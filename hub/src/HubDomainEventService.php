<?php
declare(strict_types=1);

final class HubDomainEventException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='DOMAIN_EVENT_FAILED'){parent::__construct($message);}
}

final class HubDomainEventService
{
    private const MAX_PAYLOAD_BYTES=65536;
    private const MAX_ATTEMPTS=5;
    private const LEASE_SECONDS=120;

    public function __construct(private readonly PDO $pdo)
    {
        $this->pdo->exec('PRAGMA foreign_keys=ON');
        $this->pdo->exec('PRAGMA busy_timeout=5000');
    }

    public function publish(string $topic,array $payload,string $idempotencyKey,?string $projectId=null,?string $occurredAt=null): array
    {
        $topic=self::topic($topic); $key=self::key($idempotencyKey);
        if($projectId!==null&&!self::uuid($projectId)) throw new HubDomainEventException('Invalid project','DOMAIN_EVENT_INVALID');
        $json=json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        if(strlen($json)>self::MAX_PAYLOAD_BYTES) throw new HubDomainEventException('Payload too large','DOMAIN_EVENT_TOO_LARGE');
        $sha=hash('sha256',$json); $at=self::time($occurredAt??gmdate('c')); $event=self::uuidNew();
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $q=$this->pdo->prepare('SELECT event_id,topic,payload_sha256,state,occurred_at FROM control_domain_events WHERE idempotency_key=:key');
            $q->execute(['key'=>$key]); $old=$q->fetch();
            if(is_array($old)){
                if(!hash_equals((string)$old['topic'],$topic)||!hash_equals((string)$old['payload_sha256'],$sha))
                    throw new HubDomainEventException('Idempotency conflict','DOMAIN_EVENT_IDEMPOTENCY_CONFLICT');
                $this->pdo->exec('COMMIT');
                return ['eventId'=>(string)$old['event_id'],'state'=>(string)$old['state'],'deduplicated'=>true,'occurredAt'=>(string)$old['occurred_at']];
            }
            $q=$this->pdo->prepare("INSERT INTO control_domain_events(event_id,project_id,topic,aggregate_type,aggregate_id,payload_json,payload_sha256,state,attempt_count,lease_owner,lease_expires_at,next_attempt_at,last_error_code,idempotency_key,occurred_at,created_at,updated_at,delivered_at) VALUES(:event,:project,:topic,NULL,NULL,:payload,:sha,'PENDING',0,NULL,NULL,:at,NULL,:key,:at,:at,:at,NULL)");
            $q->execute(['event'=>$event,'project'=>$projectId,'topic'=>$topic,'payload'=>$json,'sha'=>$sha,'key'=>$key,'at'=>$at]);
            $this->pdo->exec('COMMIT');
            return ['eventId'=>$event,'state'=>'PENDING','deduplicated'=>false,'occurredAt'=>$at];
        }catch(Throwable $e){try{$this->pdo->exec('ROLLBACK');}catch(Throwable){} if($e instanceof HubDomainEventException)throw $e; throw new HubDomainEventException('Publish failed','DOMAIN_EVENT_PUBLISH_FAILED');}
    }

    public function claim(string $owner,int $limit=10,?string $now=null): array
    {
        $owner=self::owner($owner); if($limit<1||$limit>50)throw new HubDomainEventException('Invalid limit','DOMAIN_EVENT_INVALID');
        $at=self::time($now??gmdate('c')); $lease=gmdate('c',strtotime($at)+self::LEASE_SECONDS);
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $this->pdo->prepare("UPDATE control_domain_events SET state='PENDING',lease_owner=NULL,lease_expires_at=NULL,last_error_code='EVENT_LEASE_EXPIRED',next_attempt_at=:at,updated_at=:at WHERE state='PROCESSING' AND lease_expires_at<=:at")->execute(['at'=>$at]);
            $q=$this->pdo->prepare("SELECT event_id FROM control_domain_events WHERE state='PENDING' AND attempt_count<:max AND (next_attempt_at IS NULL OR next_attempt_at<=:at) ORDER BY occurred_at,event_id LIMIT :limit");
            $q->bindValue(':max',self::MAX_ATTEMPTS,PDO::PARAM_INT); $q->bindValue(':at',$at); $q->bindValue(':limit',$limit,PDO::PARAM_INT); $q->execute();
            $out=[];
            foreach($q->fetchAll(PDO::FETCH_COLUMN) as $event){
                $u=$this->pdo->prepare("UPDATE control_domain_events SET state='PROCESSING',attempt_count=attempt_count+1,lease_owner=:owner,lease_expires_at=:lease,updated_at=:at WHERE event_id=:event AND state='PENDING'");
                $u->execute(['owner'=>$owner,'lease'=>$lease,'at'=>$at,'event'=>$event]); if($u->rowCount()!==1)continue;
                $r=$this->pdo->prepare('SELECT event_id,project_id,topic,payload_json,attempt_count,occurred_at FROM control_domain_events WHERE event_id=:event');$r->execute(['event'=>$event]);$row=$r->fetch();
                if(is_array($row))$out[]=['eventId'=>(string)$row['event_id'],'projectId'=>$row['project_id'],'topic'=>(string)$row['topic'],'payload'=>json_decode((string)$row['payload_json'],true),'attemptCount'=>(int)$row['attempt_count'],'occurredAt'=>(string)$row['occurred_at'],'leaseExpiresAt'=>$lease];
            }
            $this->pdo->exec('COMMIT'); return $out;
        }catch(Throwable $e){try{$this->pdo->exec('ROLLBACK');}catch(Throwable){} throw new HubDomainEventException('Claim failed','DOMAIN_EVENT_CLAIM_FAILED');}
    }

    public function acknowledge(string $eventId,string $owner,?string $now=null): void
    {
        $q=$this->pdo->prepare("UPDATE control_domain_events SET state='DELIVERED',lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=NULL,last_error_code=NULL,delivered_at=:at,updated_at=:at WHERE event_id=:event AND state='PROCESSING' AND lease_owner=:owner");
        $q->execute(['at'=>self::time($now??gmdate('c')),'event'=>self::uuidRequired($eventId),'owner'=>self::owner($owner)]);
        if($q->rowCount()!==1)throw new HubDomainEventException('Lease lost','DOMAIN_EVENT_LEASE_LOST');
    }
    public function fail(string $eventId,string $owner,string $code,?string $now=null): array
    {
        $eventId=self::uuidRequired($eventId);$owner=self::owner($owner);
        if(preg_match('/^[A-Z0-9_]{2,80}$/',$code)!==1)throw new HubDomainEventException('Invalid error code','DOMAIN_EVENT_INVALID');
        $at=self::time($now??gmdate('c'));
        $this->pdo->exec('BEGIN IMMEDIATE');
        try{
            $q=$this->pdo->prepare("SELECT attempt_count FROM control_domain_events WHERE event_id=:event AND state='PROCESSING' AND lease_owner=:owner");
            $q->execute(['event'=>$eventId,'owner'=>$owner]);$attempt=$q->fetchColumn();
            if($attempt===false)throw new HubDomainEventException('Lease lost','DOMAIN_EVENT_LEASE_LOST');
            $attempt=(int)$attempt;$dead=$attempt>=self::MAX_ATTEMPTS;$next=$dead?null:gmdate('c',strtotime($at)+min(3600,60*(2**max(0,$attempt-1))));
            $u=$this->pdo->prepare("UPDATE control_domain_events SET state=:state,lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=:next,last_error_code=:code,updated_at=:at WHERE event_id=:event AND state='PROCESSING' AND lease_owner=:owner");
            $u->execute(['state'=>$dead?'DEAD':'PENDING','next'=>$next,'code'=>$code,'at'=>$at,'event'=>$eventId,'owner'=>$owner]);
            if($u->rowCount()!==1)throw new HubDomainEventException('Lease lost','DOMAIN_EVENT_LEASE_LOST');
            $this->pdo->exec('COMMIT'); return ['state'=>$dead?'DEAD':'PENDING','attemptCount'=>$attempt,'nextAttemptAt'=>$next];
        }catch(Throwable $e){try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}throw $e;}
    }

    public function stats(): array
    {
        $out=['PENDING'=>0,'PROCESSING'=>0,'DELIVERED'=>0,'DEAD'=>0];
        foreach($this->pdo->query('SELECT state,COUNT(*) total FROM control_domain_events GROUP BY state')->fetchAll() as $r){$s=(string)$r['state'];if(isset($out[$s]))$out[$s]=(int)$r['total'];}
        return ['schemaVersion'=>1,'states'=>$out,'pending'=>$out['PENDING']+$out['PROCESSING'],'dead'=>$out['DEAD']];
    }
    private static function topic(string $v): string {$v=strtolower(trim($v));if(preg_match('/^[a-z][a-z0-9_.-]{2,79}$/',$v)!==1)throw new HubDomainEventException('Invalid topic','DOMAIN_EVENT_INVALID');return $v;}
    private static function key(string $v): string {$v=trim($v);if(preg_match('/^[A-Za-z0-9._:-]{8,160}$/',$v)!==1)throw new HubDomainEventException('Invalid key','DOMAIN_EVENT_INVALID');return $v;}
    private static function owner(string $v): string {if(preg_match('/^[a-z][a-z0-9:._-]{2,63}$/',$v)!==1)throw new HubDomainEventException('Invalid owner','DOMAIN_EVENT_INVALID');return $v;}
    private static function time(string $v): string {$t=strtotime($v);if($t===false)throw new HubDomainEventException('Invalid time','DOMAIN_EVENT_INVALID');return gmdate('c',$t);}
    private static function uuid(string $v): bool {return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$v)===1;}
    private static function uuidRequired(string $v): string {if(!self::uuid($v))throw new HubDomainEventException('Invalid event id','DOMAIN_EVENT_INVALID');return strtolower($v);}
    private static function uuidNew(): string {$b=random_bytes(16);$b[6]=chr((ord($b[6])&0x0f)|0x40);$b[8]=chr((ord($b[8])&0x3f)|0x80);$h=bin2hex($b);return substr($h,0,8).'-'.substr($h,8,4).'-'.substr($h,12,4).'-'.substr($h,16,4).'-'.substr($h,20);}
}
