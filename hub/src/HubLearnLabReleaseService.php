<?php

declare(strict_types=1);

require_once __DIR__ . '/HubOwnerAuthService.php';
require_once __DIR__ . '/HubTrustPolicy.php';

final class HubLearnLabReleaseException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='LEARNLAB_RELEASE_FAILED') { parent::__construct($message); }
}

final class HubLearnLabReleaseService
{
    public const PROJECT_ID='a7285fbd-029b-4d17-9d26-c7497b28a72e';
    public const CAPABILITY='system.learnlab.release';
    private const CANONICAL_GIT_REPO='/srv/awh-git/bay-learnlab.git';
    private const CHANNEL_ROOT='/srv/bay-learnlab/channels';

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
                'releaseSha'=>$checkpoint['releaseSha']??null,'baseReleaseSha'=>$checkpoint['baseReleaseSha']??null,
                'runtimeVersion'=>$checkpoint['runtimeVersion']??null,'cacheEpoch'=>$checkpoint['cacheEpoch']??null,
                'mode'=>$checkpoint['releaseMode']??null,'taskState'=>(string)$row['task_state'],
                'executionState'=>(string)$row['execution_state'],'progress'=>(int)$row['progress'],
                'attemptCount'=>(int)$row['attempt_count'],'approvalId'=>$row['approval_id']===null?null:(string)$row['approval_id'],
                'approvalStatus'=>$row['approval_status']===null?null:(string)$row['approval_status'],
                'approvalExpiresAt'=>$row['expires_at']===null?null:(string)$row['expires_at'],
                'decidedAt'=>$row['decided_at']===null?null:(string)$row['decided_at'],
                'failureCode'=>$row['failure_code']===null?($row['last_error_code']===null?null:(string)$row['last_error_code']):(string)$row['failure_code'],
                'resultSummary'=>$row['result_summary']===null?null:(string)$row['result_summary'],
                'updatedAt'=>(string)$row['updated_at'],
            ];
        }
        return [
            'schemaVersion'=>1,'capability'=>self::CAPABILITY,
            'current'=>$this->currentRuntime(),'sourcePromotion'=>$this->latestSourcePromotion(),
            'releases'=>$rows,'policy'=>HubTrustPolicy::describe(self::CAPABILITY),
        ];
    }

    public function request(string $token,string $csrf,array $payload,?string $now=null): array
    {
        self::keys($payload,['releaseSha','runtimeVersion','schemaVersion']);
        if(($payload['schemaVersion']??null)!==1)throw new HubLearnLabReleaseException('LearnLab release request is invalid','LEARNLAB_RELEASE_INVALID');
        $sha=strtolower(trim((string)($payload['releaseSha']??'')));
        $version=trim((string)($payload['runtimeVersion']??''));
        if(preg_match('/^[0-9a-f]{40}$/',$sha)!==1||preg_match('/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/',$version)!==1)
            throw new HubLearnLabReleaseException('LearnLab release identity is invalid','LEARNLAB_RELEASE_INVALID');

        $owner=$this->ownerMutation($token,$csrf,$now);
        $current=$this->currentRuntime();
        if(version_compare($version,(string)$current['runtimeVersion'],'<='))
            throw new HubLearnLabReleaseException('LearnLab runtime version must advance','LEARNLAB_RELEASE_VERSION_STALE');
        $latest=$this->latestSourcePromotion();
        if(!is_array($latest)||!is_string($latest['sha']??null)||!hash_equals((string)$latest['sha'],$sha))
            throw new HubLearnLabReleaseException('LearnLab release target is no longer canonical','LEARNLAB_RELEASE_TARGET_MOVED');
        $base=(string)$current['releaseSha'];$epoch=(int)$current['cacheEpoch']+1;$vault=$this->currentVaultRevision();
        $at=self::time($now??gmdate('c'));
        $this->supersedeQueuedReleaseIfTargetMoved($sha,$at);

        $existing=$this->activeRelease();
        if(is_array($existing)){
            $checkpoint=self::checkpoint((string)$existing['checkpoint_json'],false);
            if(($checkpoint['releaseSha']??null)===$sha&&($checkpoint['runtimeVersion']??null)===$version
                &&($checkpoint['baseReleaseSha']??null)===$base&&($checkpoint['cacheEpoch']??null)===$epoch&&($checkpoint['expectedVaultRevisionId']??null)===$vault){
                return ['schemaVersion'=>1,'taskId'=>(string)$existing['task_id'],'executionId'=>(string)$existing['execution_id'],
                    'approvalId'=>$existing['approval_id']===null?null:(string)$existing['approval_id'],
                    'state'=>(string)$existing['task_state'],'releaseSha'=>$sha,'runtimeVersion'=>$version,'idempotent'=>true];
            }
            throw new HubLearnLabReleaseException('Another LearnLab release is already active','LEARNLAB_RELEASE_CONFLICT');
        }

        $task=self::uuid();$execution=self::uuid();$approval=self::uuid();
        $checkpoint=['schemaVersion'=>1,'mode'=>'LEARNLAB_RELEASE','releaseMode'=>'FILE_ONLY','releaseSha'=>$sha,
            'baseReleaseSha'=>$base,'runtimeVersion'=>$version,'cacheEpoch'=>$epoch,'expectedVaultRevisionId'=>$vault,'transport'=>'LOCAL'];
        $scope=['schemaVersion'=>1,'taskId'=>$task,'projectId'=>self::PROJECT_ID,'releaseSha'=>$sha,
            'baseReleaseSha'=>$base,'runtimeVersion'=>$version,'cacheEpoch'=>$epoch,'expectedVaultRevisionId'=>$vault,
            'releaseMode'=>'FILE_ONLY','transport'=>'LOCAL','risk'=>'CRITICAL'];
        $goal='Deploy BAY LearnLab '.$version.' '.substr($sha,0,12).' ผ่าน bounded VPS-native release controller';
        $key='learnlab-release.'.substr($sha,0,12).'.'.str_replace('.','-',$version);
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $this->pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at)
                VALUES(:task,:user,:project,:goal,'WAITING_FOR_APPROVAL',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")
                ->execute(['task'=>$task,'user'=>$owner['user_id'],'project'=>self::PROJECT_ID,'goal'=>$goal,'key'=>$key,'at'=>$at]);
            $this->pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at)
                VALUES(:execution,:task,:project,NULL,'VPS',:capability,'QUEUED',NULL,NULL,0,NULL,:checkpoint,NULL,:at,:at)")
                ->execute(['execution'=>$execution,'task'=>$task,'project'=>self::PROJECT_ID,'capability'=>self::CAPABILITY,
                    'checkpoint'=>json_encode($checkpoint,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'at'=>$at]);
            $this->pdo->prepare("INSERT INTO control_approvals(approval_id,task_id,action,scope_json,status,expires_at,decided_at)
                VALUES(:approval,:task,'deployment.approve',:scope,'PENDING',:expires,NULL)")
                ->execute(['approval'=>$approval,'task'=>$task,'scope'=>json_encode($scope,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),
                    'expires'=>gmdate('c',strtotime($at)+1800)]);
            $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at)
                VALUES(:event,:task,'WAITING_FOR_APPROVAL',0,:message,:at)")
                ->execute(['event'=>self::uuid(),'task'=>$task,'message'=>'LearnLab release ผ่าน request boundary แล้วและรอ Owner อนุมัติ','at'=>$at]);
            $this->pdo->exec('COMMIT');
        }catch(Throwable $error){
            $this->rollback();
            if($error instanceof HubLearnLabReleaseException)throw $error;
            throw new HubLearnLabReleaseException('LearnLab release request could not be queued','LEARNLAB_RELEASE_QUEUE_FAILED');
        }
        return ['schemaVersion'=>1,'taskId'=>$task,'executionId'=>$execution,'approvalId'=>$approval,
            'state'=>'WAITING_FOR_APPROVAL','releaseSha'=>$sha,'runtimeVersion'=>$version,'idempotent'=>false];
    }

    public static function checkpoint(string $json,bool $strict=true): array
    {
        try{$v=json_decode($json,true,16,JSON_THROW_ON_ERROR);}catch(Throwable){
            if(!$strict)return [];throw new HubLearnLabReleaseException('LearnLab release checkpoint is invalid','LEARNLAB_RELEASE_CHECKPOINT_INVALID');
        }
        $keys=['baseReleaseSha','cacheEpoch','expectedVaultRevisionId','mode','releaseMode','releaseSha','runtimeVersion','schemaVersion','transport'];
        if(!is_array($v)||array_is_list($v)){if(!$strict)return [];throw new HubLearnLabReleaseException('LearnLab release checkpoint is invalid','LEARNLAB_RELEASE_CHECKPOINT_INVALID');}
        $actual=array_keys($v);sort($actual);$expected=$keys;sort($expected);
        $ok=$actual===$expected&&($v['schemaVersion']??null)===1&&($v['mode']??null)==='LEARNLAB_RELEASE'
            &&($v['releaseMode']??null)==='FILE_ONLY'&&($v['transport']??null)==='LOCAL'
            &&is_string($v['releaseSha']??null)&&preg_match('/^[0-9a-f]{40}$/',$v['releaseSha'])===1
            &&is_string($v['baseReleaseSha']??null)&&preg_match('/^[0-9a-f]{40}$/',$v['baseReleaseSha'])===1
            &&is_string($v['runtimeVersion']??null)&&preg_match('/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/',$v['runtimeVersion'])===1
            &&is_int($v['cacheEpoch']??null)&&$v['cacheEpoch']>0&&is_string($v['expectedVaultRevisionId']??null)&&preg_match('/^[0-9a-f-]{36}$/i',$v['expectedVaultRevisionId'])===1;
        if(!$ok){if(!$strict)return [];throw new HubLearnLabReleaseException('LearnLab release checkpoint is invalid','LEARNLAB_RELEASE_CHECKPOINT_INVALID');}
        return $v;
    }

    private function currentRuntime(): array
    {
        $rows=[];
        foreach(['pilot','stable'] as $name){
            $path=self::channelRoot().'/'.$name.'.json';
            if(!is_file($path)||is_link($path)||!is_readable($path))throw new HubLearnLabReleaseException('LearnLab channel authority is unavailable','LEARNLAB_RELEASE_NOT_READY');
            try{$value=json_decode((string)file_get_contents($path),true,16,JSON_THROW_ON_ERROR);}catch(Throwable){
                throw new HubLearnLabReleaseException('LearnLab channel authority is invalid','LEARNLAB_RELEASE_NOT_READY');
            }
            if(!is_array($value)||array_is_list($value))throw new HubLearnLabReleaseException('LearnLab channel authority is invalid','LEARNLAB_RELEASE_NOT_READY');
            $rows[$name]=$value;
        }
        $stable=$rows['stable'];$pilot=$rows['pilot'];
        $sha=strtolower((string)($stable['release_revision']??''));$version=(string)($stable['runtime_version']??'');$epoch=(int)($stable['cache_epoch']??0);
        if(preg_match('/^[0-9a-f]{40}$/',$sha)!==1||$version===''||$epoch<1
            ||strtolower((string)($pilot['release_revision']??''))!==$sha
            ||(string)($pilot['runtime_version']??'')!==$version||(int)($pilot['cache_epoch']??0)!==$epoch)
            throw new HubLearnLabReleaseException('LearnLab pilot/stable authority is not aligned','LEARNLAB_RELEASE_NOT_READY');
        return ['runtimeVersion'=>$version,'releaseSha'=>$sha,'cacheEpoch'=>$epoch,'runtimeUrl'=>$stable['runtime_url']??null,'publishedAt'=>$stable['published_at']??null];
    }

    private static function channelRoot(): string
    {
        $override=getenv('AWH_LEARNLAB_CHANNEL_ROOT');
        if(is_string($override)&&$override!==''&&str_starts_with($override,'/')&&!str_contains($override," "))return rtrim($override,'/');
        return self::CHANNEL_ROOT;
    }

    private function currentVaultRevision(): string
    {
        $q=$this->pdo->prepare("SELECT active_revision_id,sync_state FROM control_project_vaults WHERE project_id=:project");
        $q->execute(['project'=>self::PROJECT_ID]);$row=$q->fetch();
        if(!is_array($row)||($row['sync_state']??null)!=='SYNCED'||!is_string($row['active_revision_id']??null)
            ||preg_match('/^[0-9a-f-]{36}$/i',(string)$row['active_revision_id'])!==1)
            throw new HubLearnLabReleaseException('LearnLab Vault authority is not synced','LEARNLAB_RELEASE_NOT_READY');
        return (string)$row['active_revision_id'];
    }

    private function latestSourcePromotion(): ?array
    {
        $audit=null;
        $q=$this->pdo->prepare("SELECT checkpoint_json,updated_at FROM control_task_executions WHERE project_id=:project AND required_capability='source.promote' AND state='COMPLETED' ORDER BY updated_at DESC,execution_id DESC LIMIT 20");
        $q->execute(['project'=>self::PROJECT_ID]);
        foreach($q->fetchAll() as $row){
            try{$checkpoint=json_decode((string)$row['checkpoint_json'],true,16,JSON_THROW_ON_ERROR);}catch(Throwable){continue;}
            if(!is_array($checkpoint)||($checkpoint['repository']??null)!=='bay-learnlab')continue;
            $target=strtolower((string)($checkpoint['targetSha']??''));$base=strtolower((string)($checkpoint['expectedMainSha']??''));
            if(preg_match('/^[0-9a-f]{40}$/',$target)===1&&preg_match('/^[0-9a-f]{40}$/',$base)===1){
                $audit=['sha'=>$target,'previousSha'=>$base,'authority'=>'SOURCE_PROMOTION_AUDIT','observedAt'=>(string)$row['updated_at']];
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
        $configured=getenv('AWH_LEARNLAB_CANONICAL_GIT');
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

    private function ownerSession(string $token): array
    {
        $this->ready();
        try{$session=$this->auth->authenticatedUser($token);}catch(HubOwnerAuthException $error){
            throw new HubLearnLabReleaseException('LearnLab release authentication needs attention',$error->codeName);
        }
        $this->assertOwner((string)$session['userId']);return ['user_id'=>$session['userId']];
    }

    private function ownerMutation(string $token,string $csrf,?string $now): array
    {
        $this->ready();
        try{
            $row=$this->auth->authorize($token,$csrf,$now);
            if(HubTrustPolicy::requiresStepUp(self::CAPABILITY))HubOwnerAuthService::assertRecentStepUpSession($row,$now);
        }catch(HubOwnerAuthException $error){throw new HubLearnLabReleaseException('LearnLab release authentication needs attention',$error->codeName);}
        catch(HubTrustPolicyException){throw new HubLearnLabReleaseException('LearnLab release trust policy is unavailable','LEARNLAB_RELEASE_INVALID');}
        $user=(string)$row['user_id'];$this->assertOwner($user);$this->assertCapability($user,'deployment.approve');return $row;
    }

    private function supersedeQueuedReleaseIfTargetMoved(string $targetSha,string $at): void
    {
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.checkpoint_json,a.approval_id,a.status AS approval_status
            FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id
            LEFT JOIN control_approvals a ON a.task_id=e.task_id AND a.action='deployment.approve'
            WHERE e.required_capability=:capability AND e.state IN ('QUEUED','WAITING_FOR_CAPABILITY') AND e.lease_owner IS NULL
              AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY e.updated_at DESC");
        $q->execute(['capability'=>self::CAPABILITY]);
        foreach($q->fetchAll() as $row){
            $checkpoint=self::checkpoint((string)$row['checkpoint_json'],false);
            $queuedSha=strtolower((string)($checkpoint['releaseSha']??''));
            if(preg_match('/^[0-9a-f]{40}$/',$queuedSha)!==1||hash_equals($queuedSha,$targetSha))continue;
            try{
                $this->pdo->exec('BEGIN IMMEDIATE');
                $cancel=$this->pdo->prepare("UPDATE control_task_executions SET state='CANCELLED',lease_owner=NULL,lease_expires_at=NULL,last_error_code='LEARNLAB_RELEASE_SUPERSEDED',updated_at=:at WHERE execution_id=:execution AND state IN ('QUEUED','WAITING_FOR_CAPABILITY') AND lease_owner IS NULL");
                $cancel->execute(['at'=>$at,'execution'=>$row['execution_id']]);
                if($cancel->rowCount()!==1){$this->pdo->exec('ROLLBACK');continue;}
                $summary='คำขอ LearnLab รุ่นเก่าถูกแทนด้วย Source ล่าสุดโดยอัตโนมัติ';
                $this->pdo->prepare("UPDATE control_tasks SET state='CANCELLED',progress=0,result_summary=:summary,failure_code=NULL,assigned_device_id=NULL,lease_expires_at=NULL,cancelled_at=:at,updated_at=:at WHERE task_id=:task AND state NOT IN ('COMPLETED','FAILED','CANCELLED')")
                    ->execute(['summary'=>$summary,'at'=>$at,'task'=>$row['task_id']]);
                if(($row['approval_status']??null)==='PENDING'&&is_string($row['approval_id']??null))
                    $this->pdo->prepare("UPDATE control_approvals SET status='EXPIRED' WHERE approval_id=:approval AND status='PENDING'")->execute(['approval'=>$row['approval_id']]);
                $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:event,:task,'CANCELLED',0,:message,:at)")
                    ->execute(['event'=>self::uuid(),'task'=>$row['task_id'],'message'=>$summary.' · LEARNLAB_RELEASE_SUPERSEDED · latest '.substr($targetSha,0,12),'at'=>$at]);
                $this->pdo->exec('COMMIT');
            }catch(Throwable){$this->rollback();}
        }
    }

    private function activeRelease(): ?array
    {
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.checkpoint_json,t.state AS task_state,a.approval_id
            FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id
            LEFT JOIN control_approvals a ON a.task_id=e.task_id AND a.action='deployment.approve'
            WHERE e.required_capability=:capability AND e.state IN ('QUEUED','LEASED','RUNNING','WAITING_FOR_CAPABILITY')
            AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY e.updated_at DESC LIMIT 1");
        $q->execute(['capability'=>self::CAPABILITY]);$row=$q->fetch();return is_array($row)?$row:null;
    }

    private function ready(): void
    {
        foreach(['control_task_executions','control_approvals','control_project_capabilities','owner_bootstrap'] as $table){
            $q=$this->pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name");$q->execute(['name'=>$table]);
            if($q->fetchColumn()===false)throw new HubLearnLabReleaseException('LearnLab release authority is not ready','LEARNLAB_RELEASE_NOT_READY');
        }
        $q=$this->pdo->prepare('SELECT 1 FROM projects WHERE project_id=:project');$q->execute(['project'=>self::PROJECT_ID]);
        if($q->fetchColumn()===false)throw new HubLearnLabReleaseException('Canonical LearnLab project is unavailable','LEARNLAB_RELEASE_NOT_READY');
    }

    private function assertOwner(string $user): void
    {
        $owner=$this->pdo->query('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id=1 AND bootstrap_closed=1')->fetchColumn();
        if(!is_string($owner)||!hash_equals($owner,$user))throw new HubLearnLabReleaseException('Owner access is required','OWNER_FORBIDDEN');
    }

    private function assertCapability(string $user,string $capability): void
    {
        $q=$this->pdo->prepare('SELECT 1 FROM control_project_capabilities WHERE user_id=:user AND project_id=:project AND capability=:capability AND revoked_at IS NULL');
        $q->execute(['user'=>$user,'project'=>self::PROJECT_ID,'capability'=>$capability]);
        if($q->fetchColumn()===false)throw new HubLearnLabReleaseException('Deployment approval capability is required','PROJECT_FORBIDDEN');
    }

    private static function keys(array $value,array $allowed): void { $actual=array_keys($value);sort($actual);sort($allowed);if($actual!==$allowed)throw new HubLearnLabReleaseException('LearnLab release fields are invalid','LEARNLAB_RELEASE_INVALID'); }
    private static function time(string $value): string { if(strtotime($value)===false)throw new HubLearnLabReleaseException('LearnLab release time is invalid','LEARNLAB_RELEASE_INVALID');return gmdate('c',strtotime($value)); }
    private static function uuid(): string { $b=random_bytes(16);$b[6]=chr((ord($b[6])&15)|64);$b[8]=chr((ord($b[8])&63)|128);return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($b),4)); }
    private function rollback(): void { try{$this->pdo->exec('ROLLBACK');}catch(Throwable){} }
}

