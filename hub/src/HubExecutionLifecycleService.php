<?php
declare(strict_types=1);

require_once __DIR__ . '/HubCompletionAuthorityService.php';

final class HubExecutionLifecycleService
{
    public const LEASE_RETRY_WINDOW_SECONDS = 86400;

    public function __construct(private readonly PDO $pdo)
    {
        $this->pdo->exec('PRAGMA foreign_keys=ON');
        $this->pdo->exec('PRAGMA busy_timeout=5000');
    }

    /** @return array{expiredApprovalCount:int,expiredRetryCount:int,verifiedCompletionCount:int} */
    public function reconcile(?string $projectId=null, ?string $now=null): array
    {
        $at=self::timestamp($now??gmdate('c'));
        if($projectId!==null&&!self::uuid($projectId))throw new RuntimeException('Execution lifecycle project id is invalid');
        return [
            'expiredApprovalCount'=>$this->terminalizeExpiredApprovals($projectId,$at),
            'expiredRetryCount'=>$this->terminalizeExpiredRetries($projectId,$at),
            'verifiedCompletionCount'=>$this->publishVerifiedCompletions($projectId,$at),
        ];
    }

    private function terminalizeExpiredApprovals(?string $projectId,string $at): int
    {
        if(!self::tablePresent($this->pdo,'control_approvals')||!self::tablePresent($this->pdo,'control_task_executions'))return 0;
        $params=['at'=>$at];$projectSql='';
        if($projectId!==null){$projectSql=' AND t.project_id=:project';$params['project']=strtolower($projectId);}
        $q=$this->pdo->prepare("SELECT a.approval_id,a.task_id,e.execution_id FROM control_approvals a JOIN control_tasks t ON t.task_id=a.task_id JOIN control_task_executions e ON e.task_id=t.task_id WHERE a.status='PENDING' AND a.expires_at<=:at AND t.state='WAITING_FOR_APPROVAL' AND e.state IN ('QUEUED','WAITING_FOR_CAPABILITY') AND e.lease_owner IS NULL".$projectSql." ORDER BY a.expires_at,a.approval_id LIMIT 100");
        $q->execute($params);$rows=$q->fetchAll(PDO::FETCH_ASSOC);
        if($rows===[])return 0;
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');$count=0;
            foreach($rows as $row){
                $approval=(string)($row['approval_id']??'');$execution=(string)($row['execution_id']??'');$task=(string)($row['task_id']??'');
                if(!self::uuid($approval)||!self::uuid($execution)||!self::uuid($task))continue;
                $expire=$this->pdo->prepare("UPDATE control_approvals SET status='EXPIRED' WHERE approval_id=:approval AND status='PENDING' AND expires_at<=:at");
                $expire->execute(['approval'=>$approval,'at'=>$at]);if($expire->rowCount()!==1)continue;
                $this->pdo->prepare("UPDATE control_task_executions SET state='CANCELLED',lease_owner=NULL,lease_expires_at=NULL,last_error_code='APPROVAL_EXPIRED',updated_at=:at WHERE execution_id=:execution AND state IN ('QUEUED','WAITING_FOR_CAPABILITY') AND lease_owner IS NULL")->execute(['at'=>$at,'execution'=>$execution]);
                $this->pdo->prepare("UPDATE control_tasks SET state='CANCELLED',assigned_device_id=NULL,lease_expires_at=NULL,progress=0,result_summary='Approval expired; stale request cancelled safely and may be requested again',failure_code=NULL,cancelled_at=:at,updated_at=:at WHERE task_id=:task AND state='WAITING_FOR_APPROVAL'")->execute(['at'=>$at,'task'=>$task]);
                if(self::tablePresent($this->pdo,'control_execution_envelopes'))$this->pdo->prepare("UPDATE control_execution_envelopes SET state='CANCELLED',lease_expires_at=NULL,updated_at=:at WHERE execution_id=:execution AND state NOT IN ('RELEASED','CANCELLED')")->execute(['at'=>$at,'execution'=>$execution]);
                if(self::tablePresent($this->pdo,'control_task_events'))$this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:event,:task,'CANCELLED',0,'expired owner approval cancelled automatically; request may be retried',:at)")->execute(['event'=>self::newUuid(),'task'=>$task,'at'=>$at]);
                $count++;
            }
            $this->pdo->exec('COMMIT');return $count;
        }catch(Throwable $error){try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}throw $error;}
    }

    private function terminalizeExpiredRetries(?string $projectId,string $at): int
    {
        if(!self::tablePresent($this->pdo,'control_task_executions'))return 0;
        $cutoff=gmdate('c',strtotime($at)-self::LEASE_RETRY_WINDOW_SECONDS);
        $params=['cutoff'=>$cutoff];$projectSql='';
        if($projectId!==null){$projectSql=' AND e.project_id=:project';$params['project']=strtolower($projectId);}
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id WHERE e.state IN ('QUEUED','WAITING_FOR_CAPABILITY') AND t.state IN ('QUEUED','WAITING_FOR_WORKER') AND COALESCE(e.last_error_code,t.failure_code)='LEASE_EXPIRED' AND e.lease_owner IS NULL AND e.updated_at<=:cutoff".$projectSql." ORDER BY e.updated_at,e.execution_id LIMIT 100");
        $q->execute($params);$rows=$q->fetchAll(PDO::FETCH_ASSOC);
        if($rows===[])return 0;
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');$count=0;
            foreach($rows as $row){
                $execution=(string)($row['execution_id']??'');$task=(string)($row['task_id']??'');
                if(!self::uuid($execution)||!self::uuid($task))continue;
                $u=$this->pdo->prepare("UPDATE control_task_executions SET state='FAILED',lease_owner=NULL,lease_expires_at=NULL,last_error_code='LEASE_RETRY_WINDOW_EXPIRED',updated_at=:at WHERE execution_id=:execution AND state IN ('QUEUED','WAITING_FOR_CAPABILITY') AND lease_owner IS NULL");
                $u->execute(['at'=>$at,'execution'=>$execution]);if($u->rowCount()!==1)continue;
                $this->pdo->prepare("UPDATE control_tasks SET state='FAILED',assigned_device_id=NULL,lease_expires_at=NULL,progress=100,result_summary='Expired retry window was terminalized safely',failure_code='LEASE_RETRY_WINDOW_EXPIRED',updated_at=:at WHERE task_id=:task AND state IN ('QUEUED','WAITING_FOR_WORKER')")->execute(['at'=>$at,'task'=>$task]);
                if(self::tablePresent($this->pdo,'control_execution_envelopes'))$this->pdo->prepare("UPDATE control_execution_envelopes SET state='RELEASED',lease_expires_at=NULL,updated_at=:at WHERE execution_id=:execution AND state NOT IN ('RELEASED','CANCELLED')")->execute(['at'=>$at,'execution'=>$execution]);
                if(self::tablePresent($this->pdo,'control_task_events'))$this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:event,:task,'FAILED',100,'lease retry window expired; stale queue terminalized safely',:at)")->execute(['event'=>self::newUuid(),'task'=>$task,'at'=>$at]);
                $count++;
            }
            $this->pdo->exec('COMMIT');return $count;
        }catch(Throwable $error){try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}throw $error;}
    }

    private function publishVerifiedCompletions(?string $projectId,string $at): int
    {
        if(!self::tablePresent($this->pdo,'control_task_events'))return 0;
        $params=[];$projectSql='';
        if($projectId!==null){$projectSql=' AND t.project_id=:project';$params['project']=strtolower($projectId);}
        $q=$this->pdo->prepare("SELECT t.task_id,t.conversation_id,t.result_summary FROM control_tasks t WHERE t.state='COMPLETED'".$projectSql." AND NOT EXISTS (SELECT 1 FROM control_task_events v WHERE v.task_id=t.task_id AND v.state='COMPLETED' AND v.message LIKE 'completion verified authority=%') ORDER BY t.updated_at DESC,t.task_id DESC LIMIT 100");
        $q->execute($params);$rows=$q->fetchAll(PDO::FETCH_ASSOC);
        if($rows===[])return 0;

        $authority=new HubCompletionAuthorityService($this->pdo);$publish=[];
        foreach($rows as $row){
            $task=(string)($row['task_id']??'');if(!self::uuid($task))continue;
            try{$state=$authority->assessTask($task,$at);}catch(Throwable){continue;}
            if(($state['verified']??false)!==true||($state['publicState']??null)!=='COMPLETED')continue;
            $publish[]=$row;
        }
        if($publish===[])return 0;

        try{
            $this->pdo->exec('BEGIN IMMEDIATE');$count=0;
            foreach($publish as $row){
                $task=(string)$row['task_id'];
                $exists=$this->pdo->prepare("SELECT 1 FROM control_task_events WHERE task_id=:task AND state='COMPLETED' AND message LIKE 'completion verified authority=%' LIMIT 1");
                $exists->execute(['task'=>$task]);if($exists->fetchColumn()!==false)continue;
                $event=self::newUuid();
                $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:event,:task,'COMPLETED',100,'completion verified authority=VERIFIED_TERMINAL',:at)")->execute(['event'=>$event,'task'=>$task,'at'=>$at]);

                $conversation=is_string($row['conversation_id']??null)?(string)$row['conversation_id']:'';
                if(self::uuid($conversation)&&self::tablePresent($this->pdo,'control_conversation_messages')){
                    $final=$this->pdo->prepare("SELECT 1 FROM control_conversation_messages WHERE task_id=:task AND message_kind IN ('RESULT','ASSISTANT') LIMIT 1");
                    $final->execute(['task'=>$task]);
                    if($final->fetchColumn()===false){
                        $seq=$this->pdo->prepare('SELECT COALESCE(MAX(sequence_no),0)+1 FROM control_conversation_messages WHERE conversation_id=:conversation');
                        $seq->execute(['conversation'=>$conversation]);$sequence=(int)$seq->fetchColumn();
                        $body=is_string($row['result_summary']??null)&&trim((string)$row['result_summary'])!==''?(string)$row['result_summary']:'งานเสร็จแล้วและผ่านการยืนยัน execution/authority ครบถ้วน';
                        $body=function_exists('mb_strcut')?trim((string)mb_strcut($body,0,800,'UTF-8')):trim(substr($body,0,800));
                        $this->pdo->prepare("INSERT INTO control_conversation_messages(message_id,conversation_id,task_id,message_kind,sequence_no,body,idempotency_key,source_event_id,metadata_json,created_at) VALUES(:id,:conversation,:task,'RESULT',:sequence,:body,:key,:event,NULL,:at)")
                            ->execute(['id'=>self::newUuid(),'conversation'=>$conversation,'task'=>$task,'sequence'=>$sequence,'body'=>$body,'key'=>'verified-completion-'.$task,'event'=>$event,'at'=>$at]);
                        if(self::tablePresent($this->pdo,'control_conversations'))$this->pdo->prepare('UPDATE control_conversations SET updated_at=:at WHERE conversation_id=:conversation')->execute(['at'=>$at,'conversation'=>$conversation]);
                    }
                }
                $count++;
            }
            $this->pdo->exec('COMMIT');return $count;
        }catch(Throwable $error){try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}throw $error;}
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
