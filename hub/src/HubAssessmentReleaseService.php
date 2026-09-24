<?php

declare(strict_types=1);

require_once __DIR__ . '/HubOwnerAuthService.php';
require_once __DIR__ . '/HubTrustPolicy.php';

final class HubAssessmentReleaseException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='ASSESSMENT_RELEASE_FAILED'){ parent::__construct($message); }
}

final class HubAssessmentReleaseService
{
    public const PROJECT_ID='6f4920ab-3ca5-4f1e-8e91-8833c68c2d1a';
    public const CAPABILITY='system.assessment.release';
    private const PROD_ROOT='/var/www/bay-assessment';
    private const CANDIDATE_MANIFEST='/var/lib/awh-hub/assessment-release-candidate.json';

    private function __construct(private readonly PDO $pdo,private readonly HubOwnerAuthService $auth){}
    public static function fromPdo(PDO $pdo): self { return new self($pdo,HubOwnerAuthService::fromPdo($pdo)); }

    public function status(string $token): array
    {
        $owner=$this->ownerSession($token);
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.state AS execution_state,e.attempt_count,e.last_error_code,e.checkpoint_json,e.updated_at,
            t.state AS task_state,t.progress,t.result_summary,t.failure_code,a.approval_id,a.status AS approval_status,a.expires_at,a.decided_at
            FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id
            LEFT JOIN control_approvals a ON a.task_id=e.task_id AND a.action='deployment.approve'
            WHERE e.project_id=:project AND e.required_capability=:capability AND t.user_id=:owner
            ORDER BY e.updated_at DESC,e.execution_id DESC LIMIT 20");
        $q->execute(['project'=>self::PROJECT_ID,'capability'=>self::CAPABILITY,'owner'=>$owner['user_id']]);
        $rows=[];
        foreach($q->fetchAll() as $row){
            $cp=self::checkpoint((string)$row['checkpoint_json'],false);
            $rows[]=[
                'executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],
                'releaseSha'=>$cp['releaseSha']??null,'baseReleaseSha'=>$cp['baseReleaseSha']??null,'runtimeVersion'=>$cp['runtimeVersion']??null,
                'mode'=>$cp['releaseMode']??null,'taskState'=>(string)$row['task_state'],'executionState'=>(string)$row['execution_state'],
                'progress'=>(int)$row['progress'],'attemptCount'=>(int)$row['attempt_count'],
                'approvalId'=>$row['approval_id']===null?null:(string)$row['approval_id'],'approvalStatus'=>$row['approval_status']===null?null:(string)$row['approval_status'],
                'approvalExpiresAt'=>$row['expires_at']===null?null:(string)$row['expires_at'],'decidedAt'=>$row['decided_at']===null?null:(string)$row['decided_at'],
                'failureCode'=>$row['failure_code']===null?($row['last_error_code']===null?null:(string)$row['last_error_code']):(string)$row['failure_code'],
                'resultSummary'=>$row['result_summary']===null?null:(string)$row['result_summary'],'updatedAt'=>(string)$row['updated_at'],
            ];
        }
        return ['schemaVersion'=>1,'capability'=>self::CAPABILITY,'current'=>$this->currentRuntime(),'candidate'=>$this->candidate(),
            'releases'=>$rows,'policy'=>HubTrustPolicy::describe(self::CAPABILITY)];
    }

