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
    private const STAGE_CONFIRMATION='STAGE_BAY_UPDATE';
    private const MAX_BAY_PACKAGE_BYTES=9437184;
    private const VERIFICATION_CONFIRMATION='STORE_VERIFICATION_EVIDENCE';
    private const MAX_VERIFICATION_DOCUMENT_BYTES=196608;
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
        return ['schemaVersion'=>1,'state'=>'READY','authority'=>'BAY PackageManager/Update Center','remote'=>$remote,'projectGate'=>$this->projectGate('BAY EXCUSE X',$at),'observedAt'=>$at];
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private function bayStage(array $request,string $at): array
    {
        if (($request['confirmation']??null)!==self::STAGE_CONFIRMATION) throw new HubOperatorBridgeException('Explicit BAY stage confirmation is required','OPERATOR_CONFIRMATION_REQUIRED');
        $version=self::text($request,'targetVersion',80); $sha=strtolower(self::text($request,'targetSha',40)); $packageSha=strtolower(self::text($request,'packageSha256',64)); $stagedFile=self::text($request,'stagedFile',96);
        if(preg_match('/^[0-9A-Za-z][0-9A-Za-z._+-]*$/',$version)!==1||preg_match('/^[a-f0-9]{40}$/',$sha)!==1||preg_match('/^[a-f0-9]{64}$/',$packageSha)!==1||$stagedFile!==$packageSha.'.zip')throw new HubOperatorBridgeException('BAY package identity is invalid','OPERATOR_REQUEST_INVALID');
        $stageRoot=getenv('AWH_OPERATOR_STAGE_ROOT');if(!is_string($stageRoot)||$stageRoot==='')$stageRoot='/var/lib/awh-operator-staging';
        $inbox=getenv('AWH_BAY_UPDATE_INBOX');if(!is_string($inbox)||$inbox==='')$inbox='/var/www/bay-staging/current/updates/incoming';
        $stageReal=realpath($stageRoot);$inboxReal=realpath($inbox);if(!is_string($stageReal)||!is_dir($stageReal)||is_link($stageRoot)||!is_string($inboxReal)||!is_dir($inboxReal)||is_link($inbox))throw new HubOperatorBridgeException('BAY staging paths are unavailable','OPERATOR_BAY_STAGE_UNAVAILABLE');
        $source=$stageReal.'/'.$stagedFile;$sourceReal=realpath($source);if(!is_string($sourceReal)||dirname($sourceReal)!==$stageReal||is_link($source)||!is_file($sourceReal)||!is_readable($sourceReal))throw new HubOperatorBridgeException('Staged BAY package is unavailable','OPERATOR_BAY_PACKAGE_NOT_READY');
        $size=@filesize($sourceReal);if(!is_int($size)||$size<1||$size>self::MAX_BAY_PACKAGE_BYTES)throw new HubOperatorBridgeException('Staged BAY package exceeds the safe limit','OPERATOR_BAY_PACKAGE_NOT_READY');
        $actual=hash_file('sha256',$sourceReal);if(!is_string($actual)||!hash_equals($packageSha,$actual))throw new HubOperatorBridgeException('Staged BAY package checksum mismatch','OPERATOR_BAY_PACKAGE_NOT_READY');
        if(!class_exists('ZipArchive'))throw new HubOperatorBridgeException('ZIP runtime is unavailable','OPERATOR_BAY_STAGE_UNAVAILABLE');
        $zip=new ZipArchive();if($zip->open($sourceReal,ZipArchive::RDONLY|ZipArchive::CHECKCONS)!==true)throw new HubOperatorBridgeException('Staged BAY package is invalid','OPERATOR_BAY_PACKAGE_NOT_READY');
        try{$raw=$zip->getFromName('manifest.json');if(!is_string($raw))throw new HubOperatorBridgeException('Staged BAY manifest is missing','OPERATOR_BAY_PACKAGE_NOT_READY');$manifest=json_decode($raw,true,32,JSON_THROW_ON_ERROR);}catch(HubOperatorBridgeException $e){$zip->close();throw $e;}catch(Throwable){$zip->close();throw new HubOperatorBridgeException('Staged BAY manifest is invalid','OPERATOR_BAY_PACKAGE_NOT_READY');}$zip->close();
        if(!is_array($manifest)||($manifest['type']??null)!=='core'||($manifest['version']??null)!==$version||strtolower((string)($manifest['source_commit']??''))!==$sha)throw new HubOperatorBridgeException('Staged BAY manifest identity mismatch','OPERATOR_BAY_PACKAGE_NOT_READY');
        $gate=$this->projectGate('BAY EXCUSE X',$at);if(($gate['ready']??false)!==true)throw new HubOperatorBridgeException('BAY project gate is blocked','OPERATOR_PROJECT_GATE_BLOCKED');$projectId=(string)($gate['project']['projectId']??'');
        $authority=$this->acquireMutationAuthority($projectId,'Guarded BAY stage '.$version,'bay.remote_update.stage',['targetVersion'=>$version,'targetSha'=>$sha,'packageSha256'=>$packageSha],$at);$success=false;$destination=null;
        try{
            $bay=new HubBayRemoteUpdateService();$statusEnvelope=$bay->status($at);$before=($this->poster)((string)$statusEnvelope['endpoint'],(array)$statusEnvelope['statusRelay']);
            if(($before['ok']??false)!==true||(($before['preflight']['ready']??false)!==true)||(($before['maintenance']['active']??false)===true))throw new HubOperatorBridgeException('BAY Production preflight is not ready','OPERATOR_BAY_PREFLIGHT_BLOCKED');
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
            // Repeat the mutation check under BEGIN IMMEDIATE so a writer that
            // appears between the read-only gate and authority acquisition is
            // still rejected. Missing envelopes are treated as mutating, never
            // as permission to bypass the single-writer authority.
            $running=$this->pdo->prepare("SELECT e.execution_id FROM control_task_executions e LEFT JOIN control_execution_envelopes x ON x.execution_id=e.execution_id WHERE e.project_id=:project AND e.state IN ('LEASED','RUNNING') AND COALESCE(x.mutation_scope,'PROJECT_CANDIDATE')<>'READ' LIMIT 1");
            $running->execute(['project'=>$projectId]);
            if($running->fetchColumn()!==false)throw new HubOperatorBridgeException('A mutating execution currently owns this project','OPERATOR_PROJECT_GATE_BLOCKED');
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
        }catch(Throwable $error){try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}if($error instanceof HubOperatorBridgeException)throw $error;throw new HubOperatorBridgeException('Mutation authority could not be acquired','OPERATOR_AUTHORITY_FAILED');}
    }

    /** @param array{executionId:string,taskId:string,projectId:string,leaseExpiresAt:string} $authority */
    private function releaseMutationAuthority(array $authority,bool $success,string $at): void
    {
        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            (new HubCapabilityRegistryService($this->pdo))->updateEnvelopeState($authority['executionId'],'RELEASED',null,$at);
            $state=$success?'COMPLETED':'FAILED';$summary=$success?'Guarded BAY operator mutation completed':'Guarded BAY operator mutation failed and released authority';$error=$success?null:'OPERATOR_BAY_INSTALL_FAILED';
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
