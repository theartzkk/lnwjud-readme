<?php

declare(strict_types=1);

require_once __DIR__ . '/HubAssessmentReleaseService.php';

final class HubAssessmentReleaseOperatorException extends RuntimeException
{
    public function __construct(string $message,public readonly string $codeName='ASSESSMENT_RELEASE_OPERATOR_FAILED'){parent::__construct($message);}
}

final class HubAssessmentReleaseOperator
{
    private const DISPATCHER='vps-assessment-release';
    private const LEASE_SECONDS=3600;
    /** @var Closure(list<string>,?array):array{code:int,out:string,err:string} */
    private readonly Closure $runner;

    public function __construct(private readonly PDO $pdo,private readonly string $runnerScript,private readonly string $engineScript,?callable $runner=null)
    {
        foreach([$runnerScript,$engineScript] as $path)if($path===''||str_contains($path,"\0")||!str_starts_with($path,'/')||!is_file($path))
            throw new HubAssessmentReleaseOperatorException('Assessment release runtime path invalid','ASSESSMENT_RELEASE_CONFIG_INVALID');
        if($runner===null&&(!str_starts_with($runnerScript,'/opt/awh-hub/control-releases/')||!str_ends_with($runnerScript,'/hub/bin/awh-assessment-release-run.php')
            ||!str_starts_with($engineScript,'/opt/awh-hub/control-releases/')||!str_ends_with($engineScript,'/deploy/assessment/awh-assessment-release-engine.py')))
            throw new HubAssessmentReleaseOperatorException('Assessment release runtime outside active control release','ASSESSMENT_RELEASE_CONFIG_INVALID');
        $this->runner=$runner===null?Closure::fromCallable([$this,'runFixed']):Closure::fromCallable($runner);
    }
    public static function fromEnvironment(PDO $pdo): self
    {
        $runner=realpath(dirname(__DIR__).'/bin/awh-assessment-release-run.php');
        $engine=realpath(dirname(__DIR__,2).'/deploy/assessment/awh-assessment-release-engine.py');
        if(!is_string($runner)||!is_string($engine))throw new HubAssessmentReleaseOperatorException('Assessment release runtime unavailable','ASSESSMENT_RELEASE_CONFIG_INVALID');
        return new self($pdo,$runner,$engine);
    }

