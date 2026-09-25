<?php

declare(strict_types=1);

require_once __DIR__ . '/HubCoreReleaseService.php';

final class HubCoreReleaseOperatorException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='CORE_RELEASE_OPERATOR_FAILED') { parent::__construct($message); }
}

/**
 * Root-only dispatcher and runner for approved AWH core releases.
 *
 * The dispatcher receives no browser command/path input. A transient systemd
 * unit gets only an execution UUID and rehydrates all release identity from
 * canonical SQLite authority.
 */
final class HubCoreReleaseOperator
{
    private const DISPATCHER='vps-core-release';
    private const LEASE_SECONDS=14400;
    private const WORK_ROOT='/var/lib/awh-hub/core-release-work';
    private const STORAGE_BLOCK_PERCENT=90;
    private const MIN_FREE_BYTES=3221225472;
    private const SOURCE='file:///srv/awh-git/awh.git';
    private const CANONICAL_GIT_DIR='/srv/awh-git/awh.git';
    /** @var Closure(list<string>,?array):array{code:int,out:string,err:string} */
    private readonly Closure $runner;

    public function __construct(private readonly PDO $pdo,private readonly string $runnerScript,?callable $runner=null)
    {
        if($runner===null){
            if(!str_starts_with($runnerScript,'/opt/awh-hub/control-releases/')||!str_ends_with($runnerScript,'/hub/bin/awh-core-release-run.php')||!is_file($runnerScript))throw new HubCoreReleaseOperatorException('Core release runner path is invalid','CORE_RELEASE_CONFIG_INVALID');
        }elseif($runnerScript===''||str_contains($runnerScript,"\0")||!str_starts_with($runnerScript,'/')||!is_file($runnerScript))throw new HubCoreReleaseOperatorException('Core release runner test path is invalid','CORE_RELEASE_CONFIG_INVALID');
        $this->runner=$runner===null?Closure::fromCallable([$this,'runFixed']):Closure::fromCallable($runner);
    }

    public static function fromEnvironment(PDO $pdo): self
    {
        $script=realpath(dirname(__DIR__).'/bin/awh-core-release-run.php');
        if(!is_string($script))throw new HubCoreReleaseOperatorException('Core release runner is unavailable','CORE_RELEASE_CONFIG_INVALID');
        return new self($pdo,$script);
    }

