<?php

declare(strict_types=1);

require_once __DIR__ . '/HubOwnerAuthService.php';
require_once __DIR__ . '/HubTrustPolicy.php';
require_once __DIR__ . '/HubUpdateTargetRegistry.php';
require_once __DIR__ . '/HubInfrastructureService.php';
require_once __DIR__ . '/HubCapabilityRegistryService.php';

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
    public const PLATFORM_CAPABILITY='system.platform.release';
    private const CANONICAL_GIT_REPO='/srv/awh-git/awh.git';
    private const SOURCE_PROMOTION_CHAIN_LIMIT=400;

    private function __construct(private readonly PDO $pdo, private readonly HubOwnerAuthService $auth, private readonly string $capability, private readonly string $releaseMode, private readonly string $releaseTrack, private readonly string $productionBranch, private readonly string $displayName) {}
    public static function fromPdo(PDO $pdo): self { return new self($pdo,HubOwnerAuthService::fromPdo($pdo),self::CAPABILITY,'AWH_CORE','awh','production','AWH'); }
    public static function platformFromPdo(PDO $pdo): self { return new self($pdo,HubOwnerAuthService::fromPdo($pdo),self::PLATFORM_CAPABILITY,'PLATFORM_HARDENING','vps-platform','platform/production','VPS Update'); }

    public function status(string $token): array
    {
        $owner=$this->ownerSession($token);
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.state AS execution_state,e.attempt_count,e.last_error_code,e.checkpoint_json,e.updated_at,t.state AS task_state,t.progress,t.result_summary,t.failure_code,a.approval_id,a.status AS approval_status,a.expires_at,a.decided_at
            FROM control_task_executions e
            JOIN control_tasks t ON t.task_id=e.task_id
            LEFT JOIN control_approvals a ON a.task_id=e.task_id AND a.action='deployment.approve'
            WHERE e.project_id=:project AND e.required_capability=:capability AND t.user_id=:owner
            ORDER BY e.updated_at DESC,e.execution_id DESC LIMIT 20");
        $q->execute(['project'=>self::PROJECT_ID,'capability'=>$this->capability,'owner'=>$owner['user_id']]);
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
        $releaseNotes=$this->deploymentReleaseNotes($sourcePromotion);
        $sourceChainReady=!is_array($sourcePromotion)||($sourcePromotion['authority']??null)!=='CANONICAL_SHARED_REPO_CHAIN_INCOMPLETE';
        $releaseDetailsReady=$sourceChainReady&&HubUpdateTargetRegistry::releaseDetailsReady($releaseNotes,true);
        $releaseBlocker=!$sourceChainReady?'CORE_RELEASE_SOURCE_CHAIN_INCOMPLETE':($releaseDetailsReady?null:'CORE_RELEASE_DETAILS_REQUIRED');
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
        $runtimeProductionSha=$this->canonicalProductionSha();
        $trackProductionSha=$this->canonicalRefSha($this->productionBranch);
        return ['schemaVersion'=>1,'capability'=>$this->capability,'releaseTrack'=>$this->releaseTrack,'displayName'=>$this->displayName,'runtimeProductionSha'=>$runtimeProductionSha,'trackProductionSha'=>$trackProductionSha,'sourcePromotion'=>$sourcePromotion,'releaseNotes'=>$releaseNotes,'releaseDetailsReady'=>$releaseDetailsReady,'releaseBlocker'=>$releaseBlocker,'roadmap'=>$roadmap,'knownIssues'=>$knownIssues,'history'=>$history,'releases'=>$rows,'policy'=>HubTrustPolicy::describe($this->capability)];
    }

    public function request(string $token,string $csrf,array $payload,?string $now=null): array
    {
        self::keys($payload,['cleanupTopology','releaseSha','schemaVersion']);
        if(($payload['schemaVersion']??null)!==1||!is_bool($payload['cleanupTopology']??null))throw new HubCoreReleaseException('Core release request is invalid','CORE_RELEASE_INVALID');
        $sha=strtolower(trim((string)($payload['releaseSha']??'')));
        if(!preg_match('/^[0-9a-f]{40}$/',$sha))throw new HubCoreReleaseException('Release SHA is invalid','CORE_RELEASE_INVALID');
        $owner=$this->ownerMutation($token,$csrf,$now);
        $at=self::time($now??gmdate('c'));
        $completed=$this->completedCurrentRelease($sha,(bool)$payload['cleanupTopology']);
        if(is_array($completed))return $this->idempotentResponse($completed,$sha);
        $latest=$this->latestSourcePromotion();
        if(is_array($latest)&&($latest['authority']??null)==='CANONICAL_SHARED_REPO_CHAIN_INCOMPLETE')
            throw new HubCoreReleaseException('Shared source chain is incomplete for this release target','CORE_RELEASE_NOT_READY');
        if(!is_array($latest)||!is_string($latest['sha']??null)||!hash_equals((string)$latest['sha'],$sha))
            throw new HubCoreReleaseException('Core release target is no longer canonical','CORE_RELEASE_TARGET_MOVED');
        $deploymentNotes=$this->deploymentReleaseNotes($latest);
        if(!HubUpdateTargetRegistry::releaseDetailsReady($deploymentNotes,true))
            throw new HubCoreReleaseException('Core release details are required before approval','CORE_RELEASE_DETAILS_REQUIRED');
        $missionId=is_string($latest['missionExecutionId']??null)?strtolower((string)$latest['missionExecutionId']):'';
        $artifactDigest=is_string($latest['artifactDigest']??null)?strtolower((string)$latest['artifactDigest']):'';
        if(!self::uuidValid($missionId)||preg_match('/^[a-f0-9]{64}$/',$artifactDigest)!==1)
            throw new HubCoreReleaseException('Release source is missing exact Mission/artifact scope','CORE_RELEASE_SCOPE_REQUIRED');
        try{
            $scopeEnvelope=(new HubScopeAuthorizer($this->pdo))->forMission($missionId);
            if(!hash_equals((string)($scopeEnvelope['projectId']??''),self::PROJECT_ID))
                throw new HubScopeAuthorizerException('Release source Mission belongs to another project','PROJECT_SCOPE_VIOLATION');
            if(!hash_equals((string)($scopeEnvelope['repository']??''),'awh'))
                throw new HubScopeAuthorizerException('Release source scope belongs to another repository','PROJECT_SCOPE_VIOLATION');
            if(!hash_equals((string)($scopeEnvelope['releaseTrack']??''),$this->releaseTrack))
                throw new HubScopeAuthorizerException('Release source scope belongs to another release track','RELEASE_TRACK_SCOPE_VIOLATION');
        }catch(HubScopeAuthorizerException $error){throw new HubCoreReleaseException($error->getMessage(),$error->codeName);}
        $scopeId=(string)$scopeEnvelope['scopeId'];
        $this->reconcileOrphanedRelease($at);
        $this->supersedeQueuedReleaseIfTargetMoved($sha,$at);
        $existing=$this->activeRelease();
        if(is_array($existing)){
            $checkpoint=self::checkpoint((string)$existing['checkpoint_json'],false);
            if(is_string($checkpoint['releaseSha']??null)&&hash_equals($checkpoint['releaseSha'],$sha)){
                $existing=$this->resumeLegacyPendingRelease($existing,(string)$owner['user_id'],$at);
                return ['schemaVersion'=>1,'taskId'=>(string)$existing['task_id'],'executionId'=>(string)$existing['execution_id'],'approvalId'=>$existing['approval_id']===null?null:(string)$existing['approval_id'],'state'=>(string)$existing['task_state'],'releaseSha'=>$sha,'idempotent'=>true];
            }
            throw new HubCoreReleaseException('Another core release is already active','CORE_RELEASE_CONFLICT');
        }

        $task=self::uuid();$execution=self::uuid();$approval=self::uuid();
        $notesJson=json_encode($deploymentNotes,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
        $notesSha=hash('sha256',$notesJson);
        $checkpoint=['schemaVersion'=>1,'mode'=>'CORE_RELEASE','releaseSha'=>$sha,'releaseMode'=>$this->releaseMode,'releaseTrack'=>$this->releaseTrack,'cleanupTopology'=>$payload['cleanupTopology'],'transport'=>'LOCAL','releaseNotesSha256'=>$notesSha,'missionExecutionId'=>$missionId,'scopeId'=>$scopeId,'artifactDigest'=>$artifactDigest];
        $scope=['schemaVersion'=>1,'taskId'=>$task,'projectId'=>self::PROJECT_ID,'releaseSha'=>$sha,'releaseMode'=>$this->releaseMode,'releaseTrack'=>$this->releaseTrack,'cleanupTopology'=>$payload['cleanupTopology'],'transport'=>'LOCAL','risk'=>'CRITICAL','releaseNotesSha256'=>$notesSha,'missionExecutionId'=>$missionId,'scopeId'=>$scopeId,'artifactDigest'=>$artifactDigest];
        $goal='Deploy '.$this->displayName.' release '.substr($sha,0,12).' ผ่าน bounded VPS-native release controller';
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $concurrent=$this->activeRelease();
            if(is_array($concurrent)){
                $concurrentCheckpoint=self::checkpoint((string)$concurrent['checkpoint_json'],false);
                if(is_string($concurrentCheckpoint['releaseSha']??null)&&hash_equals((string)$concurrentCheckpoint['releaseSha'],$sha)){
                    $this->pdo->exec('ROLLBACK');
                    return $this->idempotentResponse($concurrent,$sha);
                }
                throw new HubCoreReleaseException('Another core release is already active','CORE_RELEASE_CONFLICT');
            }
            $completed=$this->completedCurrentRelease($sha,(bool)$payload['cleanupTopology']);
            if(is_array($completed)){
                $this->pdo->exec('ROLLBACK');
                return $this->idempotentResponse($completed,$sha);
            }
            $attempt=$this->releaseAttemptCount($sha,(bool)$payload['cleanupTopology']);
            $key=self::PROJECT_ID.'.'.$this->releaseTrack.'.release.'.substr($sha,0,12).'.'.substr($artifactDigest,0,16).'.cleanup'.($payload['cleanupTopology']?'1':'0').'.attempt'.$attempt;
            $this->pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,:goal,'WAITING_FOR_WORKER',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$task,'user'=>$owner['user_id'],'project'=>self::PROJECT_ID,'goal'=>$goal,'key'=>$key,'at'=>$at]);
            $this->pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS',:capability,'QUEUED',NULL,NULL,0,NULL,:checkpoint,NULL,:at,:at)")->execute(['execution'=>$execution,'task'=>$task,'project'=>self::PROJECT_ID,'capability'=>$this->capability,'checkpoint'=>json_encode($checkpoint,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'at'=>$at]);
            (new HubCapabilityRegistryService($this->pdo))->ensureExecutionEnvelope($execution,$at);
            $this->pdo->prepare("INSERT INTO control_approvals(approval_id,task_id,action,scope_json,status,expires_at,decided_at) VALUES(:approval,:task,'deployment.approve',:scope,'APPROVED',:expires,:decided)")->execute(['approval'=>$approval,'task'=>$task,'scope'=>json_encode($scope,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'expires'=>gmdate('c',strtotime($at)+1800),'decided'=>$at]);
            $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:event,:task,'WAITING_FOR_WORKER',0,:message,:at)")->execute(['event'=>self::uuid(),'task'=>$task,'message'=>$this->displayName.' release ได้รับ Owner authority แล้ว กำลังรอ release controller','at'=>$at]);
            $this->pdo->exec('COMMIT');
        }catch(Throwable $error){
            $this->rollback();
            if($error instanceof HubCoreReleaseException)throw $error;
            throw new HubCoreReleaseException('Core release request could not be queued','CORE_RELEASE_QUEUE_FAILED');
        }
        return ['schemaVersion'=>1,'taskId'=>$task,'executionId'=>$execution,'approvalId'=>$approval,'state'=>'WAITING_FOR_WORKER','releaseSha'=>$sha,'idempotent'=>false];
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
            if(HubTrustPolicy::requiresStepUp($this->capability))HubOwnerAuthService::assertRecentStepUpSession($row,$now);
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
        $q->execute(['capability'=>$this->capability]);$row=$q->fetch();
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
        $q->execute(['capability'=>$this->capability,'at'=>$at]);return $q->fetchColumn()!==false;
    }

    public static function supersedeQueuedForSourcePromotion(PDO $pdo,string $releaseTrack,string $targetSha,string $at,bool $strict=false): int
    {
        $track=strtolower(trim($releaseTrack));$target=strtolower(trim($targetSha));
        if(preg_match('/^[0-9a-f]{40}$/',$target)!==1)return 0;
        $service=match($track){
            'awh'=>self::fromPdo($pdo),
            'vps-platform'=>self::platformFromPdo($pdo),
            default=>null,
        };
        return $service instanceof self?$service->supersedeQueuedReleaseIfTargetMoved($target,$at,$strict):0;
    }

    private function supersedeQueuedReleaseIfTargetMoved(string $targetSha,string $at,bool $strict=false): int
    {
        $count=0;
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.state AS execution_state,e.lease_owner,e.checkpoint_json,t.state AS task_state,a.approval_id,a.status AS approval_status
            FROM control_task_executions e
            JOIN control_tasks t ON t.task_id=e.task_id
            LEFT JOIN control_approvals a ON a.task_id=e.task_id AND a.action='deployment.approve'
            WHERE e.required_capability=:capability
              AND e.state IN ('QUEUED','WAITING_FOR_CAPABILITY')
              AND e.lease_owner IS NULL
              AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED')
            ORDER BY e.updated_at DESC");
        $q->execute(['capability'=>$this->capability]);
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
                $this->pdo->exec('COMMIT');$count++;
            }catch(Throwable $error){
                $this->rollback();
                if($strict)throw new HubCoreReleaseException('Queued release reconciliation failed','CORE_RELEASE_SUPERSEDE_FAILED');
            }
        }
        return $count;
    }

    private function resumeLegacyPendingRelease(array $existing,string $ownerUser,string $at): array
    {
        if(($existing['task_state']??null)!=='WAITING_FOR_APPROVAL'||($existing['execution_state']??null)!=='QUEUED'||($existing['approval_status']??null)!=='PENDING')return $existing;
        $task=(string)($existing['task_id']??'');$approval=(string)($existing['approval_id']??'');$user=(string)($existing['user_id']??'');
        $expires=strtotime((string)($existing['expires_at']??''));
        if($task===''||$approval===''||$user===''||!hash_equals($user,$ownerUser)||$expires===false||$expires<=strtotime($at))return $existing;
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $a=$this->pdo->prepare("UPDATE control_approvals SET status='APPROVED',decided_at=:at WHERE approval_id=:approval AND task_id=:task AND action='deployment.approve' AND status='PENDING' AND expires_at>:at");
            $a->execute(['at'=>$at,'approval'=>$approval,'task'=>$task]);
            $t=$this->pdo->prepare("UPDATE control_tasks SET state='WAITING_FOR_WORKER',progress=0,failure_code=NULL,updated_at=:at WHERE task_id=:task AND user_id=:user AND state='WAITING_FOR_APPROVAL'");
            $t->execute(['at'=>$at,'task'=>$task,'user'=>$ownerUser]);
            if($a->rowCount()!==1||$t->rowCount()!==1){$this->pdo->exec('ROLLBACK');$fresh=$this->activeRelease();return is_array($fresh)?$fresh:$existing;}
            $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:event,:task,'WAITING_FOR_WORKER',0,:message,:at)")
                ->execute(['event'=>self::uuid(),'task'=>$task,'message'=>$this->displayName.' ใช้คำขอเดิมต่อโดยอัตโนมัติ ไม่สร้าง release ซ้ำ','at'=>$at]);
            $this->pdo->exec('COMMIT');
            $existing['task_state']='WAITING_FOR_WORKER';$existing['approval_status']='APPROVED';$existing['decided_at']=$at;
            return $existing;
        }catch(Throwable $error){$this->rollback();throw new HubCoreReleaseException('Legacy release could not resume safely','CORE_RELEASE_QUEUE_FAILED');}
    }

    /** @return array<string,mixed> */
    private function idempotentResponse(array $row,string $sha): array
    {
        return ['schemaVersion'=>1,'taskId'=>(string)$row['task_id'],'executionId'=>(string)$row['execution_id'],
            'approvalId'=>$row['approval_id']===null?null:(string)$row['approval_id'],'state'=>(string)$row['task_state'],
            'releaseSha'=>$sha,'idempotent'=>true];
    }

    private function completedCurrentRelease(string $sha,bool $cleanupTopology): ?array
    {
        $runtime=$this->canonicalProductionSha();$track=$this->canonicalRefSha($this->productionBranch);
        if(!is_string($runtime)||!is_string($track)||!hash_equals($track,$sha))return null;
        if($this->releaseTrack==='awh'&&(!hash_equals($runtime,$sha)||$this->awhRuntimeNeedsRepair()))return null;
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.checkpoint_json,t.state AS task_state,a.approval_id
            FROM control_task_executions e
            JOIN control_tasks t ON t.task_id=e.task_id
            LEFT JOIN control_approvals a ON a.task_id=e.task_id AND a.action='deployment.approve'
            WHERE e.project_id=:project AND e.required_capability=:capability AND e.state='COMPLETED' AND t.state='COMPLETED'
            ORDER BY e.updated_at DESC,e.execution_id DESC LIMIT 20");
        $q->execute(['project'=>self::PROJECT_ID,'capability'=>$this->capability]);
        foreach($q->fetchAll() as $row){
            $checkpoint=self::checkpoint((string)$row['checkpoint_json'],false);
            if(is_string($checkpoint['releaseSha']??null)&&hash_equals((string)$checkpoint['releaseSha'],$sha)
                &&($checkpoint['cleanupTopology']??null)===$cleanupTopology)return $row;
        }
        return null;
    }

    private function awhRuntimeNeedsRepair(): bool
    {
        try{return (HubInfrastructureService::releaseState()['componentState']??'UNKNOWN')==='SPLIT';}
        catch(Throwable){return false;}
    }

    private function releaseAttemptCount(string $sha,bool $cleanupTopology): int
    {
        $q=$this->pdo->prepare("SELECT checkpoint_json FROM control_task_executions
            WHERE project_id=:project AND required_capability=:capability ORDER BY created_at ASC,execution_id ASC");
        $q->execute(['project'=>self::PROJECT_ID,'capability'=>$this->capability]);$count=0;
        foreach($q->fetchAll() as $row){
            $checkpoint=self::checkpoint((string)$row['checkpoint_json'],false);
            if(is_string($checkpoint['releaseSha']??null)&&hash_equals((string)$checkpoint['releaseSha'],$sha)
                &&($checkpoint['cleanupTopology']??null)===$cleanupTopology)$count++;
        }
        return $count;
    }

    private function activeRelease(): ?array
    {
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.state AS execution_state,e.checkpoint_json,t.state AS task_state,t.user_id,a.approval_id,a.status AS approval_status,a.expires_at,a.decided_at
            FROM control_task_executions e
            JOIN control_tasks t ON t.task_id=e.task_id
            LEFT JOIN control_approvals a ON a.task_id=e.task_id AND a.action='deployment.approve'
            WHERE e.required_capability=:capability
              AND e.state IN ('QUEUED','LEASED','RUNNING','WAITING_FOR_CAPABILITY')
              AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED')
            ORDER BY e.updated_at DESC LIMIT 1");
        $q->execute(['capability'=>$this->capability]);$row=$q->fetch();
        return is_array($row)?$row:null;
    }

    private function latestSourcePromotion(): ?array
    {
        $audit=null;
        $q=$this->pdo->prepare("SELECT checkpoint_json,updated_at FROM control_task_executions WHERE project_id=:project AND required_capability='source.promote' AND state='COMPLETED' ORDER BY updated_at DESC,execution_id DESC LIMIT ".self::SOURCE_PROMOTION_CHAIN_LIMIT);
        $q->execute(['project'=>self::PROJECT_ID]);
        foreach($q->fetchAll() as $row){
            try{$checkpoint=json_decode((string)$row['checkpoint_json'],true,16,JSON_THROW_ON_ERROR);}catch(Throwable){continue;}
            if(!is_array($checkpoint)||($checkpoint['repository']??null)!=='awh')continue;
            $target=strtolower((string)($checkpoint['targetSha']??''));$base=strtolower((string)($checkpoint['expectedMainSha']??''));
            if(preg_match('/^[0-9a-f]{40}$/',$target)!==1||preg_match('/^[0-9a-f]{40}$/',$base)!==1)continue;
            $notes=is_array($checkpoint['releaseNotes']??null)?$checkpoint['releaseNotes']:null;
            $track=is_array($notes)&&is_string($notes['releaseTrack']??null)?strtolower((string)$notes['releaseTrack']):null;
            if($track===null){
                // Historical source-promotion metadata predates explicit release tracks.
                // Keep those records on the legacy AWH source chain; never reclassify
                // history from today's platform/production pointer.
                $track='awh';
                if(is_array($notes))$notes=['releaseTrack'=>$track]+$notes;
            }
            if(!hash_equals($track,$this->releaseTrack))continue;
            $audit=['sha'=>$target,'previousSha'=>$base,'authority'=>'SOURCE_PROMOTION_AUDIT','releaseTrack'=>$track,'observedAt'=>(string)$row['updated_at']];
            $missionId=is_string($checkpoint['missionExecutionId']??null)?strtolower((string)$checkpoint['missionExecutionId']):null;
            $bundleSha=is_string($checkpoint['bundleSha256']??null)?strtolower((string)$checkpoint['bundleSha256']):null;
            if(is_string($missionId)&&preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/',$missionId)===1)$audit['missionExecutionId']=$missionId;
            if(is_string($bundleSha)&&preg_match('/^[a-f0-9]{64}$/',$bundleSha)===1)$audit['artifactDigest']=$bundleSha;
            if(is_array($notes))$audit['releaseNotes']=$notes;
            break;
        }
        if(is_array($audit)){
            $main=$this->canonicalMainSha();
            if(is_string($main)&&hash_equals((string)$audit['sha'],$main))$audit['authority']='CANONICAL_GIT_MAIN_VERIFIED';
            return $this->sharedRepoDeploySnapshot($audit);
        }
        if($this->releaseTrack!=='awh')return null;
        $main=$this->canonicalMainSha();
        $platformProduction=$this->canonicalRefSha('platform/production');
        if(is_string($main)&&is_string($platformProduction)&&hash_equals($main,$platformProduction))return null;
        return is_string($main)?['sha'=>$main,'previousSha'=>null,'authority'=>'LEGACY_CANONICAL_GIT_MAIN','releaseTrack'=>'awh','observedAt'=>null]:null;
    }

    private function sharedRepoDeploySnapshot(array $audit): array
    {
        $trackSha=strtolower((string)($audit['sha']??''));
        $main=$this->canonicalMainSha();$platform=$this->canonicalRefSha('platform/production');
        if(preg_match('/^[0-9a-f]{40}$/',$trackSha)!==1||!is_string($main)||!is_string($platform))return $audit;
        if($this->releaseTrack==='awh'){
            if(hash_equals($trackSha,$main)||!hash_equals($main,$platform))return $audit;
            if(!$this->sourcePromotionChainConnects($main,$trackSha))return $audit;
            $audit['trackPromotionSha']=$trackSha;
            $audit['sha']=$main;
            $audit['authority']='CANONICAL_SHARED_REPO_MAIN_VERIFIED';
            return $audit;
        }
        if($this->releaseTrack!=='vps-platform'||hash_equals($trackSha,$main))return $audit;
        $chain=$this->sourcePromotionChain($platform,$main);
        if(!is_array($chain)){
            $audit['authority']='CANONICAL_SHARED_REPO_CHAIN_INCOMPLETE';
            return $audit;
        }
        $platformSegments=array_values(array_filter($chain,static fn(array $segment): bool => hash_equals((string)($segment['track']??''),'vps-platform')));
        $latestPlatformTarget=$platformSegments===[]?$platform:(string)$platformSegments[count($platformSegments)-1]['target'];
        if(!hash_equals($latestPlatformTarget,$trackSha)){
            $audit['authority']='CANONICAL_SHARED_REPO_CHAIN_INCOMPLETE';
            return $audit;
        }
        $closure=array_map(static fn(array $segment): array => [
            'base'=>(string)$segment['base'],
            'target'=>(string)$segment['target'],
            'track'=>(string)$segment['track'],
            'bundleSha256'=>(string)$segment['bundleSha256'],
        ],$chain);
        $chainDigest=hash('sha256',json_encode($closure,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
        $audit['platformAnchorSha']=$trackSha;
        $audit['anchorArtifactDigest']=$audit['artifactDigest']??null;
        $audit['sha']=$main;
        $audit['previousSha']=$platform;
        $audit['artifactDigest']=$chainDigest;
        $audit['sourceChainDigest']=$chainDigest;
        $audit['sourceChainSegmentCount']=count($chain);
        $audit['authority']='CANONICAL_SOURCE_CHAIN_VERIFIED';
        return $audit;
    }

    /** @return list<array{base:string,target:string,track:string,bundleSha256:string,missionExecutionId:?string,updatedAt:string}>|null */
    private function sourcePromotionChain(string $base,string $target): ?array
    {
        if(preg_match('/^[a-f0-9]{40}$/',$base)!==1||preg_match('/^[a-f0-9]{40}$/',$target)!==1)return null;
        if(hash_equals($base,$target))return [];
        $q=$this->pdo->prepare("SELECT checkpoint_json,updated_at FROM control_task_executions WHERE project_id=:project AND required_capability='source.promote' AND state='COMPLETED' ORDER BY updated_at DESC,execution_id DESC LIMIT ".self::SOURCE_PROMOTION_CHAIN_LIMIT);
        $q->execute(['project'=>self::PROJECT_ID]);$byTarget=[];
        foreach($q->fetchAll() as $row){
            try{$checkpoint=json_decode((string)$row['checkpoint_json'],true,16,JSON_THROW_ON_ERROR);}catch(Throwable){continue;}
            if(!is_array($checkpoint)||($checkpoint['repository']??null)!=='awh')continue;
            $segmentTarget=strtolower((string)($checkpoint['targetSha']??''));$segmentBase=strtolower((string)($checkpoint['expectedMainSha']??''));
            $bundle=strtolower((string)($checkpoint['bundleSha256']??''));$notes=$checkpoint['releaseNotes']??null;
            if(preg_match('/^[a-f0-9]{40}$/',$segmentTarget)!==1||preg_match('/^[a-f0-9]{40}$/',$segmentBase)!==1||preg_match('/^[a-f0-9]{64}$/',$bundle)!==1||!is_array($notes))continue;
            $track=is_string($notes['releaseTrack']??null)?strtolower((string)$notes['releaseTrack']):'awh';
            if(!isset($byTarget[$segmentTarget]))$byTarget[$segmentTarget]=[
                'base'=>$segmentBase,'target'=>$segmentTarget,'track'=>$track,'bundleSha256'=>$bundle,
                'missionExecutionId'=>is_string($checkpoint['missionExecutionId']??null)?strtolower((string)$checkpoint['missionExecutionId']):null,
                'updatedAt'=>(string)$row['updated_at'],
            ];
        }
        $cursor=$target;$reverse=[];$seen=[];
        for($i=0;$i<self::SOURCE_PROMOTION_CHAIN_LIMIT&&!hash_equals($cursor,$base);$i++){
            if(isset($seen[$cursor])||!isset($byTarget[$cursor]))return null;
            $seen[$cursor]=true;$segment=$byTarget[$cursor];$reverse[]=$segment;$cursor=(string)$segment['base'];
        }
        if(!hash_equals($cursor,$base))return null;
        return array_reverse($reverse);
    }

    private function sourcePromotionChainConnects(string $target,string $ancestor): bool
    {
        return is_array($this->sourcePromotionChain($ancestor,$target));
    }

    private function canonicalMainSha(): ?string
    {
        return $this->canonicalRefSha('main');
    }

    private function canonicalRefSha(string $branch): ?string
    {
        if(!in_array($branch,['main','production','runtime/production','platform/production'],true))return null;
        $configured=getenv('AWH_CORE_CANONICAL_GIT');
        $path=is_string($configured)&&$configured!==''?$configured:self::CANONICAL_GIT_REPO;
        if(!str_starts_with($path,'/')||is_link($path))return null;
        $repo=realpath($path);if(!is_string($repo)||!is_dir($repo))return null;
        $ref=$repo.'/refs/heads/'.$branch;
        if(is_file($ref)&&!is_link($ref)&&is_readable($ref)){
            $sha=strtolower(trim((string)file_get_contents($ref)));
            if(preg_match('/^[0-9a-f]{40}$/',$sha)===1)return $sha;
        }
        $packed=$repo.'/packed-refs';
        if(!is_file($packed)||is_link($packed)||!is_readable($packed)||filesize($packed)>8*1024*1024)return null;
        $needle='refs/heads/'.$branch;
        foreach(preg_split('/\r?\n/',(string)file_get_contents($packed))?:[] as $line){
            if($line===''||$line[0]==='#'||$line[0]==='^')continue;
            $parts=preg_split('/\s+/',trim($line));
            if(!is_array($parts)||count($parts)!==2||$parts[1]!==$needle)continue;
            $sha=strtolower((string)$parts[0]);if(preg_match('/^[0-9a-f]{40}$/',$sha)===1)return $sha;
        }
        return null;
    }


    /** @return array<string,mixed> */
    private function deploymentReleaseNotes(?array $latest): array
    {
        $production=$this->canonicalProductionSha();
        $releaseTarget=is_array($latest)&&is_string($latest['sha']??null)?strtolower((string)$latest['sha']):null;
        $fallback=is_array($latest['releaseNotes']??null)?$latest['releaseNotes']:$this->fallbackReleaseNotes();
        if($releaseTarget===null||preg_match('/^[0-9a-f]{40}$/',$releaseTarget)!==1||$production===null||hash_equals($releaseTarget,$production))return $fallback;

        $q=$this->pdo->prepare("SELECT checkpoint_json,updated_at FROM control_task_executions
            WHERE project_id=:project AND required_capability='source.promote' AND state='COMPLETED'
            ORDER BY updated_at DESC,execution_id DESC LIMIT ".self::SOURCE_PROMOTION_CHAIN_LIMIT);
        $q->execute(['project'=>self::PROJECT_ID]);
        $byTarget=[];
        foreach($q->fetchAll() as $row){
            try{$checkpoint=json_decode((string)$row['checkpoint_json'],true,16,JSON_THROW_ON_ERROR);}catch(Throwable){continue;}
            if(!is_array($checkpoint)||($checkpoint['repository']??null)!=='awh')continue;
            $segmentTarget=strtolower((string)($checkpoint['targetSha']??''));$base=strtolower((string)($checkpoint['expectedMainSha']??''));
            $notes=$checkpoint['releaseNotes']??null;
            if(preg_match('/^[0-9a-f]{40}$/',$segmentTarget)!==1||preg_match('/^[0-9a-f]{40}$/',$base)!==1||!is_array($notes)||!HubUpdateTargetRegistry::releaseDetailsReady($notes,true))continue;
            $track=is_string($notes['releaseTrack']??null)?strtolower((string)$notes['releaseTrack']):'awh';
            if(!isset($byTarget[$segmentTarget]))$byTarget[$segmentTarget]=['base'=>$base,'track'=>$track,'notes'=>$notes,'updatedAt'=>(string)$row['updated_at']];
        }

        $cursor=$releaseTarget;$segments=[];$seen=[];
        for($i=0;$i<self::SOURCE_PROMOTION_CHAIN_LIMIT&&!hash_equals($cursor,$production);$i++){
            if(isset($seen[$cursor])||!isset($byTarget[$cursor]))return $this->incompleteDeploymentReleaseNotes($production,$releaseTarget);
            $seen[$cursor]=true;$segment=$byTarget[$cursor];$segments[]=$segment;$cursor=(string)$segment['base'];
        }
        if(!hash_equals($cursor,$production)||$segments===[])return $this->incompleteDeploymentReleaseNotes($production,$releaseTarget);
        $segments=array_reverse($segments);

        $groups=['features'=>[],'improvements'=>[],'fixes'=>[],'internal'=>[]];$commits=[];$commitSeen=[];$touches=0;$trackSegments=[];
        $impact=['databaseMigration'=>'NONE','serviceReload'=>'NONE','appRestart'=>'NONE','signIn'=>'NONE','plannedDowntime'=>false];
        $compat=['data'=>'COMPATIBLE','runtime'=>'COMPATIBLE','authentication'=>'UNCHANGED'];
        foreach($segments as $segment){
            $notes=$segment['notes'];
            // Shared-repository dependencies may carry operational impact even when
            // their user-facing release notes belong to another track. Preserve
            // those safety signals without reclassifying their features/fixes.
            if(($notes['impact']['databaseMigration']??'NONE')!=='NONE')$impact['databaseMigration']='AUTOMATIC';
            if(($notes['impact']['serviceReload']??'NONE')!=='NONE')$impact['serviceReload']='AUTOMATIC';
            if(($notes['impact']['appRestart']??'NONE')!=='NONE')$impact['appRestart']='MAY_BE_REQUIRED';
            if(($notes['impact']['signIn']??'NONE')!=='NONE')$impact['signIn']='MAY_BE_REQUIRED';
            $impact['plannedDowntime']=$impact['plannedDowntime']||(($notes['impact']['plannedDowntime']??false)===true);
            if(($notes['compatibility']['data']??'COMPATIBLE')!=='COMPATIBLE')$compat['data']='MIGRATION_REQUIRED';
            if(($notes['compatibility']['runtime']??'COMPATIBLE')!=='COMPATIBLE')$compat['runtime']='RESTART_MAY_BE_REQUIRED';
            if(($notes['compatibility']['authentication']??'UNCHANGED')!=='UNCHANGED')$compat['authentication']='SIGN_IN_MAY_BE_REQUIRED';

            // Source topology can legitimately cross another release track in the shared repo.
            // Preserve continuity, but aggregate product-facing change details only from this track.
            if(!hash_equals((string)($segment['track']??''),$this->releaseTrack))continue;
            $trackSegments[]=$segment;
            foreach(array_keys($groups) as $category)foreach((array)($notes['summary'][$category]??[]) as $label){
                if(is_string($label)&&trim($label)!==''&&!in_array($label,$groups[$category],true)&&count($groups[$category])<12)$groups[$category][]=trim($label);
            }
            foreach((array)($notes['commits']??[]) as $commit){
                if(!is_array($commit))continue;$sha=strtolower((string)($commit['sha']??''));
                if(preg_match('/^[0-9a-f]{40}$/',$sha)!==1||isset($commitSeen[$sha])||count($commits)>=40)continue;
                $commitSeen[$sha]=true;$commits[]=$commit;
            }
            $touches+=max(0,(int)($notes['changedFileCount']??0));
        }
        if($trackSegments===[]){
            $anchor=is_array($latest)&&is_string($latest['platformAnchorSha']??null)?strtolower((string)$latest['platformAnchorSha']):null;
            $dependencyOnly=$this->releaseTrack==='vps-platform'
                &&($latest['authority']??null)==='CANONICAL_SOURCE_CHAIN_VERIFIED'
                &&is_string($anchor)&&hash_equals($anchor,$production);
            if(!$dependencyOnly)return $this->incompleteDeploymentReleaseNotes($production,$releaseTarget);
            $latestSegment=$segments[count($segments)-1];$latestNotes=$latestSegment['notes'];
            return [
                'schemaVersion'=>1,'metadataState'=>'READY','generatedFrom'=>'SOURCE_PROMOTION_CHAIN_DEPENDENCY_ONLY',
                'repository'=>'awh','releaseTrack'=>$this->releaseTrack,'previousSha'=>$production,'targetSha'=>$releaseTarget,
                'generatedAt'=>$latestNotes['generatedAt']??$latestSegment['updatedAt'],
                'ownerSummary'=>'ซิงก์ shared-source dependencies ที่ผ่านการตรวจสอบแล้ว','userVisible'=>false,
                'summary'=>['features'=>[],'improvements'=>[],'fixes'=>[],'internal'=>['Sync verified shared-source dependencies after the deployed VPS Platform anchor']],
                'commits'=>[],'changedFileCount'=>0,'changedFileCountMode'=>'TRACK_ONLY','promotionCount'=>0,'chainSegmentCount'=>count($segments),
                'impact'=>$impact,'compatibility'=>$compat,
                'rollback'=>['required'=>true,'strategy'=>'PREVIOUS_VERIFIED_RELEASE_OR_SOURCE','sourceSha'=>$production],
                'knownIssues'=>[],'comingNext'=>[],
            ];
        }
        $latestTrackSegment=$trackSegments[count($trackSegments)-1];$latestNotes=$latestTrackSegment['notes'];
        $visible=array_values(array_merge($groups['features'],$groups['improvements'],$groups['fixes']));
        return [
            'schemaVersion'=>1,'metadataState'=>'READY','generatedFrom'=>'SOURCE_PROMOTION_CHAIN_EXACT_GIT_DIFF',
            'repository'=>'awh','releaseTrack'=>$this->releaseTrack,'previousSha'=>$production,'targetSha'=>$releaseTarget,
            'generatedAt'=>$latestNotes['generatedAt']??$latestTrackSegment['updatedAt'],
            'ownerSummary'=>$visible[0]??'ไม่มีการเปลี่ยนแปลงที่ผู้ใช้เห็น','userVisible'=>$visible!==[],
            'summary'=>$groups,'commits'=>$commits,'changedFileCount'=>$touches,'changedFileCountMode'=>'SEGMENT_TOUCHES','promotionCount'=>count($trackSegments),'chainSegmentCount'=>count($segments),
            'impact'=>$impact,'compatibility'=>$compat,
            'rollback'=>['required'=>true,'strategy'=>'PREVIOUS_VERIFIED_RELEASE_OR_SOURCE','sourceSha'=>$production],
            'knownIssues'=>is_array($latestNotes['knownIssues']??null)?$latestNotes['knownIssues']:[],
            'comingNext'=>is_array($latestNotes['comingNext']??null)?$latestNotes['comingNext']:[],
        ];
    }

    /** @return array<string,mixed> */
    private function incompleteDeploymentReleaseNotes(string $production,string $target): array
    {
        return [
            'schemaVersion'=>1,'metadataState'=>'INCOMPLETE','generatedFrom'=>'SOURCE_PROMOTION_CHAIN',
            'repository'=>'awh','releaseTrack'=>$this->releaseTrack,'previousSha'=>$production,'targetSha'=>$target,'generatedAt'=>null,
            'ownerSummary'=>'Release details chain is incomplete','userVisible'=>false,
            'summary'=>['features'=>[],'improvements'=>[],'fixes'=>[],'internal'=>[]],'commits'=>[],'changedFileCount'=>0,
            'impact'=>['databaseMigration'=>'UNKNOWN','serviceReload'=>'UNKNOWN','appRestart'=>'UNKNOWN','signIn'=>'UNKNOWN','plannedDowntime'=>false],
            'compatibility'=>['data'=>'UNKNOWN','runtime'=>'UNKNOWN','authentication'=>'UNKNOWN'],
            'rollback'=>['required'=>true,'strategy'=>'PREVIOUS_VERIFIED_RELEASE_OR_SOURCE','sourceSha'=>$production],
            'knownIssues'=>[],'comingNext'=>[],
        ];
    }

    private function canonicalProductionSha(): ?string
    {
        if($this->releaseTrack==='vps-platform')
            return $this->canonicalRefSha('platform/production') ?? $this->canonicalRefSha('runtime/production') ?? $this->canonicalRefSha('production');
        return $this->canonicalRefSha('production') ?? $this->canonicalRefSha('runtime/production');
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
        if(!is_array($v)||array_is_list($v)){if(!$strict)return [];throw new HubCoreReleaseException('Core release checkpoint is invalid','CORE_RELEASE_CHECKPOINT_INVALID');}
        $legacy=['cleanupTopology','mode','releaseMode','releaseSha','schemaVersion','transport'];
        $legacyNotes=['cleanupTopology','mode','releaseMode','releaseNotesSha256','releaseSha','schemaVersion','transport'];
        $current=['cleanupTopology','mode','releaseMode','releaseNotesSha256','releaseSha','releaseTrack','schemaVersion','transport'];
        $scoped=['artifactDigest','cleanupTopology','missionExecutionId','mode','releaseMode','releaseNotesSha256','releaseSha','releaseTrack','schemaVersion','scopeId','transport'];
        $actual=array_keys($v);sort($actual);
        $legacySorted=$legacy;$legacyNotesSorted=$legacyNotes;$currentSorted=$current;$scopedSorted=$scoped;
        sort($legacySorted);sort($legacyNotesSorted);sort($currentSorted);sort($scopedSorted);
        $mode=(string)($v['releaseMode']??'');
        $track=is_string($v['releaseTrack']??null)
            ? strtolower((string)$v['releaseTrack'])
            : match($mode){'AWH_CORE'=>'awh','PLATFORM_HARDENING'=>'vps-platform',default=>''};
        $mapping=($mode==='AWH_CORE'&&$track==='awh')||($mode==='PLATFORM_HARDENING'&&$track==='vps-platform');
        $legacyMode=in_array($mode,['AWH_CORE','PLATFORM_HARDENING'],true);
        $keysOk=$actual===$currentSorted||$actual===$scopedSorted||(($actual===$legacySorted||$actual===$legacyNotesSorted)&&$legacyMode);
        $notesSha=$v['releaseNotesSha256']??null;
        $notesOk=($actual!==$currentSorted&&$actual!==$scopedSorted)||(is_string($notesSha)&&preg_match('/^[0-9a-f]{64}$/',$notesSha)===1);
        $scopeOk=$actual!==$scopedSorted||(self::uuidValid((string)($v['missionExecutionId']??''))&&preg_match('/^scope-[a-f0-9]{32}$/',(string)($v['scopeId']??''))===1&&preg_match('/^[a-f0-9]{64}$/',(string)($v['artifactDigest']??''))===1);
        $ok=$keysOk&&$notesOk&&$scopeOk&&$mapping&&($v['schemaVersion']??null)===1&&($v['mode']??null)==='CORE_RELEASE'&&($v['transport']??null)==='LOCAL'&&is_bool($v['cleanupTopology']??null)&&is_string($v['releaseSha']??null)&&preg_match('/^[0-9a-f]{40}$/',$v['releaseSha'])===1;
        if(!$ok){if(!$strict)return [];throw new HubCoreReleaseException('Core release checkpoint is invalid','CORE_RELEASE_CHECKPOINT_INVALID');}
        $v['releaseTrack']=$track;
        return $v;
    }

    private static function keys(array $value,array $allowed): void { $actual=array_keys($value);sort($actual);sort($allowed);if($actual!==$allowed)throw new HubCoreReleaseException('Core release fields are invalid','CORE_RELEASE_INVALID'); }
    private static function time(string $value): string { if(strtotime($value)===false)throw new HubCoreReleaseException('Core release time is invalid','CORE_RELEASE_INVALID');return gmdate('c',strtotime($value)); }
    private static function uuidValid(string $value): bool { return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$value)===1; }
    private static function uuid(): string { $b=random_bytes(16);$b[6]=chr((ord($b[6])&15)|64);$b[8]=chr((ord($b[8])&63)|128);return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($b),4)); }
    private function rollback(): void { try{$this->pdo->exec('ROLLBACK');}catch(Throwable){} }
}
