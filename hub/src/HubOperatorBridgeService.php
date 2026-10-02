<?php

declare(strict_types=1);

require_once __DIR__.'/HubUpdateTargetRegistry.php';

require_once __DIR__ . '/HubBayRemoteUpdateService.php';
require_once __DIR__ . '/HubCapabilityRegistryService.php';
require_once __DIR__ . '/HubExecutionLifecycleService.php';
require_once __DIR__ . '/HubPlatformMaintenanceService.php';
require_once __DIR__ . '/HubProjectVault.php';
require_once __DIR__ . '/HubProjectVaultService.php';
require_once __DIR__ . '/HubProjectSourceAuthorityService.php';

final class HubOperatorBridgeException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='OPERATOR_BRIDGE_FAILED') { parent::__construct($message); }
}

final class HubOperatorBridgeService
{
    private const INSTALL_CONFIRMATION='INSTALL_BAY_UPDATE';
    private const STAGE_CONFIRMATION='STAGE_BAY_UPDATE';
    private const MAX_BAY_PACKAGE_BYTES=9437184;
    private const VERIFICATION_CONFIRMATION='STORE_VERIFICATION_EVIDENCE';
    private const VAULT_EXPORT_CONFIRMATION='EXPORT_CANONICAL_VAULT_SOURCE';
    private const VAULT_IMPORT_CONFIRMATION='IMPORT_CANONICAL_VAULT_SOURCE';
    private const MAX_VAULT_IMPORT_BYTES=134217728;
    private const MAX_VERIFICATION_DOCUMENT_BYTES=196608;
    private const SOURCE_PROMOTE_CONFIRMATION='PROMOTE_CANONICAL_MAIN';
    private const SOURCE_METADATA_REPAIR_CONFIRMATION='REPAIR_SOURCE_PROMOTION_METADATA';
    private const MISSION_ACQUIRE_CONFIRMATION='ACQUIRE_PROJECT_MISSION';
    private const FLOW_START_CONFIRMATION='START_OR_RESUME_PROJECT_FLOW';
    private const MISSION_RELEASE_CONFIRMATION='RELEASE_PROJECT_MISSION';
    private const MISSION_CAPABILITY='operator.project_mission';
    private const MISSION_OWNER='operator-mission';
    private const MISSION_LEASE_SECONDS=7200;
    private const MISSION_STALE_SECONDS=300;
    private const PLATFORM_FREEZE_ENABLE_CONFIRMATION='ENABLE_PLATFORM_MAINTENANCE_FREEZE';
    private const PLATFORM_FREEZE_DISABLE_CONFIRMATION='DISABLE_PLATFORM_MAINTENANCE_FREEZE';
    private const STORAGE_TARGET_FREE_BYTES=6442450944;
    private const STORAGE_BLOCK_FREE_BYTES=3221225472;
    private const STORAGE_CRITICAL_FREE_BYTES=1610612736;
    private const STORAGE_GUARD_MAX_AGE_SECONDS=1800;
    private const MAX_SOURCE_BUNDLE_BYTES=134217728;
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
            'project.gate'=>$this->projectGate(self::text($request,'project',160),$at,false,self::MISSION_CAPABILITY),
            'flow.preflight'=>$this->flowPreflight($request,$at),
            'flow.start'=>$this->flowStart($request,$at),
            'platform.maintenance.status'=>$this->platformMaintenanceStatus($at),
            'platform.maintenance.enable'=>$this->platformMaintenanceEnable($request,$at),
            'platform.maintenance.disable'=>$this->platformMaintenanceDisable($request,$at),
            'verification.store'=>$this->verificationStore($request,$at),
            'verification.regressions'=>$this->verificationRegressions($request,$at),
            'vault.export'=>$this->vaultExport($request,$at),
            'vault.import'=>$this->vaultImport($request,$at),
            'mission.status'=>$this->missionStatus(self::text($request,'project',160),$at),
            'mission.acquire'=>$this->missionAcquire($request,$at),
            'mission.renew'=>$this->missionRenew($request,$at),
            'mission.release'=>$this->missionRelease($request,$at),
            'source.promote'=>$this->sourcePromote($request,$at),
            'source.metadata-repair'=>$this->sourceMetadataRepair($request,$at),
            'bay.status'=>$this->bayStatus($at),
            'bay.stage'=>$this->bayStage($request,$at),
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
        $active=$this->pdo->prepare("SELECT
            SUM(CASE WHEN e.required_capability<>:mission THEN 1 ELSE 0 END) AS writer_count,
            SUM(CASE WHEN e.required_capability=:mission THEN 1 ELSE 0 END) AS coordination_count
            FROM control_execution_envelopes x
            JOIN control_task_executions e ON e.execution_id=x.execution_id
            JOIN control_tasks t ON t.task_id=x.task_id
            WHERE x.mutation_scope<>'READ' AND x.state='ACTIVE'
            AND (x.lease_expires_at IS NULL OR x.lease_expires_at>:at)
            AND e.state NOT IN ('COMPLETED','FAILED','CANCELLED')
            AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED')");
        $active->execute(['at'=>$at,'mission'=>self::MISSION_CAPABILITY]);
        $counts=$active->fetch();
        $storage=$this->storageSafetyState($at);
        $maintenance=(new HubPlatformMaintenanceService($this->pdo))->state();
        return [
            'schemaVersion'=>2,'state'=>$quick==='ok'&&($storage['releaseBlocked']??false)!==true?'READY':'REVIEW',
            'database'=>['quickCheck'=>$quick,'schema'=>$schema],'projects'=>$projects,
            'storage'=>$storage,'platformMaintenance'=>$maintenance,
            'activeMutationCount'=>is_array($counts)?(int)($counts['writer_count']??0):0,
            'activeCoordinationCount'=>is_array($counts)?(int)($counts['coordination_count']??0):0,
            'aggregateCountsAreNotBlockingAuthority'=>true,
            'blockingDecisionAuthority'=>'AWH_EXECUTION_GATE',
            'arbitraryShell'=>false,'observedAt'=>$at
        ];
    }