    public function tick(?string $now=null): array
    {
        $this->ready();$at=self::time($now??gmdate('c'));$this->advertise($at);
        $this->cleanupTerminalWorkspaces();
        $active=$this->active();
        if(is_array($active))return $this->observeActive($active,$at);
        $row=$this->claim($at);
        if($row===null)return ['schemaVersion'=>1,'state'=>'IDLE'];
        $unit=self::unit((string)$row['execution_id']);
        $command=['/usr/bin/systemd-run','--unit='.$unit,'--description=AWH-core-release-'.substr(str_replace('-','',(string)$row['execution_id']),0,12),'--collect','--no-block','--property=RuntimeMaxSec=7200','/usr/bin/php',$this->runnerScript,(string)$row['execution_id']];
        $result=($this->runner)($command,null);
        if(($result['code']??1)!==0){$this->fail((string)$row['execution_id'],(string)$row['task_id'],'CORE_RELEASE_DISPATCH_FAILED',$at);return ['schemaVersion'=>1,'state'=>'FAILED','executionId'=>$row['execution_id'],'code'=>'CORE_RELEASE_DISPATCH_FAILED'];}
        $lease=gmdate('c',strtotime($at)+self::LEASE_SECONDS);
        $this->pdo->prepare("UPDATE control_task_executions SET state='RUNNING',lease_owner=:owner,lease_expires_at=:lease,last_error_code=NULL,updated_at=:at WHERE execution_id=:execution AND state='LEASED'")->execute(['owner'=>'core-release:'.$unit,'lease'=>$lease,'at'=>$at,'execution'=>$row['execution_id']]);
        $this->event((string)$row['task_id'],'RUNNING',10,'AWH เปิด isolated VPS core release runner แล้ว',$at);
        return ['schemaVersion'=>1,'state'=>'DISPATCHED','executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'unit'=>$unit];
    }

    private function claim(string $at): ?array
    {
        $lease=gmdate('c',strtotime($at)+300);
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $q=$this->pdo->prepare("SELECT e.*,t.goal FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id
                WHERE e.executor_kind='VPS' AND e.required_capability=:capability AND e.state='QUEUED'
                  AND t.state='WAITING_FOR_WORKER'
                  AND EXISTS(SELECT 1 FROM control_approvals a WHERE a.task_id=e.task_id AND a.action='deployment.approve' AND a.status='APPROVED')
                ORDER BY e.created_at,e.execution_id LIMIT 1");
            $q->execute(['capability'=>HubCoreReleaseService::CAPABILITY]);$row=$q->fetch();
            if(!is_array($row)){$this->pdo->exec('COMMIT');return null;}
            HubCoreReleaseService::checkpoint((string)$row['checkpoint_json']);
            $u=$this->pdo->prepare("UPDATE control_task_executions SET state='LEASED',lease_owner=:owner,lease_expires_at=:lease,attempt_count=attempt_count+1,updated_at=:at WHERE execution_id=:execution AND state='QUEUED' AND attempt_count<3");
            $u->execute(['owner'=>self::DISPATCHER,'lease'=>$lease,'at'=>$at,'execution'=>$row['execution_id']]);
            if($u->rowCount()!==1){$this->pdo->exec('ROLLBACK');return null;}
            $this->pdo->prepare("UPDATE control_tasks SET state='RUNNING',progress=5,failure_code=NULL,updated_at=:at WHERE task_id=:task AND state='WAITING_FOR_WORKER'")->execute(['at'=>$at,'task'=>$row['task_id']]);
            $this->event((string)$row['task_id'],'RUNNING',5,'Owner อนุมัติแล้ว AWH กำลังจอง VPS release authority',$at);
            $this->pdo->exec('COMMIT');return $row;
        }catch(Throwable $error){$this->rollback();if($error instanceof HubCoreReleaseException)throw new HubCoreReleaseOperatorException('Core release checkpoint is invalid',$error->codeName);throw new HubCoreReleaseOperatorException('Core release could not be claimed','CORE_RELEASE_CLAIM_FAILED');}
    }

    private function active(): ?array
    {
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.state,e.lease_owner,e.lease_expires_at,e.updated_at
            FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id
            WHERE e.required_capability=:capability AND e.state IN ('LEASED','RUNNING') AND t.state='RUNNING'
            ORDER BY e.updated_at DESC LIMIT 1");
        $q->execute(['capability'=>HubCoreReleaseService::CAPABILITY]);$row=$q->fetch();return is_array($row)?$row:null;
    }

    private function observeActive(array $row,string $at): array
    {
        $unit=self::unit((string)$row['execution_id']);
        $status=($this->runner)(['/bin/systemctl','is-active',$unit],null);
        $state=trim((string)($status['out']??''));
        if(in_array($state,['active','activating'],true)){
            $lease=gmdate('c',strtotime($at)+self::LEASE_SECONDS);
            $this->pdo->prepare("UPDATE control_task_executions SET lease_expires_at=:lease,updated_at=:at WHERE execution_id=:execution AND state IN ('LEASED','RUNNING')")->execute(['lease'=>$lease,'at'=>$at,'execution'=>$row['execution_id']]);
            return ['schemaVersion'=>1,'state'=>'RUNNING','executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'unit'=>$unit];
        }
        $expires=strtotime((string)($row['lease_expires_at']??''));
        if($expires!==false&&$expires>strtotime($at))return ['schemaVersion'=>1,'state'=>'RUNNING','executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'unit'=>$unit];
        $this->fail((string)$row['execution_id'],(string)$row['task_id'],'CORE_RELEASE_RUNNER_LOST',$at);
        return ['schemaVersion'=>1,'state'=>'FAILED','executionId'=>(string)$row['execution_id'],'code'=>'CORE_RELEASE_RUNNER_LOST'];
    }

    public function runExecution(string $executionId,?string $now=null): array
    {
        if(!self::validUuid($executionId))throw new HubCoreReleaseOperatorException('Execution identity is invalid','CORE_RELEASE_EXECUTION_INVALID');
        $this->assertRoot();
        $at=self::time($now??gmdate('c'));
        $row=$this->execution($executionId);
        $checkpoint=HubCoreReleaseService::checkpoint((string)$row['checkpoint_json']);
        $scope=$this->approvedScope((string)$row['task_id'],$checkpoint,$at);
        $sha=(string)$checkpoint['releaseSha'];
        $workRoot=self::WORK_ROOT;$workspace=null;
        try{
            $main=trim($this->run(['/usr/bin/git','-c','safe.directory='.self::CANONICAL_GIT_DIR,'--git-dir='.self::CANONICAL_GIT_DIR,'rev-parse','refs/heads/main'],null,20,'CORE_RELEASE_GIT_MAIN_FAILED')['out']);
            if(!hash_equals($sha,strtolower($main)))throw new HubCoreReleaseOperatorException('Canonical main moved before release execution','CORE_RELEASE_SOURCE_MOVED');
            $production=trim($this->run(['/usr/bin/git','-c','safe.directory='.self::CANONICAL_GIT_DIR,'--git-dir='.self::CANONICAL_GIT_DIR,'rev-parse','refs/heads/production'],null,20,'CORE_RELEASE_GIT_PRODUCTION_FAILED')['out']);
            if(hash_equals($sha,strtolower($production))){
                $this->complete($executionId,(string)$row['task_id'],$sha,'Production ใช้ release นี้อยู่แล้ว',$at);
                return ['schemaVersion'=>1,'state'=>'ALREADY_CURRENT','releaseSha'=>$sha];
            }

            $this->cleanupTerminalWorkspaces();
            $this->assertStorageHeadroom();
            $this->safeDirectory($workRoot,0700);
            $workspace=$workRoot.'/'.strtolower($executionId);
            if(file_exists($workspace)||is_link($workspace))$this->removeTree($workspace,$workRoot);
            $this->cloneCanonical($workspace,$workRoot);
            $head=trim($this->run(['/usr/bin/git','-C',$workspace,'rev-parse','HEAD'],null,20,'CORE_RELEASE_WORKSPACE_VERIFY_FAILED')['out']);
            if(!hash_equals($sha,strtolower($head)))throw new HubCoreReleaseOperatorException('Cloned source does not match approved release','CORE_RELEASE_SOURCE_MISMATCH');
            $dirty=trim($this->run(['/usr/bin/git','-C',$workspace,'status','--porcelain=v1','--untracked-files=all'],null,20,'CORE_RELEASE_WORKSPACE_VERIFY_FAILED')['out']);
            if($dirty!=='')throw new HubCoreReleaseOperatorException('Cloned source is not clean','CORE_RELEASE_SOURCE_DIRTY');

            [$node,$npm]=$this->nodeToolchain();
            $home='/var/lib/awh-hub/core-release-home';$cache='/var/lib/awh-hub/npm-cache';
            $this->safeDirectory($home,0700);$this->safeDirectory($cache,0700);
            $env=$this->releaseEnv($node,$workspace,$sha,$home,$cache);
            $this->event((string)$row['task_id'],'RUNNING',20,'Source ตรงกับ canonical main กำลังเตรียม verified toolchain',$at);
            $this->run([$npm,'ci','--ignore-scripts','--no-audit','--no-fund','--prefer-offline'],['cwd'=>$workspace,'env'=>$env],900,'CORE_RELEASE_NPM_CI_FAILED');
            $dirty=trim($this->run(['/usr/bin/git','-C',$workspace,'status','--porcelain=v1','--untracked-files=all'],null,20,'CORE_RELEASE_WORKSPACE_VERIFY_FAILED')['out']);
            if($dirty!=='')throw new HubCoreReleaseOperatorException('Dependency preparation changed tracked source','CORE_RELEASE_SOURCE_DIRTY');

            $args=[$node,$workspace.'/scripts/ops/bounded-deploy-mission.mjs','--identity-convergence','--approve'];
            if(($checkpoint['cleanupTopology']??false)===true)$args[]='--cleanup-topology';
            $this->event((string)$row['task_id'],'RUNNING',30,'AWH กำลังรัน bounded QA, backup, rollback และ Production gates',$at);
            $result=$this->run($args,['cwd'=>$workspace,'env'=>$env],6900,'CORE_RELEASE_MISSION_COMMAND_FAILED');
            if(!str_contains($result['out'],'MISSION_RESULT=PASS'))throw new HubCoreReleaseOperatorException('Bounded release mission did not produce PASS evidence','CORE_RELEASE_MISSION_FAILED');
            $done=self::time(gmdate('c'));$this->complete($executionId,(string)$row['task_id'],$sha,'Deploy สำเร็จและผ่าน Production verification ครบ',$done);
            return ['schemaVersion'=>1,'state'=>'COMPLETED','releaseSha'=>$sha,'scope'=>$scope];
        }catch(Throwable $error){
            $code=$error instanceof HubCoreReleaseOperatorException?$error->codeName:'CORE_RELEASE_RUN_FAILED';
            $this->fail($executionId,(string)$row['task_id'],$code,self::time(gmdate('c')));
            throw $error instanceof HubCoreReleaseOperatorException?$error:new HubCoreReleaseOperatorException('Core release runner failed',$code);
        }finally{
            if(is_string($workspace)&&(file_exists($workspace)||is_link($workspace))){
                try{$this->removeTree($workspace,$workRoot);}catch(Throwable $cleanupError){error_log('AWH core release workspace cleanup failed: '.$cleanupError->getMessage());}
            }
        }
    }

    private function execution(string $executionId): array
    {
        $q=$this->pdo->prepare("SELECT e.*,t.state AS task_state FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id
            WHERE e.execution_id=:execution AND e.required_capability=:capability AND e.executor_kind='VPS'");
        $q->execute(['execution'=>strtolower($executionId),'capability'=>HubCoreReleaseService::CAPABILITY]);$row=$q->fetch();
        if(!is_array($row)||!in_array((string)$row['state'],['LEASED','RUNNING'],true)||(string)$row['task_state']!=='RUNNING')throw new HubCoreReleaseOperatorException('Core release execution is not runnable','CORE_RELEASE_EXECUTION_INVALID');
        return $row;
    }

    private function approvedScope(string $taskId,array $checkpoint,string $at): array
    {
        $q=$this->pdo->prepare("SELECT scope_json,status,decided_at FROM control_approvals WHERE task_id=:task AND action='deployment.approve' ORDER BY expires_at DESC LIMIT 1");
        $q->execute(['task'=>$taskId]);$row=$q->fetch();
        if(!is_array($row)||(string)$row['status']!=='APPROVED'||!is_string($row['decided_at']))throw new HubCoreReleaseOperatorException('Owner approval is required','CORE_RELEASE_APPROVAL_REQUIRED');
        try{$scope=json_decode((string)$row['scope_json'],true,16,JSON_THROW_ON_ERROR);}catch(Throwable){throw new HubCoreReleaseOperatorException('Approval scope is invalid','CORE_RELEASE_APPROVAL_INVALID');}
        $keys=['cleanupTopology','projectId','releaseMode','releaseSha','risk','schemaVersion','taskId','transport'];$actual=is_array($scope)?array_keys($scope):[];sort($actual);sort($keys);
        $valid=is_array($scope)&&$actual===$keys&&($scope['schemaVersion']??null)===1&&hash_equals((string)($scope['taskId']??''),$taskId)&&hash_equals((string)($scope['projectId']??''),HubCoreReleaseService::PROJECT_ID)&&hash_equals((string)($scope['releaseSha']??''),(string)$checkpoint['releaseSha'])&&($scope['releaseMode']??null)==='IDENTITY_CONVERGENCE'&&($scope['transport']??null)==='LOCAL'&&($scope['risk']??null)==='CRITICAL'&&($scope['cleanupTopology']??null)===($checkpoint['cleanupTopology']??null);
        if(!$valid)throw new HubCoreReleaseOperatorException('Approval scope does not match release checkpoint','CORE_RELEASE_APPROVAL_INVALID');
        return $scope;
    }

    private function nodeToolchain(): array
    {
        $candidates=['/opt/awh-toolchain/node/bin/node'];
        $candidates=array_merge($candidates,glob('/opt/awh-toolchain/node-v*-linux-x64/bin/node')?:[],glob('/opt/awh-tools/remote-desktop/node-v*-linux-x64/bin/node')?:[]);
        $candidates[]='/usr/local/bin/node';$candidates[]='/usr/bin/node';
        foreach(array_unique($candidates) as $node){
            if(!is_file($node)||!is_executable($node))continue;
            $probe=$this->runOptional([$node,'--version'],null,10);$version=trim($probe['out']);
            if(($probe['code']??1)!==0||preg_match('/^v([0-9]+)\./',$version,$m)!==1||(int)$m[1]<22)continue;
            $npm=dirname($node).'/npm';if(is_file($npm)&&is_executable($npm))return [$node,$npm];
        }
        throw new HubCoreReleaseOperatorException('Verified Node 22+ release toolchain is unavailable','CORE_RELEASE_TOOLCHAIN_UNAVAILABLE');
    }

    private function releaseEnv(string $node,string $workspace,string $sha,string $home,string $cache): array
    {
        $base=getenv();if(!is_array($base))$base=[];
        return array_merge($base,[
            'PATH'=>dirname($node).':/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            'HOME'=>$home,'npm_config_cache'=>$cache,'NPM_CONFIG_AUDIT'=>'false','NPM_CONFIG_FUND'=>'false',
            'AWH_SOURCE_ROOT'=>$workspace,'AWH_DEPLOY_TARGET'=>'local','AWH_DEPLOY_TRANSPORT'=>'local',
            'AWH_RELEASE_COMMIT'=>$sha,'AWH_HUB_HOSTNAME'=>'kruart.online','AWH_PUBLIC_RELEASE_URL'=>'https://kruart.online/release.json',
            'AWH_OPERATOR_CLIENT'=>'/usr/local/bin/awh-operator','AWH_OWNER_AUTH_USERNAME'=>$this->ownerUsername(),'AWH_PRIVILEGED_LANE'=>'TYPED_OPERATOR',
            'LC_ALL'=>'C','LANG'=>'C',
        ]);
    }

    private function ownerUsername(): string
    {
        $q=$this->pdo->query("SELECT p.username FROM owner_bootstrap o JOIN owner_passwords p ON p.user_id=o.owner_user_id AND p.enabled=1 WHERE o.singleton_id=1 AND o.bootstrap_closed=1 LIMIT 1");
        $v=$q->fetchColumn();if(!is_string($v)||preg_match('/^[A-Za-z][A-Za-z0-9._-]{2,63}$/',$v)!==1)throw new HubCoreReleaseOperatorException('Owner identity is unavailable','CORE_RELEASE_OWNER_UNAVAILABLE');return $v;
    }

    private function advertise(string $at): void
    {
        $q=$this->pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='control_executor_capabilities'");$q->execute();if($q->fetchColumn()===false)return;
        $expires=gmdate('c',strtotime($at)+180);
        $this->pdo->prepare("INSERT INTO control_executor_capabilities(executor_id,executor_kind,capability,version,observed_at,expires_at) VALUES(:id,'VPS',:capability,'vps-native-v1',:at,:expires)
            ON CONFLICT(executor_id,capability) DO UPDATE SET version='vps-native-v1',observed_at=excluded.observed_at,expires_at=excluded.expires_at")
            ->execute(['id'=>self::DISPATCHER,'capability'=>HubCoreReleaseService::CAPABILITY,'at'=>$at,'expires'=>$expires]);
    }

    private function complete(string $execution,string $task,string $sha,string $summary,string $at): void
    {
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $this->pdo->prepare("UPDATE control_task_executions SET state='COMPLETED',lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=:at WHERE execution_id=:execution")->execute(['at'=>$at,'execution'=>$execution]);
            $this->pdo->prepare("UPDATE control_tasks SET state='COMPLETED',progress=100,result_summary=:summary,failure_code=NULL,lease_expires_at=NULL,updated_at=:at WHERE task_id=:task")->execute(['summary'=>$summary.' · '.substr($sha,0,12),'at'=>$at,'task'=>$task]);
            $this->event($task,'COMPLETED',100,$summary,$at);$this->pdo->exec('COMMIT');
        }catch(Throwable){$this->rollback();throw new HubCoreReleaseOperatorException('Core release completion could not be recorded','CORE_RELEASE_STATE_FAILED');}
    }

    private function fail(string $execution,string $task,string $code,string $at): void
    {
        $safe=preg_match('/^[A-Z0-9_]{3,80}$/',$code)===1?$code:'CORE_RELEASE_FAILED';
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $this->pdo->prepare("UPDATE control_task_executions SET state='FAILED',lease_owner=NULL,lease_expires_at=NULL,last_error_code=:code,updated_at=:at WHERE execution_id=:execution AND state NOT IN ('COMPLETED','FAILED','CANCELLED')")->execute(['code'=>$safe,'at'=>$at,'execution'=>$execution]);
            $this->pdo->prepare("UPDATE control_tasks SET state='FAILED',progress=0,result_summary='AWH core release หยุดแบบ fail-closed และยังไม่ประกาศว่าสำเร็จ',failure_code=:code,lease_expires_at=NULL,updated_at=:at WHERE task_id=:task AND state NOT IN ('COMPLETED','FAILED','CANCELLED')")->execute(['code'=>$safe,'at'=>$at,'task'=>$task]);
            $this->event($task,'FAILED',0,'Core release หยุดแบบ fail-closed: '.$safe,$at);$this->pdo->exec('COMMIT');
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
            if($q->fetchColumn()===false)throw new HubCoreReleaseOperatorException('Core release schema is not ready','CORE_RELEASE_NOT_READY');
        }
        if(!is_executable('/usr/bin/systemd-run')||!is_executable('/usr/bin/git')||!is_executable('/usr/bin/php'))throw new HubCoreReleaseOperatorException('Core release system tools are unavailable','CORE_RELEASE_TOOLCHAIN_UNAVAILABLE');
    }

    private function assertRoot(): void
    {
        if(!function_exists('posix_geteuid')||posix_geteuid()!==0)throw new HubCoreReleaseOperatorException('Core release runner requires root authority','CORE_RELEASE_ROOT_REQUIRED');
    }

    private function assertStorageHeadroom(): void
    {
        $total=@disk_total_space('/');$free=@disk_free_space('/');
        if(!is_float($total)||!is_float($free)||$total<=0||$free<0)throw new HubCoreReleaseOperatorException('Core release storage telemetry is unavailable','CORE_RELEASE_STORAGE_UNAVAILABLE');
        $usedPercent=(int)floor((1-($free/$total))*100);
        if($usedPercent>=self::STORAGE_BLOCK_PERCENT||$free<self::MIN_FREE_BYTES)
            throw new HubCoreReleaseOperatorException('Core release storage headroom is below the safe threshold','CORE_RELEASE_STORAGE_BLOCKED');
    }

    private function cleanupTerminalWorkspaces(): void
    {
        $root=self::WORK_ROOT;
        if(!is_dir($root)||is_link($root))return;
        $q=$this->pdo->prepare("SELECT execution_id FROM control_task_executions WHERE required_capability=:capability AND state IN ('COMPLETED','FAILED','CANCELLED')");
        $q->execute(['capability'=>HubCoreReleaseService::CAPABILITY]);
        $terminal=[];
        foreach($q->fetchAll(PDO::FETCH_COLUMN) as $execution)if(is_string($execution)&&self::validUuid($execution))$terminal[strtolower($execution)]=true;
        $entries=@scandir($root);if(!is_array($entries))return;
        foreach($entries as $name){
            $id=strtolower((string)$name);
            if(!isset($terminal[$id])||!self::validUuid($id))continue;
            $path=$root.'/'.$id;if(is_link($path)||!is_dir($path))continue;
            try{$this->removeTree($path,$root);}catch(Throwable $error){error_log('AWH terminal core release workspace cleanup failed: '.$error->getMessage());}
        }
    }

    private function safeDirectory(string $path,int $mode): void
    {
        if(!str_starts_with($path,'/var/lib/awh-hub/')||is_link($path))throw new HubCoreReleaseOperatorException('Core release workspace is unsafe','CORE_RELEASE_WORKSPACE_UNSAFE');
        if(!is_dir($path)&&!@mkdir($path,$mode,true)&&!is_dir($path))throw new HubCoreReleaseOperatorException('Core release workspace is unavailable','CORE_RELEASE_WORKSPACE_UNAVAILABLE');
        @chmod($path,$mode);
    }

    private function removeTree(string $path,string $root): void
    {
        $root=rtrim($root,'/');if($path===$root||!str_starts_with($path,$root.'/'))throw new HubCoreReleaseOperatorException('Cleanup path is outside core release work root','CORE_RELEASE_WORKSPACE_UNSAFE');
        if(is_link($path)||is_file($path)){@unlink($path);return;}if(!is_dir($path))return;
        $it=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);
        foreach($it as $file){$target=$file->getPathname();if($file->isLink()||$file->isFile())@unlink($target);else @rmdir($target);}
        if(!@rmdir($path)&&is_dir($path))throw new HubCoreReleaseOperatorException('Core release workspace cleanup failed','CORE_RELEASE_WORKSPACE_UNAVAILABLE');
    }

    private function cloneCanonical(string $workspace,string $workRoot): void
    {
        $command=['/usr/bin/git','-c','safe.directory='.self::CANONICAL_GIT_DIR,'clone','--no-hardlinks','--single-branch','--branch','main',self::SOURCE,$workspace];
        $last=['code'=>1,'out'=>'','err'=>''];
        for($attempt=1;$attempt<=2;$attempt++){
            if(file_exists($workspace)||is_link($workspace))$this->removeTree($workspace,$workRoot);
            $last=$this->runOptional($command,null,180);
            if(($last['code']??1)===0)return;
            if($attempt===1){error_log('AWH core release canonical clone failed once; retrying');usleep(250000);}
        }
        $detail=preg_replace('/[^A-Za-z0-9 .:_\/\-]/',' ',substr(trim((string)($last['out']??'')),-512));
        error_log('AWH core release canonical clone failed after retry; exit='.(int)($last['code']??1).' detail='.trim((string)$detail));
        throw new HubCoreReleaseOperatorException('Canonical Git clone failed after bounded retry','CORE_RELEASE_GIT_CLONE_FAILED');
    }

    private function run(array $command,?array $options=null,int $timeout=120,string $errorCode='CORE_RELEASE_COMMAND_FAILED'): array
    {
        if(preg_match('/^[A-Z0-9_]{3,80}$/',$errorCode)!==1)$errorCode='CORE_RELEASE_COMMAND_FAILED';
        $result=$this->runProcess($command,$options,$timeout);
        if($result['code']!==0)throw new HubCoreReleaseOperatorException('Typed core release command failed',$errorCode);
        return $result;
    }
    private function runOptional(array $command,?array $options=null,int $timeout=30): array { return $this->runProcess($command,$options,$timeout); }

    private function runProcess(array $command,?array $options,int $timeout): array
    {
        if($command===[]||!is_string($command[0])||!str_starts_with($command[0],'/'))return ['code'=>126,'out'=>'','err'=>'blocked'];
        $wrapped=['/usr/bin/timeout','--signal=TERM',(string)max(1,$timeout),...$command];
        $spec=[0=>['pipe','r'],1=>['pipe','w'],2=>['redirect',1]];
        $cwd=is_string($options['cwd']??null)?$options['cwd']:null;$env=is_array($options['env']??null)?$options['env']:null;
        $proc=proc_open($wrapped,$spec,$pipes,$cwd,$env);
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
    private static function unit(string $execution): string { if(!self::validUuid($execution))throw new HubCoreReleaseOperatorException('Execution identity is invalid','CORE_RELEASE_EXECUTION_INVALID');return 'awh-core-release-'.substr(str_replace('-','',strtolower($execution)),0,12).'.service'; }
    private static function validUuid(string $value): bool { return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$value)===1; }
    private static function uuid(): string { $b=random_bytes(16);$b[6]=chr((ord($b[6])&15)|64);$b[8]=chr((ord($b[8])&63)|128);return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($b),4)); }
    private static function time(string $value): string { if(strtotime($value)===false)throw new HubCoreReleaseOperatorException('Core release time is invalid','CORE_RELEASE_EXECUTION_INVALID');return gmdate('c',strtotime($value)); }
}
