<?php

declare(strict_types=1);

require_once __DIR__.'/HubUpdateTargetRegistry.php';

require_once __DIR__ . '/HubBayRemoteUpdateService.php';
require_once __DIR__ . '/HubCapabilityRegistryService.php';
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
    private const MISSION_ACQUIRE_CONFIRMATION='ACQUIRE_PROJECT_MISSION';
    private const MISSION_RELEASE_CONFIRMATION='RELEASE_PROJECT_MISSION';
    private const MISSION_CAPABILITY='operator.project_mission';
    private const MISSION_OWNER='operator-mission';
    private const MISSION_LEASE_SECONDS=7200;
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
            'project.gate'=>$this->projectGate(self::text($request,'project',160),$at),
            'verification.store'=>$this->verificationStore($request,$at),
            'verification.regressions'=>$this->verificationRegressions($request,$at),
            'vault.export'=>$this->vaultExport($request,$at),
            'vault.import'=>$this->vaultImport($request,$at),
            'mission.status'=>$this->missionStatus(self::text($request,'project',160),$at),
            'mission.acquire'=>$this->missionAcquire($request,$at),
            'mission.renew'=>$this->missionRenew($request,$at),
            'mission.release'=>$this->missionRelease($request,$at),
            'source.promote'=>$this->sourcePromote($request,$at),
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
    private function projectGate(string $selector,string $at,bool $requireSource=false,?string $capability=null,?string $excludeExecutionId=null): array
    {
        $project=$this->resolveProject($selector);
        $id=(string)$project['project_id'];
        $requestedResource=$capability===null?'CANONICAL:PROJECT':HubCapabilityRegistryService::mutationResourceForExecution($capability,'VPS');
        $active=$this->pdo->prepare("SELECT x.execution_id,x.task_id,x.project_id,x.state,x.mutation_scope,x.lease_expires_at,e.state AS execution_state,e.required_capability,e.executor_kind,t.state AS task_state,t.goal,p.name AS project_name FROM control_execution_envelopes x JOIN control_task_executions e ON e.execution_id=x.execution_id JOIN control_tasks t ON t.task_id=x.task_id JOIN projects p ON p.project_id=x.project_id WHERE x.mutation_scope<>'READ' AND x.state='ACTIVE' AND (x.lease_expires_at IS NULL OR x.lease_expires_at>:at) AND e.state NOT IN ('COMPLETED','FAILED','CANCELLED') AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY x.updated_at DESC LIMIT 80");
        $active->execute(['at'=>$at]);$allActiveRows=$active->fetchAll();
        $activeRows=array_values(array_filter($allActiveRows,static fn(array $row):bool=>hash_equals($id,(string)$row['project_id'])));
        $conflictingRows=[];
        foreach($allActiveRows as $row){
            if($excludeExecutionId!==null&&hash_equals($excludeExecutionId,(string)$row['execution_id']))continue;
            $resource=HubCapabilityRegistryService::mutationResourceForExecution((string)$row['required_capability'],(string)$row['executor_kind']);
            if(HubCapabilityRegistryService::mutationResourcesConflictForProjects($requestedResource,$id,$resource,(string)$row['project_id'])){$row['mutation_resource']=$resource;$conflictingRows[]=$row;}
        }
        $running=$this->pdo->prepare("SELECT COUNT(*) FROM control_task_executions e WHERE e.project_id=:project AND e.state IN ('LEASED','RUNNING')");
        $running->execute(['project'=>$id]); $runningCount=(int)$running->fetchColumn();
        $unscoped=$this->pdo->prepare("SELECT COUNT(*) FROM control_task_executions e LEFT JOIN control_execution_envelopes x ON x.execution_id=e.execution_id WHERE e.project_id=:project AND e.state IN ('LEASED','RUNNING') AND x.execution_id IS NULL");
        $unscoped->execute(['project'=>$id]); $unscopedCount=(int)$unscoped->fetchColumn();
        $unscopedGlobal=$this->pdo->prepare("SELECT e.execution_id,e.project_id,e.required_capability,e.executor_kind FROM control_task_executions e LEFT JOIN control_execution_envelopes x ON x.execution_id=e.execution_id WHERE e.state IN ('LEASED','RUNNING') AND x.execution_id IS NULL ORDER BY e.updated_at,e.execution_id LIMIT 80");
        $unscopedGlobal->execute();$unscopedConflictCount=0;
        foreach($unscopedGlobal->fetchAll() as $row){
            if($excludeExecutionId!==null&&hash_equals($excludeExecutionId,(string)$row['execution_id']))continue;
            $resource=HubCapabilityRegistryService::mutationResourceForExecution((string)$row['required_capability'],(string)$row['executor_kind']);
            if(HubCapabilityRegistryService::mutationResourcesConflictForProjects($requestedResource,$id,$resource,(string)$row['project_id']))$unscopedConflictCount++;
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
        $checks=[
            ['key'=>'database','ok'=>$quick==='ok','value'=>$quick,'blocking'=>true],
            ['key'=>'conflicting_mutations','ok'=>count($conflictingRows)===0,'value'=>count($conflictingRows),'blocking'=>true],
            ['key'=>'unscoped_running_mutations','ok'=>$unscopedConflictCount===0,'value'=>$unscopedConflictCount,'blocking'=>true],
            ['key'=>'active_workspace_leases','ok'=>count($workspaceRows)===0,'value'=>count($workspaceRows),'blocking'=>$capability===null],
            ['key'=>'source_authority','ok'=>$sourceReady,'value'=>$authority??'UNSET','blocking'=>$requireSource],
            ['key'=>'vault_sync','ok'=>$vaultReady,'value'=>$sync,'blocking'=>$requireSource&&$authority==='AWH_VAULT'],
        ];
        $hardBlocked=false;
        foreach($checks as $check)if(($check['blocking']??false)===true&&($check['ok']??false)!==true){$hardBlocked=true;break;}
        $productionReady=!$hardBlocked&&$sourceReady&&$vaultReady;
        $attention=!$hardBlocked&&(!$sourceReady||!$vaultReady);
        $ready=!$hardBlocked;
        $state=$hardBlocked?'BLOCKED':($attention?'ATTENTION':'READY');
        return ['schemaVersion'=>1,'state'=>$state,'ready'=>$ready,'productionReady'=>$productionReady,'sourceRequired'=>$requireSource,'requestedMutationResource'=>$requestedResource,'project'=>['projectId'=>$id,'name'=>(string)$project['name'],'type'=>(string)$project['type']],'source'=>['authority'=>$authority,'revision'=>$sourceRevision,'canonicalVaultRevisionId'=>$sourceVault,'activeVaultRevisionId'=>$activeVault,'syncState'=>$sync],'writer'=>['activeMutationCount'=>count($activeRows),'conflictingMutationCount'=>count($conflictingRows),'runningMutationExecutionCount'=>$runningCount,'unscopedRunningMutationExecutionCount'=>$unscopedCount,'waitingMutationCount'=>$waitingCount,'activeWorkspaceLeaseCount'=>count($workspaceRows),'activeMutations'=>array_map(static fn(array $r):array=>['executionId'=>(string)$r['execution_id'],'taskId'=>(string)$r['task_id'],'state'=>(string)$r['state'],'scope'=>(string)$r['mutation_scope'],'resource'=>HubCapabilityRegistryService::mutationResourceForExecution((string)$r['required_capability'],(string)$r['executor_kind']),'capability'=>(string)$r['required_capability'],'leaseExpiresAt'=>$r['lease_expires_at'],'goal'=>(string)$r['goal']],$activeRows),'workspaceLeases'=>array_map(static fn(array $r):array=>['ownerDeviceId'=>(string)$r['owner_device_id'],'checkpointId'=>$r['checkpoint_id'],'leaseExpiresAt'=>$r['lease_expires_at'],'updatedAt'=>(string)$r['updated_at']],$workspaceRows)],'checks'=>$checks,'observedAt'=>$at];
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function vaultExport(array $request,string $at): array
    {
        if(($request['confirmation']??null)!==self::VAULT_EXPORT_CONFIRMATION)throw new HubOperatorBridgeException('Explicit canonical Vault export confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $keys=array_keys($request);sort($keys);if($keys!==['action','confirmation','project','schemaVersion'])throw new HubOperatorBridgeException('Canonical Vault export request is invalid','OPERATOR_REQUEST_INVALID');
        $selector=self::text($request,'project',160);
        $gate=$this->projectGate($selector,$at,true,'artifact.object');
        if(($gate['productionReady']??false)!==true)throw new HubOperatorBridgeException('Project source gate is not ready','OPERATOR_PROJECT_GATE_BLOCKED');
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
        $this->activeProjectMission($missionId,$at,$projectId,true);
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
            if(($document['state']??null)==='COMPLETED'&&($document['result']??null)==='PASS')$this->assertPublicReleaseIdentity($release);
            $bucket='releases/'.$release;$identity=$release;
        }elseif($kind==='verification-incident'){
            $fingerprint=strtolower((string)($document['fingerprint']??''));$regression=(string)($document['regressionId']??'');
            if(preg_match('/^[a-f0-9]{64}$/',$fingerprint)!==1||$regression!=='reg-'.substr($fingerprint,0,12))throw new HubOperatorBridgeException('Verification incident identity is invalid','OPERATOR_REQUEST_INVALID');
            $this->verificationPaths($document['context']['changedPaths']??[]);
            $bucket='incidents/'.$fingerprint;$identity=$fingerprint;
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
        $changed=$this->verificationPaths($request['changedPaths']??[]);$root=$this->verificationRoot(false);$items=[];
        $incidentRoot=$root.'/incidents';if(!is_dir($incidentRoot))return ['schemaVersion'=>1,'regressions'=>[],'count'=>0,'observedAt'=>$at];
        $directories=array_slice(array_values(array_filter(glob($incidentRoot.'/*')?:[],static fn(string $p):bool=>is_dir($p)&&!is_link($p))),0,200);
        foreach($directories as $directory){
            $files=glob($directory.'/*.json')?:[];usort($files,static fn(string $a,string $b):int=>(@filemtime($b)?:0)<=> (@filemtime($a)?:0));$file=$files[0]??null;if(!is_string($file))continue;
            $raw=@file_get_contents($file);if(!is_string($raw)||strlen($raw)>self::MAX_VERIFICATION_DOCUMENT_BYTES+2)continue;
            try{$doc=json_decode($raw,true,32,JSON_THROW_ON_ERROR);}catch(Throwable){continue;}if(!is_array($doc)||($doc['kind']??null)!=='verification-incident')continue;
            try{$paths=$this->verificationPaths($doc['context']['changedPaths']??[]);}catch(HubOperatorBridgeException){continue;}
            if(array_intersect($changed,$paths)===[])continue;$items[]=['regressionId'=>(string)($doc['regressionId']??''),'fingerprint'=>(string)($doc['fingerprint']??''),'code'=>(string)($doc['code']??''),'changedPaths'=>$paths];
            if(count($items)>=50)break;
        }
        return ['schemaVersion'=>1,'regressions'=>$items,'count'=>count($items),'observedAt'=>$at];
    }

    /** @return array<string,mixed> */
    private function missionStatus(string $selector,string $at): array
    {
        $project=$this->resolveProject($selector);$projectId=(string)$project['project_id'];
        $this->reconcileExpiredMissions($projectId,$at);
        $mission=$this->activeProjectMission(null,$at,$projectId,false);
        if($mission===null)return ['schemaVersion'=>1,'state'=>'IDLE','project'=>['projectId'=>$projectId,'name'=>(string)$project['name']],'observedAt'=>$at];
        return ['schemaVersion'=>1,'state'=>'ACTIVE','project'=>['projectId'=>$projectId,'name'=>(string)$project['name']],'mission'=>$this->missionProjection($mission),'observedAt'=>$at];
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function missionAcquire(array $request,string $at): array
    {
        if(($request['confirmation']??null)!==self::MISSION_ACQUIRE_CONFIRMATION)throw new HubOperatorBridgeException('Explicit project mission confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $selector=self::text($request,'project',160);$goal=self::text($request,'goal',500);
        $project=$this->resolveProject($selector);$projectId=(string)$project['project_id'];
        $this->reconcileExpiredMissions($projectId,$at);
        $existing=$this->activeProjectMission(null,$at,$projectId,false);
        if($existing!==null)return ['schemaVersion'=>1,'state'=>'ALREADY_ACTIVE','project'=>['projectId'=>$projectId,'name'=>(string)$project['name']],'mission'=>$this->missionProjection($existing),'observedAt'=>$at];
        $gate=$this->projectGate($selector,$at,false,null);
        if(($gate['ready']??false)!==true)throw new HubOperatorBridgeException('Project already has an active mutation or workspace lease','OPERATOR_PROJECT_GATE_BLOCKED');
        $free=@disk_free_space('/');$total=@disk_total_space('/');
        if(is_float($free)&&$free<1073741824)throw new HubOperatorBridgeException('VPS free space is below the safe mission reserve','OPERATOR_STORAGE_CRITICAL');
        $authority=$this->acquireMutationAuthority($projectId,$goal,self::MISSION_CAPABILITY,['mode'=>'OPERATOR_PROJECT_MISSION','goal'=>$goal,'startedAt'=>$at],$at,self::MISSION_LEASE_SECONDS,self::MISSION_OWNER);
        $mission=$this->activeProjectMission($authority['executionId'],$at,$projectId,true);
        return ['schemaVersion'=>1,'state'=>'ACQUIRED','project'=>['projectId'=>$projectId,'name'=>(string)$project['name']],'mission'=>$this->missionProjection($mission),'storage'=>['freeBytes'=>is_float($free)?(int)$free:null,'totalBytes'=>is_float($total)?(int)$total:null],'observedAt'=>$at];
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function missionRenew(array $request,string $at): array
    {
        $execution=self::text($request,'executionId',36);if(!self::uuidValid($execution))throw new HubOperatorBridgeException('Mission execution id is invalid','OPERATOR_REQUEST_INVALID');
        $mission=$this->activeProjectMission($execution,$at,null,true);$lease=gmdate('c',strtotime($at)+self::MISSION_LEASE_SECONDS);
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $this->pdo->prepare("UPDATE control_task_executions SET lease_expires_at=:lease,updated_at=:at WHERE execution_id=:execution AND state='RUNNING' AND lease_owner=:owner")->execute(['lease'=>$lease,'at'=>$at,'execution'=>$execution,'owner'=>self::MISSION_OWNER]);
            $this->pdo->prepare("UPDATE control_tasks SET lease_expires_at=:lease,updated_at=:at WHERE task_id=:task AND state='RUNNING'")->execute(['lease'=>$lease,'at'=>$at,'task'=>$mission['task_id']]);
            $this->pdo->prepare("UPDATE control_execution_envelopes SET lease_expires_at=:lease,updated_at=:at WHERE execution_id=:execution AND state='ACTIVE'")->execute(['lease'=>$lease,'at'=>$at,'execution'=>$execution]);
            $this->pdo->exec('COMMIT');
        }catch(Throwable $error){try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}throw new HubOperatorBridgeException('Project mission could not be renewed','OPERATOR_MISSION_RENEW_FAILED');}
        $fresh=$this->activeProjectMission($execution,$at,(string)$mission['project_id'],true);
        return ['schemaVersion'=>1,'state'=>'RENEWED','mission'=>$this->missionProjection($fresh),'observedAt'=>$at];
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function missionRelease(array $request,string $at): array
    {
        if(($request['confirmation']??null)!==self::MISSION_RELEASE_CONFIRMATION)throw new HubOperatorBridgeException('Explicit project mission release confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $execution=self::text($request,'executionId',36);if(!self::uuidValid($execution))throw new HubOperatorBridgeException('Mission execution id is invalid','OPERATOR_REQUEST_INVALID');
        $outcome=self::text($request,'outcome',16);if(!in_array($outcome,['success','failure'],true))throw new HubOperatorBridgeException('Mission outcome is invalid','OPERATOR_REQUEST_INVALID');
        $mission=$this->activeProjectMission($execution,$at,null,true);
        $authority=['executionId'=>$execution,'taskId'=>(string)$mission['task_id'],'projectId'=>(string)$mission['project_id'],'leaseExpiresAt'=>(string)$mission['lease_expires_at']];
        $this->releaseMutationAuthority($authority,$outcome==='success',$at);
        return ['schemaVersion'=>1,'state'=>$outcome==='success'?'COMPLETED':'FAILED','executionId'=>$execution,'projectId'=>(string)$mission['project_id'],'observedAt'=>$at];
    }

    private function reconcileExpiredMissions(string $projectId,string $at): void
    {
        if(!self::uuidValid($projectId))return;
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id FROM control_task_executions e WHERE e.project_id=:project AND e.required_capability=:capability AND e.lease_owner=:owner AND e.state='RUNNING' AND e.lease_expires_at IS NOT NULL AND e.lease_expires_at<=:at");
        $q->execute(['project'=>$projectId,'capability'=>self::MISSION_CAPABILITY,'owner'=>self::MISSION_OWNER,'at'=>$at]);$rows=$q->fetchAll();if($rows===[])return;
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            foreach($rows as $row){
                $this->pdo->prepare("UPDATE control_execution_envelopes SET state='RELEASED',lease_expires_at=NULL,updated_at=:at WHERE execution_id=:execution")->execute(['at'=>$at,'execution'=>$row['execution_id']]);
                $this->pdo->prepare("UPDATE control_task_executions SET state='FAILED',lease_owner=NULL,lease_expires_at=NULL,last_error_code='MISSION_LEASE_EXPIRED',updated_at=:at WHERE execution_id=:execution")->execute(['at'=>$at,'execution'=>$row['execution_id']]);
                $this->pdo->prepare("UPDATE control_tasks SET state='FAILED',lease_expires_at=NULL,progress=100,result_summary='Project mission lease expired safely',failure_code='MISSION_LEASE_EXPIRED',updated_at=:at WHERE task_id=:task")->execute(['at'=>$at,'task'=>$row['task_id']]);
            }
            $this->pdo->exec('COMMIT');
        }catch(Throwable $error){try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}throw new HubOperatorBridgeException('Expired project mission could not be reconciled','OPERATOR_MISSION_RECONCILE_FAILED');}
    }

    /** @return array<string,mixed>|null */
    private function activeProjectMission(?string $executionId,string $at,?string $projectId=null,bool $required=true): ?array
    {
        $where=["e.required_capability=:capability","e.lease_owner=:owner","e.state='RUNNING'","x.state='ACTIVE'","(e.lease_expires_at IS NULL OR e.lease_expires_at>:at)","(x.lease_expires_at IS NULL OR x.lease_expires_at>:at)"];
        $params=['capability'=>self::MISSION_CAPABILITY,'owner'=>self::MISSION_OWNER,'at'=>$at];
        if($executionId!==null){$where[]='e.execution_id=:execution';$params['execution']=$executionId;}
        if($projectId!==null){$where[]='e.project_id=:project';$params['project']=$projectId;}
        $q=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.project_id,e.lease_expires_at,e.checkpoint_json,e.updated_at,t.goal,t.progress,x.state AS envelope_state FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id JOIN control_execution_envelopes x ON x.execution_id=e.execution_id WHERE ".implode(' AND ',$where)." ORDER BY e.updated_at DESC LIMIT 1");
        $q->execute($params);$row=$q->fetch();if(is_array($row))return $row;
        if($required)throw new HubOperatorBridgeException('Project mission is not active','OPERATOR_MISSION_NOT_ACTIVE');
        return null;
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function missionProjection(array $row): array
    {
        return ['executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'projectId'=>(string)$row['project_id'],'goal'=>(string)$row['goal'],'state'=>'RUNNING','progress'=>(int)$row['progress'],'leaseExpiresAt'=>$row['lease_expires_at'],'updatedAt'=>(string)$row['updated_at']];
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
        $missionId=is_string($request['missionExecutionId']??null)?trim((string)$request['missionExecutionId']):null;
        if($missionId!==null&&!self::uuidValid($missionId))throw new HubOperatorBridgeException('Project mission id is invalid','OPERATOR_REQUEST_INVALID');
        $mission=$missionId===null?null:$this->activeProjectMission($missionId,$at,$projectId,true);
        $gate=$this->projectGate((string)$config['project'],$at,false,'source.promote',$missionId);if(($gate['ready']??false)!==true)throw new HubOperatorBridgeException('Project mutation gate is blocked','OPERATOR_PROJECT_GATE_BLOCKED');
        $current=trim($this->runGit($repoReal,['rev-parse','refs/heads/main']));if(!hash_equals($expected,self::gitSha($current)))throw new HubOperatorBridgeException('Canonical main moved before source promotion','OPERATOR_SOURCE_BASE_MOVED');
        $heads=$this->runGit($repoReal,['bundle','list-heads',$bundleReal]);$advertised=false;foreach(preg_split('/\r?\n/',$heads)?:[] as $line){$parts=preg_split('/\s+/',trim($line));if(is_array($parts)&&isset($parts[0])&&strtolower((string)$parts[0])===$target){$advertised=true;break;}}
        if(!$advertised)throw new HubOperatorBridgeException('Target revision is not advertised by source bundle','OPERATOR_SOURCE_BUNDLE_NOT_READY');
        $authority=$mission===null?$this->acquireMutationAuthority($projectId,'Fast-forward canonical main '.$repository,'source.promote',['repository'=>$repository,'expectedMainSha'=>$expected,'targetSha'=>$target,'bundleSha256'=>$bundleSha],$at):['executionId'=>(string)$mission['execution_id'],'taskId'=>(string)$mission['task_id'],'projectId'=>$projectId,'leaseExpiresAt'=>(string)$mission['lease_expires_at']];$success=false;$releaseAuthority=$mission===null;
        try{
            $this->runGit($repoReal,['bundle','verify',$bundleReal]);
            $this->runGit($repoReal,['bundle','unbundle',$bundleReal]);
            $this->runGit($repoReal,['cat-file','-e',$target.'^{commit}']);
            if(($config['projection']??false)===true)$this->assertVaultProjectionTarget($repoReal,$target,$gate);
            $ancestor=$this->runGitResult($repoReal,['merge-base','--is-ancestor',$expected,$target]);if($ancestor['code']!==0)throw new HubOperatorBridgeException('Source promotion is not a fast-forward','OPERATOR_SOURCE_NON_FAST_FORWARD');
            $releaseNotes=$this->releaseNotesForPromotion($repoReal,$repository,$expected,$target,$at);
            $before=trim($this->runGit($repoReal,['rev-parse','refs/heads/main']));if(!hash_equals($expected,self::gitSha($before)))throw new HubOperatorBridgeException('Canonical main moved during source promotion','OPERATOR_SOURCE_BASE_MOVED');
            $this->runGit($repoReal,['update-ref','refs/heads/main',$target,$expected]);
            $after=trim($this->runGit($repoReal,['rev-parse','refs/heads/main']));if(!hash_equals($target,self::gitSha($after)))throw new HubOperatorBridgeException('Canonical main did not reach target revision','OPERATOR_SOURCE_PROMOTE_FAILED');
            $audit=null;
            if($mission!==null){
                try{$audit=$this->recordSourcePromotionAudit($projectId,$repository,$expected,$target,$bundleSha,$releaseNotes,$at);}
                catch(Throwable $error){
                    $rollback=$this->runGitResult($repoReal,['update-ref','refs/heads/main',$expected,$target]);
                    if(($rollback['code']??1)!==0)throw new HubOperatorBridgeException('Canonical source moved but promotion audit failed and rollback could not be verified','OPERATOR_SOURCE_PROMOTE_FAILED');
                    throw $error instanceof HubOperatorBridgeException?$error:new HubOperatorBridgeException('Source promotion audit could not be stored','OPERATOR_SOURCE_PROMOTE_FAILED');
                }
            }
            $success=true;return ['schemaVersion'=>1,'state'=>'PROMOTED','repository'=>$repository,'previousMainSha'=>$expected,'mainSha'=>$target,'bundleSha256'=>$bundleSha,'authority'=>['executionId'=>$authority['executionId'],'taskId'=>$authority['taskId'],'leaseExpiresAt'=>$authority['leaseExpiresAt'],'missionReused'=>$mission!==null],'audit'=>$audit,'releaseNotes'=>$releaseNotes,'observedAt'=>$at];
        }finally{if($releaseAuthority)$this->releaseMutationAuthority($authority,$success,gmdate('c'));}
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
        $ready=($gate['productionReady']??false)===true&&($parity['ready']??false)===true;
        return ['schemaVersion'=>1,'state'=>$ready?'READY':'SOURCE_DRIFT','authority'=>'BAY PackageManager/Update Center','remote'=>$remote,'projectGate'=>$gate,'sourceParity'=>$parity,'observedAt'=>$at];
    }

    /** @param array<string,mixed> $remote @return array<string,mixed> */
    private function bayProductionSourceParity(array $remote): array
    {
        $deployed=strtolower(trim((string)($remote['deployedSha']??'')));
        $root=getenv('AWH_CANONICAL_GIT_ROOT');if(!is_string($root)||$root==='')$root='/srv/awh-git';
        $repo=rtrim($root,'/').'/bay-excuse-x.git';
        if(preg_match('/^[a-f0-9]{40}$/',$deployed)!==1||!is_dir($repo)||is_link($repo))return ['ready'=>false,'deployedSha'=>$deployed?:null,'projectionSha'=>null,'sourceRevision'=>null,'reason'=>'UNRESOLVED'];
        try{$projection=strtolower(trim($this->runGit($repo,['rev-parse','refs/heads/main'])));$body=$this->runGit($repo,['show','-s','--format=%B',$projection]);}
        catch(Throwable){return ['ready'=>false,'deployedSha'=>$deployed,'projectionSha'=>null,'sourceRevision'=>null,'reason'=>'PROJECTION_UNAVAILABLE'];}
        $source=null;if(preg_match('/^Source-Revision:\s*([a-f0-9]{40})\s*$/mi',$body,$m)===1)$source=strtolower($m[1]);
        $ready=is_string($source)&&hash_equals($source,$deployed);
        return ['ready'=>$ready,'deployedSha'=>$deployed,'projectionSha'=>$projection,'sourceRevision'=>$source,'reason'=>$ready?'MATCH':'SOURCE_REVISION_DRIFT'];
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
        $gate=$this->projectGate('BAY EXCUSE X',$at,true,'bay.remote_update.stage');if(($gate['ready']??false)!==true||($gate['productionReady']??false)!==true)throw new HubOperatorBridgeException('BAY project gate is blocked','OPERATOR_PROJECT_GATE_BLOCKED');$projectId=(string)($gate['project']['projectId']??'');
        $authority=$this->acquireMutationAuthority($projectId,'Guarded BAY stage '.$version,'bay.remote_update.stage',['targetVersion'=>$version,'targetSha'=>$sha,'packageSha256'=>$packageSha],$at);$success=false;$destination=null;
        try{
            $bay=new HubBayRemoteUpdateService();$statusEnvelope=$bay->status($at);$before=($this->poster)((string)$statusEnvelope['endpoint'],(array)$statusEnvelope['statusRelay']);
            if(($before['ok']??false)!==true||(($before['preflight']['ready']??false)!==true)||(($before['maintenance']['active']??false)===true))throw new HubOperatorBridgeException('BAY Production preflight is not ready','OPERATOR_BAY_PREFLIGHT_BLOCKED');
            $this->assertBayProductionSourceParity($before);
            $current=(string)($before['currentVersion']??'');$deployed=strtolower((string)($before['deployedSha']??''));$from=(string)($manifest['from_version']??'');$base=strtolower((string)($manifest['source_base_commit']??''));
            if($current===''||$from!==$current||version_compare($version,$current,'<=')||preg_match('/^[a-f0-9]{40}$/',$deployed)!==1||$base===''||!hash_equals($deployed,$base))throw new HubOperatorBridgeException('BAY package baseline does not match Production','OPERATOR_BAY_BASELINE_MISMATCH');
            $safeVersion=preg_replace('/[^0-9A-Za-z._+-]+/','-',$version);if(!is_string($safeVersion)||$safeVersion==='')throw new HubOperatorBridgeException('BAY package version is invalid','OPERATOR_REQUEST_INVALID');
            $destination=$inboxReal.'/bay-excuse-x-core-'.$safeVersion.'-'.substr($sha,0,12).'.zip';$tmp=$inboxReal.'/.awh-stage-'.$packageSha.'.tmp';
            if(is_link($destination)||is_dir($destination)||file_exists($tmp)||is_link($tmp))throw new HubOperatorBridgeException('BAY Update Inbox destination is not clean','OPERATOR_BAY_STAGE_CONFLICT');
            $input=@fopen($sourceReal,'rb');$output=@fopen($tmp,'xb');if(!is_resource($input)||!is_resource($output)){if(is_resource($input))fclose($input);if(is_resource($output))fclose($output);@unlink($tmp);throw new HubOperatorBridgeException('BAY package could not be staged','OPERATOR_BAY_STAGE_UNAVAILABLE');}
            $copied=stream_copy_to_stream($input,$output,self::MAX_BAY_PACKAGE_BYTES+1);@fflush($output);if(function_exists('fsync'))@fsync($output);fclose($input);fclose($output);
            if(!is_int($copied)||$copied!==$size||!@chmod($tmp,0640)||!hash_equals($packageSha,(string)hash_file('sha256',$tmp))||!@rename($tmp,$destination)){@unlink($tmp);@unlink($destination);throw new HubOperatorBridgeException('BAY package staging verification failed','OPERATOR_BAY_STAGE_FAILED');}
            $afterEnvelope=$bay->status(gmdate('c'));$after=($this->poster)((string)$afterEnvelope['endpoint'],(array)$afterEnvelope['statusRelay']);$matched=false;
            foreach((array)($after['packages']??[]) as $row){if(is_array($row)&&($row['version']??null)===$version&&strtolower((string)($row['sourceSha']??''))===$sha&&strtolower((string)($row['packageSha256']??''))===$packageSha&&($row['installable']??false)===true){$matched=true;break;}}
            if(!$matched){@unlink($destination);$destination=null;throw new HubOperatorBridgeException('BAY Update Inbox did not accept exact package','OPERATOR_BAY_PACKAGE_NOT_READY');}
            $success=true;return ['schemaVersion'=>1,'state'=>'STAGED','gate'=>$gate,'authority'=>['executionId'=>$authority['executionId'],'taskId'=>$authority['taskId'],'leaseExpiresAt'=>$authority['leaseExpiresAt']],'package'=>['filename'=>basename($destination),'version'=>$version,'sourceSha'=>$sha,'packageSha256'=>$packageSha,'sizeBytes'=>$size],'before'=>['version'=>$current,'deployedSha'=>$deployed],'observedAt'=>$at];
        }finally{if(!$success&&is_string($destination)&&is_file($destination))@unlink($destination);$this->releaseMutationAuthority($authority,$success,gmdate('c'));}
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function bayInstall(array $request,string $at): array
    {
        if (($request['confirmation']??null)!==self::INSTALL_CONFIRMATION) throw new HubOperatorBridgeException('Explicit BAY install confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $version=self::text($request,'targetVersion',80); $sha=strtolower(self::text($request,'targetSha',40)); $packageSha=strtolower(self::text($request,'packageSha256',64));
        if(preg_match('/^[a-f0-9]{40}$/',$sha)!==1||preg_match('/^[a-f0-9]{64}$/',$packageSha)!==1)throw new HubOperatorBridgeException('BAY package identity is invalid','OPERATOR_REQUEST_INVALID');
        $gate=$this->projectGate('BAY EXCUSE X',$at,true,'bay.remote_update.install'); if (($gate['ready']??false)!==true || ($gate['productionReady']??false)!==true) throw new HubOperatorBridgeException('BAY project gate is blocked','OPERATOR_PROJECT_GATE_BLOCKED');
        $projectId=(string)($gate['project']['projectId']??'');
        $authority=$this->acquireMutationAuthority($projectId,'Guarded BAY install '.$version,'bay.remote_update.install',['targetVersion'=>$version,'targetSha'=>$sha,'packageSha256'=>$packageSha],$at);
        $success=false;
        try {
            $bay=new HubBayRemoteUpdateService(); $statusEnvelope=$bay->status($at); $before=($this->poster)((string)$statusEnvelope['endpoint'],(array)$statusEnvelope['statusRelay']);
            if (($before['ok']??false)!==true || (($before['preflight']['ready']??false)!==true) || (($before['maintenance']['active']??false)===true)) throw new HubOperatorBridgeException('BAY Production preflight is not ready','OPERATOR_BAY_PREFLIGHT_BLOCKED');
            $this->assertBayProductionSourceParity($before);
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

    /** @return array{executionId:string,taskId:string} */
    private function recordSourcePromotionAudit(string $projectId,string $repository,string $expected,string $target,string $bundleSha,array $releaseNotes,string $at): array
    {
        $taskId=self::uuid();$executionId=self::uuid();
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $owner=$this->pdo->query("SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id=1 AND bootstrap_closed=1")->fetchColumn();
            if(!is_string($owner)||!self::uuidValid($owner))throw new HubOperatorBridgeException('Owner authority is unavailable','OPERATOR_OWNER_UNAVAILABLE');
            $revision=null;$q=$this->pdo->prepare('SELECT active_revision_id FROM control_project_vaults WHERE project_id=:project');$q->execute(['project'=>$projectId]);$v=$q->fetchColumn();if(is_string($v)&&self::uuidValid($v))$revision=$v;
            $checkpoint=['repository'=>$repository,'expectedMainSha'=>$expected,'targetSha'=>$target,'bundleSha256'=>$bundleSha,'releaseNotes'=>$releaseNotes];
            $key='source-promotion-audit-'.substr(hash('sha256',$executionId),0,40);
            $summary='Canonical source promotion completed under durable project mission';
            $this->pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,:goal,'COMPLETED',NULL,NULL,100,:summary,NULL,:key,NULL,:at,:at,NULL)")
                ->execute(['task'=>$taskId,'user'=>$owner,'project'=>$projectId,'goal'=>'Audit canonical source promotion '.$repository.' '.substr($target,0,12),'summary'=>$summary,'key'=>$key,'at'=>$at]);
            $this->pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,:revision,'VPS','source.promote','COMPLETED',NULL,NULL,1,NULL,:checkpoint,NULL,:at,:at)")
                ->execute(['execution'=>$executionId,'task'=>$taskId,'project'=>$projectId,'revision'=>$revision,'checkpoint'=>json_encode($checkpoint,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'at'=>$at]);
            $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:id,:task,'COMPLETED',100,:message,:at)")
                ->execute(['id'=>self::uuid(),'task'=>$taskId,'message'=>$summary,'at'=>$at]);
            $this->pdo->exec('COMMIT');
            return ['executionId'=>$executionId,'taskId'=>$taskId];
        }catch(Throwable $error){try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}if($error instanceof HubOperatorBridgeException)throw $error;throw new HubOperatorBridgeException('Source promotion audit could not be stored','OPERATOR_SOURCE_PROMOTE_FAILED');}
    }

    /** @param array<string,mixed> $checkpoint @return array{executionId:string,taskId:string,projectId:string,leaseExpiresAt:string} */
    private function acquireMutationAuthority(string $projectId,string $goal,string $capability,array $checkpoint,string $at,int $leaseSeconds=300,string $leaseOwner='operator-bridge'): array
    {
        if(!self::uuidValid($projectId)||preg_match('/^[a-z][a-z0-9:._-]{1,63}$/',$capability)!==1)throw new HubOperatorBridgeException('Mutation authority request is invalid','OPERATOR_REQUEST_INVALID');
        if($leaseSeconds<60||$leaseSeconds>14400||preg_match('/^[a-z][a-z0-9-]{2,31}$/',$leaseOwner)!==1)throw new HubOperatorBridgeException('Mutation lease request is invalid','OPERATOR_REQUEST_INVALID');
        $lease=gmdate('c',strtotime($at)+$leaseSeconds); $taskId=self::uuid(); $executionId=self::uuid();
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
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
            return ['executionId'=>$executionId,'taskId'=>$taskId,'projectId'=>$projectId,'leaseExpiresAt'=>$lease];
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
        foreach(preg_split('/
?
/',$log)?:[] as $line){
            if($line==='')continue;
            $parts=explode("	",$line,2);if(count($parts)!==2)continue;
            $sha=strtolower(trim($parts[0]));$subject=trim($parts[1]);
            if(preg_match('/^[a-f0-9]{40}$/',$sha)!==1||$subject===''||strlen($subject)>220)continue;
            $category='improvements';
            if(preg_match('/^feat(?:([^)]{1,50}))?!?:s*/i',$subject))$category='features';
            elseif(preg_match('/^fix(?:([^)]{1,50}))?!?:s*/i',$subject))$category='fixes';
            elseif(preg_match('/^(?:chore|docs|test|ci|build)(?:([^)]{1,50}))?!?:s*/i',$subject))$category='internal';
            elseif(preg_match('/^(?:perf|refactor|style)(?:([^)]{1,50}))?!?:s*/i',$subject))$category='improvements';
            $label=preg_replace('/^[a-z]+(?:([^)]{1,50}))?!?:s*/i','',$subject)?:$subject;
            $label=mb_substr(trim($label),0,180,'UTF-8');
            if(count($groups[$category])<12)$groups[$category][]=$label;
            if(count($commits)<40)$commits[]=['sha'=>$sha,'category'=>$category,'subject'=>$label];
        }
        $paths=array_values(array_filter(preg_split('/
?
/',$this->runGit($repo,['diff','--name-only',$expected,$target]))?:[],static fn(string $v):bool=>$v!==''));
        $paths=array_slice($paths,0,240);
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
        return [
            'schemaVersion'=>1,'repository'=>$repository,'previousSha'=>$expected,'targetSha'=>$target,'generatedAt'=>$at,
            'summary'=>$groups,'commits'=>$commits,'changedFileCount'=>count($paths),
            'impact'=>[
                'databaseMigration'=>$hasMigration?'AUTOMATIC':'NONE',
                'serviceReload'=>$hasService?'AUTOMATIC':'NONE',
                'appRestart'=>$desktop?'MAY_BE_REQUIRED':'NONE',
                'signIn'=>$auth?'MAY_BE_REQUIRED':'NONE',
                'plannedDowntime'=>false,
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