    /** @return array<string,mixed> */
    private function platformMaintenanceStatus(string $at): array
    {
        return ['schemaVersion'=>1,'state'=>(new HubPlatformMaintenanceService($this->pdo))->state(),'observedAt'=>$at];
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function platformMaintenanceEnable(array $request,string $at): array
    {
        if(($request['confirmation']??null)!==self::PLATFORM_FREEZE_ENABLE_CONFIRMATION)throw new HubOperatorBridgeException('Explicit platform maintenance confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $keys=array_keys($request);sort($keys);if($keys!==['action','confirmation','project','reason','schemaVersion'])throw new HubOperatorBridgeException('Platform maintenance request is invalid','OPERATOR_REQUEST_INVALID');
        $project=$this->resolveProject(self::text($request,'project',160));$reason=self::text($request,'reason',500);
        $active=(new HubCapabilityRegistryService($this->pdo))->executionAuthorityStatus($at);
        if((int)($active['activeMutationCount']??0)>0)throw new HubOperatorBridgeException('Active mutations must finish before maintenance freeze','OPERATOR_PLATFORM_FREEZE_BUSY');
        try{$state=(new HubPlatformMaintenanceService($this->pdo))->enable((string)$project['project_id'],$reason,'typed-operator',$at);}catch(HubPlatformMaintenanceException $e){throw new HubOperatorBridgeException($e->getMessage(),$e->codeName);}
        return ['schemaVersion'=>1,'state'=>$state,'observedAt'=>$at];
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function platformMaintenanceDisable(array $request,string $at): array
    {
        if(($request['confirmation']??null)!==self::PLATFORM_FREEZE_DISABLE_CONFIRMATION)throw new HubOperatorBridgeException('Explicit platform maintenance confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $keys=array_keys($request);sort($keys);if($keys!==['action','confirmation','reason','schemaVersion'])throw new HubOperatorBridgeException('Platform maintenance request is invalid','OPERATOR_REQUEST_INVALID');
        $reason=self::text($request,'reason',500);
        try{$state=(new HubPlatformMaintenanceService($this->pdo))->disable($reason,'typed-operator',$at);}catch(HubPlatformMaintenanceException $e){throw new HubOperatorBridgeException($e->getMessage(),$e->codeName);}
        return ['schemaVersion'=>1,'state'=>$state,'observedAt'=>$at];
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
    private function projectGate(string $selector,string $at,bool $requireSource=false,?string $capability=null,?string $excludeExecutionId=null,?string $requestedResourceOverride=null): array
    {
        $project=$this->resolveProject($selector);
        $id=(string)$project['project_id'];
        (new HubExecutionLifecycleService($this->pdo))->reconcile($id,$at);
        $this->reconcileStaleMissions($id,$at);
        $requestedResource=is_string($requestedResourceOverride)&&$requestedResourceOverride!==''?strtoupper(trim($requestedResourceOverride)):($capability===null?'CANONICAL:PROJECT':HubCapabilityRegistryService::mutationResourceForExecution($capability,'VPS'));
        $active=$this->pdo->prepare("SELECT x.execution_id,x.task_id,x.project_id,x.state,x.mutation_scope,x.lease_expires_at,e.state AS execution_state,e.required_capability,e.executor_kind,e.checkpoint_json,t.state AS task_state,t.goal,p.name AS project_name FROM control_execution_envelopes x JOIN control_task_executions e ON e.execution_id=x.execution_id JOIN control_tasks t ON t.task_id=x.task_id JOIN projects p ON p.project_id=x.project_id WHERE x.mutation_scope<>'READ' AND x.state='ACTIVE' AND (x.lease_expires_at IS NULL OR x.lease_expires_at>:at) AND e.state NOT IN ('COMPLETED','FAILED','CANCELLED') AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY x.updated_at DESC LIMIT 80");
        $active->execute(['at'=>$at]);$allActiveRows=$active->fetchAll();
        $activeRows=array_values(array_filter($allActiveRows,static fn(array $row):bool=>hash_equals($id,(string)$row['project_id'])));
        $coordinationRows=array_values(array_filter($activeRows,static fn(array $row):bool=>(string)($row['required_capability']??'')===self::MISSION_CAPABILITY));
        $writerRows=array_values(array_filter($activeRows,static fn(array $row):bool=>(string)($row['required_capability']??'')!==self::MISSION_CAPABILITY));
        $conflictingRows=[];
        foreach($allActiveRows as $row){
            if($excludeExecutionId!==null&&hash_equals($excludeExecutionId,(string)$row['execution_id']))continue;
            $resource=HubCapabilityRegistryService::mutationResourceForExecution((string)$row['required_capability'],(string)$row['executor_kind'],is_string($row['checkpoint_json']??null)?(string)$row['checkpoint_json']:null);
            if(HubCapabilityRegistryService::mutationResourcesConflictForProjects($requestedResource,$id,$resource,(string)$row['project_id'])){$row['mutation_resource']=$resource;$conflictingRows[]=$row;}
        }
        $running=$this->pdo->prepare("SELECT COUNT(*) FROM control_task_executions e WHERE e.project_id=:project AND e.state IN ('LEASED','RUNNING')");
        $running->execute(['project'=>$id]); $runningCount=(int)$running->fetchColumn();
        $unscoped=$this->pdo->prepare("SELECT COUNT(*) FROM control_task_executions e LEFT JOIN control_execution_envelopes x ON x.execution_id=e.execution_id WHERE e.project_id=:project AND e.state IN ('LEASED','RUNNING') AND x.execution_id IS NULL");
        $unscoped->execute(['project'=>$id]); $unscopedCount=(int)$unscoped->fetchColumn();
        $unscopedGlobal=$this->pdo->prepare("SELECT e.execution_id,e.project_id,e.required_capability,e.executor_kind,e.checkpoint_json FROM control_task_executions e LEFT JOIN control_execution_envelopes x ON x.execution_id=e.execution_id WHERE e.state IN ('LEASED','RUNNING') AND x.execution_id IS NULL ORDER BY e.updated_at,e.execution_id LIMIT 80");
        $unscopedGlobal->execute();$unscopedConflictCount=0;
        foreach($unscopedGlobal->fetchAll() as $row){
            if($excludeExecutionId!==null&&hash_equals($excludeExecutionId,(string)$row['execution_id']))continue;
            $candidateProject=(string)$row['project_id'];
            if(hash_equals($id,$candidateProject)){$unscopedConflictCount++;continue;}
            $resource=HubCapabilityRegistryService::mutationResourceForExecution((string)$row['required_capability'],(string)$row['executor_kind'],is_string($row['checkpoint_json']??null)?(string)$row['checkpoint_json']:null);
            if(HubCapabilityRegistryService::mutationResourcesConflictForProjects($requestedResource,$id,$resource,$candidateProject))$unscopedConflictCount++;
        }
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
        $vaultReady=$authority!=='AWH_VAULT'||$sync==='SYNCED';
        $maintenanceService=new HubPlatformMaintenanceService($this->pdo);
        $maintenance=$maintenanceService->state();
        $maintenanceAllowed=$maintenanceService->mutationAllowed($id,$requestedResource);
        $checks=[
            ['key'=>'platform_maintenance','ok'=>$maintenanceAllowed,'value'=>($maintenance['mode']??'NORMAL'),'blocking'=>true],
            ['key'=>'database','ok'=>$quick==='ok','value'=>$quick,'blocking'=>true],
            ['key'=>'conflicting_mutations','ok'=>count($conflictingRows)===0,'value'=>count($conflictingRows),'blocking'=>true],
            ['key'=>'unscoped_running_mutations','ok'=>$unscopedConflictCount===0,'value'=>$unscopedConflictCount,'blocking'=>true],
            ['key'=>'active_workspace_leases','ok'=>count($workspaceRows)===0,'value'=>count($workspaceRows),'blocking'=>$capability===null],
            ['key'=>'source_authority','ok'=>$sourceReady,'value'=>$authority??'UNSET','blocking'=>$requireSource],
            ['key'=>'vault_sync','ok'=>$vaultReady,'value'=>$sync,'blocking'=>$requireSource&&$authority==='AWH_VAULT'],
        ];
        $hardBlocked=false;
        foreach($checks as $check)if(($check['blocking']??false)===true&&($check['ok']??false)!==true){$hardBlocked=true;break;}
        $sourceGateReady=!$hardBlocked&&$sourceReady&&$vaultReady;
        $attention=!$hardBlocked&&(!$sourceReady||!$vaultReady);
        $ready=!$hardBlocked;
        $state=$hardBlocked?'BLOCKED':($attention?'ATTENTION':'READY');
        $decision=$hardBlocked?'WAIT_CONFLICT':(count($coordinationRows)>0?'CONTINUE_OR_JOIN':'CONTINUE');
        return ['schemaVersion'=>2,'state'=>$state,'ready'=>$ready,'mutationReady'=>$ready,'sourceReady'=>$sourceGateReady,'blocking'=>$hardBlocked,'decision'=>$decision,'decisionAuthority'=>'AWH_EXECUTION_GATE','productionReady'=>$sourceGateReady,'productionReadyDeprecated'=>true,'runtimeParityState'=>'NOT_EVALUATED','readinessSemantics'=>['ready'=>'MUTATION_GATE','mutationReady'=>'MUTATION_GATE','sourceReady'=>'SOURCE_AUTHORITY_AND_VAULT','productionReady'=>'DEPRECATED_ALIAS_OF_SOURCE_READY','runtimeParityState'=>'SEPARATE_RELEASE_VERIFICATION'],'sourceRequired'=>$requireSource,'requestedMutationResource'=>$requestedResource,'project'=>['projectId'=>$id,'name'=>(string)$project['name'],'type'=>(string)$project['type']],'source'=>['authority'=>$authority,'revision'=>$sourceRevision,'canonicalVaultRevisionId'=>$sourceVault,'activeVaultRevisionId'=>$activeVault,'syncState'=>$sync],'writer'=>['activeMutationCount'=>count($writerRows),'conflictingMutationCount'=>count($conflictingRows),'runningMutationExecutionCount'=>count($writerRows),'unscopedRunningMutationExecutionCount'=>$unscopedCount,'waitingMutationCount'=>$waitingCount,'activeWorkspaceLeaseCount'=>count($workspaceRows),'activeMutations'=>array_map(static fn(array $r):array=>['executionId'=>(string)$r['execution_id'],'taskId'=>(string)$r['task_id'],'state'=>(string)$r['state'],'scope'=>(string)$r['mutation_scope'],'resource'=>HubCapabilityRegistryService::mutationResourceForExecution((string)$r['required_capability'],(string)$r['executor_kind'],is_string($r['checkpoint_json']??null)?(string)$r['checkpoint_json']:null),'capability'=>(string)$r['required_capability'],'leaseExpiresAt'=>$r['lease_expires_at'],'goal'=>(string)$r['goal']],$writerRows),'workspaceLeases'=>array_map(static fn(array $r):array=>['ownerDeviceId'=>(string)$r['owner_device_id'],'checkpointId'=>$r['checkpoint_id'],'leaseExpiresAt'=>$r['lease_expires_at'],'updatedAt'=>(string)$r['updated_at']],$workspaceRows)],'coordination'=>['activeMissionCount'=>count($coordinationRows),'blocksMutation'=>false,'mutationDecision'=>$hardBlocked?'WAIT_CONFLICT':'CONTINUE','nextUserAction'=>$hardBlocked?'RESOLVE_CONFLICT':'NONE','rule'=>'PROJECT_MISSIONS_ARE_COORDINATION_ONLY','missions'=>array_map(static fn(array $r):array=>['executionId'=>(string)$r['execution_id'],'taskId'=>(string)$r['task_id'],'leaseExpiresAt'=>$r['lease_expires_at'],'goal'=>(string)$r['goal'],'releaseTrack'=>self::missionReleaseTrackFromCheckpoint((string)($r['checkpoint_json']??'')),'ownerActionRequired'=>false,'nextUserAction'=>'NONE'],$coordinationRows)],'checks'=>$checks,'observedAt'=>$at];
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function vaultExport(array $request,string $at): array
    {
        if(($request['confirmation']??null)!==self::VAULT_EXPORT_CONFIRMATION)throw new HubOperatorBridgeException('Explicit canonical Vault export confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $keys=array_keys($request);sort($keys);if($keys!==['action','confirmation','project','schemaVersion'])throw new HubOperatorBridgeException('Canonical Vault export request is invalid','OPERATOR_REQUEST_INVALID');
        $selector=self::text($request,'project',160);
        $gate=$this->projectGate($selector,$at,true,'artifact.object');
        if(($gate['sourceReady']??false)!==true)throw new HubOperatorBridgeException('Project source gate is not ready','OPERATOR_PROJECT_GATE_BLOCKED');
        $source=is_array($gate['source']??null)?$gate['source']:[];$project=is_array($gate['project']??null)?$gate['project']:[];
        $projectId=(string)($project['projectId']??'');$revision=(string)($source['canonicalVaultRevisionId']??'');$active=(string)($source['activeVaultRevisionId']??'');
        if(($source['authority']??null)!=='AWH_VAULT'||($source['syncState']??null)!=='SYNCED'||preg_match('/^[0-9a-f-]{36}$/i',$projectId)!==1||preg_match('/^[0-9a-f-]{36}$/i',$revision)!==1||!hash_equals($revision,$active))throw new HubOperatorBridgeException('Canonical Vault source is not exportable','OPERATOR_PROJECT_GATE_BLOCKED');
        $q=$this->pdo->prepare("SELECT content_sha256,state FROM control_project_vault_revisions WHERE revision_id=:revision AND project_id=:project LIMIT 1");$q->execute(['revision'=>$revision,'project'=>$projectId]);$row=$q->fetch();
        if(!is_array($row)||($row['state']??null)!=='ACTIVE')throw new HubOperatorBridgeException('Canonical Vault revision is not active','OPERATOR_VAULT_EXPORT_UNAVAILABLE');
        $contentSha=strtolower(trim((string)($row['content_sha256']??'')));if(preg_match('/^[a-f0-9]{64}$/',$contentSha)!==1)throw new HubOperatorBridgeException('Canonical Vault content identity is invalid','OPERATOR_VAULT_EXPORT_UNAVAILABLE');
        $stageRoot=getenv('AWH_OPERATOR_STAGE_ROOT');if(!is_string($stageRoot)||$stageRoot==='')$stageRoot='/var/lib/awh-remote/operator-staging';
        $exportRoot=getenv('AWH_OPERATOR_EXPORT_ROOT');if(!is_string($exportRoot)||$exportRoot==='')$exportRoot='/var/lib/awh-hub/operator-exports';
        $vaultRoot=getenv('AWH_PROJECT_VAULT_ROOT');if(!is_string($vaultRoot)||$vaultRoot==='')$vaultRoot='/var/lib/awh-hub/project-vault';
        $stageReal=realpath($stageRoot);$exportReal=realpath($exportRoot);$vaultReal=realpath($vaultRoot);
        if(!is_string($stageReal)||!is_dir($stageReal)||is_link($stageRoot)||!is_writable($stageReal)||!is_string($exportReal)||!is_dir($exportReal)||is_link($exportRoot)||(((int)(@stat($exportReal)['mode']??0)&0o022)!==0)||!is_writable($exportReal)||!is_string($vaultReal)||!is_dir($vaultReal)||is_link($vaultRoot))throw new HubOperatorBridgeException('Canonical Vault export roots are unavailable','OPERATOR_VAULT_EXPORT_UNAVAILABLE');
        $stagedFile='vault-'.$revision.'-'.substr($contentSha,0,16).'-'.bin2hex(random_bytes(4)).'.zip';$destination=$stageReal.'/'.$stagedFile;$private=$exportReal.'/.'.$stagedFile.'.tmp';
        try{
            $archive=(new HubProjectVault($vaultReal))->archive($projectId,$revision,$private);
            $input=@fopen($private,'rb');$output=@fopen($destination,'xb');
            if(!is_resource($input)||!is_resource($output)){if(is_resource($input))fclose($input);if(is_resource($output))fclose($output);@unlink($destination);throw new HubOperatorBridgeException('Canonical Vault staging copy could not start','OPERATOR_VAULT_EXPORT_UNAVAILABLE');}
            $copied=stream_copy_to_stream($input,$output,HubProjectVault::MAX_ARCHIVE_BYTES+1);@fflush($output);if(function_exists('fsync'))@fsync($output);fclose($input);fclose($output);
            $actual=is_file($destination)?hash_file('sha256',$destination):false;
            if(!is_int($copied)||$copied!==(int)$archive['sizeBytes']||!is_string($actual)||!hash_equals((string)$archive['sha256'],$actual)||!@chmod($destination,0640)){@unlink($destination);throw new HubOperatorBridgeException('Canonical Vault staging copy failed verification','OPERATOR_VAULT_EXPORT_UNAVAILABLE');}
            return ['schemaVersion'=>1,'state'=>'EXPORTED','projectId'=>$projectId,'projectName'=>(string)($project['name']??''),'vaultRevisionId'=>$revision,'contentSha256'=>$contentSha,'stagedFile'=>$stagedFile,'archiveSha256'=>(string)$archive['sha256'],'sizeBytes'=>(int)$archive['sizeBytes'],'fileCount'=>(int)$archive['fileCount'],'observedAt'=>$at];
        }finally{@unlink($private);}
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function vaultImport(array $request,string $at): array
    {
        if(($request['confirmation']??null)!==self::VAULT_IMPORT_CONFIRMATION)throw new HubOperatorBridgeException('Explicit canonical Vault import confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $keys=array_keys($request);sort($keys);if($keys!==['action','archiveSha256','confirmation','expectedActiveRevisionId','missionExecutionId','project','schemaVersion','stagedFile'])throw new HubOperatorBridgeException('Canonical Vault import request is invalid','OPERATOR_REQUEST_INVALID');
        $selector=self::text($request,'project',160);$archiveSha=self::sha256(self::text($request,'archiveSha256',64));$stagedFile=self::text($request,'stagedFile',80);
        $expected=strtolower(self::text($request,'expectedActiveRevisionId',36));$missionId=strtolower(self::text($request,'missionExecutionId',36));
        if(!self::uuidValid($expected)||!self::uuidValid($missionId)||$stagedFile!==$archiveSha.'.zip')throw new HubOperatorBridgeException('Canonical Vault import identity is invalid','OPERATOR_REQUEST_INVALID');
        $project=$this->resolveProject($selector);$projectId=(string)$project['project_id'];
        $this->ensureProjectMissionActive($missionId,$at,$projectId);
        $gate=$this->projectGate($selector,$at,false,'source.promote',$missionId);if(($gate['ready']??false)!==true)throw new HubOperatorBridgeException('Project mutation gate is blocked','OPERATOR_PROJECT_GATE_BLOCKED');
        $source=is_array($gate['source']??null)?$gate['source']:[];
        $active=strtolower((string)($source['activeVaultRevisionId']??''));$canonical=strtolower((string)($source['canonicalVaultRevisionId']??''));
        if(($source['authority']??null)!=='AWH_VAULT'||!self::uuidValid($active)||!self::uuidValid($canonical)||!hash_equals($expected,$active)||!hash_equals($expected,$canonical))throw new HubOperatorBridgeException('Canonical Vault source moved before import','OPERATOR_VAULT_BASE_MOVED');
        $stageRoot=getenv('AWH_OPERATOR_STAGE_ROOT');if(!is_string($stageRoot)||$stageRoot==='')$stageRoot='/var/lib/awh-remote/operator-staging';$stageReal=realpath($stageRoot);
        if(!is_string($stageReal)||!is_dir($stageReal)||is_link($stageRoot))throw new HubOperatorBridgeException('Vault import staging is unavailable','OPERATOR_VAULT_IMPORT_UNAVAILABLE');
        $archive=$stageReal.'/'.$stagedFile;$archiveReal=realpath($archive);$stat=is_string($archiveReal)?@stat($archiveReal):false;
        if(!is_string($archiveReal)||dirname($archiveReal)!==$stageReal||is_link($archive)||!is_file($archiveReal)||!is_readable($archiveReal)||!is_array($stat)||(((int)($stat['mode']??0)&0o022)!==0))throw new HubOperatorBridgeException('Vault import archive is unavailable or unsafe','OPERATOR_VAULT_IMPORT_UNAVAILABLE');
        $size=@filesize($archiveReal);$actual=hash_file('sha256',$archiveReal);if(!is_int($size)||$size<1||$size>self::MAX_VAULT_IMPORT_BYTES||!is_string($actual)||!hash_equals($archiveSha,$actual))throw new HubOperatorBridgeException('Vault import archive failed verification','OPERATOR_VAULT_IMPORT_UNAVAILABLE');
        $owner=$this->pdo->query("SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id=1 AND bootstrap_closed=1")->fetchColumn();if(!is_string($owner)||!self::uuidValid($owner))throw new HubOperatorBridgeException('AWH Owner identity is unavailable','OPERATOR_VAULT_IMPORT_UNAVAILABLE');
        try{
            $vaults=HubProjectVaultService::fromEnvironment($this->pdo);$ingest=$vaults->ingestArchive($projectId,$archiveReal,$owner,null,$expected,$at);$revision=null;$changed=($ingest['changed']??false)===true;
            if($changed){$revision=is_string($ingest['createdRevisionId']??null)?strtolower((string)$ingest['createdRevisionId']):null;}
            else{
                $duplicate=is_string($ingest['duplicateRevisionId']??null)?strtolower((string)$ingest['duplicateRevisionId']):null;if($duplicate===null||!self::uuidValid($duplicate))throw new HubOperatorBridgeException('Vault import duplicate identity is unavailable','OPERATOR_VAULT_IMPORT_FAILED');
                $q=$this->pdo->prepare('SELECT state,parent_revision_id FROM control_project_vault_revisions WHERE project_id=:project AND revision_id=:revision LIMIT 1');$q->execute(['project'=>$projectId,'revision'=>$duplicate]);$row=$q->fetch();
                if(!is_array($row))throw new HubOperatorBridgeException('Vault import duplicate revision is unavailable','OPERATOR_VAULT_IMPORT_FAILED');
                if(($row['state']??null)==='ACTIVE'&&hash_equals($duplicate,$expected)){
                    $bound=(new HubProjectSourceAuthorityService($this->pdo,null))->bindVault($projectId,$duplicate,$at);
                    return ['schemaVersion'=>1,'state'=>'CURRENT','projectId'=>$projectId,'projectName'=>(string)$project['name'],'previousVaultRevisionId'=>$expected,'vaultRevisionId'=>$duplicate,'contentSha256'=>(string)($bound['canonicalContentSha256']??''),'archiveSha256'=>$archiveSha,'changed'=>false,'authority'=>'AWH_VAULT','observedAt'=>$at];
                }
                if(($row['state']??null)!=='CANDIDATE'||!is_string($row['parent_revision_id']??null)||!hash_equals(strtolower((string)$row['parent_revision_id']),$expected))throw new HubOperatorBridgeException('Vault import would reactivate non-candidate historical bytes','OPERATOR_VAULT_IMPORT_CONFLICT');
                $revision=$duplicate;
            }
            if(!is_string($revision)||!self::uuidValid($revision))throw new HubOperatorBridgeException('Vault import revision identity is invalid','OPERATOR_VAULT_IMPORT_FAILED');
            $promoted=$vaults->promote($projectId,$revision,$expected,$at);if(($promoted['activeRevisionId']??null)!==$revision||($promoted['syncState']??null)!=='SYNCED')throw new HubOperatorBridgeException('Vault promotion could not be verified','OPERATOR_VAULT_IMPORT_FAILED');
            $bound=(new HubProjectSourceAuthorityService($this->pdo,null))->bindVault($projectId,$revision,$at);if(($bound['authority']??null)!=='AWH_VAULT'||($bound['canonicalVaultRevisionId']??null)!==$revision||($bound['state']??null)!=='CURRENT')throw new HubOperatorBridgeException('Vault source binding could not be verified','OPERATOR_VAULT_IMPORT_FAILED');
            return ['schemaVersion'=>1,'state'=>'PROMOTED','projectId'=>$projectId,'projectName'=>(string)$project['name'],'previousVaultRevisionId'=>$expected,'vaultRevisionId'=>$revision,'contentSha256'=>(string)($bound['canonicalContentSha256']??''),'archiveSha256'=>$archiveSha,'sizeBytes'=>$size,'fileCount'=>(int)($promoted['fileCount']??0),'changed'=>true,'authority'=>'AWH_VAULT','missionExecutionId'=>$missionId,'observedAt'=>$at];
        }catch(HubProjectVaultException $error){$code=$error->codeName==='PROJECT_REVISION_CONFLICT'?'OPERATOR_VAULT_BASE_MOVED':'OPERATOR_VAULT_IMPORT_FAILED';throw new HubOperatorBridgeException('Canonical Vault import failed',$code);}
        catch(HubProjectSourceAuthorityException){throw new HubOperatorBridgeException('Canonical Vault source binding failed','OPERATOR_VAULT_IMPORT_FAILED');}
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function verificationStore(array $request,string $at): array
    {
        if (($request['confirmation']??null)!==self::VERIFICATION_CONFIRMATION) throw new HubOperatorBridgeException('Explicit verification evidence confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $document=$request['document']??null;
        if(!is_array($document)||array_is_list($document))throw new HubOperatorBridgeException('Verification evidence document is invalid','OPERATOR_REQUEST_INVALID');
        $json=json_encode($document,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        if(strlen($json)<2||strlen($json)>self::MAX_VERIFICATION_DOCUMENT_BYTES)throw new HubOperatorBridgeException('Verification evidence document exceeds the safe limit','OPERATOR_REQUEST_INVALID');
        $kind=(string)($document['kind']??'');$bucket='';$identity='';
        if($kind==='release-verification'){
            $release=strtolower((string)($document['releaseSha']??''));
            if(preg_match('/^[a-f0-9]{40}$/',$release)!==1)throw new HubOperatorBridgeException('Release verification identity is invalid','OPERATOR_REQUEST_INVALID');
            if(($document['state']??null)==='COMPLETED'&&($document['result']??null)==='PASS'){
                $track=strtolower(trim((string)($document['releaseTrack']??'awh')));
                if($track==='vps-platform')$this->assertPlatformReleaseIdentity($release);
                else $this->assertPublicReleaseIdentity($release);
            }
            $bucket='releases/'.$release;$identity=$release;
        }elseif($kind==='verification-incident'){
            $fingerprint=strtolower((string)($document['fingerprint']??''));$regression=(string)($document['regressionId']??'');
            if(preg_match('/^[a-f0-9]{64}$/',$fingerprint)!==1||$regression!=='reg-'.substr($fingerprint,0,12))throw new HubOperatorBridgeException('Verification incident identity is invalid','OPERATOR_REQUEST_INVALID');
            $this->verificationPaths($document['context']['changedPaths']??[]);
            $bucket='incidents/'.$fingerprint;$identity=$fingerprint;
        }elseif($kind==='verification-lesson'){
            $lesson=$this->verificationLesson($document);
            $bucket='lessons/'.(string)$lesson['classFingerprint'];$identity=(string)$lesson['lessonId'];
        }else throw new HubOperatorBridgeException('Verification evidence kind is not allowlisted','OPERATOR_ACTION_FORBIDDEN');
        $root=$this->verificationRoot();$directory=$root.'/'.$bucket;
        if(!is_dir($directory)&&!@mkdir($directory,0700,true))throw new HubOperatorBridgeException('Verification evidence storage is unavailable','OPERATOR_VERIFICATION_STORAGE_UNAVAILABLE');
        if(is_link($directory))throw new HubOperatorBridgeException('Verification evidence destination is unsafe','OPERATOR_VERIFICATION_STORAGE_UNAVAILABLE');
        $sha=hash('sha256',$json);$path=$directory.'/'.$sha.'.json';
        if(!is_file($path)){
            $tmp=$directory.'/.write-'.$sha.'-'.bin2hex(random_bytes(4));
            if(@file_put_contents($tmp,$json."\n",LOCK_EX)===false||!@chmod($tmp,0600)||!@rename($tmp,$path)){@unlink($tmp);throw new HubOperatorBridgeException('Verification evidence could not be stored','OPERATOR_VERIFICATION_STORAGE_UNAVAILABLE');}
        }
        return ['schemaVersion'=>1,'state'=>'STORED','kind'=>$kind,'identity'=>$identity,'sha256'=>$sha,'relativePath'=>$bucket.'/'.$sha.'.json','observedAt'=>$at];
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function verificationRegressions(array $request,string $at): array
    {
        $changed=$this->verificationPaths($request['changedPaths']??[]);
        $projectId=is_string($request['projectId']??null)?strtolower(trim((string)$request['projectId'])):'';
        $releaseTrack=is_string($request['releaseTrack']??null)?strtolower(trim((string)$request['releaseTrack'])):'';
        $productFamily=is_string($request['productFamily']??null)?strtolower(trim((string)$request['productFamily'])):'';
        if($projectId!==''&&!self::uuidValid($projectId))throw new HubOperatorBridgeException('Verification project identity is invalid','OPERATOR_REQUEST_INVALID');
        foreach([[$releaseTrack,'release track'],[$productFamily,'product family']] as [$value,$label])if($value!==''&&preg_match('/^[a-z0-9][a-z0-9._-]{0,79}$/',$value)!==1)throw new HubOperatorBridgeException('Verification '.$label.' is invalid','OPERATOR_REQUEST_INVALID');
        $root=$this->verificationRoot(false);$items=[];$seen=[];
        $incidentRoot=$root.'/incidents';
        if(is_dir($incidentRoot)){
            $directories=array_slice(array_values(array_filter(glob($incidentRoot.'/*')?:[],static fn(string $p):bool=>is_dir($p)&&!is_link($p))),0,200);
            foreach($directories as $directory){
                $doc=$this->latestVerificationDocument($directory,'verification-incident');if($doc===null)continue;
                try{$paths=$this->verificationPaths($doc['context']['changedPaths']??[]);}catch(HubOperatorBridgeException){continue;}
                if(array_intersect($changed,$paths)===[])continue;
                $regression=(string)($doc['regressionId']??'');if(!preg_match('/^reg-[a-f0-9]{12}$/',$regression)||isset($seen[$regression]))continue;
                $seen[$regression]=true;$items[]=[
                    'regressionId'=>$regression,'fingerprint'=>(string)($doc['fingerprint']??''),
                    'code'=>(string)($doc['code']??''),'changedPaths'=>$paths,
                    'problemClass'=>(string)($doc['problemClass']??''),'impactScope'=>(string)($doc['impactScope']??'PROJECT'),
                    'source'=>'INCIDENT_PATH','requiredChecks'=>[],
                ];
                if(count($items)>=50)break;
            }
        }
        $lessonRoot=$root.'/lessons';
        if(is_dir($lessonRoot)&&count($items)<50){
            $directories=array_slice(array_values(array_filter(glob($lessonRoot.'/*')?:[],static fn(string $p):bool=>is_dir($p)&&!is_link($p))),0,200);
            foreach($directories as $directory){
                $doc=$this->latestVerificationDocument($directory,'verification-lesson');if($doc===null||($doc['state']??null)!=='ENFORCED')continue;
                if(!$this->verificationLessonApplies($doc,$projectId,$releaseTrack,$productFamily))continue;
                $regression=(string)($doc['sourceRegressionId']??'');if(!preg_match('/^reg-[a-f0-9]{12}$/',$regression)||isset($seen[$regression]))continue;
                $checks=is_array($doc['requiredChecks']??null)?array_values(array_filter($doc['requiredChecks'],'is_string')):[];
                $seen[$regression]=true;$items[]=[
                    'regressionId'=>$regression,'fingerprint'=>(string)($doc['classFingerprint']??''),
                    'code'=>(string)($doc['problemClass']??''),'changedPaths'=>[],
                    'problemClass'=>(string)($doc['problemClass']??''),'impactScope'=>(string)($doc['impactScope']??''),
                    'lessonId'=>(string)($doc['lessonId']??''),'source'=>'VERIFIED_LESSON','requiredChecks'=>$checks,
                ];
                if(count($items)>=50)break;
            }
        }
        return ['schemaVersion'=>2,'regressions'=>$items,'count'=>count($items),'observedAt'=>$at];
    }

    /** @return array<string,mixed> */
    private function storageSafetyState(string $at): array
    {
        $free=@disk_free_space('/');$total=@disk_total_space('/');
        $freeBytes=is_float($free)?(int)$free:null;$totalBytes=is_float($total)?(int)$total:null;
        $path=getenv('AWH_STORAGE_GUARD_STATE');if(!is_string($path)||$path==='')$path='/var/lib/awh-hub/storage-guard.json';
        $guardState='UNKNOWN';$guardFresh=false;$guardCheckedAt=null;$guardReleaseBlocked=false;
        if(is_file($path)&&is_readable($path)&&!is_link($path)){
            $raw=@file_get_contents($path);
            if(is_string($raw)&&strlen($raw)<=16384){
                try{$doc=json_decode($raw,true,16,JSON_THROW_ON_ERROR);}catch(Throwable){$doc=null;}
                if(is_array($doc)){
                    $guardCheckedAt=is_string($doc['checkedAt']??null)?(string)$doc['checkedAt']:null;
                    $stamp=is_string($guardCheckedAt)?strtotime($guardCheckedAt):false;
                    $guardFresh=$stamp!==false&&abs(strtotime($at)-$stamp)<=self::STORAGE_GUARD_MAX_AGE_SECONDS;
                    $guardState=is_string($doc['state']??null)?(string)$doc['state']:'UNKNOWN';
                    $guardReleaseBlocked=$guardFresh&&($doc['releaseBlocked']??false)===true;
                }
            }
        }
        $liveReady=$freeBytes!==null&&$totalBytes!==null&&$totalBytes>0&&$freeBytes>=0&&$freeBytes<=$totalBytes;
        $usedPercent=$liveReady?(int)floor((($totalBytes-$freeBytes)*100)/$totalBytes):null;
        $diskBlocked=$liveReady&&($usedPercent>=90||$freeBytes<self::STORAGE_BLOCK_FREE_BYTES);
        $state=$liveReady?($usedPercent>=95||$freeBytes<self::STORAGE_CRITICAL_FREE_BYTES?'CRITICAL':($usedPercent>=80||$freeBytes<self::STORAGE_TARGET_FREE_BYTES?'WARNING':'OK')):'UNKNOWN';
        // The guard file is a periodic snapshot. Live disk telemetry is the mutation
        // authority whenever it is available; otherwise a recently verified guard
        // snapshot is the fail-safe fallback. This prevents a recovered disk from
        // remaining blocked for STORAGE_GUARD_MAX_AGE_SECONDS after self-heal.
        $guardFallbackUsed=false;
        if(!$liveReady&&$guardFresh&&in_array($guardState,['OK','WARNING','CRITICAL'],true)){
            $state=$guardState;$diskBlocked=$guardReleaseBlocked;$guardFallbackUsed=true;
        }
        $guardDisagreesWithLive=$liveReady&&$guardFresh&&($guardReleaseBlocked!==$diskBlocked||($guardState!=='UNKNOWN'&&!hash_equals($guardState,$state)));
        return [
            'state'=>$state,'authority'=>'AWH_STORAGE_GUARD+LIVE_DISK',
            'freeBytes'=>$freeBytes,'totalBytes'=>$totalBytes,'usedPercent'=>$usedPercent,
            'targetFreeBytes'=>self::STORAGE_TARGET_FREE_BYTES,
            'blockFreeBytes'=>self::STORAGE_BLOCK_FREE_BYTES,
            'criticalFreeBytes'=>self::STORAGE_CRITICAL_FREE_BYTES,
            'releaseBlocked'=>$diskBlocked,
            'guardState'=>$guardState,'guardFresh'=>$guardFresh,'guardCheckedAt'=>$guardCheckedAt,
            'guardReleaseBlocked'=>$guardReleaseBlocked,'guardFallbackUsed'=>$guardFallbackUsed,'guardDisagreesWithLive'=>$guardDisagreesWithLive,
            'selfHealAuthority'=>'awh-storage-guard.timer',
        ];
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function flowPreflight(array $request,string $at): array
    {
        $selector=self::text($request,'project',160);
        $trackKey=is_string($request['releaseTrack']??null)?strtolower(trim((string)$request['releaseTrack'])):'';
        if($trackKey!==''&&preg_match('/^[a-z0-9][a-z0-9._-]{0,79}$/',$trackKey)!==1)throw new HubOperatorBridgeException('Flow release track is invalid','OPERATOR_REQUEST_INVALID');
        $track=$trackKey===''?null:HubUpdateTargetRegistry::byReleaseTrack($trackKey);
        if($trackKey!==''&&!is_array($track))throw new HubOperatorBridgeException('Flow release track is not registered','RELEASE_TRACK_SCOPE_VIOLATION');

        $candidateGate=$this->projectGate($selector,$at,false,self::MISSION_CAPABILITY);
        $deployCapability=is_array($track)&&is_string($track['capability']??null)?(string)$track['capability']:null;
        $deployResource=is_array($track)&&is_string($track['deployResource']??null)?(string)$track['deployResource']:null;
        $deployGate=$deployCapability===null?$candidateGate:$this->projectGate($selector,$at,false,$deployCapability,null,$deployResource);
        $mission=$this->missionStatus($selector,$at);
        $storage=$this->storageSafetyState($at);
        $authority=$this->flowReleaseAuthority($track,$at);
        $matchingMission=null;
        foreach((array)($mission['missions']??[]) as $candidate){
            if(!is_array($candidate))continue;
            $candidateTrack=is_string($candidate['releaseTrack']??null)?(string)$candidate['releaseTrack']:'';
            if($trackKey===''||($candidateTrack!==''&&hash_equals($trackKey,$candidateTrack))){$matchingMission=$candidate;break;}
        }
        $existingState=is_array($matchingMission)?(string)($matchingMission['state']??'IDLE'):'IDLE';
        $existing=$existingState==='STALE_RESUMABLE'?'RESUMABLE':($existingState==='COORDINATING'?'ACTIVE':'NONE');
        $gateChecks=[];
        foreach((array)($candidateGate['checks']??[]) as $check){
            if(!is_array($check)||!is_string($check['key']??null))continue;
            $gateChecks[(string)$check['key']]=($check['ok']??false)===true;
        }
        $blockers=[];

        if(($candidateGate['blocking']??false)===true){
            $blockers[]=['classification'=>'HARD_STOP','code'=>'PROJECT_MUTATION_GATE_BLOCKED','blocking'=>true,'rootCause'=>'canonical project mutation gate has a conflicting or unsafe state','impact'=>'development mutation must not start','nextAction'=>'RECONCILE_PROJECT_GATE'];
        }
        if(($deployGate['blocking']??false)===true&&($candidateGate['blocking']??false)!==true){
            $blockers[]=['classification'=>'CONTINUE_WITH_WARNING','code'=>'DEPLOY_TARGET_BUSY','blocking'=>false,'rootCause'=>'deploy resource currently conflicts while candidate work remains isolated','impact'=>'development can continue; deployment must wait','nextAction'=>'RECHECK_BEFORE_DEPLOY'];
        }
        if(($storage['releaseBlocked']??false)===true){
            $blockers[]=['classification'=>'AUTO_FIX','code'=>'STORAGE_RESERVE_RECOVERING','blocking'=>true,'rootCause'=>'free space is below the release reserve','impact'=>'new mutating work pauses until deterministic cleanup restores reserve','nextAction'=>'AWH_STORAGE_GUARD_SELF_HEAL'];
        }elseif(($storage['state']??'UNKNOWN')==='WARNING'){
            $blockers[]=['classification'=>'CONTINUE_WITH_WARNING','code'=>'STORAGE_WARNING','blocking'=>false,'rootCause'=>'free space is below the preferred operating margin but above the hard release reserve','impact'=>'development can continue with storage self-heal active','nextAction'=>'AWH_STORAGE_GUARD_SELF_HEAL'];
        }
        if($existing==='RESUMABLE'){
            $blockers[]=['classification'=>'AUTO_FIX','code'=>'EXISTING_WORK_RESUMABLE','blocking'=>false,'rootCause'=>'the previous coordination heartbeat is stale but its durable execution is valid','impact'=>'reuse the same Mission/checkpoint instead of creating another','nextAction'=>'RESUME_SAME_EXECUTION'];
        }elseif($existing==='ACTIVE'){
            $blockers[]=['classification'=>'AUTO_FIX','code'=>'EXISTING_WORK_ACTIVE','blocking'=>false,'rootCause'=>'an existing coordination Mission already owns this project context','impact'=>'join the existing Mission instead of creating another','nextAction'=>'JOIN_EXISTING'];
        }
        if(($authority['state']??'NOT_EVALUATED')==='DEGRADED'){
            $blockers[]=['classification'=>'CONTINUE_WITH_WARNING','code'=>'DEPLOY_AUTHORITY_DEGRADED','blocking'=>false,'rootCause'=>'the configured deploy capability heartbeat is not currently fresh','impact'=>'development can continue; deployment must wait for the existing authority','nextAction'=>'RECHECK_DEPLOY_AUTHORITY'];
        }
        if(($authority['ownerApprovalRequired']??false)===true){
            $blockers[]=['classification'=>'OWNER_REQUIRED','code'=>'DEPLOY_APPROVAL_REQUIRED_LATER','blocking'=>false,'phase'=>'DEPLOY','rootCause'=>'this release track intentionally requires bounded Owner approval','impact'=>'development and QA can continue without interruption','nextAction'=>'REQUEST_ONCE_WHEN_RELEASE_READY'];
        }

        $hard=(bool)array_filter($blockers,static fn(array $b):bool=>($b['blocking']??false)===true);
        $coordinationAction=$existing==='RESUMABLE'?'RESUME_EXISTING':($existing==='ACTIVE'?'JOIN_EXISTING':'START_NEW');
        if($hard)$decision='HARD_BLOCK';
        elseif(array_filter($blockers,static fn(array $b):bool=>($b['classification']??'')==='CONTINUE_WITH_WARNING'))$decision='START_WITH_WARNING';
        else $decision='START';

        return [
            'schemaVersion'=>1,'state'=>'PROJECT_READINESS','decision'=>$decision,'blocking'=>$hard,'coordinationAction'=>$coordinationAction,'ownerActionRequired'=>false,'nextUserAction'=>$hard?'RESOLVE_CONFLICT':'NONE',
            'project'=>$candidateGate['project']??null,'releaseTrack'=>$trackKey===''?null:$trackKey,
            'readiness'=>[
                'source'=>($candidateGate['sourceReady']??false)?'READY':'DEGRADED',
                'writer'=>($candidateGate['blocking']??false)?'BLOCKED':(((int)($candidateGate['writer']['activeMutationCount']??0)>0)?'BUSY':'READY'),
                'storage'=>($storage['releaseBlocked']??false)?'BLOCKED':(string)($storage['state']??'UNKNOWN'),
                'authority'=>(string)($authority['state']??'NOT_EVALUATED'),
                'dependencies'=>($gateChecks['database']??false)?'READY':'DEGRADED',
                'runtime'=>'NOT_EVALUATED',
                'existingWork'=>$existing,
                'deployTarget'=>($deployGate['blocking']??false)?'BLOCKED':match((string)($authority['state']??'NOT_EVALUATED')){'READY'=>'READY','DEGRADED'=>'DEGRADED',default=>'NOT_EVALUATED'},
                'physicalUat'=>'NOT_EVALUATED',
            ],
            'gate'=>$candidateGate,'deployGate'=>$deployGate,'mission'=>$mission,'storage'=>$storage,'authority'=>$authority,
            'blockers'=>$blockers,'observedAt'=>$at,
        ];
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function flowStart(array $request,string $at): array
    {
        if(($request['confirmation']??null)!==self::FLOW_START_CONFIRMATION)throw new HubOperatorBridgeException('Explicit flow start confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $project=self::text($request,'project',160);$goal=self::text($request,'goal',500);
        $preflightRequest=['schemaVersion'=>1,'project'=>$project];
        if(is_string($request['releaseTrack']??null))$preflightRequest['releaseTrack']=$request['releaseTrack'];
        $preflight=$this->flowPreflight($preflightRequest,$at);
        if(($preflight['blocking']??true)===true)throw new HubOperatorBridgeException('Project flow is hard-blocked by live readiness','OPERATOR_FLOW_BLOCKED');
        $missionRequest=['schemaVersion'=>1,'project'=>$project,'goal'=>$goal,'confirmation'=>self::MISSION_ACQUIRE_CONFIRMATION];
        foreach(['releaseTrack','scopeMode','impactedTracks'] as $key)if(array_key_exists($key,$request))$missionRequest[$key]=$request[$key];
        $mission=$this->missionAcquire($missionRequest,$at);
        return ['schemaVersion'=>1,'state'=>(string)($mission['state']??'UNKNOWN'),'decision'=>(string)($mission['decision']??$preflight['decision']),'preflight'=>$preflight,'mission'=>$mission['mission']??null,'scope'=>$mission['scope']??null,'observedAt'=>$at];
    }

    /** @param array<string,mixed>|null $track @return array<string,mixed> */
    private function flowReleaseAuthority(?array $track,string $at): array
    {
        if(!is_array($track))return ['state'=>'NOT_EVALUATED','capability'=>null,'executorId'=>null,'ownerApprovalRequired'=>false,'ownerActionRequiredNow'=>false];
        $capability=is_string($track['capability']??null)?(string)$track['capability']:'';
        $ownerApproval=($track['ownerApprovalRequired']??false)===true;
        if($capability==='')return ['state'=>'NOT_EVALUATED','capability'=>null,'executorId'=>null,'ownerApprovalRequired'=>$ownerApproval,'ownerActionRequiredNow'=>false];
        if($capability==='bay.remote_update.install')return [
            'state'=>'READY','capability'=>$capability,'executorId'=>'operator-bridge',
            'executorKind'=>'VPS','version'=>'typed-bay-update-v1','observedAt'=>$at,'expiresAt'=>null,
            'ownerApprovalRequired'=>$ownerApproval,'ownerActionRequiredNow'=>false,
            'authorityMode'=>'BUILTIN_TYPED_OPERATOR_BRIDGE',
        ];
        $table=$this->pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='control_executor_capabilities'")->fetchColumn();
        if((int)$table!==1)return ['state'=>'NOT_EVALUATED','capability'=>$capability,'executorId'=>null,'ownerApprovalRequired'=>$ownerApproval,'ownerActionRequiredNow'=>false];
        $q=$this->pdo->prepare("SELECT executor_id,executor_kind,version,observed_at,expires_at FROM control_executor_capabilities WHERE capability=:capability AND (expires_at IS NULL OR datetime(expires_at)>datetime(:at)) ORDER BY observed_at DESC,executor_id LIMIT 1");
        $q->execute(['capability'=>$capability,'at'=>$at]);$row=$q->fetch();
        return [
            'state'=>is_array($row)?'READY':'DEGRADED','capability'=>$capability,
            'executorId'=>is_array($row)?(string)$row['executor_id']:null,
            'executorKind'=>is_array($row)?(string)$row['executor_kind']:null,
            'version'=>is_array($row)&&is_string($row['version']??null)?(string)$row['version']:null,
            'observedAt'=>is_array($row)?(string)$row['observed_at']:null,
            'expiresAt'=>is_array($row)&&is_string($row['expires_at']??null)?(string)$row['expires_at']:null,
            'ownerApprovalRequired'=>$ownerApproval,'ownerActionRequiredNow'=>false,
        ];
    }

    /** @return array<string,mixed> */
    private function missionStatus(string $selector,string $at): array
    {
        $project=$this->resolveProject($selector);$projectId=(string)$project['project_id'];
        $this->reconcileStaleMissions($projectId,$at);
        $activeRows=$this->activeProjectMissions($at,$projectId);
        $resumableRows=$this->resumableProjectMissions($projectId);
        $active=array_map(fn(array $row):array=>$this->missionProjection($row),$activeRows);
        $resumable=array_map(fn(array $row):array=>$this->missionProjection($row),$resumableRows);
        $all=array_merge($active,$resumable);
        if($active!==[]){
            return ['schemaVersion'=>2,'state'=>'COORDINATING','blocking'=>false,'decision'=>'CONTINUE_OR_JOIN','mutationDecision'=>'CONTINUE','coordinationDecision'=>'CONTINUE_OR_JOIN','decisionAuthority'=>'AWH_EXECUTION_GATE','ownerActionRequired'=>false,'nextUserAction'=>'NONE','project'=>['projectId'=>$projectId,'name'=>(string)$project['name']],'activeMissionCount'=>count($active),'resumableMissionCount'=>count($resumable),'mission'=>$active[0],'activeMissions'=>$active,'resumableMissions'=>$resumable,'missions'=>$all,'rule'=>'PROJECT_MISSIONS_ARE_COORDINATION_ONLY','observedAt'=>$at];
        }
        if($resumable!==[]){
            return ['schemaVersion'=>2,'state'=>'STALE_RESUMABLE','blocking'=>false,'decision'=>'CONTINUE','mutationDecision'=>'CONTINUE','coordinationDecision'=>'RESUME_EXISTING','decisionAuthority'=>'AWH_EXECUTION_GATE','ownerActionRequired'=>false,'nextUserAction'=>'NONE','project'=>['projectId'=>$projectId,'name'=>(string)$project['name']],'activeMissionCount'=>0,'resumableMissionCount'=>count($resumable),'mission'=>$resumable[0],'activeMissions'=>[],'resumableMissions'=>$resumable,'missions'=>$resumable,'rule'=>'STALE_MISSION_IS_NON_BLOCKING_COORDINATION','observedAt'=>$at];
        }
        return ['schemaVersion'=>2,'state'=>'IDLE','blocking'=>false,'decision'=>'CONTINUE','mutationDecision'=>'CONTINUE','coordinationDecision'=>'START_NEW','decisionAuthority'=>'AWH_EXECUTION_GATE','ownerActionRequired'=>false,'nextUserAction'=>'NONE','project'=>['projectId'=>$projectId,'name'=>(string)$project['name']],'activeMissionCount'=>0,'resumableMissionCount'=>0,'activeMissions'=>[],'resumableMissions'=>[],'missions'=>[],'observedAt'=>$at];
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function missionAcquire(array $request,string $at): array
    {
        if(($request['confirmation']??null)!==self::MISSION_ACQUIRE_CONFIRMATION)throw new HubOperatorBridgeException('Explicit project mission confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $selector=self::text($request,'project',160);$goal=self::text($request,'goal',500);
        $project=$this->resolveProject($selector);$projectId=(string)$project['project_id'];
        $requestedTrack=is_string($request['releaseTrack']??null)?strtolower(trim((string)$request['releaseTrack'])):'';
        $this->reconcileStaleMissions($projectId,$at);

        $existing=$this->activeProjectMissions($at,$projectId);$current=null;
        foreach($existing as $row)if(self::missionMatchesReleaseTrack($row,$requestedTrack===''?null:$requestedTrack)){$current=$row;break;}
        if(is_array($current)){
            $renewed=$this->missionRenew(['executionId'=>(string)$current['execution_id']],$at);
            $scope=$this->missionScopeFromRequest($request,(string)$current['execution_id'],$projectId,$at);
            return [
                'schemaVersion'=>2,'state'=>'JOINED','blocking'=>false,'decision'=>'CONTINUE_OR_JOIN','coordinationAction'=>'JOIN_EXISTING','ownerActionRequired'=>false,'nextUserAction'=>'NONE',
                'decisionAuthority'=>'AWH_EXECUTION_GATE',
                'project'=>['projectId'=>$projectId,'name'=>(string)$project['name']],
                'requestedGoal'=>$goal,'mission'=>$renewed['mission'],'scope'=>$scope,
                'rule'=>'RELEASE_TRACK_SCOPED_PROJECT_COORDINATION',
                'observedAt'=>$at,
            ];
        }

        $resumable=$this->resumableProjectMissions($projectId);$current=null;
        foreach($resumable as $row)if(self::missionMatchesReleaseTrack($row,$requestedTrack===''?null:$requestedTrack)){$current=$row;break;}
        if(is_array($current)){
            $resumed=$this->resumeProjectMission($current,$at);
            $scope=$this->missionScopeFromRequest($request,(string)$current['execution_id'],$projectId,$at);
            return [
                'schemaVersion'=>2,'state'=>'RESUMED','blocking'=>false,'decision'=>'CONTINUE','coordinationAction'=>'RESUME_EXISTING','ownerActionRequired'=>false,'nextUserAction'=>'NONE',
                'decisionAuthority'=>'AWH_EXECUTION_GATE',
                'project'=>['projectId'=>$projectId,'name'=>(string)$project['name']],
                'requestedGoal'=>$goal,'mission'=>$resumed['mission'],'scope'=>$scope,
                'rule'=>'STALE_MISSION_RESUMES_SAME_TRACK_EXECUTION',
                'observedAt'=>$at,
            ];
        }

        $gate=$this->projectGate($selector,$at,false,self::MISSION_CAPABILITY);
        if(($gate['ready']??false)!==true)throw new HubOperatorBridgeException('Project mission coordination gate is unavailable','OPERATOR_PROJECT_GATE_BLOCKED');
        $storage=$this->storageSafetyState($at);
        if(($storage['releaseBlocked']??false)===true)throw new HubOperatorBridgeException('VPS storage safety gate is recovering below the mission reserve','OPERATOR_STORAGE_CRITICAL');
        $checkpoint=['mode'=>'OPERATOR_PROJECT_MISSION','goal'=>$goal,'startedAt'=>$at,'storageState'=>$storage['state']??'UNKNOWN'];
        if($requestedTrack!=='')$checkpoint['requestedReleaseTrack']=$requestedTrack;
        $authority=$this->acquireMutationAuthority($projectId,$goal,self::MISSION_CAPABILITY,$checkpoint,$at,self::MISSION_LEASE_SECONDS,self::MISSION_OWNER);
        $mission=$this->activeProjectMission($authority['executionId'],$at,$projectId,true);
        $joined=($authority['joined']??false)===true;
        $scope=$this->missionScopeFromRequest($request,(string)$authority['executionId'],$projectId,$at);
        return ['schemaVersion'=>2,'state'=>$joined?'JOINED':'ACQUIRED','blocking'=>false,'decision'=>$joined?'CONTINUE_OR_JOIN':'CONTINUE','coordinationAction'=>$joined?'JOIN_EXISTING':'START_NEW','ownerActionRequired'=>false,'nextUserAction'=>'NONE','decisionAuthority'=>'AWH_EXECUTION_GATE','project'=>['projectId'=>$projectId,'name'=>(string)$project['name']],'requestedGoal'=>$joined?$goal:null,'mission'=>$this->missionProjection($mission),'scope'=>$scope,'rule'=>'RELEASE_TRACK_SCOPED_PROJECT_COORDINATION','storage'=>$storage,'observedAt'=>$at];
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function missionRenew(array $request,string $at): array
    {
        $execution=self::text($request,'executionId',36);if(!self::uuidValid($execution))throw new HubOperatorBridgeException('Mission execution id is invalid','OPERATOR_REQUEST_INVALID');
        $mission=$this->activeProjectMission($execution,$at,null,false);
        if($mission===null){
            $stale=$this->resumableProjectMission($execution,null,false);
            if($stale!==null)return ['schemaVersion'=>2,'state'=>'STALE_RESUMABLE','mission'=>$this->missionProjection($stale),'observedAt'=>$at];
            throw new HubOperatorBridgeException('Project mission is not active','OPERATOR_MISSION_NOT_ACTIVE');
        }
        $updated=strtotime((string)($mission['updated_at']??''));
        $now=strtotime($at);
        if($updated===false||$now===false||$updated<=($now-self::MISSION_STALE_SECONDS)){
            $this->reconcileStaleMissions((string)$mission['project_id'],$at);
            $stale=$this->resumableProjectMission($execution,(string)$mission['project_id'],true);
            return ['schemaVersion'=>2,'state'=>'STALE_RESUMABLE','mission'=>$this->missionProjection($stale),'observedAt'=>$at];
        }
        $lease=gmdate('c',$now+self::MISSION_LEASE_SECONDS);
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $this->pdo->prepare("UPDATE control_task_executions SET lease_expires_at=:lease WHERE execution_id=:execution AND state='RUNNING' AND lease_owner=:owner")->execute(['lease'=>$lease,'execution'=>$execution,'owner'=>self::MISSION_OWNER]);
            $this->pdo->prepare("UPDATE control_tasks SET lease_expires_at=:lease WHERE task_id=:task AND state='RUNNING'")->execute(['lease'=>$lease,'task'=>$mission['task_id']]);
            $this->pdo->prepare("UPDATE control_execution_envelopes SET lease_expires_at=:lease WHERE execution_id=:execution AND state='ACTIVE'")->execute(['lease'=>$lease,'execution'=>$execution]);
            $this->pdo->exec('COMMIT');
        }catch(Throwable $error){try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}throw new HubOperatorBridgeException('Project mission could not be renewed','OPERATOR_MISSION_RENEW_FAILED');}
        $fresh=$this->activeProjectMission($execution,$at,(string)$mission['project_id'],true);
        return ['schemaVersion'=>2,'state'=>'LEASE_RENEWED','mission'=>$this->missionProjection($fresh),'observedAt'=>$at];
    }

    /** @param array<string,mixed> $mission @return array<string,mixed> */
    private function resumeProjectMission(array $mission,string $at): array
    {
        $execution=(string)$mission['execution_id'];
        $lease=gmdate('c',strtotime($at)+self::MISSION_LEASE_SECONDS);
        $checkpoint=self::missionCheckpoint((string)$mission['checkpoint_json'],[
            'state'=>'RUNNING_HEALTHY','resumedAt'=>$at,'lastHeartbeatAt'=>$at,'staleReason'=>null,
        ]);
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $this->pdo->prepare("UPDATE control_task_executions SET state='RUNNING',lease_owner=:owner,lease_expires_at=:lease,checkpoint_json=:checkpoint,last_error_code=NULL,updated_at=:at WHERE execution_id=:execution AND state='WAITING_FOR_CAPABILITY'")->execute(['owner'=>self::MISSION_OWNER,'lease'=>$lease,'checkpoint'=>$checkpoint,'at'=>$at,'execution'=>$execution]);
            $this->pdo->prepare("UPDATE control_tasks SET state='RUNNING',lease_expires_at=:lease,result_summary='Project mission resumed from durable checkpoint',failure_code=NULL,updated_at=:at WHERE task_id=:task AND state='WAITING_FOR_WORKER'")->execute(['lease'=>$lease,'at'=>$at,'task'=>$mission['task_id']]);
            $this->pdo->prepare("UPDATE control_execution_envelopes SET state='ACTIVE',lease_expires_at=:lease,updated_at=:at WHERE execution_id=:execution AND state='WAITING'")->execute(['lease'=>$lease,'at'=>$at,'execution'=>$execution]);
            $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:id,:task,'RUNNING',:progress,'Project mission resumed from durable checkpoint',:at)")->execute(['id'=>self::uuid(),'task'=>$mission['task_id'],'progress'=>(int)$mission['progress'],'at'=>$at]);
            $this->pdo->exec('COMMIT');
        }catch(Throwable $error){try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}throw new HubOperatorBridgeException('Project mission could not be resumed','OPERATOR_MISSION_RESUME_FAILED');}
        $fresh=$this->activeProjectMission($execution,$at,(string)$mission['project_id'],true);
        return ['schemaVersion'=>2,'state'=>'RESUMED','mission'=>$this->missionProjection($fresh),'observedAt'=>$at];
    }

    private function ensureProjectMissionActive(string $execution,string $at,string $projectId): bool
    {
        $active=$this->activeProjectMission($execution,$at,$projectId,false);
        if($active!==null)return false;
        $stale=$this->resumableProjectMission($execution,$projectId,false);
        if($stale===null)throw new HubOperatorBridgeException('Project mission is not active','OPERATOR_MISSION_NOT_ACTIVE');
        $this->resumeProjectMission($stale,$at);
        return true;
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function missionRelease(array $request,string $at): array
    {
        if(($request['confirmation']??null)!==self::MISSION_RELEASE_CONFIRMATION)throw new HubOperatorBridgeException('Explicit project mission release confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $execution=self::text($request,'executionId',36);if(!self::uuidValid($execution))throw new HubOperatorBridgeException('Mission execution id is invalid','OPERATOR_REQUEST_INVALID');
        $outcome=self::text($request,'outcome',16);if(!in_array($outcome,['success','failure'],true))throw new HubOperatorBridgeException('Mission outcome is invalid','OPERATOR_REQUEST_INVALID');
        $mission=$this->activeProjectMission($execution,$at,null,false);
        if($mission===null)$mission=$this->resumableProjectMission($execution,null,true);
        $authority=['executionId'=>$execution,'taskId'=>(string)$mission['task_id'],'projectId'=>(string)$mission['project_id'],'leaseExpiresAt'=>(string)($mission['lease_expires_at']??'')];
        $this->releaseMutationAuthority($authority,$outcome==='success',$at);
        return ['schemaVersion'=>2,'state'=>$outcome==='success'?'COMPLETED':'FAILED','executionId'=>$execution,'projectId'=>(string)$mission['project_id'],'observedAt'=>$at];
    }

    private function reconcileStaleMissions(string $projectId,string $at): void
    {
        if(!self::uuidValid($projectId))return;
        $cutoff=gmdate('c',strtotime($at)-self::MISSION_STALE_SECONDS);
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.checkpoint_json,e.updated_at,e.lease_expires_at,t.progress FROM control_task_executions e JOIN control_execution_envelopes x ON x.execution_id=e.execution_id JOIN control_tasks t ON t.task_id=e.task_id WHERE e.project_id=:project AND e.required_capability=:capability AND e.lease_owner=:owner AND e.state='RUNNING' AND x.state='ACTIVE' AND (datetime(e.updated_at)<=datetime(:cutoff) OR (e.lease_expires_at IS NOT NULL AND datetime(e.lease_expires_at)<=datetime(:at)) OR (x.lease_expires_at IS NOT NULL AND datetime(x.lease_expires_at)<=datetime(:at)))");
        $q->execute(['project'=>$projectId,'capability'=>self::MISSION_CAPABILITY,'owner'=>self::MISSION_OWNER,'cutoff'=>$cutoff,'at'=>$at]);$rows=$q->fetchAll();if($rows===[])return;
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            foreach($rows as $row){
                $leaseExpired=is_string($row['lease_expires_at']??null)&&strtotime((string)$row['lease_expires_at'])!==false&&strtotime((string)$row['lease_expires_at'])<=strtotime($at);
                $reason=$leaseExpired?'MISSION_LEASE_EXPIRED':'MISSION_HEARTBEAT_STALE';
                $checkpoint=self::missionCheckpoint((string)($row['checkpoint_json']??'{}'),[
                    'state'=>'STALE_RESUMABLE','staleAt'=>$at,'staleReason'=>$reason,'lastHeartbeatAt'=>(string)($row['updated_at']??''),
                    'nextAutomaticAction'=>'RESUME_SAME_EXECUTION',
                ]);
                $this->pdo->prepare("UPDATE control_execution_envelopes SET state='WAITING',lease_expires_at=NULL,updated_at=:at WHERE execution_id=:execution AND state='ACTIVE'")->execute(['at'=>$at,'execution'=>$row['execution_id']]);
                $this->pdo->prepare("UPDATE control_task_executions SET state='WAITING_FOR_CAPABILITY',lease_expires_at=NULL,checkpoint_json=:checkpoint,last_error_code='MISSION_STALE_RESUMABLE',updated_at=:at WHERE execution_id=:execution AND state='RUNNING'")->execute(['checkpoint'=>$checkpoint,'at'=>$at,'execution'=>$row['execution_id']]);
                $this->pdo->prepare("UPDATE control_tasks SET state='WAITING_FOR_WORKER',lease_expires_at=NULL,result_summary='Project mission is stale but resumable from the same durable execution',failure_code='MISSION_STALE_RESUMABLE',updated_at=:at WHERE task_id=:task AND state='RUNNING'")->execute(['at'=>$at,'task'=>$row['task_id']]);
                $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:id,:task,'WAITING_FOR_WORKER',:progress,'Project mission heartbeat became stale; same execution is resumable',:at)")->execute(['id'=>self::uuid(),'task'=>$row['task_id'],'progress'=>(int)($row['progress']??0),'at'=>$at]);
            }
            $this->pdo->exec('COMMIT');
        }catch(Throwable $error){try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}throw new HubOperatorBridgeException('Stale project mission could not be reconciled','OPERATOR_MISSION_RECONCILE_FAILED');}
    }

    /** @return list<array<string,mixed>> */
    private function activeProjectMissions(string $at,string $projectId): array
    {
        if(!self::uuidValid($projectId))return [];
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.project_id,e.state AS execution_state,e.lease_expires_at,e.checkpoint_json,e.updated_at,t.state AS task_state,t.goal,t.progress,x.state AS envelope_state FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id JOIN control_execution_envelopes x ON x.execution_id=e.execution_id WHERE e.required_capability=:capability AND e.lease_owner=:owner AND e.state='RUNNING' AND x.state='ACTIVE' AND e.project_id=:project AND (e.lease_expires_at IS NULL OR e.lease_expires_at>:at) AND (x.lease_expires_at IS NULL OR x.lease_expires_at>:at) ORDER BY e.updated_at DESC,e.execution_id DESC LIMIT 40");
        $q->execute(['capability'=>self::MISSION_CAPABILITY,'owner'=>self::MISSION_OWNER,'project'=>$projectId,'at'=>$at]);
        return array_values(array_filter($q->fetchAll(),static fn(mixed $row):bool=>is_array($row)));
    }

    /** @return list<array<string,mixed>> */
    private function resumableProjectMissions(string $projectId): array
    {
        if(!self::uuidValid($projectId))return [];
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.project_id,e.state AS execution_state,e.lease_expires_at,e.checkpoint_json,e.updated_at,t.state AS task_state,t.goal,t.progress,x.state AS envelope_state FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id JOIN control_execution_envelopes x ON x.execution_id=e.execution_id WHERE e.required_capability=:capability AND e.lease_owner=:owner AND e.state='WAITING_FOR_CAPABILITY' AND t.state='WAITING_FOR_WORKER' AND x.state='WAITING' AND e.project_id=:project ORDER BY e.updated_at DESC,e.execution_id DESC LIMIT 40");
        $q->execute(['capability'=>self::MISSION_CAPABILITY,'owner'=>self::MISSION_OWNER,'project'=>$projectId]);
        return array_values(array_filter($q->fetchAll(),static fn(mixed $row):bool=>is_array($row)));
    }

    /** @return array<string,mixed>|null */
    private function activeProjectMission(?string $executionId,string $at,?string $projectId=null,bool $required=true): ?array
    {
        $where=["e.required_capability=:capability","e.lease_owner=:owner","e.state='RUNNING'","x.state='ACTIVE'","(e.lease_expires_at IS NULL OR e.lease_expires_at>:at)","(x.lease_expires_at IS NULL OR x.lease_expires_at>:at)"];
        $params=['capability'=>self::MISSION_CAPABILITY,'owner'=>self::MISSION_OWNER,'at'=>$at];
        if($executionId!==null){$where[]='e.execution_id=:execution';$params['execution']=$executionId;}
        if($projectId!==null){$where[]='e.project_id=:project';$params['project']=$projectId;}
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.project_id,e.state AS execution_state,e.lease_expires_at,e.checkpoint_json,e.updated_at,t.state AS task_state,t.goal,t.progress,x.state AS envelope_state FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id JOIN control_execution_envelopes x ON x.execution_id=e.execution_id WHERE ".implode(' AND ',$where)." ORDER BY e.updated_at DESC LIMIT 1");
        $q->execute($params);$row=$q->fetch();if(is_array($row))return $row;
        if($required)throw new HubOperatorBridgeException('Project mission is not active','OPERATOR_MISSION_NOT_ACTIVE');
        return null;
    }

    /** @return array<string,mixed>|null */
    private function resumableProjectMission(?string $executionId,?string $projectId=null,bool $required=true): ?array
    {
        $where=["e.required_capability=:capability","e.lease_owner=:owner","e.state='WAITING_FOR_CAPABILITY'","t.state='WAITING_FOR_WORKER'","x.state='WAITING'"];
        $params=['capability'=>self::MISSION_CAPABILITY,'owner'=>self::MISSION_OWNER];
        if($executionId!==null){$where[]='e.execution_id=:execution';$params['execution']=$executionId;}
        if($projectId!==null){$where[]='e.project_id=:project';$params['project']=$projectId;}
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.project_id,e.state AS execution_state,e.lease_expires_at,e.checkpoint_json,e.updated_at,t.state AS task_state,t.goal,t.progress,x.state AS envelope_state FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id JOIN control_execution_envelopes x ON x.execution_id=e.execution_id WHERE ".implode(' AND ',$where)." ORDER BY e.updated_at DESC LIMIT 1");
        $q->execute($params);$row=$q->fetch();if(is_array($row))return $row;
        if($required)throw new HubOperatorBridgeException('Project mission is not resumable','OPERATOR_MISSION_NOT_ACTIVE');
        return null;
    }

    private static function missionReleaseTrackFromCheckpoint(string $raw): ?string
    {
        try{$checkpoint=json_decode($raw,true,32,JSON_THROW_ON_ERROR);}catch(Throwable){return null;}
        if(!is_array($checkpoint)||array_is_list($checkpoint))return null;
        $scope=$checkpoint['scopeEnvelope']??null;
        $track=is_array($scope)&&!array_is_list($scope)&&is_string($scope['releaseTrack']??null)?strtolower(trim((string)$scope['releaseTrack'])):(is_string($checkpoint['requestedReleaseTrack']??null)?strtolower(trim((string)$checkpoint['requestedReleaseTrack'])):'');
        return preg_match('/^[a-z0-9][a-z0-9._-]{0,79}$/',$track)===1?$track:null;
    }

    /** @param array<string,mixed> $row */
    private static function missionMatchesReleaseTrack(array $row,?string $releaseTrack): bool
    {
        if($releaseTrack===null||$releaseTrack==='')return true;
        $current=self::missionReleaseTrackFromCheckpoint((string)($row['checkpoint_json']??''));
        return is_string($current)&&hash_equals($current,$releaseTrack);
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function missionProjection(array $row): array
    {
        $stale=(string)($row['execution_state']??'')==='WAITING_FOR_CAPABILITY'||(string)($row['envelope_state']??'')==='WAITING';
        $releaseTrack=self::missionReleaseTrackFromCheckpoint((string)($row['checkpoint_json']??''));
        return ['executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'projectId'=>(string)$row['project_id'],'goal'=>(string)$row['goal'],'releaseTrack'=>$releaseTrack,'state'=>$stale?'STALE_RESUMABLE':'COORDINATING','executionState'=>$stale?'STALE_RESUMABLE':'RUNNING','progress'=>(int)$row['progress'],'leaseExpiresAt'=>$row['lease_expires_at'],'updatedAt'=>(string)$row['updated_at'],'ownerActionRequired'=>false,'nextUserAction'=>'NONE','nextAutomaticAction'=>$stale?'RESUME_SAME_EXECUTION':'CONTINUE'];
    }

    /** @param array<string,mixed> $request @return array<string,mixed>|null */
    private function missionScopeFromRequest(array $request,string $missionExecutionId,string $projectId,string $at): ?array
    {
        if(!array_key_exists('releaseTrack',$request))return null;
        $releaseTrack=self::key(self::text($request,'releaseTrack',80));
        $scopeMode=is_string($request['scopeMode']??null)?strtoupper(trim((string)$request['scopeMode'])):'SINGLE_TRACK';
        $impacted=[];
        if(array_key_exists('impactedTracks',$request)){
            if(!is_array($request['impactedTracks'])||!array_is_list($request['impactedTracks'])||count($request['impactedTracks'])>16)
                throw new HubOperatorBridgeException('Mission impacted tracks are invalid','OPERATOR_REQUEST_INVALID');
            foreach($request['impactedTracks'] as $track){
                if(!is_string($track)||preg_match('/^[a-z0-9][a-z0-9._-]{0,79}$/',strtolower(trim($track)))!==1)
                    throw new HubOperatorBridgeException('Mission impacted tracks are invalid','OPERATOR_REQUEST_INVALID');
                $impacted[]=strtolower(trim($track));
            }
        }
        try{return (new HubScopeAuthorizer($this->pdo))->issueOrResolve($missionExecutionId,$projectId,$releaseTrack,$at,$scopeMode,$impacted);}
        catch(HubScopeAuthorizerException $error){throw new HubOperatorBridgeException($error->getMessage(),$error->codeName);}
    }

    /** @param array<string,mixed> $patch */
    private static function missionCheckpoint(string $raw,array $patch): string
    {
        try{$checkpoint=json_decode($raw,true,32,JSON_THROW_ON_ERROR);}catch(Throwable){$checkpoint=[];}
        if(!is_array($checkpoint)||array_is_list($checkpoint))$checkpoint=[];
        $lifecycle=is_array($checkpoint['missionLifecycle']??null)&&!array_is_list($checkpoint['missionLifecycle'])?$checkpoint['missionLifecycle']:[];
        foreach($patch as $key=>$value){if($value===null)unset($lifecycle[$key]);else $lifecycle[$key]=$value;}
        $checkpoint['missionLifecycle']=$lifecycle;
        return json_encode($checkpoint,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function sourceMetadataRepair(array $request,string $at): array
    {
        if(($request['confirmation']??null)!==self::SOURCE_METADATA_REPAIR_CONFIRMATION)
            throw new HubOperatorBridgeException('Explicit source metadata repair confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $repository=self::key(self::text($request,'repository',80));
        $repositories=HubUpdateTargetRegistry::repositories();$config=$repositories[$repository]??null;
        if(!is_array($config))throw new HubOperatorBridgeException('Source repository is not allowlisted','OPERATOR_SOURCE_REPOSITORY_FORBIDDEN');
        $base=self::gitSha(self::text($request,'baseSha',40));$target=self::gitSha(self::text($request,'targetSha',40));
        if(hash_equals($base,$target))throw new HubOperatorBridgeException('Metadata repair edge is invalid','OPERATOR_REQUEST_INVALID');
        $missionId=is_string($request['missionExecutionId']??null)?strtolower(trim((string)$request['missionExecutionId'])):'';
        if(!self::uuidValid($missionId))throw new HubOperatorBridgeException('Source metadata repair requires the active mission of the target project','OPERATOR_PROJECT_SCOPE_REQUIRED');

        $gitRoot=getenv('AWH_CANONICAL_GIT_ROOT');if(!is_string($gitRoot)||$gitRoot==='')$gitRoot='/srv/awh-git';
        $gitReal=realpath($gitRoot);if(!is_string($gitReal)||!is_dir($gitReal)||is_link($gitRoot))throw new HubOperatorBridgeException('Source promotion roots are unavailable','OPERATOR_SOURCE_STORAGE_UNAVAILABLE');
        $repo=$gitReal.'/'.$config['directory'];$repoReal=realpath($repo);if(!is_string($repoReal)||dirname($repoReal)!==$gitReal||!is_dir($repoReal)||is_link($repo))throw new HubOperatorBridgeException('Canonical Git repository is unavailable','OPERATOR_SOURCE_STORAGE_UNAVAILABLE');
        $projectRecord=$this->resolveProject((string)$config['project']);$projectId=(string)$projectRecord['project_id'];
        $this->ensureProjectMissionActive($missionId,$at,$projectId);
        $gate=$this->projectGate((string)$config['project'],$at,false,'source.promote',$missionId);if(($gate['ready']??false)!==true)throw new HubOperatorBridgeException('Project mutation gate is blocked','OPERATOR_PROJECT_GATE_BLOCKED');

        $main=self::gitSha(trim($this->runGit($repoReal,['rev-parse','refs/heads/main'])));
        foreach([$base,$target] as $sha){$probe=$this->runGitResult($repoReal,['cat-file','-e',$sha.'^{commit}']);if($probe['code']!==0)throw new HubOperatorBridgeException('Metadata repair revision is unavailable','OPERATOR_SOURCE_METADATA_REPAIR_INVALID');}
        if($this->runGitResult($repoReal,['merge-base','--is-ancestor',$base,$target])['code']!==0||$this->runGitResult($repoReal,['merge-base','--is-ancestor',$target,$main])['code']!==0)
            throw new HubOperatorBridgeException('Metadata repair edge is outside canonical main lineage','OPERATOR_SOURCE_METADATA_REPAIR_INVALID');

        $q=$this->pdo->prepare("SELECT execution_id,checkpoint_json,updated_at FROM control_task_executions WHERE project_id=:project AND required_capability='source.promote' AND state='COMPLETED' ORDER BY updated_at DESC,execution_id DESC LIMIT 160");
        $q->execute(['project'=>$projectId]);$predecessor=false;$successor=false;$existing=null;
        foreach($q->fetchAll() as $row){
            try{$checkpoint=json_decode((string)$row['checkpoint_json'],true,16,JSON_THROW_ON_ERROR);}catch(Throwable){continue;}
            if(!is_array($checkpoint)||($checkpoint['repository']??null)!==$repository)continue;
            $edgeBase=strtolower((string)($checkpoint['expectedMainSha']??''));$edgeTarget=strtolower((string)($checkpoint['targetSha']??''));$notes=$checkpoint['releaseNotes']??null;
            if(preg_match('/^[0-9a-f]{40}$/',$edgeBase)!==1||preg_match('/^[0-9a-f]{40}$/',$edgeTarget)!==1||!is_array($notes)||!HubUpdateTargetRegistry::releaseDetailsReady($notes,true))continue;
            if(hash_equals($edgeTarget,$target)&&$existing===null)$existing=['executionId'=>(string)$row['execution_id'],'releaseNotes'=>$notes];
            if(hash_equals($edgeTarget,$base))$predecessor=true;
            if(hash_equals($edgeBase,$target))$successor=true;
        }
        if(is_array($existing))return ['schemaVersion'=>1,'state'=>'ALREADY_REPAIRED','repository'=>$repository,'baseSha'=>$base,'targetSha'=>$target,'mainSha'=>$main,'audit'=>['executionId'=>$existing['executionId']],'releaseNotes'=>$existing['releaseNotes'],'idempotent'=>true,'sourceBytesChanged'=>false,'observedAt'=>$at];
        if(!$predecessor&&$repository==='awh'){
            foreach(['refs/heads/runtime/production','refs/heads/production'] as $ref){$probe=$this->runGitResult($repoReal,['rev-parse','--verify',$ref]);if($probe['code']===0&&preg_match('/^[0-9a-f]{40}$/',strtolower(trim($probe['stdout'])))===1&&hash_equals($base,strtolower(trim($probe['stdout'])))){$predecessor=true;break;}}
        }
        if(!$predecessor||!$successor)throw new HubOperatorBridgeException('Metadata repair is not bounded by verified promotion history','OPERATOR_SOURCE_METADATA_REPAIR_BOUNDARY');

        $releaseNotes=$this->releaseNotesForPromotion($repoReal,$repository,$base,$target,$at);
        $releaseNotes['generatedFrom']='EXACT_GIT_DIFF_METADATA_CHAIN_REPAIR';
        if(!HubUpdateTargetRegistry::releaseDetailsReady($releaseNotes,true))throw new HubOperatorBridgeException('Release details could not be reconstructed','OPERATOR_RELEASE_DETAILS_REQUIRED');
        $checkpoint=['repository'=>$repository,'expectedMainSha'=>$base,'targetSha'=>$target,'missionExecutionId'=>$missionId,'releaseNotes'=>$releaseNotes,'metadataRepair'=>true,'repairKind'=>'SOURCE_PROMOTION_CHAIN_GAP'];
        $authority=$this->acquireMutationAuthority($projectId,'Repair exact source promotion metadata '.$repository.' '.substr($target,0,12),'source.promote',$checkpoint,$at);
        $success=false;
        try{
            $save=$this->pdo->prepare("UPDATE control_task_executions SET checkpoint_json=:checkpoint,updated_at=:at WHERE execution_id=:execution AND required_capability='source.promote' AND state='RUNNING'");
            $save->execute(['checkpoint'=>json_encode($checkpoint,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),'at'=>$at,'execution'=>$authority['executionId']]);
            if($save->rowCount()!==1)throw new HubOperatorBridgeException('Metadata repair audit could not be persisted','OPERATOR_SOURCE_METADATA_REPAIR_FAILED');
            $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:id,:task,'RUNNING',80,:message,:at)")
                ->execute(['id'=>self::uuid(),'task'=>$authority['taskId'],'message'=>'Release metadata chain repaired from exact canonical Git diff; source bytes unchanged','at'=>$at]);
            $mainAfter=self::gitSha(trim($this->runGit($repoReal,['rev-parse','refs/heads/main'])));if(!hash_equals($main,$mainAfter))throw new HubOperatorBridgeException('Canonical main moved during metadata repair','OPERATOR_SOURCE_BASE_MOVED');
            $success=true;
            return ['schemaVersion'=>1,'state'=>'REPAIRED','repository'=>$repository,'baseSha'=>$base,'targetSha'=>$target,'mainSha'=>$mainAfter,'authority'=>['executionId'=>$authority['executionId'],'taskId'=>$authority['taskId'],'missionExecutionId'=>$missionId,'writerType'=>'SOURCE_PROMOTE_METADATA_REPAIR'],'releaseNotes'=>$releaseNotes,'idempotent'=>false,'sourceBytesChanged'=>false,'observedAt'=>$at];
        }finally{$this->releaseMutationAuthority($authority,$success,gmdate('c'));}
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function sourcePromote(array $request,string $at): array
    {
        if(($request['confirmation']??null)!==self::SOURCE_PROMOTE_CONFIRMATION)throw new HubOperatorBridgeException('Explicit source promotion confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $repository=self::key(self::text($request,'repository',80));$repositories=HubUpdateTargetRegistry::repositories();$config=$repositories[$repository]??null;
        if(!is_array($config))throw new HubOperatorBridgeException('Source repository is not allowlisted','OPERATOR_SOURCE_REPOSITORY_FORBIDDEN');
        $expected=self::gitSha(self::text($request,'expectedMainSha',40));$target=self::gitSha(self::text($request,'targetSha',40));$bundleSha=self::sha256(self::text($request,'bundleSha256',64));$stagedFile=self::text($request,'stagedFile',96);
        if($stagedFile!==$bundleSha.'.bundle'||hash_equals($expected,$target))throw new HubOperatorBridgeException('Source promotion identity is invalid','OPERATOR_REQUEST_INVALID');
        $stageRoot=getenv('AWH_OPERATOR_STAGE_ROOT');if(!is_string($stageRoot)||$stageRoot==='')$stageRoot='/var/lib/awh-remote/operator-staging';
        $gitRoot=getenv('AWH_CANONICAL_GIT_ROOT');if(!is_string($gitRoot)||$gitRoot==='')$gitRoot='/srv/awh-git';
        $stageReal=realpath($stageRoot);$gitReal=realpath($gitRoot);if(!is_string($stageReal)||!is_dir($stageReal)||is_link($stageRoot)||!is_string($gitReal)||!is_dir($gitReal)||is_link($gitRoot))throw new HubOperatorBridgeException('Source promotion roots are unavailable','OPERATOR_SOURCE_STORAGE_UNAVAILABLE');
        $bundle=$stageReal.'/'.$stagedFile;$bundleReal=realpath($bundle);if(!is_string($bundleReal)||dirname($bundleReal)!==$stageReal||is_link($bundle)||!is_file($bundleReal)||!is_readable($bundleReal))throw new HubOperatorBridgeException('Source bundle is unavailable','OPERATOR_SOURCE_BUNDLE_NOT_READY');
        $size=@filesize($bundleReal);$actual=hash_file('sha256',$bundleReal);if(!is_int($size)||$size<1||$size>self::MAX_SOURCE_BUNDLE_BYTES||!is_string($actual)||!hash_equals($bundleSha,$actual))throw new HubOperatorBridgeException('Source bundle verification failed','OPERATOR_SOURCE_BUNDLE_NOT_READY');
        $repo=$gitReal.'/'.$config['directory'];$repoReal=realpath($repo);if(!is_string($repoReal)||dirname($repoReal)!==$gitReal||!is_dir($repoReal)||is_link($repo))throw new HubOperatorBridgeException('Canonical Git repository is unavailable','OPERATOR_SOURCE_STORAGE_UNAVAILABLE');
        $projectRecord=$this->resolveProject((string)$config['project']);$projectId=(string)$projectRecord['project_id'];
        $missionId=is_string($request['missionExecutionId']??null)?trim((string)$request['missionExecutionId']):'';
        if(!self::uuidValid($missionId))throw new HubOperatorBridgeException('Source promotion requires the active mission of the target project','OPERATOR_PROJECT_SCOPE_REQUIRED');
        $missionResumed=$this->ensureProjectMissionActive($missionId,$at,$projectId);
        $gate=$this->projectGate((string)$config['project'],$at,false,'source.promote',$missionId);if(($gate['ready']??false)!==true)throw new HubOperatorBridgeException('Project mutation gate is blocked','OPERATOR_PROJECT_GATE_BLOCKED');
        $current=trim($this->runGit($repoReal,['rev-parse','refs/heads/main']));if(!hash_equals($expected,self::gitSha($current)))throw new HubOperatorBridgeException('Canonical main moved before source promotion','OPERATOR_SOURCE_BASE_MOVED');
        $defaultBranch=is_string($config['defaultBranch']??null)?trim((string)$config['defaultBranch']):'main';if(preg_match('/^[a-z0-9][a-z0-9._\/-]{0,79}$/',$defaultBranch)!==1)throw new HubOperatorBridgeException('Repository default branch contract is invalid','OPERATOR_SOURCE_REPOSITORY_FORBIDDEN');
        $headBefore=trim($this->runGit($repoReal,['symbolic-ref','HEAD']));if(preg_match('#^refs/heads/[A-Za-z0-9._/-]+$#',$headBefore)!==1)throw new HubOperatorBridgeException('Repository default HEAD is unresolved','OPERATOR_SOURCE_STORAGE_UNAVAILABLE');$headChanged=false;
        $heads=$this->runGit($repoReal,['bundle','list-heads',$bundleReal]);$advertised=false;foreach(preg_split('/\r?\n/',$heads)?:[] as $line){$parts=preg_split('/\s+/',trim($line));if(is_array($parts)&&isset($parts[0])&&strtolower((string)$parts[0])===$target){$advertised=true;break;}}
        if(!$advertised)throw new HubOperatorBridgeException('Target revision is not advertised by source bundle','OPERATOR_SOURCE_BUNDLE_NOT_READY');
        $authority=$this->acquireMutationAuthority(
            $projectId,
            'Fast-forward canonical main '.$repository,
            'source.promote',
            ['repository'=>$repository,'expectedMainSha'=>$expected,'targetSha'=>$target,'bundleSha256'=>$bundleSha,'missionExecutionId'=>$missionId],
            $at
        );
        $success=false;
        try{
            $this->runGit($repoReal,['bundle','verify',$bundleReal]);
            $this->runGit($repoReal,['bundle','unbundle',$bundleReal]);
            $this->runGit($repoReal,['cat-file','-e',$target.'^{commit}']);
            if(($config['projection']??false)===true)$this->assertVaultProjectionTarget($repoReal,$target,$gate);
            $ancestor=$this->runGitResult($repoReal,['merge-base','--is-ancestor',$expected,$target]);if($ancestor['code']!==0)throw new HubOperatorBridgeException('Source promotion is not a fast-forward','OPERATOR_SOURCE_NON_FAST_FORWARD');
            $releaseNotes=$this->releaseNotesForPromotion($repoReal,$repository,$expected,$target,$at);
            if(!HubUpdateTargetRegistry::releaseDetailsReady($releaseNotes,true))
                throw new HubOperatorBridgeException('Release details are required before source promotion','OPERATOR_RELEASE_DETAILS_REQUIRED');
            $changedPaths=array_values(array_filter(preg_split('/\r?\n/',$this->runGit($repoReal,['diff','--name-only',$expected,$target]))?:[],static fn(string $path):bool=>$path!==''));
            try{
                $scope=(new HubScopeAuthorizer($this->pdo))->forMission($missionId);
                (new HubScopeAuthorizer($this->pdo))->assertSourceMutation($scope,$repository,(string)$releaseNotes['releaseTrack'],$changedPaths);
            }catch(HubScopeAuthorizerException $error){
                throw new HubOperatorBridgeException($error->getMessage(),$error->codeName);
            }
            $this->persistSourcePromotionReleaseNotes((string)$authority['executionId'],$repository,$expected,$target,$bundleSha,$releaseNotes,$missionId,$at);
            $before=trim($this->runGit($repoReal,['rev-parse','refs/heads/main']));if(!hash_equals($expected,self::gitSha($before)))throw new HubOperatorBridgeException('Canonical main moved during source promotion','OPERATOR_SOURCE_BASE_MOVED');
            $this->runGit($repoReal,['update-ref','refs/heads/main',$target,$expected]);
            $after=trim($this->runGit($repoReal,['rev-parse','refs/heads/main']));if(!hash_equals($target,self::gitSha($after)))throw new HubOperatorBridgeException('Canonical main did not reach target revision','OPERATOR_SOURCE_PROMOTE_FAILED');
            $expectedHead='refs/heads/'.$defaultBranch;
            if(!hash_equals($headBefore,$expectedHead)){
                try{$this->runGit($repoReal,['symbolic-ref','HEAD',$expectedHead]);$headChanged=true;$headAfter=trim($this->runGit($repoReal,['symbolic-ref','HEAD']));if(!hash_equals($headAfter,$expectedHead))throw new HubOperatorBridgeException('Repository default HEAD did not converge','OPERATOR_SOURCE_PROMOTE_FAILED');}
                catch(Throwable $error){$this->runGitResult($repoReal,['update-ref','refs/heads/main',$expected,$target]);if($headChanged)$this->runGitResult($repoReal,['symbolic-ref','HEAD',$headBefore]);throw $error instanceof HubOperatorBridgeException?$error:new HubOperatorBridgeException('Repository default HEAD could not be reconciled','OPERATOR_SOURCE_PROMOTE_FAILED');}
            }
            $audit=['executionId'=>(string)$authority['executionId'],'taskId'=>(string)$authority['taskId']];
            $success=true;return ['schemaVersion'=>2,'state'=>'PROMOTED','repository'=>$repository,'previousMainSha'=>$expected,'mainSha'=>$target,'bundleSha256'=>$bundleSha,'authority'=>['executionId'=>$authority['executionId'],'taskId'=>$authority['taskId'],'leaseExpiresAt'=>$authority['leaseExpiresAt'],'missionReused'=>false,'missionResumed'=>$missionResumed,'missionExecutionId'=>$missionId,'writerType'=>'SOURCE_PROMOTE'],'audit'=>$audit,'releaseNotes'=>$releaseNotes,'observedAt'=>$at];
        }finally{$this->releaseMutationAuthority($authority,$success,gmdate('c'));}
    }

    /** @param array<string,mixed> $gate */
    private function assertVaultProjectionTarget(string $repo,string $target,array $gate): void
    {
        $source=is_array($gate['source']??null)?$gate['source']:[];
        $project=is_array($gate['project']??null)?$gate['project']:[];
        $projectId=(string)($project['projectId']??'');
        $vault=(string)($source['activeVaultRevisionId']??'');
        $canonical=(string)($source['canonicalVaultRevisionId']??'');
        if(($source['authority']??null)!=='AWH_VAULT'||($source['syncState']??null)!=='SYNCED'||!self::uuidValid($projectId)||!self::uuidValid($vault)||!hash_equals($vault,$canonical))throw new HubOperatorBridgeException('Vault projection authority is not ready','OPERATOR_SOURCE_PROJECTION_REQUIRED');

        $q=$this->pdo->prepare("SELECT v.file_count,r.content_sha256,r.state FROM control_project_vaults v JOIN control_project_vault_revisions r ON r.project_id=v.project_id AND r.revision_id=v.active_revision_id WHERE v.project_id=:project LIMIT 1");
        $q->execute(['project'=>$projectId]);$row=$q->fetch();
        $content=strtolower((string)($row['content_sha256']??''));
        $fileCount=(int)($row['file_count']??-1);
        if(!is_array($row)||($row['state']??null)!=='ACTIVE'||preg_match('/^[a-f0-9]{64}$/',$content)!==1||$fileCount<1)throw new HubOperatorBridgeException('Active Vault projection identity is unavailable','OPERATOR_SOURCE_PROJECTION_REQUIRED');

        $parents=preg_split('/\s+/',trim($this->runGit($repo,['rev-list','--parents','-n','1',$target])))?:[];
        if(count($parents)!==2||strtolower((string)$parents[0])!==$target||preg_match('/^[a-f0-9]{40}$/i',(string)$parents[1])!==1)throw new HubOperatorBridgeException('Projection commit must have exactly one source parent','OPERATOR_SOURCE_PROJECTION_INVALID');
        $parent=strtolower((string)$parents[1]);
        $targetTree=strtolower(trim($this->runGit($repo,['rev-parse',$target.'^{tree}'])));
        $parentTree=strtolower(trim($this->runGit($repo,['rev-parse',$parent.'^{tree}'])));
        if(!preg_match('/^[a-f0-9]{40}$/',$targetTree)||!hash_equals($targetTree,$parentTree))throw new HubOperatorBridgeException('Projection commit must not alter source bytes','OPERATOR_SOURCE_PROJECTION_INVALID');

        $body=$this->runGit($repo,['show','-s','--format=%B',$target]);
        foreach([
            'Vault-Revision: '.$vault,
            'Content-SHA256: '.$content,
            'Authority: AWH_VAULT',
            'Projection: true',
            'Source-Revision: '.$parent,
        ] as $line)if(!preg_match('/(?:^|\R)'.preg_quote($line,'/').'(?=\R|$)/',$body))throw new HubOperatorBridgeException('Projection commit does not match active Vault identity','OPERATOR_SOURCE_PROJECTION_INVALID');

        $identity=$this->gitArchiveIdentity($repo,$target);
        if(($identity['fileCount']??0)!==$fileCount||!hash_equals($content,(string)($identity['contentSha256']??'')))throw new HubOperatorBridgeException('Projection bytes do not match active Vault identity','OPERATOR_SOURCE_PROJECTION_INVALID');
    }

    /** @return array{contentSha256:string,fileCount:int,contentBytes:int} */
    private function gitArchiveIdentity(string $repo,string $target): array
    {
        if(!class_exists('ZipArchive'))throw new HubOperatorBridgeException('ZIP runtime is unavailable for projection verification','OPERATOR_SOURCE_PROJECTION_REQUIRED');
        $stageRoot=getenv('AWH_OPERATOR_STAGE_ROOT');if(!is_string($stageRoot)||$stageRoot==='')$stageRoot='/var/lib/awh-remote/operator-staging';
        $stage=realpath($stageRoot);if(!is_string($stage)||!is_dir($stage)||is_link($stageRoot)||!is_writable($stage))throw new HubOperatorBridgeException('Projection verification staging is unavailable','OPERATOR_SOURCE_STORAGE_UNAVAILABLE');
        $archive=$stage.'/.projection-'.substr($target,0,12).'-'.bin2hex(random_bytes(6)).'.zip';$zip=null;
        try{
            $this->runGit($repo,['archive','--format=zip','--output='.$archive,$target]);
            if(!is_file($archive)||is_link($archive)||!is_readable($archive))throw new HubOperatorBridgeException('Projection archive could not be verified','OPERATOR_SOURCE_PROJECTION_INVALID');
            $zip=new ZipArchive();if($zip->open($archive,ZipArchive::RDONLY|ZipArchive::CHECKCONS)!==true)throw new HubOperatorBridgeException('Projection archive is invalid','OPERATOR_SOURCE_PROJECTION_INVALID');
            if($zip->numFiles<1||$zip->numFiles>HubProjectVault::MAX_FILES)throw new HubOperatorBridgeException('Projection archive file count is invalid','OPERATOR_SOURCE_PROJECTION_INVALID');
            $manifest=[];$total=0;$seen=[];
            for($index=0;$index<$zip->numFiles;$index++){
                $stat=$zip->statIndex($index,ZipArchive::FL_UNCHANGED);
                if(!is_array($stat)||!is_string($stat['name']??null)||!is_int($stat['size']??null))throw new HubOperatorBridgeException('Projection archive metadata is invalid','OPERATOR_SOURCE_PROJECTION_INVALID');
                $name=str_replace('\\','/',(string)$stat['name']);if(str_ends_with($name,'/'))continue;
                if($name===''||str_starts_with($name,'/')||preg_match('#^[A-Za-z]:/#',$name)===1||strlen($name)>900)throw new HubOperatorBridgeException('Projection archive path is unsafe','OPERATOR_SOURCE_PROJECTION_INVALID');
                $parts=explode('/',$name);foreach($parts as $part)if($part===''||$part==='.'||$part==='..'||strlen($part)>180||preg_match('/[\x00-\x1f\x7f]/',$part))throw new HubOperatorBridgeException('Projection archive path is unsafe','OPERATOR_SOURCE_PROJECTION_INVALID');
                if(isset($seen[$name]))throw new HubOperatorBridgeException('Projection archive contains duplicate paths','OPERATOR_SOURCE_PROJECTION_INVALID');$seen[$name]=true;
                $size=(int)$stat['size'];if($size<0||$size>HubProjectVault::MAX_FILE_BYTES)throw new HubOperatorBridgeException('Projection file exceeds safe limit','OPERATOR_SOURCE_PROJECTION_INVALID');
                $total+=$size;if($total>HubProjectVault::MAX_CONTENT_BYTES)throw new HubOperatorBridgeException('Projection content exceeds safe limit','OPERATOR_SOURCE_PROJECTION_INVALID');
                $stream=$zip->getStream((string)$stat['name']);if(!is_resource($stream))throw new HubOperatorBridgeException('Projection file could not be read','OPERATOR_SOURCE_PROJECTION_INVALID');
                $hash=hash_init('sha256');$read=0;
                try{while(!feof($stream)){$chunk=fread($stream,65536);if($chunk===false)throw new HubOperatorBridgeException('Projection file could not be read','OPERATOR_SOURCE_PROJECTION_INVALID');if($chunk==='')continue;$read+=strlen($chunk);if($read>$size)throw new HubOperatorBridgeException('Projection file size is invalid','OPERATOR_SOURCE_PROJECTION_INVALID');hash_update($hash,$chunk);}}finally{fclose($stream);}
                if($read!==$size)throw new HubOperatorBridgeException('Projection file size is invalid','OPERATOR_SOURCE_PROJECTION_INVALID');
                $manifest[]=['path'=>$name,'sha256'=>hash_final($hash),'sizeBytes'=>$read];
            }
            if($manifest===[])throw new HubOperatorBridgeException('Projection archive has no files','OPERATOR_SOURCE_PROJECTION_INVALID');
            usort($manifest,static fn(array $left,array $right):int=>strcmp($left['path'],$right['path']));
            $json=json_encode(['schemaVersion'=>1,'files'=>$manifest],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
            return ['contentSha256'=>hash('sha256',$json),'fileCount'=>count($manifest),'contentBytes'=>$total];
        }finally{if($zip instanceof ZipArchive)$zip->close();@unlink($archive);}
    }

    private function assertPlatformReleaseIdentity(string $releaseSha): void
    {
        $root=getenv('AWH_CANONICAL_GIT_ROOT');if(!is_string($root)||$root==='')$root='/srv/awh-git';
        $repo=rtrim($root,'/').'/awh.git';
        if(!is_dir($repo)||is_link($repo))throw new HubOperatorBridgeException('Platform release identity is unavailable','OPERATOR_VERIFICATION_IDENTITY_UNAVAILABLE');
        try{$current=strtolower(trim($this->runGit($repo,['rev-parse','refs/heads/platform/production'])));}
        catch(Throwable){throw new HubOperatorBridgeException('Platform release identity is unavailable','OPERATOR_VERIFICATION_IDENTITY_UNAVAILABLE');}
        if(preg_match('/^[a-f0-9]{40}$/',$current)!==1||!hash_equals($releaseSha,$current))throw new HubOperatorBridgeException('Release evidence does not match VPS Platform Production identity','OPERATOR_VERIFICATION_IDENTITY_MISMATCH');
    }

    private function assertPublicReleaseIdentity(string $releaseSha): void
    {
        $path=getenv('AWH_PUBLIC_RELEASE_MANIFEST');if(!is_string($path)||$path==='')$path='/var/www/awh-web/current/release.json';
        if(is_link($path)||!is_file($path)||!is_readable($path))throw new HubOperatorBridgeException('Public release identity is unavailable','OPERATOR_VERIFICATION_IDENTITY_UNAVAILABLE');
        $raw=@file_get_contents($path);if(!is_string($raw)||strlen($raw)>262144)throw new HubOperatorBridgeException('Public release identity is unavailable','OPERATOR_VERIFICATION_IDENTITY_UNAVAILABLE');
        try{$release=json_decode($raw,true,32,JSON_THROW_ON_ERROR);}catch(Throwable){throw new HubOperatorBridgeException('Public release identity is invalid','OPERATOR_VERIFICATION_IDENTITY_UNAVAILABLE');}
        if(!is_array($release)||strtolower((string)($release['sourceSha']??''))!==$releaseSha||($release['sourceState']??null)!=='COMMITTED')throw new HubOperatorBridgeException('Release evidence does not match public Production identity','OPERATOR_VERIFICATION_IDENTITY_MISMATCH');
    }

    private function verificationRoot(bool $create=true): string
    {
        $root=getenv('AWH_VERIFICATION_EVIDENCE_ROOT');if(!is_string($root)||$root==='')$root='/var/lib/awh-hub/verification-evidence';
        if(is_link($root))throw new HubOperatorBridgeException('Verification evidence root is unsafe','OPERATOR_VERIFICATION_STORAGE_UNAVAILABLE');
        if(!is_dir($root)&&$create&&!@mkdir($root,0700,true))throw new HubOperatorBridgeException('Verification evidence root is unavailable','OPERATOR_VERIFICATION_STORAGE_UNAVAILABLE');
        return rtrim($root,'/');
    }

    /** @param array<string,mixed> $document @return array<string,string> */
    private function verificationLesson(array $document): array
    {
        $classFingerprint=strtolower((string)($document['classFingerprint']??''));
        $lessonId=(string)($document['lessonId']??'');
        $problemClass=(string)($document['problemClass']??'');
        $impactScope=strtoupper((string)($document['impactScope']??''));
        $rootCauseLayer=(string)($document['rootCauseLayer']??'');
        $sourceRegression=(string)($document['sourceRegressionId']??'');
        if(preg_match('/^[a-f0-9]{64}$/',$classFingerprint)!==1||$lessonId!=='lesson-'.substr($classFingerprint,0,12))
            throw new HubOperatorBridgeException('Verification lesson identity is invalid','OPERATOR_REQUEST_INVALID');
        if(preg_match('/^[A-Z][A-Z0-9_]{2,79}$/',$problemClass)!==1||preg_match('/^[A-Z][A-Z0-9_]{2,79}$/',$rootCauseLayer)!==1)
            throw new HubOperatorBridgeException('Verification lesson class is invalid','OPERATOR_REQUEST_INVALID');
        if(!in_array($impactScope,['PROJECT','PRODUCT_FAMILY','ECOSYSTEM','PLATFORM'],true)||($document['state']??null)!=='ENFORCED')
            throw new HubOperatorBridgeException('Verification lesson scope/state is invalid','OPERATOR_REQUEST_INVALID');
        if(preg_match('/^reg-[a-f0-9]{12}$/',$sourceRegression)!==1)throw new HubOperatorBridgeException('Verification lesson source is invalid','OPERATOR_REQUEST_INVALID');
        $closure=$document['closure']??null;
        if(!is_array($closure)||array_is_list($closure))throw new HubOperatorBridgeException('Verification lesson closure is invalid','OPERATOR_REQUEST_INVALID');
        foreach(['rootCause','canonicalFix','prevention','regression','recovery','observability'] as $key){
            $value=$closure[$key]??null;
            if(!is_string($value)||trim($value)===''||strlen($value)>2000)throw new HubOperatorBridgeException('Verification lesson closure is incomplete','OPERATOR_REQUEST_INVALID');
        }
        $checks=$document['requiredChecks']??[];
        if(!is_array($checks)||!array_is_list($checks)||count($checks)>30)throw new HubOperatorBridgeException('Verification lesson checks are invalid','OPERATOR_REQUEST_INVALID');
        foreach($checks as $check)if(!is_string($check)||preg_match('/^[a-z0-9][a-z0-9._:-]{1,79}$/',$check)!==1)throw new HubOperatorBridgeException('Verification lesson check is invalid','OPERATOR_REQUEST_INVALID');
        $projectId=strtolower(trim((string)($document['projectId']??'')));
        $productFamily=strtolower(trim((string)($document['productFamily']??'')));
        $releaseTrack=strtolower(trim((string)($document['releaseTrack']??'')));
        if($impactScope==='PROJECT'&&!self::uuidValid($projectId))throw new HubOperatorBridgeException('Project-scoped lesson needs a project identity','OPERATOR_REQUEST_INVALID');
        if($impactScope==='PRODUCT_FAMILY'&&preg_match('/^[a-z0-9][a-z0-9._-]{0,79}$/',$productFamily)!==1)throw new HubOperatorBridgeException('Product-family lesson needs a family identity','OPERATOR_REQUEST_INVALID');
        if($releaseTrack!==''&&preg_match('/^[a-z0-9][a-z0-9._-]{0,79}$/',$releaseTrack)!==1)throw new HubOperatorBridgeException('Verification lesson release track is invalid','OPERATOR_REQUEST_INVALID');
        $source=$this->verificationIncidentByRegression($sourceRegression);
        if($source===null||!hash_equals($classFingerprint,strtolower((string)($source['classFingerprint']??'')))||$problemClass!==(string)($source['problemClass']??'')||$impactScope!==(string)($source['impactScope']??''))
            throw new HubOperatorBridgeException('Verification lesson must be backed by a matching classified incident','OPERATOR_VERIFICATION_LESSON_SOURCE_REQUIRED');
        return ['classFingerprint'=>$classFingerprint,'lessonId'=>$lessonId];
    }

    /** @return array<string,mixed>|null */
    private function verificationIncidentByRegression(string $regressionId): ?array
    {
        $root=$this->verificationRoot(false).'/incidents';
        if(!is_dir($root))return null;
        foreach(array_slice(array_values(array_filter(glob($root.'/*')?:[],static fn(string $p):bool=>is_dir($p)&&!is_link($p))),0,200) as $directory){
            $doc=$this->latestVerificationDocument($directory,'verification-incident');
            if(is_array($doc)&&hash_equals($regressionId,(string)($doc['regressionId']??'')))return $doc;
        }
        return null;
    }

    /** @return array<string,mixed>|null */
    private function latestVerificationDocument(string $directory,string $kind): ?array
    {
        $files=glob($directory.'/*.json')?:[];
        usort($files,static fn(string $a,string $b):int=>(@filemtime($b)?:0)<=> (@filemtime($a)?:0));
        foreach($files as $file){
            $raw=@file_get_contents($file);if(!is_string($raw)||strlen($raw)>self::MAX_VERIFICATION_DOCUMENT_BYTES+2)continue;
            try{$doc=json_decode($raw,true,32,JSON_THROW_ON_ERROR);}catch(Throwable){continue;}
            if(is_array($doc)&&($doc['kind']??null)===$kind)return $doc;
        }
        return null;
    }

    /** @param array<string,mixed> $lesson */
    private function verificationLessonApplies(array $lesson,string $projectId,string $releaseTrack,string $productFamily): bool
    {
        $scope=strtoupper((string)($lesson['impactScope']??''));
        if($scope==='PROJECT')return $projectId!==''&&hash_equals($projectId,strtolower((string)($lesson['projectId']??'')));
        if($scope==='PRODUCT_FAMILY')return $productFamily!==''&&hash_equals($productFamily,strtolower((string)($lesson['productFamily']??'')));
        return in_array($scope,['ECOSYSTEM','PLATFORM'],true);
    }

    /** @return list<string> */
    private function verificationPaths(mixed $value): array
    {
        if(!is_array($value)||!array_is_list($value)||count($value)>80)throw new HubOperatorBridgeException('Verification changed paths are invalid','OPERATOR_REQUEST_INVALID');$out=[];
        foreach($value as $path){if(!is_string($path)||$path===''||strlen($path)>512||str_contains($path,"\0")||str_starts_with($path,'/')||preg_match('#(?:^|/)\.\.(?:/|$)#',$path))throw new HubOperatorBridgeException('Verification changed path is invalid','OPERATOR_REQUEST_INVALID');$out[]=$path;}
        return array_values(array_unique($out));
    }

    /** @return array<string,mixed> */
    private function bayStatus(string $at): array
    {
        $bay=new HubBayRemoteUpdateService(); $signed=$bay->status($at); $remote=($this->poster)((string)$signed['endpoint'],(array)$signed['statusRelay']);
        $gate=$this->projectGate('BAY EXCUSE X',$at,true);$parity=$this->bayProductionSourceParity($remote);
        $ready=($gate['sourceReady']??false)===true&&($parity['ready']??false)===true;
        return ['schemaVersion'=>1,'state'=>$ready?'READY':'SOURCE_DRIFT','authority'=>'BAY PackageManager/Update Center','remote'=>$remote,'projectGate'=>$gate,'sourceParity'=>$parity,'observedAt'=>$at];
    }

    /** @return array{projectionSha:string,sourceRevision:string} */
    private function bayCanonicalSourceIdentity(): array
    {
        $root=getenv('AWH_CANONICAL_GIT_ROOT');if(!is_string($root)||$root==='')$root='/srv/awh-git';
        $repo=rtrim($root,'/').'/bay-excuse-x.git';
        if(!is_dir($repo)||is_link($repo))throw new HubOperatorBridgeException('BAY canonical source repository is unavailable','OPERATOR_BAY_SOURCE_DRIFT');
        try{$projection=strtolower(trim($this->runGit($repo,['rev-parse','refs/heads/main'])));$body=$this->runGit($repo,['show','-s','--format=%B',$projection]);}
        catch(Throwable){throw new HubOperatorBridgeException('BAY canonical source projection is unavailable','OPERATOR_BAY_SOURCE_DRIFT');}
        $source='';if(preg_match('/^Source-Revision:\s*([a-f0-9]{40})\s*$/mi',$body,$m)===1)$source=strtolower($m[1]);
        if(preg_match('/^[a-f0-9]{40}$/',$projection)!==1||preg_match('/^[a-f0-9]{40}$/',$source)!==1)throw new HubOperatorBridgeException('BAY canonical source projection is invalid','OPERATOR_BAY_SOURCE_DRIFT');
        return ['projectionSha'=>$projection,'sourceRevision'=>$source];
    }

    /** @param array<string,mixed> $remote @return array<string,mixed> */
    private function bayProductionSourceParity(array $remote): array
    {
        try{$canonical=$this->bayCanonicalSourceIdentity();}
        catch(Throwable){return ['ready'=>false,'deployedSha'=>null,'projectionSha'=>null,'sourceRevision'=>null,'releaseTrack'=>null,'reason'=>'PROJECTION_UNAVAILABLE'];}
        $packageTrack='bay-excuse-core';$sourceTrack='bay-excuse-x';
        try{
            $project=$this->resolveProject('BAY EXCUSE X');
            $notes=$this->releaseDetailsForSourceSha((string)$project['project_id'],'bay-excuse-x',$canonical['sourceRevision']);
            $candidate=is_array($notes)?strtolower(trim((string)($notes['releaseTrack']??''))):'';
            if(in_array($candidate,['bay-excuse-x','line-oa','bay-cooperative','bay-pp'],true))$sourceTrack=$candidate;
            $packageTrack=match($sourceTrack){'line-oa'=>'line-oa','bay-cooperative'=>'cooperative-center','bay-pp'=>'pp-center',default=>'bay-excuse-core'};
        }catch(Throwable){}
        $track=is_array($remote['releaseTracks'][$packageTrack]??null)?$remote['releaseTracks'][$packageTrack]:[];
        $deployed=strtolower(trim((string)($track['sourceSha']??'')));
        if($deployed===''&&$packageTrack==='bay-excuse-core')$deployed=strtolower(trim((string)($remote['deployedSha']??'')));
        if(preg_match('/^[a-f0-9]{40}$/',$deployed)!==1)return ['ready'=>false,'deployedSha'=>$deployed?:null,'projectionSha'=>$canonical['projectionSha'],'sourceRevision'=>$canonical['sourceRevision'],'releaseTrack'=>$packageTrack,'sourceReleaseTrack'=>$sourceTrack,'reason'=>'UNRESOLVED'];
        $ready=hash_equals($canonical['sourceRevision'],$deployed);
        return ['ready'=>$ready,'deployedSha'=>$deployed,'projectionSha'=>$canonical['projectionSha'],'sourceRevision'=>$canonical['sourceRevision'],'releaseTrack'=>$packageTrack,'sourceReleaseTrack'=>$sourceTrack,'reason'=>$ready?'MATCH':'SOURCE_REVISION_DRIFT'];
    }

    /** @return array{projectionSha:string,sourceRevision:string} */
    private function assertBayCanonicalTarget(string $targetSha): array
    {
        $canonical=$this->bayCanonicalSourceIdentity();
        if(!hash_equals($canonical['sourceRevision'],strtolower($targetSha)))throw new HubOperatorBridgeException('BAY target source does not match canonical authority','OPERATOR_BAY_TARGET_DRIFT');
        return $canonical;
    }

    /** @param array<string,mixed> $remote */
    private function assertBayProductionSourceParity(array $remote): void
    {
        $parity=$this->bayProductionSourceParity($remote);
        if(($parity['ready']??false)!==true)throw new HubOperatorBridgeException('BAY Production source does not match canonical authority','OPERATOR_BAY_SOURCE_DRIFT');
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function bayStage(array $request,string $at): array
    {
        if (($request['confirmation']??null)!==self::STAGE_CONFIRMATION) throw new HubOperatorBridgeException('Explicit BAY stage confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $version=self::text($request,'targetVersion',80); $sha=strtolower(self::text($request,'targetSha',40)); $packageSha=strtolower(self::text($request,'packageSha256',64)); $stagedFile=self::text($request,'stagedFile',96);
        if(preg_match('/^[0-9A-Za-z][0-9A-Za-z._+-]*$/',$version)!==1||preg_match('/^[a-f0-9]{40}$/',$sha)!==1||preg_match('/^[a-f0-9]{64}$/',$packageSha)!==1||$stagedFile!==$packageSha.'.zip')throw new HubOperatorBridgeException('BAY package identity is invalid','OPERATOR_REQUEST_INVALID');
        $stageRoot=getenv('AWH_OPERATOR_STAGE_ROOT');if(!is_string($stageRoot)||$stageRoot==='')$stageRoot='/var/lib/awh-remote/operator-staging';
        $inbox=getenv('AWH_BAY_UPDATE_INBOX');if(!is_string($inbox)||$inbox==='')$inbox='/var/www/bay-production-shadow/current/updates/incoming';
        $stageReal=realpath($stageRoot);$inboxReal=realpath($inbox);if(!is_string($stageReal)||!is_dir($stageReal)||is_link($stageRoot)||!is_string($inboxReal)||!is_dir($inboxReal)||is_link($inbox))throw new HubOperatorBridgeException('BAY staging paths are unavailable','OPERATOR_BAY_STAGE_UNAVAILABLE');
        $source=$stageReal.'/'.$stagedFile;$sourceReal=realpath($source);if(!is_string($sourceReal)||dirname($sourceReal)!==$stageReal||is_link($source)||!is_file($sourceReal)||!is_readable($sourceReal))throw new HubOperatorBridgeException('Staged BAY package is unavailable','OPERATOR_BAY_PACKAGE_NOT_READY');
        $size=@filesize($sourceReal);if(!is_int($size)||$size<1||$size>self::MAX_BAY_PACKAGE_BYTES)throw new HubOperatorBridgeException('Staged BAY package exceeds the safe limit','OPERATOR_BAY_PACKAGE_NOT_READY');
        $actual=hash_file('sha256',$sourceReal);if(!is_string($actual)||!hash_equals($packageSha,$actual))throw new HubOperatorBridgeException('Staged BAY package checksum mismatch','OPERATOR_BAY_PACKAGE_NOT_READY');
        if(!class_exists('ZipArchive'))throw new HubOperatorBridgeException('ZIP runtime is unavailable','OPERATOR_BAY_STAGE_UNAVAILABLE');
        $zip=new ZipArchive();if($zip->open($sourceReal,ZipArchive::RDONLY|ZipArchive::CHECKCONS)!==true)throw new HubOperatorBridgeException('Staged BAY package is invalid','OPERATOR_BAY_PACKAGE_NOT_READY');
        try{$raw=$zip->getFromName('manifest.json');if(!is_string($raw))throw new HubOperatorBridgeException('Staged BAY manifest is missing','OPERATOR_BAY_PACKAGE_NOT_READY');$manifest=json_decode($raw,true,32,JSON_THROW_ON_ERROR);}catch(HubOperatorBridgeException $e){$zip->close();throw $e;}catch(Throwable){$zip->close();throw new HubOperatorBridgeException('Staged BAY manifest is invalid','OPERATOR_BAY_PACKAGE_NOT_READY');}$zip->close();
        if(!is_array($manifest)||($manifest['type']??null)!=='core'||($manifest['version']??null)!==$version||strtolower((string)($manifest['source_commit']??''))!==$sha)throw new HubOperatorBridgeException('Staged BAY manifest identity mismatch','OPERATOR_BAY_PACKAGE_NOT_READY');
        $releaseTrack=strtolower(trim((string)($manifest['release_track']??'bay-excuse-core')));
        $filePrefixes=['bay-excuse-core'=>'bay-excuse-x-core','cooperative-center'=>'bay-cooperative-center','pp-center'=>'bay-pp-center','line-oa'=>'bay-line-oa'];
        if(!isset($filePrefixes[$releaseTrack]))throw new HubOperatorBridgeException('BAY package release track is not allowlisted','OPERATOR_BAY_PACKAGE_NOT_READY');
        $gate=$this->projectGate('BAY EXCUSE X',$at,true,'bay.remote_update.stage');if(($gate['ready']??false)!==true||($gate['sourceReady']??false)!==true)throw new HubOperatorBridgeException('BAY project gate is blocked','OPERATOR_PROJECT_GATE_BLOCKED');$projectId=(string)($gate['project']['projectId']??'');
        $this->assertBayCanonicalTarget($sha);
        $releaseNotes=$this->releaseDetailsForSourceSha($projectId,'bay-excuse-x',$sha);
        $sourceTrack=is_array($releaseNotes)?strtolower(trim((string)($releaseNotes['releaseTrack']??''))):'';
        $expectedTrack=match($sourceTrack){'line-oa'=>'line-oa','bay-cooperative'=>'cooperative-center','bay-pp'=>'pp-center',default=>'bay-excuse-core'};
        if($releaseTrack!==$expectedTrack)throw new HubOperatorBridgeException('BAY package release track does not match canonical source ownership','OPERATOR_BAY_PACKAGE_NOT_READY');
        $authority=$this->acquireMutationAuthority($projectId,'Guarded BAY stage '.$releaseTrack.' '.$version,'bay.remote_update.stage',['releaseTrack'=>$releaseTrack,'targetVersion'=>$version,'targetSha'=>$sha,'packageSha256'=>$packageSha],$at);$success=false;$destination=null;
        try{
            $bay=new HubBayRemoteUpdateService();$statusEnvelope=$bay->status($at);$before=($this->poster)((string)$statusEnvelope['endpoint'],(array)$statusEnvelope['statusRelay']);
            if(($before['ok']??false)!==true||(($before['preflight']['ready']??false)!==true)||(($before['maintenance']['active']??false)===true))throw new HubOperatorBridgeException('BAY Production preflight is not ready','OPERATOR_BAY_PREFLIGHT_BLOCKED');
            $trackState=is_array($before['releaseTracks'][$releaseTrack]??null)?$before['releaseTracks'][$releaseTrack]:[];
            $current=(string)($trackState['currentVersion']??'');
            $deployed=strtolower((string)($trackState['sourceSha']??''));
            if($releaseTrack==='bay-excuse-core'){
                if($current==='')$current=(string)($before['currentVersion']??'');
                if($deployed==='')$deployed=strtolower((string)($before['deployedSha']??''));
            }
            $from=(string)($manifest['from_version']??'');$base=strtolower((string)($manifest['source_base_commit']??''));
            if($current===''||$from!==$current||version_compare($version,$current,'<=')||preg_match('/^[a-f0-9]{40}$/',$deployed)!==1||$base===''||!hash_equals($deployed,$base))throw new HubOperatorBridgeException('BAY '.$releaseTrack.' package baseline does not match Production track','OPERATOR_BAY_BASELINE_MISMATCH');
            $safeVersion=preg_replace('/[^0-9A-Za-z._+-]+/','-',$version);if(!is_string($safeVersion)||$safeVersion==='')throw new HubOperatorBridgeException('BAY package version is invalid','OPERATOR_REQUEST_INVALID');
            $destination=$inboxReal.'/'.$filePrefixes[$releaseTrack].'-'.$safeVersion.'-'.substr($sha,0,12).'.zip';$tmp=$inboxReal.'/.awh-stage-'.$packageSha.'.tmp';
            if(is_link($destination)||is_dir($destination)||file_exists($tmp)||is_link($tmp))throw new HubOperatorBridgeException('BAY Update Inbox destination is not clean','OPERATOR_BAY_STAGE_CONFLICT');
            $input=@fopen($sourceReal,'rb');$output=@fopen($tmp,'xb');if(!is_resource($input)||!is_resource($output)){if(is_resource($input))fclose($input);if(is_resource($output))fclose($output);@unlink($tmp);throw new HubOperatorBridgeException('BAY package could not be staged','OPERATOR_BAY_STAGE_UNAVAILABLE');}
            $copied=stream_copy_to_stream($input,$output,self::MAX_BAY_PACKAGE_BYTES+1);@fflush($output);if(function_exists('fsync'))@fsync($output);fclose($input);fclose($output);
            if(!is_int($copied)||$copied!==$size||!@chmod($tmp,0640)||!hash_equals($packageSha,(string)hash_file('sha256',$tmp))||!@rename($tmp,$destination)){@unlink($tmp);@unlink($destination);throw new HubOperatorBridgeException('BAY package staging verification failed','OPERATOR_BAY_STAGE_FAILED');}
            $afterEnvelope=$bay->status(gmdate('c'));$after=($this->poster)((string)$afterEnvelope['endpoint'],(array)$afterEnvelope['statusRelay']);$matched=false;
            foreach((array)($after['packages']??[]) as $row){if(is_array($row)&&($row['version']??null)===$version&&strtolower((string)($row['releaseTrack']??'bay-excuse-core'))===$releaseTrack&&strtolower((string)($row['sourceSha']??''))===$sha&&strtolower((string)($row['packageSha256']??''))===$packageSha&&($row['installable']??false)===true){$matched=true;break;}}
            if(!$matched){@unlink($destination);$destination=null;throw new HubOperatorBridgeException('BAY Update Inbox did not accept exact package','OPERATOR_BAY_PACKAGE_NOT_READY');}
            $success=true;return ['schemaVersion'=>1,'state'=>'STAGED','gate'=>$gate,'authority'=>['executionId'=>$authority['executionId'],'taskId'=>$authority['taskId'],'leaseExpiresAt'=>$authority['leaseExpiresAt']],'package'=>['filename'=>basename($destination),'releaseTrack'=>$releaseTrack,'version'=>$version,'sourceSha'=>$sha,'packageSha256'=>$packageSha,'sizeBytes'=>$size],'before'=>['releaseTrack'=>$releaseTrack,'version'=>$current,'deployedSha'=>$deployed],'observedAt'=>$at];
        }finally{if(!$success&&is_string($destination)&&is_file($destination))@unlink($destination);$this->releaseMutationAuthority($authority,$success,gmdate('c'));}
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function bayInstall(array $request,string $at): array
    {
        if (($request['confirmation']??null)!==self::INSTALL_CONFIRMATION) throw new HubOperatorBridgeException('Explicit BAY install confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $version=self::text($request,'targetVersion',80); $sha=strtolower(self::text($request,'targetSha',40)); $packageSha=strtolower(self::text($request,'packageSha256',64));
        if(preg_match('/^[a-f0-9]{40}$/',$sha)!==1||preg_match('/^[a-f0-9]{64}$/',$packageSha)!==1)throw new HubOperatorBridgeException('BAY package identity is invalid','OPERATOR_REQUEST_INVALID');
        $sourceGate=$this->projectGate('BAY EXCUSE X',$at,true,self::MISSION_CAPABILITY);
        if (($sourceGate['sourceReady']??false)!==true) throw new HubOperatorBridgeException('BAY project source gate is blocked','OPERATOR_PROJECT_GATE_BLOCKED');
        $projectId=(string)($sourceGate['project']['projectId']??'');
        $this->assertBayCanonicalTarget($sha);
        $releaseNotes=$this->releaseDetailsForSourceSha($projectId,'bay-excuse-x',$sha);
        if(!HubUpdateTargetRegistry::releaseDetailsReady($releaseNotes))
            throw new HubOperatorBridgeException('BAY release details are required before install','OPERATOR_RELEASE_DETAILS_REQUIRED');
        $sourceTrack=strtolower(trim((string)($releaseNotes['releaseTrack']??'')));
        $expectedTrack=match($sourceTrack){'line-oa'=>'line-oa','bay-cooperative'=>'cooperative-center','bay-pp'=>'pp-center',default=>'bay-excuse-core'};
        $registryTrack=match($expectedTrack){'line-oa'=>'line-oa','cooperative-center'=>'bay-cooperative','pp-center'=>'bay-pp',default=>'bay-excuse-x'};
        $trackConfig=HubUpdateTargetRegistry::byReleaseTrack($registryTrack);
        $deployResource=is_array($trackConfig)&&is_string($trackConfig['deployResource']??null)?(string)$trackConfig['deployResource']:'CANONICAL:DEPLOY:PROJECT';
        $gate=$this->projectGate('BAY EXCUSE X',$at,true,'bay.remote_update.install',null,$deployResource);
        if (($gate['ready']??false)!==true || ($gate['sourceReady']??false)!==true) throw new HubOperatorBridgeException('BAY project gate is blocked','OPERATOR_PROJECT_GATE_BLOCKED');
        $authority=$this->acquireMutationAuthority($projectId,'Guarded BAY install '.$expectedTrack.' '.$version,'bay.remote_update.install',['releaseTrack'=>$expectedTrack,'targetVersion'=>$version,'targetSha'=>$sha,'packageSha256'=>$packageSha,'releaseNotes'=>$releaseNotes],$at);
        $success=false;
        try {
            $bay=new HubBayRemoteUpdateService(); $statusEnvelope=$bay->status($at); $before=($this->poster)((string)$statusEnvelope['endpoint'],(array)$statusEnvelope['statusRelay']);
            if (($before['ok']??false)!==true || (($before['preflight']['ready']??false)!==true) || (($before['maintenance']['active']??false)===true)) throw new HubOperatorBridgeException('BAY Production preflight is not ready','OPERATOR_BAY_PREFLIGHT_BLOCKED');
            $package=null; foreach((array)($before['packages']??[]) as $row){if(!is_array($row))continue;if(($row['version']??null)===$version&&strtolower((string)($row['releaseTrack']??'bay-excuse-core'))===$expectedTrack&&strtolower((string)($row['sourceSha']??''))===$sha&&strtolower((string)($row['packageSha256']??''))===$packageSha&&($row['installable']??false)===true){$package=$row;break;}}
            if(!is_array($package)) throw new HubOperatorBridgeException('Exact BAY release-track package is not installable in Update Inbox','OPERATOR_BAY_PACKAGE_NOT_READY');
            $signed=$bay->installRelay($version,$sha,$packageSha,$at); $result=($this->poster)((string)$signed['endpoint'],(array)$signed['relay']);
            if (($result['ok']??false)!==true) throw new HubOperatorBridgeException('BAY PackageManager rejected install','OPERATOR_BAY_INSTALL_FAILED');
            $afterEnvelope=$bay->status(gmdate('c'));$after=($this->poster)((string)$afterEnvelope['endpoint'],(array)$afterEnvelope['statusRelay']);
            if(($after['ok']??false)!==true)throw new HubOperatorBridgeException('BAY post-install status is unavailable','OPERATOR_BAY_INSTALL_FAILED');
            $this->assertBayProductionSourceParity($after);
            $beforeTrack=is_array($before['releaseTracks'][$expectedTrack]??null)?$before['releaseTracks'][$expectedTrack]:[];
            $afterTrack=is_array($after['releaseTracks'][$expectedTrack]??null)?$after['releaseTracks'][$expectedTrack]:[];
            $afterVersion=(string)($afterTrack['currentVersion']??'');
            $afterSha=strtolower((string)($afterTrack['sourceSha']??''));
            if($expectedTrack==='bay-excuse-core'){
                if($afterVersion==='')$afterVersion=(string)($after['currentVersion']??'');
                if($afterSha==='')$afterSha=strtolower((string)($after['deployedSha']??''));
            }
            if($afterVersion!==$version||!hash_equals($sha,$afterSha))throw new HubOperatorBridgeException('BAY release-track post-install identity does not match target','OPERATOR_BAY_INSTALL_FAILED');
            $success=true;
            return ['schemaVersion'=>1,'state'=>'INSTALLED','releaseTrack'=>$expectedTrack,'gate'=>$gate,'authority'=>['executionId'=>$authority['executionId'],'taskId'=>$authority['taskId'],'leaseExpiresAt'=>$authority['leaseExpiresAt']],'before'=>['version'=>$beforeTrack['currentVersion']??null,'deployedSha'=>$beforeTrack['sourceSha']??($expectedTrack==='bay-excuse-core'?($before['deployedSha']??null):null)],'after'=>['version'=>$afterVersion,'deployedSha'=>$afterSha],'result'=>$result,'observedAt'=>$at];
        } finally {
            $this->releaseMutationAuthority($authority,$success,gmdate('c'));
        }
    }

    /** @return array<string,mixed>|null */
    private function releaseDetailsForSourceSha(string $projectId,string $repository,string $sha): ?array
    {
        if(!self::uuidValid($projectId)||!isset(HubUpdateTargetRegistry::repositories()[$repository])||preg_match('/^[0-9a-f]{40}$/',$sha)!==1)return null;
        $root=getenv('AWH_CANONICAL_GIT_ROOT');if(!is_string($root)||$root==='')$root='/srv/awh-git';$repo=rtrim($root,'/').'/'.$repository.'.git';
        $q=$this->pdo->prepare("SELECT checkpoint_json FROM control_task_executions WHERE project_id=:project AND required_capability='source.promote' AND state='COMPLETED' ORDER BY updated_at DESC,execution_id DESC LIMIT 80");
        $q->execute(['project'=>$projectId]);
        foreach($q->fetchAll() as $row){
            try{$checkpoint=json_decode((string)$row['checkpoint_json'],true,16,JSON_THROW_ON_ERROR);}catch(Throwable){continue;}
            if(!is_array($checkpoint)||($checkpoint['repository']??null)!==$repository)continue;
            $target=strtolower((string)($checkpoint['targetSha']??''));$matches=preg_match('/^[a-f0-9]{40}$/',$target)===1&&hash_equals($sha,$target);
            if(!$matches&&preg_match('/^[a-f0-9]{40}$/',$target)===1&&is_dir($repo)&&!is_link($repo)){
                try{$body=$this->runGit($repo,['show','-s','--format=%B',$target]);if(preg_match('/^Source-Revision:\s*([a-f0-9]{40})\s*$/mi',$body,$m)===1)$matches=hash_equals($sha,strtolower($m[1]));}
                catch(Throwable){$matches=false;}
            }
            if(!$matches)continue;
            $notes=$checkpoint['releaseNotes']??null;
            return HubUpdateTargetRegistry::releaseDetailsReady($notes)?$notes:null;
        }
        return null;
    }

    /** Persist release details and target-project mission context on the typed source.promote writer. */
    private function persistSourcePromotionReleaseNotes(string $executionId,string $repository,string $expected,string $target,string $bundleSha,array $releaseNotes,string $missionExecutionId,string $at): void
    {
        $checkpoint=['repository'=>$repository,'expectedMainSha'=>$expected,'targetSha'=>$target,'bundleSha256'=>$bundleSha,'missionExecutionId'=>$missionExecutionId,'releaseNotes'=>$releaseNotes];
        $q=$this->pdo->prepare("UPDATE control_task_executions SET checkpoint_json=:checkpoint,updated_at=:at WHERE execution_id=:execution AND required_capability='source.promote' AND state='RUNNING'");
        $q->execute(['checkpoint'=>json_encode($checkpoint,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'at'=>$at,'execution'=>$executionId]);
        if($q->rowCount()!==1)throw new HubOperatorBridgeException('Release details could not be bound to source promotion','OPERATOR_RELEASE_DETAILS_REQUIRED');
    }

    /** @param array<string,mixed> $checkpoint @return array{executionId:string,taskId:string,projectId:string,leaseExpiresAt:string,joined?:bool} */
    private function acquireMutationAuthority(string $projectId,string $goal,string $capability,array $checkpoint,string $at,int $leaseSeconds=300,string $leaseOwner='operator-bridge'): array
    {
        if(!self::uuidValid($projectId)||preg_match('/^[a-z][a-z0-9:._-]{1,63}$/',$capability)!==1)throw new HubOperatorBridgeException('Mutation authority request is invalid','OPERATOR_REQUEST_INVALID');
        if($leaseSeconds<60||$leaseSeconds>14400||preg_match('/^[a-z][a-z0-9-]{2,31}$/',$leaseOwner)!==1)throw new HubOperatorBridgeException('Mutation lease request is invalid','OPERATOR_REQUEST_INVALID');
        $lease=gmdate('c',strtotime($at)+$leaseSeconds); $taskId=self::uuid(); $executionId=self::uuid();
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            if($capability===self::MISSION_CAPABILITY){
                $requestedTrack=is_string($checkpoint['requestedReleaseTrack']??null)?strtolower(trim((string)$checkpoint['requestedReleaseTrack'])):'';
                $existing=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.lease_expires_at,e.checkpoint_json FROM control_task_executions e JOIN control_execution_envelopes x ON x.execution_id=e.execution_id WHERE e.project_id=:project AND e.required_capability=:capability AND e.lease_owner=:owner AND e.state='RUNNING' AND x.state='ACTIVE' AND (e.lease_expires_at IS NULL OR e.lease_expires_at>:at) AND (x.lease_expires_at IS NULL OR x.lease_expires_at>:at) ORDER BY e.updated_at DESC,e.execution_id DESC LIMIT 40");
                $existing->execute(['project'=>$projectId,'capability'=>self::MISSION_CAPABILITY,'owner'=>self::MISSION_OWNER,'at'=>$at]);
                foreach($existing->fetchAll() as $row){
                    if(!is_array($row))continue;
                    $currentTrack=self::missionReleaseTrackFromCheckpoint((string)($row['checkpoint_json']??''));
                    if($requestedTrack!==''&&(!is_string($currentTrack)||!hash_equals($requestedTrack,$currentTrack)))continue;
                    $this->pdo->exec('COMMIT');
                    return ['executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'projectId'=>$projectId,'leaseExpiresAt'=>(string)$row['lease_expires_at'],'joined'=>true];
                }
            }
            // Missing envelopes are an integrity gap and remain fail-closed.
            // Scoped envelopes are arbitrated below by the canonical registry,
            // so unrelated workspace/candidate/resource lanes are not blocked.
            $unscoped=$this->pdo->prepare("SELECT e.execution_id FROM control_task_executions e LEFT JOIN control_execution_envelopes x ON x.execution_id=e.execution_id WHERE e.project_id=:project AND e.state IN ('LEASED','RUNNING') AND x.execution_id IS NULL LIMIT 1");
            $unscoped->execute(['project'=>$projectId]);
            if($unscoped->fetchColumn()!==false)throw new HubOperatorBridgeException('A running mutation has no resource scope','OPERATOR_PROJECT_GATE_BLOCKED');
            $owner=$this->pdo->query("SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id=1 AND bootstrap_closed=1")->fetchColumn();
            if(!is_string($owner)||!self::uuidValid($owner))throw new HubOperatorBridgeException('Owner authority is unavailable','OPERATOR_OWNER_UNAVAILABLE');
            $revision=null;$q=$this->pdo->prepare('SELECT active_revision_id FROM control_project_vaults WHERE project_id=:project');$q->execute(['project'=>$projectId]);$v=$q->fetchColumn();if(is_string($v)&&self::uuidValid($v))$revision=$v;
            $key='operator-bridge-'.substr(hash('sha256',$executionId),0,48);
            $this->pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,:goal,'RUNNING',NULL,:lease,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$taskId,'user'=>$owner,'project'=>$projectId,'goal'=>$goal,'lease'=>$lease,'key'=>$key,'at'=>$at]);
            $this->pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,:revision,'VPS',:capability,'RUNNING',:owner,:lease,1,NULL,:checkpoint,NULL,:at,:at)")->execute(['execution'=>$executionId,'task'=>$taskId,'project'=>$projectId,'revision'=>$revision,'capability'=>$capability,'owner'=>$leaseOwner,'lease'=>$lease,'checkpoint'=>json_encode($checkpoint,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'at'=>$at]);
            $registry=new HubCapabilityRegistryService($this->pdo); $claim=$registry->activateExecutionAuthority($executionId,$lease,$at,true);
            if(($claim['granted']??false)!==true)throw new HubOperatorBridgeException('Another execution owns a conflicting project resource','OPERATOR_PROJECT_GATE_BLOCKED');
            $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:id,:task,'RUNNING',10,'Guarded operator bridge acquired canonical mutation authority',:at)")->execute(['id'=>self::uuid(),'task'=>$taskId,'at'=>$at]);
            $this->pdo->exec('COMMIT');
            return ['executionId'=>$executionId,'taskId'=>$taskId,'projectId'=>$projectId,'leaseExpiresAt'=>$lease,'joined'=>false];
        }catch(Throwable $error){try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}if($error instanceof HubOperatorBridgeException)throw $error;throw new HubOperatorBridgeException('Mutation authority could not be acquired','OPERATOR_AUTHORITY_FAILED');}
    }

    /** @param array{executionId:string,taskId:string,projectId:string,leaseExpiresAt:string} $authority */
    private function releaseMutationAuthority(array $authority,bool $success,string $at): void
    {
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            (new HubCapabilityRegistryService($this->pdo))->updateEnvelopeState($authority['executionId'],'RELEASED',null,$at);
            $state=$success?'COMPLETED':'FAILED';$summary=$success?'Guarded operator mutation completed':'Guarded operator mutation failed and released authority';$error=$success?null:'OPERATOR_MUTATION_FAILED';
            $this->pdo->prepare('UPDATE control_task_executions SET state=:state,lease_owner=NULL,lease_expires_at=NULL,last_error_code=:error,updated_at=:at WHERE execution_id=:execution')->execute(['state'=>$state,'error'=>$error,'at'=>$at,'execution'=>$authority['executionId']]);
            $this->pdo->prepare('UPDATE control_tasks SET state=:state,lease_expires_at=NULL,progress=100,result_summary=:summary,failure_code=:error,updated_at=:at WHERE task_id=:task')->execute(['state'=>$state,'summary'=>$summary,'error'=>$error,'at'=>$at,'task'=>$authority['taskId']]);
            $this->pdo->prepare('INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:id,:task,:state,100,:message,:at)')->execute(['id'=>self::uuid(),'task'=>$authority['taskId'],'state'=>$state,'message'=>$summary,'at'=>$at]);
            $this->pdo->exec('COMMIT');
        }catch(Throwable $error){try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}throw new HubOperatorBridgeException('Mutation authority could not be released','OPERATOR_AUTHORITY_RELEASE_FAILED');}
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



    /** @return array<string,mixed> */
    private function releaseNotesForPromotion(string $repo,string $repository,string $expected,string $target,string $at): array
    {
        $groups=['features'=>[],'improvements'=>[],'fixes'=>[],'internal'=>[]];
        $commits=[];
        $log=$this->runGit($repo,['log','--no-merges','--max-count=80','--format=%H%x09%s',$expected.'..'.$target]);
        foreach(preg_split('/\r?\n/',$log)?:[] as $line){
            if($line==='')continue;
            $parts=explode("\t",$line,2);if(count($parts)!==2)continue;
            $sha=strtolower(trim($parts[0]));$subject=trim($parts[1]);
            if(preg_match('/^[a-f0-9]{40}$/',$sha)!==1||$subject===''||strlen($subject)>220)continue;
            $category='improvements';
            if(preg_match('/^feat(?:\([^)]{1,50}\))?!?:\s*/i',$subject))$category='features';
            elseif(preg_match('/^fix(?:\([^)]{1,50}\))?!?:\s*/i',$subject))$category='fixes';
            elseif(preg_match('/^(?:chore|docs|test|ci|build)(?:\([^)]{1,50}\))?!?:\s*/i',$subject))$category='internal';
            elseif(preg_match('/^(?:perf|refactor|style)(?:\([^)]{1,50}\))?!?:\s*/i',$subject))$category='improvements';
            $label=preg_replace('/^[a-z]+(?:\([^)]{1,50}\))?!?:\s*/i','',$subject)?:$subject;
            $label=mb_substr(trim($label),0,180,'UTF-8');
            if($label==='')continue;
            if(count($groups[$category])<12)$groups[$category][]=$label;
            if(count($commits)<40)$commits[]=['sha'=>$sha,'category'=>$category,'subject'=>$label];
        }
        $paths=array_values(array_filter(preg_split('/\r?\n/',$this->runGit($repo,['diff','--name-only',$expected,$target]))?:[],static fn(string $v):bool=>$v!==''));
        $paths=array_slice($paths,0,240);
        $releaseTrack=HubUpdateTargetRegistry::releaseTrackForPaths($repository,$paths);
        if($releaseTrack===null)throw new HubOperatorBridgeException('Source promotion crosses release-track ownership; split the change-set first','OPERATOR_RELEASE_TRACK_MIXED');
        if(count($groups['features'])+count($groups['improvements'])+count($groups['fixes'])+count($groups['internal'])===0&&count($paths)>0){
            $areas=[];foreach($paths as $path){$area=explode('/',$path,2)[0]??'';if($area!==''&&!in_array($area,$areas,true)&&count($areas)<4)$areas[]=$area;}
            $groups['internal'][]='ปรับปรุงแพตช์ในส่วน '.implode(', ',$areas).' ('.count($paths).' ไฟล์)';
        }
        $hasMigration=false;$hasService=false;$desktop=false;$auth=false;
        foreach($paths as $path){
            if(str_contains($path,'/migrations/')||str_starts_with($path,'hub/migrations/'))$hasMigration=true;
            if(preg_match('#^deploy/(?:systemd|nginx|php-fpm)/#',$path))$hasService=true;
            if(preg_match('#^(?:src/desktop/|forge\.|scripts/(?:desktop|release)/|config/(?:device-runtime|full-device-engine))#',$path)||in_array($path,['package.json','package-lock.json'],true))$desktop=true;
            if(str_contains(strtolower($path),'auth'))$auth=true;
        }
        $known=[];$roadmap=[];
        $roadmapRaw=$this->runGitResult($repo,['show',$target.':config/update-roadmap.json']);
        if(($roadmapRaw['code']??1)===0&&is_string($roadmapRaw['stdout']??null)&&strlen((string)$roadmapRaw['stdout'])<=65536){
            try{$cfg=json_decode((string)$roadmapRaw['stdout'],true,16,JSON_THROW_ON_ERROR);}catch(Throwable){$cfg=null;}
            if(is_array($cfg)){
                foreach((array)($cfg['knownIssues']??[]) as $value)if(is_string($value)&&trim($value)!==''&&strlen($value)<=220&&count($known)<12)$known[]=trim($value);
                foreach((array)($cfg['comingNext']??[]) as $entry){
                    if(!is_array($entry)||count($roadmap)>=8)continue;
                    $title=is_string($entry['title']??null)?trim((string)$entry['title']):'';
                    $status=is_string($entry['status']??null)?strtoupper(trim((string)$entry['status'])):'PLANNED';
                    if($title===''||strlen($title)>160||!in_array($status,['PLANNED','IN_PROGRESS','REVIEW'],true))continue;
                    $items=[];foreach((array)($entry['items']??[]) as $value)if(is_string($value)&&trim($value)!==''&&strlen($value)<=220&&count($items)<8)$items[]=trim($value);
                    $roadmap[]=['title'=>$title,'status'=>$status,'items'=>$items];
                }
            }
        }
        $visible=array_values(array_merge($groups['features'],$groups['improvements'],$groups['fixes']));
        $userVisible=count($visible)>0;
        $ownerSummary=$userVisible?(string)$visible[0]:'ไม่มีการเปลี่ยนแปลงที่ผู้ใช้เห็น';
        // VPS Platform releases always execute the bounded, idempotent schema
        // chain and reload managed platform services. Approval metadata must
        // describe operational behavior, not merely infer it from changed paths.
        $platformOperationalImpact=$releaseTrack==='vps-platform';
        return [
            'schemaVersion'=>1,'metadataState'=>'READY','generatedFrom'=>'EXACT_GIT_DIFF',
            'repository'=>$repository,'releaseTrack'=>$releaseTrack,'previousSha'=>$expected,'targetSha'=>$target,'generatedAt'=>$at,
            'ownerSummary'=>$ownerSummary,'userVisible'=>$userVisible,
            'summary'=>$groups,'commits'=>$commits,'changedFileCount'=>count($paths),
            'impact'=>[
                'databaseMigration'=>($hasMigration||$platformOperationalImpact)?'AUTOMATIC':'NONE',
                'serviceReload'=>($hasService||$platformOperationalImpact)?'AUTOMATIC':'NONE',
                'appRestart'=>$desktop?'MAY_BE_REQUIRED':'NONE',
                'signIn'=>$auth?'MAY_BE_REQUIRED':'NONE',
                'plannedDowntime'=>false,
            ],
            'compatibility'=>[
                'data'=>$hasMigration?'MIGRATION_REQUIRED':'COMPATIBLE',
                'runtime'=>$desktop?'RESTART_MAY_BE_REQUIRED':'COMPATIBLE',
                'authentication'=>$auth?'SIGN_IN_MAY_BE_REQUIRED':'UNCHANGED',
            ],
            'rollback'=>[
                'required'=>true,
                'strategy'=>'PREVIOUS_VERIFIED_RELEASE_OR_SOURCE',
                'sourceSha'=>$expected,
            ],
            'knownIssues'=>$known,'comingNext'=>$roadmap,
        ];
    }

    /** @param list<string> $args */
    private function runGit(string $repo,array $args): string
    {
        $result=$this->runGitResult($repo,$args);
        if($result['code']!==0)throw new HubOperatorBridgeException('Bounded Git operation failed','OPERATOR_SOURCE_PROMOTE_FAILED');
        return $result['stdout'];
    }

    /** @param list<string> $args @return array{code:int,stdout:string} */
    private function runGitResult(string $repo,array $args): array
    {
        if(!is_dir($repo)||is_link($repo))throw new HubOperatorBridgeException('Canonical Git repository is unavailable','OPERATOR_SOURCE_STORAGE_UNAVAILABLE');
        $command=array_merge(['/usr/bin/git','--git-dir='.$repo],$args);$pipes=[];
        $process=@proc_open($command,[0=>['file','/dev/null','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes,null,['LC_ALL'=>'C','PATH'=>'/usr/bin:/bin'],['bypass_shell'=>true]);
        if(!is_resource($process))throw new HubOperatorBridgeException('Bounded Git runtime is unavailable','OPERATOR_SOURCE_STORAGE_UNAVAILABLE');
        $stdout=is_resource($pipes[1]??null)?stream_get_contents($pipes[1],65537):'';$stderr=is_resource($pipes[2]??null)?stream_get_contents($pipes[2],65537):'';
        foreach($pipes as $pipe)if(is_resource($pipe))fclose($pipe);$code=proc_close($process);
        if(!is_string($stdout)||strlen($stdout)>65536||!is_string($stderr)||strlen($stderr)>65536)throw new HubOperatorBridgeException('Bounded Git output exceeded safe limit','OPERATOR_SOURCE_PROMOTE_FAILED');
        return ['code'=>(int)$code,'stdout'=>$stdout];
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
    private static function gitSha(string $value): string { $value=strtolower(trim($value));if(preg_match('/^[a-f0-9]{40}$/',$value)!==1)throw new HubOperatorBridgeException('Git revision is invalid','OPERATOR_REQUEST_INVALID');return $value; }
    private static function sha256(string $value): string { $value=strtolower(trim($value));if(preg_match('/^[a-f0-9]{64}$/',$value)!==1)throw new HubOperatorBridgeException('SHA-256 identity is invalid','OPERATOR_REQUEST_INVALID');return $value; }
    private static function uuidValid(string $value): bool { return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$value)===1; }
    private static function uuid(): string { $b=random_bytes(16);$b[6]=chr((ord($b[6])&0x0f)|0x40);$b[8]=chr((ord($b[8])&0x3f)|0x80);return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($b),4)); }
    private static function timestamp(string $value): string { $t=strtotime($value); if($t===false)throw new HubOperatorBridgeException('Time is invalid','OPERATOR_REQUEST_INVALID'); return gmdate('c',$t); }
}
