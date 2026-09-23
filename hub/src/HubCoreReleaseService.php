<?php

declare(strict_types=1);

require_once __DIR__ . '/HubOwnerAuthService.php';
require_once __DIR__ . '/HubTrustPolicy.php';

final class HubCoreReleaseException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='CORE_RELEASE_FAILED') { parent::__construct($message); }
}

/**
 * Owner-facing authority for AWH core releases.
 *
 * Requests are materialized into the existing control task/execution/approval
 * authorities. This service never executes a shell command and never receives
 * a filesystem path from the browser.
 */
final class HubCoreReleaseService
{
    public const PROJECT_ID='113b45c0-23e1-408d-ae0f-ac5eca7f6900';
    public const CAPABILITY='system.core.release';

    private function __construct(private readonly PDO $pdo, private readonly HubOwnerAuthService $auth) {}
    public static function fromPdo(PDO $pdo): self { return new self($pdo,HubOwnerAuthService::fromPdo($pdo)); }

    public function status(string $token): array
    {
        $owner=$this->ownerSession($token);
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.state AS execution_state,e.attempt_count,e.last_error_code,e.checkpoint_json,e.updated_at,t.state AS task_state,t.progress,t.result_summary,t.failure_code,a.approval_id,a.status AS approval_status,a.expires_at,a.decided_at
            FROM control_task_executions e
            JOIN control_tasks t ON t.task_id=e.task_id
            LEFT JOIN control_approvals a ON a.task_id=e.task_id AND a.action='deployment.approve'
            WHERE e.project_id=:project AND e.required_capability=:capability AND t.user_id=:owner
            ORDER BY e.updated_at DESC,e.execution_id DESC LIMIT 20");
        $q->execute(['project'=>self::PROJECT_ID,'capability'=>self::CAPABILITY,'owner'=>$owner['user_id']]);
        $rows=[];
        foreach($q->fetchAll() as $row){
            $checkpoint=self::checkpoint((string)$row['checkpoint_json'],false);
            $rows[]=[
                'executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],
                'releaseSha'=>$checkpoint['releaseSha']??null,'mode'=>$checkpoint['releaseMode']??null,
                'taskState'=>(string)$row['task_state'],'executionState'=>(string)$row['execution_state'],
                'progress'=>(int)$row['progress'],'attemptCount'=>(int)$row['attempt_count'],
                'approvalId'=>$row['approval_id']===null?null:(string)$row['approval_id'],
                'approvalStatus'=>$row['approval_status']===null?null:(string)$row['approval_status'],
                'approvalExpiresAt'=>$row['expires_at']===null?null:(string)$row['expires_at'],
                'decidedAt'=>$row['decided_at']===null?null:(string)$row['decided_at'],
                'failureCode'=>$row['failure_code']===null?($row['last_error_code']===null?null:(string)$row['last_error_code']):(string)$row['failure_code'],
                'resultSummary'=>$row['result_summary']===null?null:(string)$row['result_summary'],
                'updatedAt'=>(string)$row['updated_at'],
            ];
        }
        return ['schemaVersion'=>1,'capability'=>self::CAPABILITY,'releases'=>$rows,'policy'=>HubTrustPolicy::describe('system.core.release')];
    }