    public function tick(?string $now=null): array
    {
        $this->ready();$at=self::time($now??gmdate('c'));$this->advertise($at);
        $candidate=$this->runOptional(['/usr/bin/python3',$this->engineScript,'--candidate'],null,180);
        if(($candidate['code']??1)!==0)error_log('Assessment candidate refresh failed closed');
        $active=$this->active();if(is_array($active))return $this->observeActive($active,$at);
        $row=$this->claim($at);if($row===null)return ['schemaVersion'=>1,'state'=>'IDLE'];
        $unit=self::unit((string)$row['execution_id']);
        $rw='/var/lib/awh-hub /var/lib/awh-remote/handoff /var/www/bay-assessment /var/www/bay-assessment-staging /var/lib/bay-assessment /var/lib/bay-assessment-staging /var/backups /srv/awh-git';
        $command=['/usr/bin/systemd-run','--unit='.$unit,'--description=AWH-Assessment-release-'.substr(str_replace('-','',(string)$row['execution_id']),0,12),
            '--collect','--no-block','--property=RuntimeMaxSec=2400','--property=NoNewPrivileges=true','--property=PrivateTmp=false','--property=PrivateDevices=true',
            '--property=ProtectHome=read-only','--property=ProtectSystem=full','--property=ReadWritePaths='.$rw,
            '--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','/usr/bin/php',$this->runnerScript,(string)$row['execution_id']];
        $result=($this->runner)($command,null);
        if(($result['code']??1)!==0){$this->fail((string)$row['execution_id'],(string)$row['task_id'],'ASSESSMENT_RELEASE_DISPATCH_FAILED',$at);return ['schemaVersion'=>1,'state'=>'FAILED','code'=>'ASSESSMENT_RELEASE_DISPATCH_FAILED'];}
        $lease=gmdate('c',strtotime($at)+self::LEASE_SECONDS);
        $this->pdo->prepare("UPDATE control_task_executions SET state='RUNNING',lease_owner=:owner,lease_expires_at=:lease,last_error_code=NULL,updated_at=:at WHERE execution_id=:execution AND state='LEASED'")
            ->execute(['owner'=>'assessment-release:'.$unit,'lease'=>$lease,'at'=>$at,'execution'=>$row['execution_id']]);
        $this->event((string)$row['task_id'],'RUNNING',10,'AWH เปิด isolated Assessment release runner แล้ว',$at);
        return ['schemaVersion'=>1,'state'=>'DISPATCHED','executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'unit'=>$unit];
    }

    public function runExecution(string $executionId,?string $now=null): array
    {
        if(!self::validUuid($executionId))throw new HubAssessmentReleaseOperatorException('Execution identity invalid','ASSESSMENT_RELEASE_EXECUTION_INVALID');
        $this->assertRoot();$at=self::time($now??gmdate('c'));$row=$this->execution($executionId);
        $cp=HubAssessmentReleaseService::checkpoint((string)$row['checkpoint_json']);$scope=$this->approvedScope((string)$row['task_id'],$cp);
        try{
            $this->event((string)$row['task_id'],'RUNNING',20,'กำลังตรวจ candidate, source, DB backup และ staging',$at);
            $engine=$this->run(['/usr/bin/python3',$this->engineScript,'--apply','--execution-id',$executionId,
                '--release-sha',(string)$cp['releaseSha'],'--base-sha',(string)$cp['baseReleaseSha'],'--runtime-version',(string)$cp['runtimeVersion'],
                '--manifest-sha',(string)$cp['candidateManifestSha256']],null,2100,'ASSESSMENT_RELEASE_ENGINE_FAILED');
            $payload=$this->lastJson($engine['out']);
            if(($payload['ok']??false)!==true||!is_array($payload['result']??null)||($payload['result']['state']??null)!=='LIVE_SMOKE_PASSED')
                throw new HubAssessmentReleaseOperatorException('Assessment engine did not reach live verified state','ASSESSMENT_RELEASE_ENGINE_FAILED');
            $this->pdo->prepare('UPDATE projects SET source_revision=:release,observed_at=:at,provenance=:provenance WHERE project_id=:project')
                ->execute(['release'=>$cp['releaseSha'],'at'=>gmdate('c'),'provenance'=>'assessment-release:'.substr((string)$cp['releaseSha'],0,12),'project'=>HubAssessmentReleaseService::PROJECT_ID]);
            $this->runOptional(['/usr/bin/python3',$this->engineScript,'--finalize','--execution-id',$executionId],null,60);
            $done=self::time(gmdate('c'));$summary='Deploy BAY Assessment '.(string)$cp['runtimeVersion'].' สำเร็จและ Production ผ่าน health/smoke';
            $this->complete($executionId,(string)$row['task_id'],(string)$cp['releaseSha'],$summary,$done);
            return ['schemaVersion'=>1,'state'=>'COMPLETED','releaseSha'=>$cp['releaseSha'],'runtimeVersion'=>$cp['runtimeVersion'],'scope'=>$scope,'result'=>$payload['result']];
        }catch(Throwable $e){
            $this->runOptional(['/usr/bin/python3',$this->engineScript,'--rollback','--execution-id',$executionId],null,180);
            $code=$e instanceof HubAssessmentReleaseOperatorException?$e->codeName:'ASSESSMENT_RELEASE_RUN_FAILED';
            $this->fail($executionId,(string)$row['task_id'],$code,self::time(gmdate('c')));
            throw $e instanceof HubAssessmentReleaseOperatorException?$e:new HubAssessmentReleaseOperatorException('Assessment release runner failed',$code);
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
            $q->execute(['capability'=>HubAssessmentReleaseService::CAPABILITY]);$row=$q->fetch();
            if(!is_array($row)){$this->pdo->exec('COMMIT');return null;}
            HubAssessmentReleaseService::checkpoint((string)$row['checkpoint_json']);
            $u=$this->pdo->prepare("UPDATE control_task_executions SET state='LEASED',lease_owner=:owner,lease_expires_at=:lease,attempt_count=attempt_count+1,updated_at=:at
                WHERE execution_id=:execution AND state='QUEUED' AND attempt_count<3");
            $u->execute(['owner'=>self::DISPATCHER,'lease'=>$lease,'at'=>$at,'execution'=>$row['execution_id']]);
            if($u->rowCount()!==1){$this->pdo->exec('ROLLBACK');return null;}
            $this->pdo->prepare("UPDATE control_tasks SET state='RUNNING',progress=5,failure_code=NULL,updated_at=:at WHERE task_id=:task AND state='WAITING_FOR_WORKER'")
                ->execute(['at'=>$at,'task'=>$row['task_id']]);$this->event((string)$row['task_id'],'RUNNING',5,'Owner อนุมัติแล้ว AWH กำลังเปิด bounded Assessment release runner',$at);
            $this->pdo->exec('COMMIT');return $row;
        }catch(Throwable $e){$this->rollback();throw new HubAssessmentReleaseOperatorException('Assessment release could not be claimed','ASSESSMENT_RELEASE_CLAIM_FAILED');}
    }
    private function active(): ?array
    {
        $q=$this->pdo->prepare("SELECT e.*,t.state AS task_state FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id
            WHERE e.required_capability=:capability AND e.state IN ('LEASED','RUNNING') AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY e.updated_at DESC LIMIT 1");
        $q->execute(['capability'=>HubAssessmentReleaseService::CAPABILITY]);$row=$q->fetch();return is_array($row)?$row:null;
    }
    private function observeActive(array $row,string $at): array
    {
        $unit=self::unit((string)$row['execution_id']);$status=($this->runner)(['/bin/systemctl','is-active',$unit],null);$state=trim((string)($status['out']??''));
        if(in_array($state,['active','activating'],true)){$lease=gmdate('c',strtotime($at)+self::LEASE_SECONDS);$this->pdo->prepare("UPDATE control_task_executions SET lease_expires_at=:lease,updated_at=:at WHERE execution_id=:execution AND state IN ('LEASED','RUNNING')")->execute(['lease'=>$lease,'at'=>$at,'execution'=>$row['execution_id']]);return ['schemaVersion'=>1,'state'=>'RUNNING','executionId'=>(string)$row['execution_id'],'unit'=>$unit];}
        $expires=strtotime((string)($row['lease_expires_at']??''));if($expires!==false&&$expires>strtotime($at))return ['schemaVersion'=>1,'state'=>'RUNNING','executionId'=>(string)$row['execution_id'],'unit'=>$unit];
        $this->fail((string)$row['execution_id'],(string)$row['task_id'],'ASSESSMENT_RELEASE_RUNNER_LOST',$at);return ['schemaVersion'=>1,'state'=>'FAILED','code'=>'ASSESSMENT_RELEASE_RUNNER_LOST'];
    }
    private function execution(string $id): array
    {
        $q=$this->pdo->prepare("SELECT e.*,t.state AS task_state FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id WHERE e.execution_id=:execution AND e.required_capability=:capability AND e.executor_kind='VPS'");
        $q->execute(['execution'=>strtolower($id),'capability'=>HubAssessmentReleaseService::CAPABILITY]);$row=$q->fetch();
        if(!is_array($row)||!in_array((string)$row['state'],['LEASED','RUNNING'],true)||(string)$row['task_state']!=='RUNNING')throw new HubAssessmentReleaseOperatorException('Assessment release execution not runnable','ASSESSMENT_RELEASE_EXECUTION_INVALID');
        return $row;
    }
    private function approvedScope(string $task,array $cp): array
    {
        $q=$this->pdo->prepare("SELECT scope_json,status,decided_at FROM control_approvals WHERE task_id=:task AND action='deployment.approve' ORDER BY expires_at DESC LIMIT 1");$q->execute(['task'=>$task]);$r=$q->fetch();
        if(!is_array($r)||(string)$r['status']!=='APPROVED'||!is_string($r['decided_at']))throw new HubAssessmentReleaseOperatorException('Owner approval required','ASSESSMENT_RELEASE_APPROVAL_REQUIRED');
        try{$scope=json_decode((string)$r['scope_json'],true,16,JSON_THROW_ON_ERROR);}catch(Throwable){throw new HubAssessmentReleaseOperatorException('Approval scope invalid','ASSESSMENT_RELEASE_APPROVAL_INVALID');}
        $keys=['baseReleaseSha','candidateManifestSha256','projectId','releaseMode','releaseSha','risk','runtimeVersion','schemaVersion','taskId','transport'];$actual=is_array($scope)?array_keys($scope):[];sort($actual);sort($keys);
        $valid=is_array($scope)&&$actual===$keys&&($scope['schemaVersion']??null)===1&&hash_equals((string)($scope['taskId']??''),$task)
            &&hash_equals((string)($scope['projectId']??''),HubAssessmentReleaseService::PROJECT_ID)&&($scope['releaseMode']??null)==='IMMUTABLE_NODE'&&($scope['transport']??null)==='LOCAL'&&($scope['risk']??null)==='CRITICAL';
        foreach(['releaseSha','baseReleaseSha','runtimeVersion','candidateManifestSha256'] as $k)$valid=$valid&&hash_equals((string)($scope[$k]??''),(string)($cp[$k]??''));
        if(!$valid)throw new HubAssessmentReleaseOperatorException('Approval scope does not match checkpoint','ASSESSMENT_RELEASE_APPROVAL_INVALID');return $scope;
    }
    private function advertise(string $at): void
    {
        $q=$this->pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='control_executor_capabilities'");if($q->fetchColumn()===false)return;$expires=gmdate('c',strtotime($at)+180);
        $this->pdo->prepare("INSERT INTO control_executor_capabilities(executor_id,executor_kind,capability,version,observed_at,expires_at)
            VALUES(:id,'VPS',:capability,'vps-native-v1',:at,:expires) ON CONFLICT(executor_id,capability) DO UPDATE SET version='vps-native-v1',observed_at=excluded.observed_at,expires_at=excluded.expires_at")
            ->execute(['id'=>self::DISPATCHER,'capability'=>HubAssessmentReleaseService::CAPABILITY,'at'=>$at,'expires'=>$expires]);
    }
    private function complete(string $execution,string $task,string $sha,string $summary,string $at): void
    {
        try{$this->pdo->exec('BEGIN IMMEDIATE');$this->pdo->prepare("UPDATE control_task_executions SET state='COMPLETED',lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=:at WHERE execution_id=:execution")->execute(['at'=>$at,'execution'=>$execution]);
            $this->pdo->prepare("UPDATE control_tasks SET state='COMPLETED',progress=100,result_summary=:summary,failure_code=NULL,lease_expires_at=NULL,updated_at=:at WHERE task_id=:task")->execute(['summary'=>$summary.' · '.substr($sha,0,12),'at'=>$at,'task'=>$task]);
            $this->event($task,'COMPLETED',100,$summary,$at);$this->pdo->exec('COMMIT');}catch(Throwable){$this->rollback();throw new HubAssessmentReleaseOperatorException('Assessment completion state failed','ASSESSMENT_RELEASE_STATE_FAILED');}
    }
    private function fail(string $execution,string $task,string $code,string $at): void
    {
        $safe=preg_match('/^[A-Z0-9_]{3,80}$/',$code)===1?$code:'ASSESSMENT_RELEASE_FAILED';
        try{$this->pdo->exec('BEGIN IMMEDIATE');$this->pdo->prepare("UPDATE control_task_executions SET state='FAILED',lease_owner=NULL,lease_expires_at=NULL,last_error_code=:code,updated_at=:at WHERE execution_id=:execution AND state NOT IN ('COMPLETED','FAILED','CANCELLED')")->execute(['code'=>$safe,'at'=>$at,'execution'=>$execution]);
            $this->pdo->prepare("UPDATE control_tasks SET state='FAILED',progress=0,result_summary='Assessment release หยุดแบบ fail-closed',failure_code=:code,lease_expires_at=NULL,updated_at=:at WHERE task_id=:task AND state NOT IN ('COMPLETED','FAILED','CANCELLED')")->execute(['code'=>$safe,'at'=>$at,'task'=>$task]);
            $this->event($task,'FAILED',0,'Assessment release หยุดแบบ fail-closed: '.$safe,$at);$this->pdo->exec('COMMIT');}catch(Throwable){$this->rollback();}
    }
    private function event(string $task,string $state,int $progress,string $message,string $at): void{$this->pdo->prepare('INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:id,:task,:state,:progress,:message,:at)')->execute(['id'=>self::uuid(),'task'=>$task,'state'=>$state,'progress'=>$progress,'message'=>$message,'at'=>$at]);}
    private function ready(): void{foreach(['control_tasks','control_task_executions','control_approvals','owner_bootstrap'] as $t){$q=$this->pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name");$q->execute(['name'=>$t]);if($q->fetchColumn()===false)throw new HubAssessmentReleaseOperatorException('Assessment release schema not ready','ASSESSMENT_RELEASE_NOT_READY');}foreach(['/usr/bin/systemd-run','/usr/bin/php','/usr/bin/python3'] as $p)if(!is_executable($p))throw new HubAssessmentReleaseOperatorException('Assessment toolchain unavailable','ASSESSMENT_RELEASE_TOOLCHAIN_UNAVAILABLE');}
    private function assertRoot(): void{if(!function_exists('posix_geteuid')||posix_geteuid()!==0)throw new HubAssessmentReleaseOperatorException('Assessment runner requires root','ASSESSMENT_RELEASE_ROOT_REQUIRED');}
    private function lastJson(string $out): array{$lines=array_reverse(array_filter(array_map('trim',preg_split('/\R/',$out)?:[])));foreach($lines as $line){try{$v=json_decode($line,true,64,JSON_THROW_ON_ERROR);if(is_array($v)&&!array_is_list($v))return $v;}catch(Throwable){}}throw new HubAssessmentReleaseOperatorException('Assessment engine response invalid','ASSESSMENT_RELEASE_ENGINE_FAILED');}
    private function run(array $command,?array $options=null,int $timeout=120,string $code='ASSESSMENT_RELEASE_COMMAND_FAILED'): array{$r=$this->runProcess($command,$options,$timeout);if($r['code']!==0)throw new HubAssessmentReleaseOperatorException('Typed Assessment command failed',$code);return $r;}
    private function runOptional(array $command,?array $options=null,int $timeout=30): array{return $this->runProcess($command,$options,$timeout);}
    private function runProcess(array $command,?array $options,int $timeout): array{if($command===[]||!is_string($command[0])||!str_starts_with($command[0],'/'))return ['code'=>126,'out'=>'','err'=>'blocked'];$wrapped=['/usr/bin/timeout','--signal=TERM',(string)max(1,$timeout),...$command];$spec=[0=>['pipe','r'],1=>['pipe','w'],2=>['redirect',1]];$proc=proc_open($wrapped,$spec,$pipes,is_string($options['cwd']??null)?$options['cwd']:null,is_array($options['env']??null)?$options['env']:null);if(!is_resource($proc))return ['code'=>127,'out'=>'','err'=>'unavailable'];fclose($pipes[0]);$out=stream_get_contents($pipes[1]);fclose($pipes[1]);$code=proc_close($proc);$out=is_string($out)?$out:'';if(strlen($out)>4*1024*1024)$out=substr($out,-4*1024*1024);return ['code'=>$code,'out'=>$out,'err'=>''];}
    private function runFixed(array $command,?array $options=null): array{if($command===[]||!in_array($command[0],['/usr/bin/systemd-run','/bin/systemctl'],true))return ['code'=>126,'out'=>'','err'=>'blocked'];return $this->runProcess($command,$options,30);}
    private function rollback(): void{try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}}
    private static function unit(string $execution): string{if(!self::validUuid($execution))throw new HubAssessmentReleaseOperatorException('Execution invalid','ASSESSMENT_RELEASE_EXECUTION_INVALID');return 'awh-assessment-release-'.substr(str_replace('-','',strtolower($execution)),0,12).'.service';}
    private static function validUuid(string $v): bool{return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$v)===1;}
    private static function uuid(): string{$b=random_bytes(16);$b[6]=chr((ord($b[6])&15)|64);$b[8]=chr((ord($b[8])&63)|128);return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($b),4));}
    private static function time(string $v): string{if(strtotime($v)===false)throw new HubAssessmentReleaseOperatorException('Time invalid','ASSESSMENT_RELEASE_EXECUTION_INVALID');return gmdate('c',strtotime($v));}
}
