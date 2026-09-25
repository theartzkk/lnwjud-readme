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
    private const CANONICAL_GIT_REPO='/srv/awh-git/awh.git';

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
        $sourcePromotion=$this->latestSourcePromotion();
        $releaseNotes=is_array($sourcePromotion['releaseNotes']??null)?$sourcePromotion['releaseNotes']:$this->fallbackReleaseNotes();
        $roadmap=is_array($releaseNotes['comingNext']??null)?$releaseNotes['comingNext']:$this->fallbackRoadmap()['comingNext'];
        $knownIssues=is_array($releaseNotes['knownIssues']??null)?$releaseNotes['knownIssues']:$this->fallbackRoadmap()['knownIssues'];
        $history=[];
        foreach($rows as $row){
            if(!in_array((string)($row['taskState']??''),['COMPLETED','FAILED','CANCELLED'],true))continue;
            $history[]=[
                'releaseSha'=>$row['releaseSha']??null,'state'=>$row['taskState']??null,'resultSummary'=>$row['resultSummary']??null,
                'failureCode'=>$row['failureCode']??null,'updatedAt'=>$row['updatedAt']??null,
            ];
            if(count($history)>=12)break;
        }
        return ['schemaVersion'=>1,'capability'=>self::CAPABILITY,'sourcePromotion'=>$sourcePromotion,'releaseNotes'=>$releaseNotes,'roadmap'=>$roadmap,'knownIssues'=>$knownIssues,'history'=>$history,'releases'=>$rows,'policy'=>HubTrustPolicy::describe('system.core.release')];
    }

    public function request(string $token,string $csrf,array $payload,?string $now=null): array
    {
        self::keys($payload,['cleanupTopology','releaseSha','schemaVersion']);
        if(($payload['schemaVersion']??null)!==1||!is_bool($payload['cleanupTopology']??null))throw new HubCoreReleaseException('Core release request is invalid','CORE_RELEASE_INVALID');
        $sha=strtolower(trim((string)($payload['releaseSha']??'')));
        if(!preg_match('/^[0-9a-f]{40}$/',$sha))throw new HubCoreReleaseException('Release SHA is invalid','CORE_RELEASE_INVALID');
        $owner=$this->ownerMutation($token,$csrf,$now);
        $at=self::time($now??gmdate('c'));
        $latest=$this->latestSourcePromotion();
        if(!is_array($latest)||!is_string($latest['sha']??null)||!hash_equals((string)$latest['sha'],$sha))
            throw new HubCoreReleaseException('Core release target is no longer canonical','CORE_RELEASE_TARGET_MOVED');
        $this->reconcileOrphanedRelease($at);
        $this->supersedeQueuedReleaseIfTargetMoved($sha,$at);
        $existing=$this->activeRelease();
        if(is_array($existing)){
            $checkpoint=self::checkpoint((string)$existing['checkpoint_json'],false);
            if(is_string($checkpoint['releaseSha']??null)&&hash_equals($checkpoint['releaseSha'],$sha)){
                return ['schemaVersion'=>1,'taskId'=>(string)$existing['task_id'],'executionId'=>(string)$existing['execution_id'],'approvalId'=>$existing['approval_id']===null?null:(string)$existing['approval_id'],'state'=>(string)$existing['task_state'],'releaseSha'=>$sha,'idempotent'=>true];
            }
            throw new HubCoreReleaseException('Another core release is already active','CORE_RELEASE_CONFLICT');
        }

        $task=self::uuid();$execution=self::uuid();$approval=self::uuid();
        $checkpoint=['schemaVersion'=>1,'mode'=>'CORE_RELEASE','releaseSha'=>$sha,'releaseMode'=>'IDENTITY_CONVERGENCE','cleanupTopology'=>$payload['cleanupTopology'],'transport'=>'LOCAL'];
        $scope=['schemaVersion'=>1,'taskId'=>$task,'projectId'=>self::PROJECT_ID,'releaseSha'=>$sha,'releaseMode'=>'IDENTITY_CONVERGENCE','cleanupTopology'=>$payload['cleanupTopology'],'transport'=>'LOCAL','risk'=>'CRITICAL'];
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

    private function reconcileOrphanedRelease(string $at): void
    {
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.state AS execution_state,e.updated_at,t.state AS task_state,a.approval_id,a.status AS approval_status,a.expires_at
            FROM control_task_executions e
            JOIN control_tasks t ON t.task_id=e.task_id
            LEFT JOIN control_approvals a ON a.task_id=e.task_id AND a.action='deployment.approve'
            WHERE e.required_capability=:capability
              AND e.state='QUEUED'
              AND t.state IN ('WAITING_FOR_APPROVAL','WAITING_FOR_WORKER')
            ORDER BY e.updated_at DESC LIMIT 1");
        $q->execute(['capability'=>self::CAPABILITY]);$row=$q->fetch();
        if(!is_array($row))return;
        $code=null;$summary=null;$expireApproval=false;
        $now=strtotime($at);$updated=strtotime((string)$row['updated_at']);
        if(($row['approval_status']??null)==='PENDING'&&strtotime((string)($row['expires_at']??''))!==false&&strtotime((string)$row['expires_at'])<=$now){
            $code='CORE_RELEASE_APPROVAL_EXPIRED';$summary='คำขอปล่อยรุ่นหมดอายุและถูกปิดอัตโนมัติ';$expireApproval=true;
        }elseif(($row['approval_status']??null)==='APPROVED'&&($row['task_state']??null)==='WAITING_FOR_WORKER'&&$updated!==false&&$now-$updated>=300&&!$this->coreDispatcherHeartbeatFresh($at)){
            $code='CORE_RELEASE_DISPATCHER_UNAVAILABLE';$summary='Core Release dispatcher ไม่พร้อมเกินช่วงปลอดภัย ระบบปิดงานค้างอัตโนมัติ';
        }
        if($code===null||$summary===null)return;
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            if($expireApproval&&is_string($row['approval_id']??null))$this->pdo->prepare("UPDATE control_approvals SET status='EXPIRED' WHERE approval_id=:approval AND status='PENDING'")->execute(['approval'=>$row['approval_id']]);
            $u=$this->pdo->prepare("UPDATE control_task_executions SET state='FAILED',lease_owner=NULL,lease_expires_at=NULL,last_error_code=:code,updated_at=:at WHERE execution_id=:execution AND state='QUEUED'");
            $u->execute(['code'=>$code,'at'=>$at,'execution'=>$row['execution_id']]);
            if($u->rowCount()===1){
                $this->pdo->prepare("UPDATE control_tasks SET state='FAILED',progress=0,result_summary=:summary,failure_code=:code,lease_expires_at=NULL,updated_at=:at WHERE task_id=:task AND state IN ('WAITING_FOR_APPROVAL','WAITING_FOR_WORKER')")->execute(['summary'=>$summary,'code'=>$code,'at'=>$at,'task'=>$row['task_id']]);
                $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:event,:task,'FAILED',0,:message,:at)")->execute(['event'=>self::uuid(),'task'=>$row['task_id'],'message'=>$summary.' · '.$code,'at'=>$at]);
            }
            $this->pdo->exec('COMMIT');
        }catch(Throwable){$this->rollback();}
    }

    private function coreDispatcherHeartbeatFresh(string $at): bool
    {
        $table=$this->pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='control_executor_capabilities'");
        $table->execute();if($table->fetchColumn()===false)return true;
        $q=$this->pdo->prepare("SELECT 1 FROM control_executor_capabilities WHERE executor_id='vps-core-release' AND capability=:capability AND expires_at>:at LIMIT 1");
        $q->execute(['capability'=>self::CAPABILITY,'at'=>$at]);return $q->fetchColumn()!==false;
    }

    private function supersedeQueuedReleaseIfTargetMoved(string $targetSha,string $at): void
    {
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.state AS execution_state,e.lease_owner,e.checkpoint_json,t.state AS task_state,a.approval_id,a.status AS approval_status
            FROM control_task_executions e
            JOIN control_tasks t ON t.task_id=e.task_id
            LEFT JOIN control_approvals a ON a.task_id=e.task_id AND a.action='deployment.approve'
            WHERE e.required_capability=:capability
              AND e.state IN ('QUEUED','WAITING_FOR_CAPABILITY')
              AND e.lease_owner IS NULL
              AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED')
            ORDER BY e.updated_at DESC");
        $q->execute(['capability'=>self::CAPABILITY]);
        foreach($q->fetchAll() as $row){
            $checkpoint=self::checkpoint((string)$row['checkpoint_json'],false);
            $queuedSha=strtolower((string)($checkpoint['releaseSha']??''));
            if(preg_match('/^[0-9a-f]{40}$/',$queuedSha)!==1||hash_equals($queuedSha,$targetSha))continue;
            try{
                $this->pdo->exec('BEGIN IMMEDIATE');
                $cancel=$this->pdo->prepare("UPDATE control_task_executions SET state='CANCELLED',lease_owner=NULL,lease_expires_at=NULL,last_error_code='CORE_RELEASE_SUPERSEDED',updated_at=:at WHERE execution_id=:execution AND state IN ('QUEUED','WAITING_FOR_CAPABILITY') AND lease_owner IS NULL");
                $cancel->execute(['at'=>$at,'execution'=>$row['execution_id']]);
                if($cancel->rowCount()!==1){$this->pdo->exec('ROLLBACK');continue;}
                $summary='คำขอ AWH รุ่นเก่าถูกแทนด้วย Source ล่าสุดโดยอัตโนมัติ';
                $this->pdo->prepare("UPDATE control_tasks SET state='CANCELLED',progress=0,result_summary=:summary,failure_code=NULL,assigned_device_id=NULL,lease_expires_at=NULL,cancelled_at=:at,updated_at=:at WHERE task_id=:task AND state NOT IN ('COMPLETED','FAILED','CANCELLED')")
                    ->execute(['summary'=>$summary,'at'=>$at,'task'=>$row['task_id']]);
                if(($row['approval_status']??null)==='PENDING'&&is_string($row['approval_id']??null))
                    $this->pdo->prepare("UPDATE control_approvals SET status='EXPIRED' WHERE approval_id=:approval AND status='PENDING'")->execute(['approval'=>$row['approval_id']]);
                $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:event,:task,'CANCELLED',0,:message,:at)")
                    ->execute(['event'=>self::uuid(),'task'=>$row['task_id'],'message'=>$summary.' · CORE_RELEASE_SUPERSEDED · latest '.substr($targetSha,0,12),'at'=>$at]);
                $this->pdo->exec('COMMIT');
            }catch(Throwable){$this->rollback();}
        }
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

    private function latestSourcePromotion(): ?array
    {
        $audit=null;
        $q=$this->pdo->prepare("SELECT checkpoint_json,updated_at FROM control_task_executions WHERE project_id=:project AND required_capability='source.promote' AND state='COMPLETED' ORDER BY updated_at DESC,execution_id DESC LIMIT 20");
        $q->execute(['project'=>self::PROJECT_ID]);
        foreach($q->fetchAll() as $row){
            try{$checkpoint=json_decode((string)$row['checkpoint_json'],true,16,JSON_THROW_ON_ERROR);}catch(Throwable){continue;}
            if(!is_array($checkpoint)||($checkpoint['repository']??null)!=='awh')continue;
            $target=strtolower((string)($checkpoint['targetSha']??''));$base=strtolower((string)($checkpoint['expectedMainSha']??''));
            if(preg_match('/^[0-9a-f]{40}$/',$target)===1&&preg_match('/^[0-9a-f]{40}$/',$base)===1){
                $audit=['sha'=>$target,'previousSha'=>$base,'authority'=>'SOURCE_PROMOTION_AUDIT','observedAt'=>(string)$row['updated_at']];
                if(is_array($checkpoint['releaseNotes']??null))$audit['releaseNotes']=$checkpoint['releaseNotes'];
                break;
            }
        }
        $main=$this->canonicalMainSha();
        if($main===null)return $audit;
        if(is_array($audit)&&is_string($audit['sha']??null)&&hash_equals((string)$audit['sha'],$main)){
            $audit['authority']='CANONICAL_GIT_MAIN_VERIFIED';
            return $audit;
        }
        return ['sha'=>$main,'previousSha'=>is_array($audit)&&is_string($audit['sha']??null)?(string)$audit['sha']:null,
            'authority'=>'CANONICAL_GIT_MAIN','observedAt'=>is_array($audit)?($audit['observedAt']??null):null];
    }

    private function canonicalMainSha(): ?string
    {
        $configured=getenv('AWH_CORE_CANONICAL_GIT');
        $path=is_string($configured)&&$configured!==''?$configured:self::CANONICAL_GIT_REPO;
        if(!str_starts_with($path,'/')||is_link($path))return null;
        $repo=realpath($path);if(!is_string($repo)||!is_dir($repo))return null;
        $ref=$repo.'/refs/heads/main';
        if(is_file($ref)&&!is_link($ref)&&is_readable($ref)){
            $sha=strtolower(trim((string)file_get_contents($ref)));
            if(preg_match('/^[0-9a-f]{40}$/',$sha)===1)return $sha;
        }
        $packed=$repo.'/packed-refs';
        if(!is_file($packed)||is_link($packed)||!is_readable($packed)||filesize($packed)>8*1024*1024)return null;
        foreach(preg_split('/\r?\n/',(string)file_get_contents($packed))?:[] as $line){
            if($line===''||$line[0]==='#'||$line[0]==='^')continue;
            $parts=preg_split('/\s+/',trim($line));
            if(!is_array($parts)||count($parts)!==2||$parts[1]!=='refs/heads/main')continue;
            $sha=strtolower((string)$parts[0]);if(preg_match('/^[0-9a-f]{40}$/',$sha)===1)return $sha;
        }
        return null;
    }


    /** @return array<string,mixed> */
    private function fallbackReleaseNotes(): array
    {
        $roadmap=$this->fallbackRoadmap();
        return [
            'schemaVersion'=>1,'repository'=>'awh','previousSha'=>null,'targetSha'=>$this->canonicalMainSha(),
            'generatedAt'=>null,'summary'=>['features'=>[],'improvements'=>[],'fixes'=>[],'internal'=>[]],
            'commits'=>[],'changedFileCount'=>0,
            'impact'=>['databaseMigration'=>'UNKNOWN','serviceReload'=>'UNKNOWN','appRestart'=>'UNKNOWN','signIn'=>'UNKNOWN','plannedDowntime'=>false],
            'knownIssues'=>$roadmap['knownIssues'],'comingNext'=>$roadmap['comingNext'],'source'=>'ROADMAP_FALLBACK',
        ];
    }

    /** @return array{knownIssues:list<string>,comingNext:list<array<string,mixed>>} */
    private function fallbackRoadmap(): array
    {
        $result=['knownIssues'=>[],'comingNext'=>[]];
        $path=dirname(__DIR__,2).'/config/update-roadmap.json';
        if(is_link($path)||!is_file($path)||!is_readable($path))return $result;
        $size=@filesize($path);if(!is_int($size)||$size<2||$size>65536)return $result;
        try{$data=json_decode((string)file_get_contents($path),true,16,JSON_THROW_ON_ERROR);}catch(Throwable){return $result;}
        if(!is_array($data)||($data['schemaVersion']??null)!==1)return $result;
        foreach((array)($data['knownIssues']??[]) as $value){
            if(is_string($value)&&trim($value)!==''&&strlen($value)<=220&&count($result['knownIssues'])<12)$result['knownIssues'][]=trim($value);
        }
        foreach((array)($data['comingNext']??[]) as $entry){
            if(!is_array($entry)||count($result['comingNext'])>=8)continue;
            $title=is_string($entry['title']??null)?trim((string)$entry['title']):'';
            $status=is_string($entry['status']??null)?strtoupper(trim((string)$entry['status'])):'PLANNED';
            if($title===''||strlen($title)>160||!in_array($status,['PLANNED','IN_PROGRESS','REVIEW'],true))continue;
            $items=[];foreach((array)($entry['items']??[]) as $value)if(is_string($value)&&trim($value)!==''&&strlen($value)<=220&&count($items)<8)$items[]=trim($value);
            $result['comingNext'][]=['title'=>$title,'status'=>$status,'items'=>$items];
        }
        return $result;
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
        $ok=$actual===$expected&&($v['schemaVersion']??null)===1&&($v['mode']??null)==='CORE_RELEASE'&&($v['releaseMode']??null)==='IDENTITY_CONVERGENCE'&&($v['transport']??null)==='LOCAL'&&is_bool($v['cleanupTopology']??null)&&is_string($v['releaseSha']??null)&&preg_match('/^[0-9a-f]{40}$/',$v['releaseSha'])===1;
        if(!$ok){if(!$strict)return [];throw new HubCoreReleaseException('Core release checkpoint is invalid','CORE_RELEASE_CHECKPOINT_INVALID');}
        return $v;
    }

    private static function keys(array $value,array $allowed): void { $actual=array_keys($value);sort($actual);sort($allowed);if($actual!==$allowed)throw new HubCoreReleaseException('Core release fields are invalid','CORE_RELEASE_INVALID'); }
    private static function time(string $value): string { if(strtotime($value)===false)throw new HubCoreReleaseException('Core release time is invalid','CORE_RELEASE_INVALID');return gmdate('c',strtotime($value)); }
    private static function uuid(): string { $b=random_bytes(16);$b[6]=chr((ord($b[6])&15)|64);$b[8]=chr((ord($b[8])&63)|128);return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($b),4)); }
    private function rollback(): void { try{$this->pdo->exec('ROLLBACK');}catch(Throwable){} }
}