    public function request(string $token,string $csrf,array $payload,?string $now=null): array
    {
        self::keys($payload,['releaseSha','runtimeVersion','schemaVersion']);
        if(($payload['schemaVersion']??null)!==1)throw new HubAssessmentReleaseException('Assessment release request invalid','ASSESSMENT_RELEASE_INVALID');
        $sha=strtolower(trim((string)($payload['releaseSha']??'')));$version=trim((string)($payload['runtimeVersion']??''));
        if(preg_match('/^[0-9a-f]{40}$/',$sha)!==1||preg_match('/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/',$version)!==1)
            throw new HubAssessmentReleaseException('Assessment release identity invalid','ASSESSMENT_RELEASE_INVALID');
        $owner=$this->ownerMutation($token,$csrf,$now);
        $candidate=$this->candidate();
        if(($candidate['ready']??false)!==true||!hash_equals((string)$candidate['releaseSha'],$sha)||!hash_equals((string)$candidate['runtimeVersion'],$version))
            throw new HubAssessmentReleaseException('Assessment candidate moved before approval','ASSESSMENT_RELEASE_TARGET_MOVED');
        $current=$this->currentRuntime();$base=(string)$current['releaseSha'];
        if(hash_equals($base,$sha))throw new HubAssessmentReleaseException('Assessment is already current','ASSESSMENT_RELEASE_VERSION_STALE');
        $at=self::time($now??gmdate('c'));
        $this->supersedeQueuedReleaseIfTargetMoved($sha,$at);
        $existing=$this->activeRelease();
        if(is_array($existing)){
            $cp=self::checkpoint((string)$existing['checkpoint_json'],false);
            if(($cp['releaseSha']??null)===$sha&&($cp['runtimeVersion']??null)===$version&&($cp['baseReleaseSha']??null)===$base)
                return ['schemaVersion'=>1,'taskId'=>(string)$existing['task_id'],'executionId'=>(string)$existing['execution_id'],
                    'approvalId'=>$existing['approval_id']===null?null:(string)$existing['approval_id'],'state'=>(string)$existing['task_state'],
                    'releaseSha'=>$sha,'runtimeVersion'=>$version,'idempotent'=>true];
            throw new HubAssessmentReleaseException('Another Assessment release is active','ASSESSMENT_RELEASE_CONFLICT');
        }
        $task=self::uuid();$execution=self::uuid();$approval=self::uuid();
        $checkpoint=['schemaVersion'=>1,'mode'=>'ASSESSMENT_RELEASE','releaseMode'=>'IMMUTABLE_NODE','releaseSha'=>$sha,'baseReleaseSha'=>$base,
            'runtimeVersion'=>$version,'candidateManifestSha256'=>(string)$candidate['manifestSha256'],'transport'=>'LOCAL'];
        $scope=['schemaVersion'=>1,'taskId'=>$task,'projectId'=>self::PROJECT_ID,'releaseSha'=>$sha,'baseReleaseSha'=>$base,'runtimeVersion'=>$version,
            'candidateManifestSha256'=>(string)$candidate['manifestSha256'],'releaseMode'=>'IMMUTABLE_NODE','transport'=>'LOCAL','risk'=>'CRITICAL'];
        $goal='Deploy BAY Assessment '.$version.' '.substr($sha,0,12).' ผ่าน bounded VPS-native release controller';
        $key='assessment-release.'.substr($sha,0,12).'.'.str_replace('.','-',$version);
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
                ->execute(['approval'=>$approval,'task'=>$task,'scope'=>json_encode($scope,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'expires'=>gmdate('c',strtotime($at)+1800)]);
            $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at)
                VALUES(:event,:task,'WAITING_FOR_APPROVAL',0,:message,:at)")
                ->execute(['event'=>self::uuid(),'task'=>$task,'message'=>'Assessment release ผ่าน request boundary แล้วและรอ Owner อนุมัติ','at'=>$at]);
            $this->pdo->exec('COMMIT');
        }catch(Throwable $e){$this->rollback();throw $e instanceof HubAssessmentReleaseException?$e:new HubAssessmentReleaseException('Assessment release queue failed','ASSESSMENT_RELEASE_QUEUE_FAILED');}
        return ['schemaVersion'=>1,'taskId'=>$task,'executionId'=>$execution,'approvalId'=>$approval,'state'=>'WAITING_FOR_APPROVAL',
            'releaseSha'=>$sha,'runtimeVersion'=>$version,'idempotent'=>false];
    }

    public static function checkpoint(string $json,bool $strict=true): array
    {
        try{$v=json_decode($json,true,16,JSON_THROW_ON_ERROR);}catch(Throwable){if(!$strict)return [];throw new HubAssessmentReleaseException('Assessment release checkpoint invalid','ASSESSMENT_RELEASE_CHECKPOINT_INVALID');}
        $keys=['baseReleaseSha','candidateManifestSha256','mode','releaseMode','releaseSha','runtimeVersion','schemaVersion','transport'];
        if(!is_array($v)||array_is_list($v)){if(!$strict)return [];throw new HubAssessmentReleaseException('Assessment release checkpoint invalid','ASSESSMENT_RELEASE_CHECKPOINT_INVALID');}
        $actual=array_keys($v);sort($actual);$expected=$keys;sort($expected);
        $ok=$actual===$expected&&($v['schemaVersion']??null)===1&&($v['mode']??null)==='ASSESSMENT_RELEASE'&&($v['releaseMode']??null)==='IMMUTABLE_NODE'&&($v['transport']??null)==='LOCAL'
            &&is_string($v['releaseSha']??null)&&preg_match('/^[0-9a-f]{40}$/',$v['releaseSha'])===1
            &&is_string($v['baseReleaseSha']??null)&&preg_match('/^[0-9a-f]{40}$/',$v['baseReleaseSha'])===1
            &&is_string($v['runtimeVersion']??null)&&preg_match('/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/',$v['runtimeVersion'])===1
            &&is_string($v['candidateManifestSha256']??null)&&preg_match('/^[0-9a-f]{64}$/',$v['candidateManifestSha256'])===1;
        if(!$ok){if(!$strict)return [];throw new HubAssessmentReleaseException('Assessment release checkpoint invalid','ASSESSMENT_RELEASE_CHECKPOINT_INVALID');}
        return $v;
    }

    private function candidate(): array
    {
        $path=getenv('AWH_ASSESSMENT_CANDIDATE_MANIFEST');if(!is_string($path)||$path==='')$path=self::CANDIDATE_MANIFEST;
        if(!is_file($path)||is_link($path)||!is_readable($path)||filesize($path)>65536)return ['ready'=>false];
        $raw=(string)file_get_contents($path);$sha=hash('sha256',$raw);
        try{$v=json_decode($raw,true,16,JSON_THROW_ON_ERROR);}catch(Throwable){return ['ready'=>false];}
        if(!is_array($v)||($v['schemaVersion']??null)!==1||($v['product']??null)!=='BAY Assessment'||($v['ready']??null)!==true)return ['ready'=>false];
        $release=strtolower((string)($v['releaseSha']??''));$base=strtolower((string)($v['baseReleaseSha']??''));$version=(string)($v['runtimeVersion']??'');
        if(preg_match('/^[0-9a-f]{40}$/',$release)!==1||preg_match('/^[0-9a-f]{40}$/',$base)!==1||preg_match('/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/',$version)!==1)return ['ready'=>false];
        return ['ready'=>true,'releaseSha'=>$release,'baseReleaseSha'=>$base,'runtimeVersion'=>$version,'sourceMode'=>(string)($v['sourceMode']??'UNKNOWN'),
            'qa'=>(string)($v['qa']??'UNKNOWN'),'manifestSha256'=>$sha,'observedAt'=>$v['observedAt']??null];
    }

    private function currentRuntime(): array
    {
        $root=getenv('AWH_ASSESSMENT_PROD_ROOT');if(!is_string($root)||$root==='')$root=self::PROD_ROOT;
        $root=rtrim($root,'/');
        $current=realpath($root.'/current');$rootReal=realpath($root);
        if(!is_string($rootReal)||!is_string($current)||!is_dir($current)||!str_starts_with($current,$rootReal.'/releases/'))throw new HubAssessmentReleaseException('Assessment runtime unavailable','ASSESSMENT_RELEASE_NOT_READY');
        $package=$current.'/package.json';if(!is_file($package)||is_link($package)||!is_readable($package))throw new HubAssessmentReleaseException('Assessment package unavailable','ASSESSMENT_RELEASE_NOT_READY');
        try{$json=json_decode((string)file_get_contents($package),true,16,JSON_THROW_ON_ERROR);}catch(Throwable){throw new HubAssessmentReleaseException('Assessment package invalid','ASSESSMENT_RELEASE_NOT_READY');}
        $version=(string)($json['version']??'');if($version===''||preg_match('/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/',$version)!==1)throw new HubAssessmentReleaseException('Assessment version invalid','ASSESSMENT_RELEASE_NOT_READY');
        $sourceFile=$current.'/SOURCE_SHA';$sha=is_file($sourceFile)?strtolower(trim((string)file_get_contents($sourceFile))):'';
        if(preg_match('/^[0-9a-f]{40}$/',$sha)!==1){
            $candidate=$this->candidate();$base=(string)($candidate['baseReleaseSha']??'');$name=basename($current);
            if(preg_match('/-([0-9a-f]{12})$/',$name,$m)===1&&preg_match('/^[0-9a-f]{40}$/',$base)===1&&str_starts_with($base,strtolower($m[1])))$sha=$base;
        }
        if(preg_match('/^[0-9a-f]{40}$/',$sha)!==1)throw new HubAssessmentReleaseException('Assessment source identity unavailable','ASSESSMENT_RELEASE_NOT_READY');
        return ['runtimeVersion'=>$version,'releaseSha'=>$sha,'releasePath'=>$current,'url'=>'https://assessment.kruart.online/'];
    }

    private function ownerSession(string $token): array
    {
        $this->ready();try{$s=$this->auth->authenticatedUser($token);}catch(HubOwnerAuthException $e){throw new HubAssessmentReleaseException('Assessment release authentication needs attention',$e->codeName);}
        $this->assertOwner((string)$s['userId']);return ['user_id'=>$s['userId']];
    }
    private function ownerMutation(string $token,string $csrf,?string $now): array
    {
        $this->ready();try{$row=$this->auth->authorize($token,$csrf,$now);if(HubTrustPolicy::requiresStepUp(self::CAPABILITY))HubOwnerAuthService::assertRecentStepUpSession($row,$now);}
        catch(HubOwnerAuthException $e){throw new HubAssessmentReleaseException('Assessment release authentication needs attention',$e->codeName);}
        catch(HubTrustPolicyException){throw new HubAssessmentReleaseException('Assessment release trust policy unavailable','ASSESSMENT_RELEASE_INVALID');}
        $user=(string)$row['user_id'];$this->assertOwner($user);$this->assertCapability($user,'deployment.approve');return $row;
    }
    private function supersedeQueuedReleaseIfTargetMoved(string $targetSha,string $at): void
    {
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.checkpoint_json,a.approval_id,a.status AS approval_status
            FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id LEFT JOIN control_approvals a ON a.task_id=e.task_id AND a.action='deployment.approve'
            WHERE e.required_capability=:capability AND e.state IN ('QUEUED','WAITING_FOR_CAPABILITY') AND e.lease_owner IS NULL
              AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY e.updated_at DESC");
        $q->execute(['capability'=>self::CAPABILITY]);
        foreach($q->fetchAll() as $row){
            $checkpoint=self::checkpoint((string)$row['checkpoint_json'],false);
            $queuedSha=strtolower((string)($checkpoint['releaseSha']??''));
            if(preg_match('/^[0-9a-f]{40}$/',$queuedSha)!==1||hash_equals($queuedSha,$targetSha))continue;
            try{
                $this->pdo->exec('BEGIN IMMEDIATE');
                $cancel=$this->pdo->prepare("UPDATE control_task_executions SET state='CANCELLED',lease_owner=NULL,lease_expires_at=NULL,last_error_code='ASSESSMENT_RELEASE_SUPERSEDED',updated_at=:at WHERE execution_id=:execution AND state IN ('QUEUED','WAITING_FOR_CAPABILITY') AND lease_owner IS NULL");
                $cancel->execute(['at'=>$at,'execution'=>$row['execution_id']]);
                if($cancel->rowCount()!==1){$this->pdo->exec('ROLLBACK');continue;}
                $summary='คำขอ Assessment รุ่นเก่าถูกแทนด้วย candidate ล่าสุดโดยอัตโนมัติ';
                $this->pdo->prepare("UPDATE control_tasks SET state='CANCELLED',progress=0,result_summary=:summary,failure_code=NULL,assigned_device_id=NULL,lease_expires_at=NULL,cancelled_at=:at,updated_at=:at WHERE task_id=:task AND state NOT IN ('COMPLETED','FAILED','CANCELLED')")
                    ->execute(['summary'=>$summary,'at'=>$at,'task'=>$row['task_id']]);
                if(($row['approval_status']??null)==='PENDING'&&is_string($row['approval_id']??null))
                    $this->pdo->prepare("UPDATE control_approvals SET status='EXPIRED' WHERE approval_id=:approval AND status='PENDING'")->execute(['approval'=>$row['approval_id']]);
                $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:event,:task,'CANCELLED',0,:message,:at)")
                    ->execute(['event'=>self::uuid(),'task'=>$row['task_id'],'message'=>$summary.' · ASSESSMENT_RELEASE_SUPERSEDED · latest '.substr($targetSha,0,12),'at'=>$at]);
                $this->pdo->exec('COMMIT');
            }catch(Throwable){$this->rollback();}
        }
    }

    private function activeRelease(): ?array
    {
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.checkpoint_json,t.state AS task_state,a.approval_id
            FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id LEFT JOIN control_approvals a ON a.task_id=e.task_id AND a.action='deployment.approve'
            WHERE e.required_capability=:capability AND e.state IN ('QUEUED','LEASED','RUNNING','WAITING_FOR_CAPABILITY') AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED')
            ORDER BY e.updated_at DESC LIMIT 1");$q->execute(['capability'=>self::CAPABILITY]);$r=$q->fetch();return is_array($r)?$r:null;
    }
    private function ready(): void
    {
        foreach(['control_task_executions','control_approvals','control_project_capabilities','owner_bootstrap'] as $table){$q=$this->pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name");$q->execute(['name'=>$table]);if($q->fetchColumn()===false)throw new HubAssessmentReleaseException('Assessment release authority not ready','ASSESSMENT_RELEASE_NOT_READY');}
        $q=$this->pdo->prepare('SELECT 1 FROM projects WHERE project_id=:project');$q->execute(['project'=>self::PROJECT_ID]);if($q->fetchColumn()===false)throw new HubAssessmentReleaseException('Canonical Assessment project unavailable','ASSESSMENT_RELEASE_NOT_READY');
    }
    private function assertOwner(string $user): void
    {
        $owner=$this->pdo->query('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id=1 AND bootstrap_closed=1')->fetchColumn();
        if(!is_string($owner)||!hash_equals($owner,$user))throw new HubAssessmentReleaseException('Owner access required','OWNER_FORBIDDEN');
    }
    private function assertCapability(string $user,string $capability): void
    {
        $q=$this->pdo->prepare('SELECT 1 FROM control_project_capabilities WHERE user_id=:user AND project_id=:project AND capability=:capability AND revoked_at IS NULL');
        $q->execute(['user'=>$user,'project'=>self::PROJECT_ID,'capability'=>$capability]);if($q->fetchColumn()===false)throw new HubAssessmentReleaseException('Deployment approval required','PROJECT_FORBIDDEN');
    }
    private static function keys(array $v,array $allowed): void{$a=array_keys($v);sort($a);sort($allowed);if($a!==$allowed)throw new HubAssessmentReleaseException('Assessment release fields invalid','ASSESSMENT_RELEASE_INVALID');}
    private static function time(string $v): string{if(strtotime($v)===false)throw new HubAssessmentReleaseException('Assessment release time invalid','ASSESSMENT_RELEASE_INVALID');return gmdate('c',strtotime($v));}
    private static function uuid(): string{$b=random_bytes(16);$b[6]=chr((ord($b[6])&15)|64);$b[8]=chr((ord($b[8])&63)|128);return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($b),4));}
    private function rollback(): void{try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}}
}