    public function request(string $token,string $csrf,array $payload,?string $now=null): array
    {
        self::keys($payload,['cleanupTopology','releaseSha','schemaVersion']);
        if(($payload['schemaVersion']??null)!==1||!is_bool($payload['cleanupTopology']??null))throw new HubCoreReleaseException('Core release request is invalid','CORE_RELEASE_INVALID');
        $sha=strtolower(trim((string)($payload['releaseSha']??'')));
        if(!preg_match('/^[0-9a-f]{40}$/',$sha))throw new HubCoreReleaseException('Release SHA is invalid','CORE_RELEASE_INVALID');
        $owner=$this->ownerMutation($token,$csrf,$now);
        $at=self::time($now??gmdate('c'));
        $existing=$this->activeRelease();
        if(is_array($existing)){
            $checkpoint=self::checkpoint((string)$existing['checkpoint_json'],false);
            if(is_string($checkpoint['releaseSha']??null)&&hash_equals($checkpoint['releaseSha'],$sha)){
                return ['schemaVersion'=>1,'taskId'=>(string)$existing['task_id'],'executionId'=>(string)$existing['execution_id'],'approvalId'=>$existing['approval_id']===null?null:(string)$existing['approval_id'],'state'=>(string)$existing['task_state'],'releaseSha'=>$sha,'idempotent'=>true];
            }
            throw new HubCoreReleaseException('Another core release is already active','CORE_RELEASE_CONFLICT');
        }

        $task=self::uuid();$execution=self::uuid();$approval=self::uuid();
        $checkpoint=['schemaVersion'=>1,'mode'=>'CORE_RELEASE','releaseSha'=>$sha,'releaseMode'=>'PROJECT_SOURCE_AUTHORITY','cleanupTopology'=>$payload['cleanupTopology'],'transport'=>'LOCAL'];
        $scope=['schemaVersion'=>1,'taskId'=>$task,'projectId'=>self::PROJECT_ID,'releaseSha'=>$sha,'releaseMode'=>'PROJECT_SOURCE_AUTHORITY','cleanupTopology'=>$payload['cleanupTopology'],'transport'=>'LOCAL','risk'=>'CRITICAL'];
        $goal='Deploy AWH core release '.substr($sha,0,12).' ผ่าน bounded VPS-native release controller';
        $key='core-release.'.substr($sha,0,12).'.'.substr(str_replace('-','',$task),0,12);
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $this->pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,:goal,'WAITING_FOR_APPROVAL',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$task,'user'=>$owner['user_id'],'project'=>self::PROJECT_ID,'goal'=>$goal,'key'=>$key,'at'=>$at]);
            $this->pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS',:capability,'QUEUED',NULL,NULL,0,NULL,:checkpoint,NULL,:at,:at)")->execute(['execution'=>$execution,'task'=>$task,'project'=>self::PROJECT_ID,'capability'=>self::CAPABILITY,'checkpoint'=>json_encode($checkpoint,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'at'=>$at]);
            $this->pdo->prepare("INSERT INTO control_approvals(approval_id,task_id,action,scope_json,status,expires_at,decided_at) VALUES(:approval,:task,'deployment.approve',:scope,'PENDING',:expires,NULL)")->execute(['approval'=>$approval,'task'=>$task,'scope'=>json_encode($scope,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'expires'=>gmdate('c',strtotime($at)+1800)]);
            $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:event,:task,'WAITING_FOR_APPROVAL',0,:message,:at)")->execute(['event'=>self::uuid(),'task'=>$task,'message'=>'AWH core release ผ่าน verification boundary แล้วและรอ Owner อนุมัติ','at'=>$at]);
            $this->pdo->exec('COMMIT');
        }catch(Throwable $error){
            $this->rollback();
            if($error instanceof HubCoreReleaseException)throw $error;
            throw new HubCoreReleaseException('Core release request could not be queued','CORE_RELEASE_QUEUE_FAILED');
        }
        return ['schemaVersion'=>1,'taskId'=>$task,'executionId'=>$execution,'approvalId'=>$approval,'state'=>'WAITING_FOR_APPROVAL','releaseSha'=>$sha,'idempotent'=>false];
    }

    private function ownerSession(string $token): array
    {
        $this->ready();
        try{$session=$this->auth->authenticatedUser($token);}catch(HubOwnerAuthException $error){throw new HubCoreReleaseException('Core release authentication needs attention',$error->codeName);}
        $this->assertOwner((string)$session['userId']);
        return ['user_id'=>$session['userId']];
    }

    private function ownerMutation(string $token,string $csrf,?string $now): array
    {
        $this->ready();
        try{
            $row=$this->auth->authorize($token,$csrf,$now);
            if(HubTrustPolicy::requiresStepUp('system.core.release'))HubOwnerAuthService::assertRecentStepUpSession($row,$now);
        }catch(HubOwnerAuthException $error){throw new HubCoreReleaseException('Core release authentication needs attention',$error->codeName);}
        catch(HubTrustPolicyException){throw new HubCoreReleaseException('Core release trust policy is unavailable','CORE_RELEASE_INVALID');}
        $user=(string)$row['user_id'];$this->assertOwner($user);$this->assertCapability($user,'deployment.approve');
        return $row;
    }

    private function activeRelease(): ?array
    {
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.checkpoint_json,t.state AS task_state,a.approval_id
            FROM control_task_executions e
            JOIN control_tasks t ON t.task_id=e.task_id
            LEFT JOIN control_approvals a ON a.task_id=e.task_id AND a.action='deployment.approve'
            WHERE e.required_capability=:capability
              AND e.state IN ('QUEUED','LEASED','RUNNING','WAITING_FOR_CAPABILITY')
              AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED')
            ORDER BY e.updated_at DESC LIMIT 1");
        $q->execute(['capability'=>self::CAPABILITY]);$row=$q->fetch();
        return is_array($row)?$row:null;
    }

    private function ready(): void
    {
        foreach(['control_task_executions','control_approvals','control_project_capabilities','owner_bootstrap'] as $table){
            $q=$this->pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name");$q->execute(['name'=>$table]);
            if($q->fetchColumn()===false)throw new HubCoreReleaseException('Core release authority is not ready','CORE_RELEASE_NOT_READY');
        }
        $q=$this->pdo->prepare('SELECT 1 FROM projects WHERE project_id=:project');$q->execute(['project'=>self::PROJECT_ID]);
        if($q->fetchColumn()===false)throw new HubCoreReleaseException('Canonical AWH project is unavailable','CORE_RELEASE_NOT_READY');
    }

    private function assertOwner(string $user): void
    {
        $owner=$this->pdo->query('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id=1 AND bootstrap_closed=1')->fetchColumn();
        if(!is_string($owner)||!hash_equals($owner,$user))throw new HubCoreReleaseException('Owner access is required','OWNER_FORBIDDEN');
    }

    private function assertCapability(string $user,string $capability): void
    {
        $q=$this->pdo->prepare('SELECT 1 FROM control_project_capabilities WHERE user_id=:user AND project_id=:project AND capability=:capability AND revoked_at IS NULL');
        $q->execute(['user'=>$user,'project'=>self::PROJECT_ID,'capability'=>$capability]);
        if($q->fetchColumn()===false)throw new HubCoreReleaseException('Deployment approval capability is required','PROJECT_FORBIDDEN');
    }

    /** @return array<string,mixed> */
    public static function checkpoint(string $json,bool $strict=true): array
    {
        try{$v=json_decode($json,true,16,JSON_THROW_ON_ERROR);}catch(Throwable){if(!$strict)return [];throw new HubCoreReleaseException('Core release checkpoint is invalid','CORE_RELEASE_CHECKPOINT_INVALID');}
        $keys=['cleanupTopology','mode','releaseMode','releaseSha','schemaVersion','transport'];
        if(!is_array($v)||array_is_list($v)){if(!$strict)return [];throw new HubCoreReleaseException('Core release checkpoint is invalid','CORE_RELEASE_CHECKPOINT_INVALID');}
        $actual=array_keys($v);sort($actual);$expected=$keys;sort($expected);
        $ok=$actual===$expected&&($v['schemaVersion']??null)===1&&($v['mode']??null)==='CORE_RELEASE'&&($v['releaseMode']??null)==='PROJECT_SOURCE_AUTHORITY'&&($v['transport']??null)==='LOCAL'&&is_bool($v['cleanupTopology']??null)&&is_string($v['releaseSha']??null)&&preg_match('/^[0-9a-f]{40}$/',$v['releaseSha'])===1;
        if(!$ok){if(!$strict)return [];throw new HubCoreReleaseException('Core release checkpoint is invalid','CORE_RELEASE_CHECKPOINT_INVALID');}
        return $v;
    }

    private static function keys(array $value,array $allowed): void { $actual=array_keys($value);sort($actual);sort($allowed);if($actual!==$allowed)throw new HubCoreReleaseException('Core release fields are invalid','CORE_RELEASE_INVALID'); }
    private static function time(string $value): string { if(strtotime($value)===false)throw new HubCoreReleaseException('Core release time is invalid','CORE_RELEASE_INVALID');return gmdate('c',strtotime($value)); }
    private static function uuid(): string { $b=random_bytes(16);$b[6]=chr((ord($b[6])&15)|64);$b[8]=chr((ord($b[8])&63)|128);return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($b),4)); }
    private function rollback(): void { try{$this->pdo->exec('ROLLBACK');}catch(Throwable){} }
}
