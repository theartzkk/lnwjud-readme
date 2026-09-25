<?php

declare(strict_types=1);

require_once __DIR__ . '/HubLearnLabReleaseService.php';
require_once __DIR__ . '/HubProjectVaultService.php';
require_once __DIR__ . '/HubProjectSourceAuthorityService.php';

final class HubLearnLabReleaseOperatorException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='LEARNLAB_RELEASE_OPERATOR_FAILED') { parent::__construct($message); }
}

final class HubLearnLabReleaseOperator
{
    private const DISPATCHER='vps-learnlab-release';
    private const LEASE_SECONDS=7200;
    private const WORK_ROOT='/var/lib/awh-hub/learnlab-release-work';
    /** @var Closure(list<string>,?array):array{code:int,out:string,err:string} */
    private readonly Closure $runner;

    public function __construct(
        private readonly PDO $pdo,
        private readonly string $runnerScript,
        private readonly string $engineScript,
        ?callable $runner=null
    ){
        foreach([$runnerScript,$engineScript] as $path){
            if($path===''||str_contains($path,"\0")||!str_starts_with($path,'/')||!is_file($path))
                throw new HubLearnLabReleaseOperatorException('LearnLab release runtime path is invalid','LEARNLAB_RELEASE_CONFIG_INVALID');
        }
        if($runner===null){
            if(!str_starts_with($runnerScript,'/opt/awh-hub/control-releases/')||!str_ends_with($runnerScript,'/hub/bin/awh-learnlab-release-run.php')
                ||!str_starts_with($engineScript,'/opt/awh-hub/control-releases/')||!str_ends_with($engineScript,'/deploy/learnlab/awh-learnlab-release-engine.py'))
                throw new HubLearnLabReleaseOperatorException('LearnLab release runtime is outside the active control release','LEARNLAB_RELEASE_CONFIG_INVALID');
        }
        $this->runner=$runner===null?Closure::fromCallable([$this,'runFixed']):Closure::fromCallable($runner);
    }

    public static function fromEnvironment(PDO $pdo): self
    {
        $runner=realpath(dirname(__DIR__).'/bin/awh-learnlab-release-run.php');
        $engine=realpath(dirname(__DIR__,2).'/deploy/learnlab/awh-learnlab-release-engine.py');
        if(!is_string($runner)||!is_string($engine))
            throw new HubLearnLabReleaseOperatorException('LearnLab release runtime is unavailable','LEARNLAB_RELEASE_CONFIG_INVALID');
        return new self($pdo,$runner,$engine);
    }

