<?php
declare(strict_types=1);

final class HubExecutionLifecycleService
{
    public const LEASE_RETRY_WINDOW_SECONDS = 86400;

    public function __construct(private readonly PDO $pdo)
    {
        $this->pdo->exec('PRAGMA foreign_keys=ON');
        $this->pdo->exec('PRAGMA busy_timeout=5000');
    }

    /** @return array{expiredRetryCount:int} */
    public function reconcile(?string $projectId=null, ?string $now=null): array
    {
        $at=self::timestamp($now??gmdate('c'));
        $cutoff=gmdate('c',strtotime($at)-self::LEASE_RETRY_WINDOW_SECONDS);
        $params=['cutoff'=>$cutoff];
        $projectSql='';
        if($projectId!==null){
            if(!self::uuid($projectId)) throw new RuntimeException('Execution lifecycle project id is invalid');
            $projectSql=' AND e.project_id=:project';
            $params['project']=strtolower($projectId);
        }
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id WHERE e.state IN ('QUEUED','WAITING_FOR_CAPABILITY') AND t.state IN ('QUEUED','WAITING_FOR_WORKER') AND COALESCE(e.last_error_code,t.failure_code)='LEASE_EXPIRED' AND e.lease_owner IS NULL AND e.updated_at<=:cutoff".$projectSql." ORDER BY e.updated_at,e.execution_id LIMIT 100");
        $q->execute($params); $rows=$q->fetchAll(PDO::FETCH_ASSOC);
        if($rows===[]) return ['expiredRetryCount'=>0];
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $count=0;
            foreach($rows as $row){
                $execution=(string)($row['execution_id']??''); $task=(string)($row['task_id']??'');
                if(!self::uuid($execution)||!self::uuid($task)) continue;
                $u=$this->pdo->prepare("UPDATE control_task_executions SET state='FAILED',lease_owner=NULL,lease_expires_at=NULL,last_error_code='LEASE_RETRY_WINDOW_EXPIRED',updated_at=:at WHERE execution_id=:execution AND state IN ('QUEUED','WAITING_FOR_CAPABILITY') AND lease_owner IS NULL");
                $u->execute(['at'=>$at,'execution'=>$execution]); if($u->rowCount()!==1) continue;
                $this->pdo->prepare("UPDATE control_tasks SET state='FAILED',assigned_device_id=NULL,lease_expires_at=NULL,progress=100,result_summary='Expired retry window was terminalized safely',failure_code='LEASE_RETRY_WINDOW_EXPIRED',updated_at=:at WHERE task_id=:task AND state IN ('QUEUED','WAITING_FOR_WORKER')")->execute(['at'=>$at,'task'=>$task]);
                if(self::tablePresent($this->pdo,'control_execution_envelopes')) $this->pdo->prepare("UPDATE control_execution_envelopes SET state='RELEASED',lease_expires_at=NULL,updated_at=:at WHERE execution_id=:execution AND state NOT IN ('RELEASED','CANCELLED')")->execute(['at'=>$at,'execution'=>$execution]);
                if(self::tablePresent($this->pdo,'control_task_events')) $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:event,:task,'FAILED',100,'lease retry window expired; stale queue terminalized safely',:at)")->execute(['event'=>self::newUuid(),'task'=>$task,'at'=>$at]);
                $count++;
            }
            $this->pdo->exec('COMMIT');
            return ['expiredRetryCount'=>$count];
        }catch(Throwable $error){
            try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}
            throw $error;
        }
    }

    private static function tablePresent(PDO $pdo,string $table): bool
    {
        $q=$pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name");$q->execute(['name'=>$table]);return $q->fetchColumn()!==false;
    }
    private static function timestamp(string $value): string
    {
        $stamp=strtotime($value);if($stamp===false)throw new RuntimeException('Execution lifecycle time is invalid');return gmdate('c',$stamp);
    }
    private static function uuid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$value)===1;
    }
    private static function newUuid(): string
    {
        $bytes=random_bytes(16);$bytes[6]=chr((ord($bytes[6])&0x0f)|0x40);$bytes[8]=chr((ord($bytes[8])&0x3f)|0x80);$hex=bin2hex($bytes);return substr($hex,0,8).'-'.substr($hex,8,4).'-'.substr($hex,12,4).'-'.substr($hex,16,4).'-'.substr($hex,20);
    }
}
