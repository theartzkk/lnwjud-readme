<?php

declare(strict_types=1);

require_once __DIR__ . '/HubBayRemoteUpdateService.php';
require_once __DIR__ . '/HubCapabilityRegistryService.php';

final class HubOperatorBridgeException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='OPERATOR_BRIDGE_FAILED') { parent::__construct($message); }
}

final class HubOperatorBridgeService
{
    private const INSTALL_CONFIRMATION='INSTALL_BAY_UPDATE';
    /** @var Closure(string,array<string,mixed>):array<string,mixed> */
    private readonly Closure $poster;

    /** @param null|callable(string,array<string,mixed>):array<string,mixed> $poster */
    public function __construct(private readonly PDO $pdo, ?callable $poster=null)
    {
        $this->pdo->exec('PRAGMA foreign_keys=ON');
        $this->pdo->exec('PRAGMA busy_timeout=5000');
        $this->poster=$poster===null ? Closure::fromCallable([$this,'postJson']) : Closure::fromCallable($poster);
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    public function handle(array $request, ?string $now=null): array
    {
        if (($request['schemaVersion']??null)!==1) throw new HubOperatorBridgeException('Request schema is invalid','OPERATOR_REQUEST_INVALID');
        $action=is_string($request['action']??null)?trim((string)$request['action']):'';
        $at=self::timestamp($now??gmdate('c'));
        return match($action){
            'system.status'=>$this->systemStatus($at),
            'projects.list'=>$this->projects($at),
            'project.gate'=>$this->projectGate(self::text($request,'project',160),$at),
            'bay.status'=>$this->bayStatus($at),
            'bay.install'=>$this->bayInstall($request,$at),
            default=>throw new HubOperatorBridgeException('Action is not allowlisted','OPERATOR_ACTION_FORBIDDEN'),
        };
    }

    /** @return array<string,mixed> */
    private function systemStatus(string $at): array
    {
        $quick=(string)$this->pdo->query('PRAGMA quick_check')->fetchColumn();
        $schema=(int)$this->pdo->query('PRAGMA user_version')->fetchColumn();
        $projects=(int)$this->pdo->query('SELECT COUNT(*) FROM projects')->fetchColumn();
        $active=$this->pdo->prepare("SELECT COUNT(*) FROM control_execution_envelopes x JOIN control_task_executions e ON e.execution_id=x.execution_id JOIN control_tasks t ON t.task_id=x.task_id WHERE x.mutation_scope<>'READ' AND x.state='ACTIVE' AND (x.lease_expires_at IS NULL OR x.lease_expires_at>:at) AND e.state NOT IN ('COMPLETED','FAILED','CANCELLED') AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED')");
        $active->execute(['at'=>$at]);
        return ['schemaVersion'=>1,'state'=>$quick==='ok'?'READY':'REVIEW','database'=>['quickCheck'=>$quick,'schema'=>$schema],'projects'=>$projects,'activeMutationCount'=>(int)$active->fetchColumn(),'arbitraryShell'=>false,'observedAt'=>$at];
    }

    /** @return array<string,mixed> */
    private function projects(string $at): array
    {
        $q=$this->pdo->query("SELECT p.project_id,p.name,p.type,p.canonical_source_authority,p.canonical_source_revision,p.canonical_source_vault_revision_id,v.active_revision_id,v.sync_state FROM projects p LEFT JOIN control_project_vaults v ON v.project_id=p.project_id ORDER BY p.name,p.project_id LIMIT 200");
        $items=[];
        foreach($q->fetchAll() as $r)$items[]=['projectId'=>(string)$r['project_id'],'name'=>(string)$r['name'],'type'=>(string)$r['type'],'sourceAuthority'=>$r['canonical_source_authority'],'sourceRevision'=>$r['canonical_source_revision'],'sourceVaultRevisionId'=>$r['canonical_source_vault_revision_id'],'activeVaultRevisionId'=>$r['active_revision_id'],'vaultSyncState'=>$r['sync_state']];
        return ['schemaVersion'=>1,'projects'=>$items,'count'=>count($items),'observedAt'=>$at];
    }

    /** @return array<string,mixed> */
    private function projectGate(string $selector,string $at): array
    {
        $project=$this->resolveProject($selector);
        $id=(string)$project['project_id'];
        $active=$this->pdo->prepare("SELECT x.execution_id,x.task_id,x.state,x.mutation_scope,x.lease_expires_at,e.state AS execution_state,e.required_capability,t.state AS task_state,t.goal FROM control_execution_envelopes x JOIN control_task_executions e ON e.execution_id=x.execution_id JOIN control_tasks t ON t.task_id=x.task_id WHERE x.project_id=:project AND x.mutation_scope<>'READ' AND x.state='ACTIVE' AND (x.lease_expires_at IS NULL OR x.lease_expires_at>:at) AND e.state NOT IN ('COMPLETED','FAILED','CANCELLED') AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY x.updated_at DESC LIMIT 20");
        $active->execute(['project'=>$id,'at'=>$at]); $activeRows=$active->fetchAll();
        $running=$this->pdo->prepare("SELECT COUNT(*) FROM control_task_executions e LEFT JOIN control_execution_envelopes x ON x.execution_id=e.execution_id WHERE e.project_id=:project AND e.state IN ('LEASED','RUNNING') AND COALESCE(x.mutation_scope,'PROJECT_CANDIDATE')<>'READ'");
        $running->execute(['project'=>$id]); $runningCount=(int)$running->fetchColumn();
        $workspace=$this->pdo->prepare("SELECT owner_device_id,checkpoint_id,lease_expires_at,updated_at FROM control_workspace_leases WHERE project_id=:project AND state='ACTIVE' AND (lease_expires_at IS NULL OR lease_expires_at>:at) LIMIT 5");
        $workspace->execute(['project'=>$id,'at'=>$at]); $workspaceRows=$workspace->fetchAll();
        $waiting=$this->pdo->prepare("SELECT COUNT(*) FROM control_execution_envelopes x JOIN control_task_executions e ON e.execution_id=x.execution_id JOIN control_tasks t ON t.task_id=x.task_id WHERE x.project_id=:project AND x.mutation_scope<>'READ' AND x.state IN ('OPEN','WAITING','CONFLICT') AND e.state NOT IN ('COMPLETED','FAILED','CANCELLED') AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED')");
        $waiting->execute(['project'=>$id]); $waitingCount=(int)$waiting->fetchColumn();
        $vault=$this->pdo->prepare("SELECT storage_mode,active_revision_id,sync_state,content_bytes,file_count,updated_at FROM control_project_vaults WHERE project_id=:project");
        $vault->execute(['project'=>$id]); $vaultRow=$vault->fetch();
        $quick=(string)$this->pdo->query('PRAGMA quick_check')->fetchColumn();
        $authority=is_string($project['canonical_source_authority']??null)?(string)$project['canonical_source_authority']:null;
        $sourceRevision=is_string($project['canonical_source_revision']??null)?strtolower((string)$project['canonical_source_revision']):null;
        $sourceVault=is_string($project['canonical_source_vault_revision_id']??null)?(string)$project['canonical_source_vault_revision_id']:null;
        $activeVault=is_array($vaultRow)&&is_string($vaultRow['active_revision_id']??null)?(string)$vaultRow['active_revision_id']:null;
        $sync=is_array($vaultRow)?(string)($vaultRow['sync_state']??'EMPTY'):'EMPTY';
        $sourceReady=in_array($authority,['AWH_VAULT','GITHUB'],true) && ($authority!=='AWH_VAULT' || ($sync==='SYNCED'&&$activeVault!==null&&$sourceVault!==null&&hash_equals($activeVault,$sourceVault)));
        if($authority==='GITHUB')$sourceReady=$sourceRevision!==null&&preg_match('/^[a-f0-9]{40}$/',$sourceRevision)===1;
        $checks=[
            ['key'=>'database','ok'=>$quick==='ok','value'=>$quick],
            ['key'=>'active_mutations','ok'=>count($activeRows)===0,'value'=>count($activeRows)],
            ['key'=>'running_mutation_executions','ok'=>$runningCount===0,'value'=>$runningCount],
            ['key'=>'active_workspace_leases','ok'=>count($workspaceRows)===0,'value'=>count($workspaceRows)],
            ['key'=>'source_authority','ok'=>$sourceReady,'value'=>$authority??'UNSET'],
            ['key'=>'vault_sync','ok'=>$authority!=='AWH_VAULT'||$sync==='SYNCED','value'=>$sync],
        ];
        $ready=!in_array(false,array_column($checks,'ok'),true);
        return ['schemaVersion'=>1,'state'=>$ready?'READY':'BLOCKED','ready'=>$ready,'project'=>['projectId'=>$id,'name'=>(string)$project['name'],'type'=>(string)$project['type']],'source'=>['authority'=>$authority,'revision'=>$sourceRevision,'canonicalVaultRevisionId'=>$sourceVault,'activeVaultRevisionId'=>$activeVault,'syncState'=>$sync],'writer'=>['activeMutationCount'=>count($activeRows),'runningMutationExecutionCount'=>$runningCount,'waitingMutationCount'=>$waitingCount,'activeWorkspaceLeaseCount'=>count($workspaceRows),'activeMutations'=>array_map(static fn(array $r):array=>['executionId'=>(string)$r['execution_id'],'taskId'=>(string)$r['task_id'],'state'=>(string)$r['state'],'capability'=>(string)$r['required_capability'],'leaseExpiresAt'=>$r['lease_expires_at'],'goal'=>(string)$r['goal']],$activeRows),'workspaceLeases'=>array_map(static fn(array $r):array=>['ownerDeviceId'=>(string)$r['owner_device_id'],'checkpointId'=>$r['checkpoint_id'],'leaseExpiresAt'=>$r['lease_expires_at'],'updatedAt'=>(string)$r['updated_at']],$workspaceRows)],'checks'=>$checks,'observedAt'=>$at];
    }

    /** @return array<string,mixed> */
    private function bayStatus(string $at): array
    {
        $bay=new HubBayRemoteUpdateService(); $signed=$bay->status($at); $remote=($this->poster)((string)$signed['endpoint'],(array)$signed['statusRelay']);
        return ['schemaVersion'=>1,'state'=>'READY','authority'=>'BAY PackageManager/Update Center','remote'=>$remote,'projectGate'=>$this->projectGate('BAY EXCUSE X',$at),'observedAt'=>$at];
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function bayInstall(array $request,string $at): array
    {
        if (($request['confirmation']??null)!==self::INSTALL_CONFIRMATION) throw new HubOperatorBridgeException('Explicit BAY install confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $version=self::text($request,'targetVersion',80); $sha=strtolower(self::text($request,'targetSha',40)); $packageSha=strtolower(self::text($request,'packageSha256',64));
        if(preg_match('/^[a-f0-9]{40}$/',$sha)!==1||preg_match('/^[a-f0-9]{64}$/',$packageSha)!==1)throw new HubOperatorBridgeException('BAY package identity is invalid','OPERATOR_REQUEST_INVALID');
        $gate=$this->projectGate('BAY EXCUSE X',$at); if (($gate['ready']??false)!==true) throw new HubOperatorBridgeException('BAY project gate is blocked','OPERATOR_PROJECT_GATE_BLOCKED');
        $projectId=(string)($gate['project']['projectId']??'');
        $authority=$this->acquireMutationAuthority($projectId,'Guarded BAY install '.$version,'bay.remote_update.install',['targetVersion'=>$version,'targetSha'=>$sha,'packageSha256'=>$packageSha],$at);
        $success=false;
        try {
            $bay=new HubBayRemoteUpdateService(); $statusEnvelope=$bay->status($at); $before=($this->poster)((string)$statusEnvelope['endpoint'],(array)$statusEnvelope['statusRelay']);
            if (($before['ok']??false)!==true || (($before['preflight']['ready']??false)!==true) || (($before['maintenance']['active']??false)===true)) throw new HubOperatorBridgeException('BAY Production preflight is not ready','OPERATOR_BAY_PREFLIGHT_BLOCKED');
            $package=null; foreach((array)($before['packages']??[]) as $row){if(!is_array($row))continue;if(($row['version']??null)===$version&&strtolower((string)($row['sourceSha']??''))===$sha&&strtolower((string)($row['packageSha256']??''))===$packageSha&&($row['installable']??false)===true){$package=$row;break;}}
            if(!is_array($package)) throw new HubOperatorBridgeException('Exact BAY package is not installable in Update Inbox','OPERATOR_BAY_PACKAGE_NOT_READY');
            $signed=$bay->installRelay($version,$sha,$packageSha,$at); $result=($this->poster)((string)$signed['endpoint'],(array)$signed['relay']);
            if (($result['ok']??false)!==true) throw new HubOperatorBridgeException('BAY PackageManager rejected install','OPERATOR_BAY_INSTALL_FAILED');
            $success=true;
            return ['schemaVersion'=>1,'state'=>'INSTALLED','gate'=>$gate,'authority'=>['executionId'=>$authority['executionId'],'taskId'=>$authority['taskId'],'leaseExpiresAt'=>$authority['leaseExpiresAt']],'before'=>['version'=>$before['currentVersion']??null,'deployedSha'=>$before['deployedSha']??null],'result'=>$result,'observedAt'=>$at];
        } finally {
            $this->releaseMutationAuthority($authority,$success,gmdate('c'));
        }
    }

    /** @param array<string,mixed> $checkpoint @return array{executionId:string,taskId:string,projectId:string,leaseExpiresAt:string} */
    private function acquireMutationAuthority(string $projectId,string $goal,string $capability,array $checkpoint,string $at): array
    {
        if(!self::uuidValid($projectId)||preg_match('/^[a-z][a-z0-9:._-]{1,63}$/',$capability)!==1)throw new HubOperatorBridgeException('Mutation authority request is invalid','OPERATOR_REQUEST_INVALID');
        $lease=gmdate('c',strtotime($at)+300); $taskId=self::uuid(); $executionId=self::uuid();
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $workspace=$this->pdo->prepare("SELECT owner_device_id FROM control_workspace_leases WHERE project_id=:project AND state='ACTIVE' AND (lease_expires_at IS NULL OR lease_expires_at>:at) LIMIT 1");
            $workspace->execute(['project'=>$projectId,'at'=>$at]);
            if($workspace->fetchColumn()!==false)throw new HubOperatorBridgeException('A workspace writer currently owns this project','OPERATOR_PROJECT_GATE_BLOCKED');
            $owner=$this->pdo->query("SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id=1 AND bootstrap_closed=1")->fetchColumn();
            if(!is_string($owner)||!self::uuidValid($owner))throw new HubOperatorBridgeException('Owner authority is unavailable','OPERATOR_OWNER_UNAVAILABLE');
            $revision=null;$q=$this->pdo->prepare('SELECT active_revision_id FROM control_project_vaults WHERE project_id=:project');$q->execute(['project'=>$projectId]);$v=$q->fetchColumn();if(is_string($v)&&self::uuidValid($v))$revision=$v;
            $key='operator-bridge-'.substr(hash('sha256',$executionId),0,48);
            $this->pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,:goal,'RUNNING',NULL,:lease,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$taskId,'user'=>$owner,'project'=>$projectId,'goal'=>$goal,'lease'=>$lease,'key'=>$key,'at'=>$at]);
            $this->pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,:revision,'VPS',:capability,'RUNNING','operator-bridge',:lease,1,NULL,:checkpoint,NULL,:at,:at)")->execute(['execution'=>$executionId,'task'=>$taskId,'project'=>$projectId,'revision'=>$revision,'capability'=>$capability,'lease'=>$lease,'checkpoint'=>json_encode($checkpoint,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'at'=>$at]);
            $registry=new HubCapabilityRegistryService($this->pdo); $claim=$registry->activateExecutionAuthority($executionId,$lease,$at);
            if(($claim['granted']??false)!==true)throw new HubOperatorBridgeException('Another mutating execution owns this project','OPERATOR_PROJECT_GATE_BLOCKED');
            $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:id,:task,'RUNNING',10,'Guarded operator bridge acquired canonical mutation authority',:at)")->execute(['id'=>self::uuid(),'task'=>$taskId,'at'=>$at]);
            $this->pdo->exec('COMMIT');
            return ['executionId'=>$executionId,'taskId'=>$taskId,'projectId'=>$projectId,'leaseExpiresAt'=>$lease];
        }catch(Throwable $error){if($this->pdo->inTransaction())$this->pdo->exec('ROLLBACK');if($error instanceof HubOperatorBridgeException)throw $error;throw new HubOperatorBridgeException('Mutation authority could not be acquired','OPERATOR_AUTHORITY_FAILED');}
    }

    /** @param array{executionId:string,taskId:string,projectId:string,leaseExpiresAt:string} $authority */
    private function releaseMutationAuthority(array $authority,bool $success,string $at): void
    {
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            (new HubCapabilityRegistryService($this->pdo))->updateEnvelopeState($authority['executionId'],'RELEASED',null,$at);
            $state=$success?'COMPLETED':'FAILED';$summary=$success?'Guarded BAY install completed':'Guarded BAY install failed and released authority';$error=$success?null:'OPERATOR_BAY_INSTALL_FAILED';
            $this->pdo->prepare('UPDATE control_task_executions SET state=:state,lease_owner=NULL,lease_expires_at=NULL,last_error_code=:error,updated_at=:at WHERE execution_id=:execution')->execute(['state'=>$state,'error'=>$error,'at'=>$at,'execution'=>$authority['executionId']]);
            $this->pdo->prepare('UPDATE control_tasks SET state=:state,lease_expires_at=NULL,progress=100,result_summary=:summary,failure_code=:error,updated_at=:at WHERE task_id=:task')->execute(['state'=>$state,'summary'=>$summary,'error'=>$error,'at'=>$at,'task'=>$authority['taskId']]);
            $this->pdo->prepare('INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:id,:task,:state,100,:message,:at)')->execute(['id'=>self::uuid(),'task'=>$authority['taskId'],'state'=>$state,'message'=>$summary,'at'=>$at]);
            $this->pdo->exec('COMMIT');
        }catch(Throwable $error){if($this->pdo->inTransaction())$this->pdo->exec('ROLLBACK');throw new HubOperatorBridgeException('Mutation authority could not be released','OPERATOR_AUTHORITY_RELEASE_FAILED');}
    }

    /** @return array<string,mixed> */
    private function resolveProject(string $selector): array
    {
        $rows=$this->pdo->query("SELECT p.project_id,p.name,p.type,p.canonical_source_authority,p.canonical_source_revision,p.canonical_source_vault_revision_id FROM projects p ORDER BY p.name,p.project_id LIMIT 250")->fetchAll();
        $needle=self::key($selector); $matches=[];
        foreach($rows as $r){$keys=[self::key((string)$r['project_id']),self::key((string)$r['name'])]; if(in_array($needle,$keys,true))$matches[]=$r;}
        if(count($matches)!==1) throw new HubOperatorBridgeException(count($matches)===0?'Project was not found':'Project selector is ambiguous',count($matches)===0?'OPERATOR_PROJECT_NOT_FOUND':'OPERATOR_PROJECT_AMBIGUOUS');
        return $matches[0];
    }

    /** @param array<string,mixed> $payload @return array<string,mixed> */
    private function postJson(string $endpoint,array $payload): array
    {
        if($endpoint!=='https://excuse.kruart.online/remote-update.php') throw new HubOperatorBridgeException('Remote endpoint is not allowlisted','OPERATOR_REMOTE_FORBIDDEN');
        $json=json_encode($payload,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        $context=stream_context_create(['http'=>['method'=>'POST','header'=>"Content-Type: application/json\r\nAccept: application/json\r\nConnection: close\r\n",'content'=>$json,'timeout'=>15,'ignore_errors'=>true]]);
        $raw=@file_get_contents($endpoint,false,$context); if(!is_string($raw)||$raw==='') throw new HubOperatorBridgeException('Remote update endpoint is unavailable','OPERATOR_REMOTE_UNAVAILABLE');
        try{$decoded=json_decode($raw,true,32,JSON_THROW_ON_ERROR);}catch(Throwable){throw new HubOperatorBridgeException('Remote update response is invalid','OPERATOR_REMOTE_INVALID');}
        if(!is_array($decoded)||array_is_list($decoded))throw new HubOperatorBridgeException('Remote update response is invalid','OPERATOR_REMOTE_INVALID'); return $decoded;
    }

    /** @param array<string,mixed> $request */
    private static function text(array $request,string $key,int $max): string { $value=$request[$key]??null; if(!is_string($value))throw new HubOperatorBridgeException('Request field is invalid','OPERATOR_REQUEST_INVALID'); $value=trim($value); if($value===''||strlen($value)>$max||str_contains($value,"\0"))throw new HubOperatorBridgeException('Request field is invalid','OPERATOR_REQUEST_INVALID'); return $value; }
    private static function key(string $value): string { $value=mb_strtolower(trim($value),'UTF-8'); return preg_replace('/[^\pL\pN]+/u','-',$value)?:$value; }
    private static function uuidValid(string $value): bool { return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$value)===1; }
    private static function uuid(): string { $b=random_bytes(16);$b[6]=chr((ord($b[6])&0x0f)|0x40);$b[8]=chr((ord($b[8])&0x3f)|0x80);return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($b),4)); }
    private static function timestamp(string $value): string { $t=strtotime($value); if($t===false)throw new HubOperatorBridgeException('Time is invalid','OPERATOR_REQUEST_INVALID'); return gmdate('c',$t); }
}