    public function tick(?string $now=null): array
    {
        $this->ready();$at=self::time($now??gmdate('c'));$this->advertise($at);
        $active=$this->active();if(is_array($active))return $this->observeActive($active,$at);
        $row=$this->claim($at);if($row===null)return ['schemaVersion'=>1,'state'=>'IDLE'];
        $unit=self::unit((string)$row['execution_id']);
        $rw='/var/lib/awh-hub /var/www/bay-staging /srv/bay-learnlab /etc/nginx/sites-enabled /etc/nginx/backups /var/backups/learnlab-releases';
        $command=['/usr/bin/systemd-run','--unit='.$unit,'--description=AWH-LearnLab-release-'.substr(str_replace('-','',(string)$row['execution_id']),0,12),
            '--collect','--no-block','--property=RuntimeMaxSec=3600','--property=NoNewPrivileges=true','--property=PrivateTmp=false',
            '--property=PrivateDevices=true','--property=ProtectHome=true','--property=ProtectSystem=full',
            '--property=ReadWritePaths='.$rw,'--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
            '/usr/bin/php',$this->runnerScript,(string)$row['execution_id']];
        $result=($this->runner)($command,null);
        if(($result['code']??1)!==0){
            $this->fail((string)$row['execution_id'],(string)$row['task_id'],'LEARNLAB_RELEASE_DISPATCH_FAILED',$at);
            return ['schemaVersion'=>1,'state'=>'FAILED','executionId'=>$row['execution_id'],'code'=>'LEARNLAB_RELEASE_DISPATCH_FAILED'];
        }
        $lease=gmdate('c',strtotime($at)+self::LEASE_SECONDS);
        $this->pdo->prepare("UPDATE control_task_executions SET state='RUNNING',lease_owner=:owner,lease_expires_at=:lease,last_error_code=NULL,updated_at=:at WHERE execution_id=:execution AND state='LEASED'")
            ->execute(['owner'=>'learnlab-release:'.$unit,'lease'=>$lease,'at'=>$at,'execution'=>$row['execution_id']]);
        $this->event((string)$row['task_id'],'RUNNING',10,'AWH เปิด isolated VPS LearnLab release runner แล้ว',$at);
        return ['schemaVersion'=>1,'state'=>'DISPATCHED','executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'unit'=>$unit];
    }

    public function runExecution(string $executionId,?string $now=null): array
    {
        if(!self::validUuid($executionId))throw new HubLearnLabReleaseOperatorException('Execution identity is invalid','LEARNLAB_RELEASE_EXECUTION_INVALID');
        $this->assertRoot();$at=self::time($now??gmdate('c'));
        $row=$this->execution($executionId);$checkpoint=HubLearnLabReleaseService::checkpoint((string)$row['checkpoint_json']);
        $scope=$this->approvedScope((string)$row['task_id'],$checkpoint);
        $this->assertExpectedVault((string)$checkpoint['expectedVaultRevisionId']);
        $vaultCommitted=false;
        try{
            $this->event((string)$row['task_id'],'RUNNING',20,'กำลังตรวจ Source, disk, diff scope และสร้าง rollback checkpoint',$at);
            $engine=$this->run([
                '/usr/bin/python3',$this->engineScript,'--apply','--execution-id',$executionId,
                '--release-sha',(string)$checkpoint['releaseSha'],'--base-sha',(string)$checkpoint['baseReleaseSha'],
                '--runtime-version',(string)$checkpoint['runtimeVersion'],'--cache-epoch',(string)$checkpoint['cacheEpoch'],
            ],null,3300,'LEARNLAB_RELEASE_ENGINE_FAILED');
            $payload=$this->lastJson($engine['out']);
            if(($payload['ok']??false)!==true||!is_array($payload['result']??null)||($payload['result']['state']??null)!=='LIVE_SMOKE_PASSED')
                throw new HubLearnLabReleaseOperatorException('LearnLab release engine did not reach verified live state','LEARNLAB_RELEASE_ENGINE_FAILED');
            $result=$payload['result'];
            $this->event((string)$row['task_id'],'RUNNING',80,'Runtime, Teacher/API, channels และ live smoke ผ่านแล้ว กำลัง commit AWH Vault authority',self::time(gmdate('c')));
            $vault=$this->promoteVault($checkpoint,$result);
            $vaultCommitted=true;
            $finalize=$this->runOptional(['/usr/bin/python3',$this->engineScript,'--finalize','--execution-id',$executionId],null,120);
            $summary='Deploy LearnLab '.(string)$checkpoint['runtimeVersion'].' สำเร็จและ Source/Vault ตรง Production';
            if(($finalize['code']??1)!==0)$summary.=' · cleanup deferred';
            $done=self::time(gmdate('c'));$this->complete($executionId,(string)$row['task_id'],(string)$checkpoint['releaseSha'],$summary,$done);
            return ['schemaVersion'=>1,'state'=>'COMPLETED','releaseSha'=>$checkpoint['releaseSha'],'runtimeVersion'=>$checkpoint['runtimeVersion'],'vault'=>$vault,'scope'=>$scope];
        }catch(Throwable $error){
            if(!$vaultCommitted){
                $this->runOptional(['/usr/bin/python3',$this->engineScript,'--rollback','--execution-id',$executionId],null,240);
            }
            $code=$error instanceof HubLearnLabReleaseOperatorException?$error->codeName:'LEARNLAB_RELEASE_RUN_FAILED';
            $this->fail($executionId,(string)$row['task_id'],$code,self::time(gmdate('c')));
            throw $error instanceof HubLearnLabReleaseOperatorException?$error:new HubLearnLabReleaseOperatorException('LearnLab release runner failed',$code);
        }
    }

    private function promoteVault(array $checkpoint,array $result): array
    {
        $archive=(string)($result['vaultArchive']??'');$content=strtolower((string)($result['vaultContentSha256']??''));$count=(int)($result['vaultFileCount']??0);
        $work=self::WORK_ROOT.'/'.(string)($result['executionId']??'');
        $real=realpath($archive);
        if(!is_string($real)||!is_file($real)||is_link($archive)||!str_starts_with($real,$work.'/')
            ||preg_match('/^[a-f0-9]{64}$/',$content)!==1||$count<1)
            throw new HubLearnLabReleaseOperatorException('Vault artifact identity is invalid','LEARNLAB_RELEASE_VAULT_INVALID');
        $expected=(string)$checkpoint['expectedVaultRevisionId'];$owner=$this->ownerId();
        $vault=HubProjectVaultService::fromEnvironment($this->pdo);$source=new HubProjectSourceAuthorityService($this->pdo,null);
        $before=$vault->state(HubLearnLabReleaseService::PROJECT_ID);
        $sourceBefore=$source->state(HubLearnLabReleaseService::PROJECT_ID,false);
        if(($before['activeRevisionId']??null)!==$expected||($before['syncState']??null)!=='SYNCED'
            ||($sourceBefore['authority']??null)!=='AWH_VAULT'||($sourceBefore['canonicalVaultRevisionId']??null)!==$expected)
            throw new HubLearnLabReleaseOperatorException('Vault authority moved before commit','LEARNLAB_RELEASE_VAULT_MOVED');
        $created=null;$at=gmdate('c');
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $ingested=$vault->ingestArchive(HubLearnLabReleaseService::PROJECT_ID,$real,$owner,null,$expected,$at);
            if(($ingested['changed']??false)!==true||!is_string($ingested['createdRevisionId']??null))
                throw new RuntimeException('VAULT_CANDIDATE_NOT_CREATED');
            $created=(string)$ingested['createdRevisionId'];
            if(($ingested['promotionRequired']??false)===true)$vault->promote(HubLearnLabReleaseService::PROJECT_ID,$created,$expected,$at);
            $vault->expireStalePromotionApprovals(HubLearnLabReleaseService::PROJECT_ID,$created,$at);
            $bound=$source->bindVault(HubLearnLabReleaseService::PROJECT_ID,$created,$at);$after=$vault->state(HubLearnLabReleaseService::PROJECT_ID);
            if(($after['activeRevisionId']??null)!==$created||($after['syncState']??null)!=='SYNCED'
                ||strtolower((string)($after['contentSha256']??''))!==$content||(int)($after['fileCount']??0)!==$count
                ||($bound['canonicalVaultRevisionId']??null)!==$created||($bound['state']??null)!=='CURRENT')
                throw new RuntimeException('VAULT_POSTCONDITION_FAILED');
            $this->pdo->prepare('UPDATE projects SET source_revision=:release,observed_at=:at,provenance=:provenance WHERE project_id=:project')
                ->execute(['release'=>(string)$checkpoint['releaseSha'],'at'=>$at,'provenance'=>'release-vault:'.substr((string)$checkpoint['releaseSha'],0,12),'project'=>HubLearnLabReleaseService::PROJECT_ID]);
            $this->pdo->exec('COMMIT');
            return ['beforeVaultRevisionId'=>$expected,'afterVaultRevisionId'=>$created,'contentSha256'=>$content,'fileCount'=>$count];
        }catch(Throwable $error){
            try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}
            if(is_string($created)){try{$vault->vault()->removeRevision(HubLearnLabReleaseService::PROJECT_ID,$created);}catch(Throwable){}}
            throw new HubLearnLabReleaseOperatorException('Vault promotion failed closed','LEARNLAB_RELEASE_VAULT_FAILED');
        }
    }

    private function claim(string $at): ?array
    {
        $lease=gmdate('c',strtotime($at)+300);
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $q=$this->pdo->prepare("SELECT e.*,t.goal FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id
                WHERE e.executor_kind='VPS' AND e.required_capability=:capability AND e.state='QUEUED' AND t.state='WAITING_FOR_WORKER'
                AND EXISTS(SELECT 1 FROM control_approvals a WHERE a.task_id=e.task_id AND a.action='deployment.approve' AND a.status='APPROVED')
                ORDER BY e.created_at,e.execution_id LIMIT 1");
            $q->execute(['capability'=>HubLearnLabReleaseService::CAPABILITY]);$row=$q->fetch();
            if(!is_array($row)){$this->pdo->exec('COMMIT');return null;}
            HubLearnLabReleaseService::checkpoint((string)$row['checkpoint_json']);
            $u=$this->pdo->prepare("UPDATE control_task_executions SET state='LEASED',lease_owner=:owner,lease_expires_at=:lease,attempt_count=attempt_count+1,updated_at=:at
                WHERE execution_id=:execution AND state='QUEUED' AND attempt_count<3");
            $u->execute(['owner'=>self::DISPATCHER,'lease'=>$lease,'at'=>$at,'execution'=>$row['execution_id']]);
            if($u->rowCount()!==1){$this->pdo->exec('ROLLBACK');return null;}
            $this->pdo->prepare("UPDATE control_tasks SET state='RUNNING',progress=5,failure_code=NULL,updated_at=:at WHERE task_id=:task AND state='WAITING_FOR_WORKER'")
                ->execute(['at'=>$at,'task'=>$row['task_id']]);
            $this->event((string)$row['task_id'],'RUNNING',5,'Owner อนุมัติแล้ว AWH กำลังเปิด bounded LearnLab release runner',$at);
            $this->pdo->exec('COMMIT');return $row;
        }catch(Throwable $error){
            $this->rollback();
            if($error instanceof HubLearnLabReleaseException)throw new HubLearnLabReleaseOperatorException('LearnLab release checkpoint is invalid',$error->codeName);
            throw new HubLearnLabReleaseOperatorException('LearnLab release could not be claimed','LEARNLAB_RELEASE_CLAIM_FAILED');
        }
    }

    private function active(): ?array
    {
        $q=$this->pdo->prepare("SELECT e.*,t.state AS task_state FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id
            WHERE e.required_capability=:capability AND e.state IN ('LEASED','RUNNING') AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED')
            ORDER BY e.updated_at DESC LIMIT 1");
        $q->execute(['capability'=>HubLearnLabReleaseService::CAPABILITY]);$row=$q->fetch();return is_array($row)?$row:null;
    }

    private function observeActive(array $row,string $at): array
    {
        $unit=self::unit((string)$row['execution_id']);$status=($this->runner)(['/bin/systemctl','is-active',$unit],null);
        $state=trim((string)($status['out']??''));
        if(in_array($state,['active','activating'],true)){
            $lease=gmdate('c',strtotime($at)+self::LEASE_SECONDS);
            $this->pdo->prepare("UPDATE control_task_executions SET lease_expires_at=:lease,updated_at=:at WHERE execution_id=:execution AND state IN ('LEASED','RUNNING')")
                ->execute(['lease'=>$lease,'at'=>$at,'execution'=>$row['execution_id']]);
            return ['schemaVersion'=>1,'state'=>'RUNNING','executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'unit'=>$unit];
        }
        $expires=strtotime((string)($row['lease_expires_at']??''));
        if($expires!==false&&$expires>strtotime($at))return ['schemaVersion'=>1,'state'=>'RUNNING','executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'unit'=>$unit];
        $this->fail((string)$row['execution_id'],(string)$row['task_id'],'LEARNLAB_RELEASE_RUNNER_LOST',$at);
        return ['schemaVersion'=>1,'state'=>'FAILED','executionId'=>(string)$row['execution_id'],'code'=>'LEARNLAB_RELEASE_RUNNER_LOST'];
    }

    private function execution(string $executionId): array
    {
        $q=$this->pdo->prepare("SELECT e.*,t.state AS task_state FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id
            WHERE e.execution_id=:execution AND e.required_capability=:capability AND e.executor_kind='VPS'");
        $q->execute(['execution'=>strtolower($executionId),'capability'=>HubLearnLabReleaseService::CAPABILITY]);$row=$q->fetch();
        if(!is_array($row)||!in_array((string)$row['state'],['LEASED','RUNNING'],true)||(string)$row['task_state']!=='RUNNING')
            throw new HubLearnLabReleaseOperatorException('LearnLab release execution is not runnable','LEARNLAB_RELEASE_EXECUTION_INVALID');
        return $row;
    }

    private function approvedScope(string $taskId,array $checkpoint): array
    {
        $q=$this->pdo->prepare("SELECT scope_json,status,decided_at FROM control_approvals WHERE task_id=:task AND action='deployment.approve' ORDER BY expires_at DESC LIMIT 1");
        $q->execute(['task'=>$taskId]);$row=$q->fetch();
        if(!is_array($row)||(string)$row['status']!=='APPROVED'||!is_string($row['decided_at']))
            throw new HubLearnLabReleaseOperatorException('Owner approval is required','LEARNLAB_RELEASE_APPROVAL_REQUIRED');
        try{$scope=json_decode((string)$row['scope_json'],true,16,JSON_THROW_ON_ERROR);}catch(Throwable){
            throw new HubLearnLabReleaseOperatorException('Approval scope is invalid','LEARNLAB_RELEASE_APPROVAL_INVALID');
        }
        $keys=['baseReleaseSha','cacheEpoch','expectedVaultRevisionId','projectId','releaseMode','releaseSha','risk','runtimeVersion','schemaVersion','taskId','transport'];
        $actual=is_array($scope)?array_keys($scope):[];sort($actual);sort($keys);
        $valid=is_array($scope)&&$actual===$keys&&($scope['schemaVersion']??null)===1
            &&hash_equals((string)($scope['taskId']??''),$taskId)&&hash_equals((string)($scope['projectId']??''),HubLearnLabReleaseService::PROJECT_ID)
            &&($scope['releaseMode']??null)==='FILE_ONLY'&&($scope['transport']??null)==='LOCAL'&&($scope['risk']??null)==='CRITICAL';
        foreach(['releaseSha','baseReleaseSha','runtimeVersion','expectedVaultRevisionId'] as $key)
            $valid=$valid&&hash_equals((string)($scope[$key]??''),(string)($checkpoint[$key]??''));
        $valid=$valid&&($scope['cacheEpoch']??null)===($checkpoint['cacheEpoch']??null);
        if(!$valid)throw new HubLearnLabReleaseOperatorException('Approval scope does not match release checkpoint','LEARNLAB_RELEASE_APPROVAL_INVALID');
        return $scope;
    }

    private function assertExpectedVault(string $expected): void
    {
        $q=$this->pdo->prepare("SELECT active_revision_id,sync_state FROM control_project_vaults WHERE project_id=:project");
        $q->execute(['project'=>HubLearnLabReleaseService::PROJECT_ID]);$row=$q->fetch();
        if(!is_array($row)||($row['sync_state']??null)!=='SYNCED'||($row['active_revision_id']??null)!==$expected)
            throw new HubLearnLabReleaseOperatorException('LearnLab Vault authority moved','LEARNLAB_RELEASE_VAULT_MOVED');
    }

    private function ownerId(): string
    {
        $v=$this->pdo->query("SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id=1 AND bootstrap_closed=1")->fetchColumn();
        if(!is_string($v)||preg_match('/^[0-9a-f-]{36}$/i',$v)!==1)throw new HubLearnLabReleaseOperatorException('Owner identity unavailable','LEARNLAB_RELEASE_OWNER_UNAVAILABLE');
        return $v;
    }

    private function advertise(string $at): void
    {
        $q=$this->pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='control_executor_capabilities'");$q->execute();
        if($q->fetchColumn()===false)return;$expires=gmdate('c',strtotime($at)+180);
        $this->pdo->prepare("INSERT INTO control_executor_capabilities(executor_id,executor_kind,capability,version,observed_at,expires_at)
            VALUES(:id,'VPS',:capability,'vps-native-v1',:at,:expires)
            ON CONFLICT(executor_id,capability) DO UPDATE SET version='vps-native-v1',observed_at=excluded.observed_at,expires_at=excluded.expires_at")
            ->execute(['id'=>self::DISPATCHER,'capability'=>HubLearnLabReleaseService::CAPABILITY,'at'=>$at,'expires'=>$expires]);
    }

    private function complete(string $execution,string $task,string $sha,string $summary,string $at): void
    {
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $this->pdo->prepare("UPDATE control_task_executions SET state='COMPLETED',lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=:at WHERE execution_id=:execution")
                ->execute(['at'=>$at,'execution'=>$execution]);
            $this->pdo->prepare("UPDATE control_tasks SET state='COMPLETED',progress=100,result_summary=:summary,failure_code=NULL,lease_expires_at=NULL,updated_at=:at WHERE task_id=:task")
                ->execute(['summary'=>$summary.' · '.substr($sha,0,12),'at'=>$at,'task'=>$task]);
            $this->event($task,'COMPLETED',100,$summary,$at);$this->pdo->exec('COMMIT');
        }catch(Throwable){$this->rollback();throw new HubLearnLabReleaseOperatorException('LearnLab completion could not be recorded','LEARNLAB_RELEASE_STATE_FAILED');}
    }

    private function fail(string $execution,string $task,string $code,string $at): void
    {
        $safe=preg_match('/^[A-Z0-9_]{3,80}$/',$code)===1?$code:'LEARNLAB_RELEASE_FAILED';
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $this->pdo->prepare("UPDATE control_task_executions SET state='FAILED',lease_owner=NULL,lease_expires_at=NULL,last_error_code=:code,updated_at=:at
                WHERE execution_id=:execution AND state NOT IN ('COMPLETED','FAILED','CANCELLED')")->execute(['code'=>$safe,'at'=>$at,'execution'=>$execution]);
            $this->pdo->prepare("UPDATE control_tasks SET state='FAILED',progress=0,result_summary='LearnLab release หยุดแบบ fail-closed',failure_code=:code,lease_expires_at=NULL,updated_at=:at
                WHERE task_id=:task AND state NOT IN ('COMPLETED','FAILED','CANCELLED')")->execute(['code'=>$safe,'at'=>$at,'task'=>$task]);
            $this->event($task,'FAILED',0,'LearnLab release หยุดแบบ fail-closed: '.$safe,$at);$this->pdo->exec('COMMIT');
        }catch(Throwable){$this->rollback();}
    }

    private function event(string $task,string $state,int $progress,string $message,string $at): void
    {
        $this->pdo->prepare('INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:id,:task,:state,:progress,:message,:at)')
            ->execute(['id'=>self::uuid(),'task'=>$task,'state'=>$state,'progress'=>$progress,'message'=>$message,'at'=>$at]);
    }

    private function ready(): void
    {
        foreach(['control_tasks','control_task_executions','control_approvals','owner_bootstrap'] as $table){
            $q=$this->pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name");$q->execute(['name'=>$table]);
            if($q->fetchColumn()===false)throw new HubLearnLabReleaseOperatorException('LearnLab release schema is not ready','LEARNLAB_RELEASE_NOT_READY');
        }
        foreach(['/usr/bin/systemd-run','/usr/bin/php','/usr/bin/python3'] as $path)
            if(!is_executable($path))throw new HubLearnLabReleaseOperatorException('LearnLab release toolchain unavailable','LEARNLAB_RELEASE_TOOLCHAIN_UNAVAILABLE');
    }

    private function assertRoot(): void
    {
        if(!function_exists('posix_geteuid')||posix_geteuid()!==0)throw new HubLearnLabReleaseOperatorException('LearnLab release runner requires root','LEARNLAB_RELEASE_ROOT_REQUIRED');
    }

    private function lastJson(string $out): array
    {
        $lines=array_reverse(array_filter(array_map('trim',preg_split('/\R/',$out)?:[])));
        foreach($lines as $line){try{$v=json_decode($line,true,64,JSON_THROW_ON_ERROR);if(is_array($v)&&!array_is_list($v))return $v;}catch(Throwable){}}
        throw new HubLearnLabReleaseOperatorException('LearnLab release engine response invalid','LEARNLAB_RELEASE_ENGINE_FAILED');
    }

    private function run(array $command,?array $options=null,int $timeout=120,string $errorCode='LEARNLAB_RELEASE_COMMAND_FAILED'): array
    {
        $r=$this->runProcess($command,$options,$timeout);
        if($r['code']!==0)throw new HubLearnLabReleaseOperatorException('Typed LearnLab release command failed',$errorCode);
        return $r;
    }
    private function runOptional(array $command,?array $options=null,int $timeout=30): array { return $this->runProcess($command,$options,$timeout); }
    private function runProcess(array $command,?array $options,int $timeout): array
    {
        if($command===[]||!is_string($command[0])||!str_starts_with($command[0],'/'))return ['code'=>126,'out'=>'','err'=>'blocked'];
        $wrapped=['/usr/bin/timeout','--signal=TERM',(string)max(1,$timeout),...$command];
        $spec=[0=>['pipe','r'],1=>['pipe','w'],2=>['redirect',1]];$cwd=is_string($options['cwd']??null)?$options['cwd']:null;
        $env=is_array($options['env']??null)?$options['env']:null;$proc=proc_open($wrapped,$spec,$pipes,$cwd,$env);
        if(!is_resource($proc))return ['code'=>127,'out'=>'','err'=>'unavailable'];
        fclose($pipes[0]);$out=stream_get_contents($pipes[1]);fclose($pipes[1]);$code=proc_close($proc);
        $out=is_string($out)?$out:'';if(strlen($out)>4*1024*1024)$out=substr($out,-4*1024*1024);
        return ['code'=>$code,'out'=>$out,'err'=>''];
    }
    private function runFixed(array $command,?array $options=null): array
    {
        if($command===[]||!in_array($command[0],['/usr/bin/systemd-run','/bin/systemctl'],true))return ['code'=>126,'out'=>'','err'=>'blocked'];
        return $this->runProcess($command,$options,30);
    }
    private function rollback(): void { try{$this->pdo->exec('ROLLBACK');}catch(Throwable){} }
    private static function unit(string $execution): string { if(!self::validUuid($execution))throw new HubLearnLabReleaseOperatorException('Execution invalid','LEARNLAB_RELEASE_EXECUTION_INVALID');return 'awh-learnlab-release-'.substr(str_replace('-','',strtolower($execution)),0,12).'.service'; }
    private static function validUuid(string $value): bool { return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$value)===1; }
    private static function uuid(): string { $b=random_bytes(16);$b[6]=chr((ord($b[6])&15)|64);$b[8]=chr((ord($b[8])&63)|128);return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($b),4)); }
    private static function time(string $value): string { if(strtotime($value)===false)throw new HubLearnLabReleaseOperatorException('Time invalid','LEARNLAB_RELEASE_EXECUTION_INVALID');return gmdate('c',strtotime($value)); }
}

