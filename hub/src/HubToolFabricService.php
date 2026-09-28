<?php

declare(strict_types=1);

final class HubToolFabricException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='TOOL_FABRIC_FAILED') { parent::__construct($message); }
}

final class HubToolFabricService
{
    private const CAPABILITY='/^[a-z][a-z0-9:._-]{0,63}$/';
    private const REPOSITORY='/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/';
    private const SHA='/^[0-9a-f]{40}$/';
    private const SOURCE_PREFIX='tool.';
    private const DISCOVERY_INTERVAL=86400;
    /** @var null|callable(string):?string */
    private $resolver;

    public function __construct(private readonly PDO $pdo, private readonly string $root, ?callable $resolver=null)
    {
        $this->resolver=$resolver;
    }

    public static function fromEnvironment(PDO $pdo): self
    {
        return new self($pdo, dirname(__DIR__,2));
    }

    /** @return array<string,mixed> */
    private function registry(): array
    {
        $path=$this->root.'/config/external-capabilities.json';
        $raw=@file_get_contents($path);
        if(!is_string($raw)||strlen($raw)>1024*1024) throw new HubToolFabricException('Tool Fabric registry is unavailable','TOOL_FABRIC_REGISTRY_INVALID');
        try{$value=json_decode($raw,true,64,JSON_THROW_ON_ERROR);}catch(Throwable){throw new HubToolFabricException('Tool Fabric registry is invalid','TOOL_FABRIC_REGISTRY_INVALID');}
        if(!is_array($value)||($value['schemaVersion']??null)!==1||($value['registryId']??null)!=='awh.external-capabilities.v1'||($value['controlPlaneAuthority']??null)!=='AWH'||!is_array($value['entries']??null)||count($value['entries'])>64) throw new HubToolFabricException('Tool Fabric registry authority is invalid','TOOL_FABRIC_REGISTRY_INVALID');
        return $value;
    }

    /** @return array<string,array<string,mixed>> */
    private function entriesByCapability(): array
    {
        $out=[];
        foreach($this->registry()['entries'] as $entry){
            if(!is_array($entry)||!is_string($entry['capability']??null)||preg_match(self::CAPABILITY,(string)$entry['capability'])!==1||!is_string($entry['repository']??null)||preg_match(self::REPOSITORY,(string)$entry['repository'])!==1||!is_string($entry['revision']??null)||preg_match(self::SHA,(string)$entry['revision'])!==1) throw new HubToolFabricException('Tool Fabric source entry is invalid','TOOL_FABRIC_REGISTRY_INVALID');
            $cap=(string)$entry['capability']; if(isset($out[$cap])) throw new HubToolFabricException('Tool Fabric capability is duplicated','TOOL_FABRIC_REGISTRY_INVALID'); $out[$cap]=$entry;
        }
        return $out;
    }

    private static function sourceId(array $entry): string
    {
        $id=is_string($entry['id']??null)?(string)$entry['id']:'';
        if(!preg_match('/^[a-z][a-z0-9._-]{1,63}$/',$id)) throw new HubToolFabricException('Tool Fabric provider id is invalid','TOOL_FABRIC_REGISTRY_INVALID');
        return self::SOURCE_PREFIX.$id;
    }

    /** @return array<string,mixed> */
    private static function metadata(array $entry, array $existing=[]): array
    {
        return $existing+[
            'capability'=>(string)$entry['capability'],
            'providerId'=>(string)$entry['id'],
            'integrationMode'=>(string)($entry['integrationMode']??'REFERENCE_CORPUS'),
            'runtimeKind'=>(string)($entry['runtimeKind']??'REFERENCE'),
            'installPolicy'=>(string)($entry['installPolicy']??'REFERENCE_ONLY'),
            'networkPolicy'=>(string)($entry['networkPolicy']??'NONE'),
            'lifecycleState'=>(string)($entry['lifecycleState']??'DISCOVERED'),
            'pinnedRevision'=>(string)$entry['revision'],
            'disabled'=>false,
        ];
    }

    public function syncCatalog(?string $now=null): array
    {
        $at=$this->timestamp($now??gmdate('c')); $entries=$this->entriesByCapability();
        $select=$this->pdo->prepare('SELECT observed_at,metadata_json FROM control_capability_sources WHERE source_id=:id');
        $insert=$this->pdo->prepare("INSERT INTO control_capability_sources(source_id,source_kind,display_name,source_uri,version,license_id,enabled,observed_at,metadata_json) VALUES(:id,'UPSTREAM',:name,:uri,:version,:license,1,:observed,:meta) ON CONFLICT(source_id) DO UPDATE SET display_name=excluded.display_name,source_uri=excluded.source_uri,version=excluded.version,license_id=excluded.license_id,metadata_json=excluded.metadata_json");
        $count=0;
        foreach($entries as $entry){
            $id=self::sourceId($entry); $select->execute(['id'=>$id]); $row=$select->fetch();
            $existing=[]; $observed='1970-01-01T00:00:00+00:00';
            if(is_array($row)){
                $observed=is_string($row['observed_at']??null)?(string)$row['observed_at']:$observed;
                try{$decoded=json_decode((string)($row['metadata_json']??'{}'),true,32,JSON_THROW_ON_ERROR);if(is_array($decoded))$existing=$decoded;}catch(Throwable){}
            }
            $static=self::metadata($entry,[]);
            foreach(['lifecycleState','upstreamRevision','updateAvailable','lastDiscoveryAt','discoveryState','previewRevision','stableRevision','previousStableRevision','stableProvision','previousStableProvision','qaRevision','qaState','licenseState','integrityState','smokeState','capabilityContractState','regressionState','mcpQaState','rollbackState','lastQaAt','lastLifecycleAction','lastLifecycleAt','intakeState','intakeRevision','rejectedRevision','disabled'] as $key) if(array_key_exists($key,$existing)) $static[$key]=$existing[$key];
            $meta=json_encode($static,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
            $insert->execute(['id'=>$id,'name'=>(string)$entry['displayName'],'uri'=>'https://github.com/'.(string)$entry['repository'],'version'=>(string)$entry['revision'],'license'=>(string)$entry['license'],'observed'=>$observed,'meta'=>$meta]); $count++;
        }
        return ['schemaVersion'=>1,'state'=>'SYNCED','count'=>$count];
    }

    public function discoverDue(?string $now=null, int $limit=2): array
    {
        $at=$this->timestamp($now??gmdate('c')); if($limit<1||$limit>4) throw new HubToolFabricException('Tool discovery limit is invalid','TOOL_FABRIC_DISCOVERY_INVALID');
        $this->syncCatalog($at); $entries=$this->entriesByCapability(); $bySource=[]; foreach($entries as $entry)$bySource[self::sourceId($entry)]=$entry;
        $cutoff=gmdate('c',(strtotime($at)?:time())-self::DISCOVERY_INTERVAL);
        $q=$this->pdo->prepare("SELECT source_id,metadata_json FROM control_capability_sources WHERE source_id LIKE 'tool.%' AND observed_at<=:cutoff ORDER BY observed_at,source_id LIMIT :limit");
        $q->bindValue(':cutoff',$cutoff,PDO::PARAM_STR);$q->bindValue(':limit',$limit,PDO::PARAM_INT);$q->execute();
        $update=$this->pdo->prepare('UPDATE control_capability_sources SET observed_at=:at,metadata_json=:meta WHERE source_id=:id');
        $items=[];
        foreach($q->fetchAll() as $row){
            $id=(string)$row['source_id'];$entry=$bySource[$id]??null;if(!is_array($entry))continue;
            try{$meta=json_decode((string)$row['metadata_json'],true,32,JSON_THROW_ON_ERROR);}catch(Throwable){$meta=[];}if(!is_array($meta))$meta=[];
            $head=$this->resolveHead((string)$entry['repository']);
            $meta['lastDiscoveryAt']=$at;$meta['discoveryState']=$head===null?'UNAVAILABLE':'OBSERVED';
            if($head!==null){
                $previousObserved=is_string($meta['upstreamRevision']??null)?(string)$meta['upstreamRevision']:null;
                $baseline=is_string($meta['stableRevision']??null)?(string)$meta['stableRevision']:(string)$entry['revision'];
                $changed=!hash_equals($baseline,$head);
                $meta['upstreamRevision']=$head;$meta['updateAvailable']=$changed;
                $state=is_string($meta['lifecycleState']??null)?(string)$meta['lifecycleState']:(string)($entry['lifecycleState']??'DISCOVERED');
                $stable=is_string($meta['stableRevision']??null)?(string)$meta['stableRevision']:($state==='STABLE'?(string)$entry['revision']:null);
                if($changed){
                    $candidateChanged=!is_string($meta['intakeRevision']??null)||!hash_equals((string)$meta['intakeRevision'],$head);
                    if($candidateChanged){
                        $meta['intakeRevision']=$head;
                        $meta['intakeState']=is_string($meta['rejectedRevision']??null)&&hash_equals((string)$meta['rejectedRevision'],$head)?'REJECTED':'DISCOVERED';
                        $meta['previewRevision']=null;
                        foreach(['qaRevision','qaState','licenseState','integrityState','smokeState','capabilityContractState','regressionState','mcpQaState','rollbackState','lastQaAt'] as $key)unset($meta[$key]);
                    }
                    if($stable!==null)$meta['lifecycleState']='STABLE';
                }else{
                    $meta['intakeState']=null;$meta['intakeRevision']=null;$meta['previewRevision']=null;
                }
            }
            $update->execute(['at'=>$at,'meta'=>json_encode($meta,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'id'=>$id]);
            $items[]=['capability'=>(string)$entry['capability'],'state'=>$meta['discoveryState'],'upstreamRevision'=>$head,'updateAvailable'=>(bool)($meta['updateAvailable']??false)];
        }
        return ['schemaVersion'=>1,'authority'=>'AWH_UPDATE_CENTER','mutatedRuntime'=>false,'checked'=>count($items),'items'=>$items];
    }

    private function resolveHead(string $repository): ?string
    {
        if($this->resolver!==null){$value=($this->resolver)($repository);return is_string($value)&&preg_match(self::SHA,$value)===1?strtolower($value):null;}
        if(preg_match(self::REPOSITORY,$repository)!==1)return null;
        $cmd=['/usr/bin/timeout','--signal=TERM','5','/usr/bin/git','ls-remote','https://github.com/'.$repository.'.git','HEAD'];
        $proc=@proc_open($cmd,[0=>['file','/dev/null','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes,null,['LC_ALL'=>'C','PATH'=>'/usr/bin:/bin'],['bypass_shell'=>true]);
        if(!is_resource($proc))return null;$out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);$code=proc_close($proc);
        if($code!==0||!is_string($out)||preg_match('/^([0-9a-f]{40})\s+HEAD\s*$/mi',$out,$m)!==1)return null;return strtolower($m[1]);
    }

    public function snapshot(?string $now=null): array
    {
        $at=$this->timestamp($now??gmdate('c'));$this->syncCatalog($at);$entries=$this->entriesByCapability();
        $source=$this->pdo->prepare('SELECT enabled,observed_at,metadata_json FROM control_capability_sources WHERE source_id=:id');
        $installed=$this->pdo->prepare("SELECT COUNT(DISTINCT p.provider_id) FROM control_execution_provider_capabilities pc JOIN control_execution_providers p ON p.provider_id=pc.provider_id WHERE pc.capability=:cap AND pc.enabled=1 AND p.enabled=1 AND p.provider_kind='DEVICE' AND (p.expires_at IS NULL OR p.expires_at>:at) AND (pc.expires_at IS NULL OR pc.expires_at>:at)");
        $items=[];
        foreach($entries as $cap=>$entry){
            $source->execute(['id'=>self::sourceId($entry)]);$row=$source->fetch();$meta=[];
            if(is_array($row)){try{$decoded=json_decode((string)$row['metadata_json'],true,32,JSON_THROW_ON_ERROR);if(is_array($decoded))$meta=$decoded;}catch(Throwable){}}
            $installed->execute(['cap'=>$cap,'at'=>$at]);$count=(int)$installed->fetchColumn();
            $state=is_string($meta['lifecycleState']??null)?(string)$meta['lifecycleState']:(string)($entry['lifecycleState']??'DISCOVERED');
            $disabled=(bool)($meta['disabled']??false)||($row!==false&&(int)($row['enabled']??1)!==1);
            $update=(bool)($meta['updateAvailable']??false);
            $intake=is_string($meta['intakeState']??null)?(string)$meta['intakeState']:null;$stableRevision=is_string($meta['stableRevision']??null)?(string)$meta['stableRevision']:($state==='STABLE'?(string)$entry['revision']:null);$stableProvision=is_array($meta['stableProvision']??null)?$meta['stableProvision']:(is_array($entry['provision']??null)&&$stableRevision!==null&&is_string($entry['provision']['revision']??null)&&hash_equals($stableRevision,(string)$entry['provision']['revision'])?$entry['provision']:null);$provisionable=$state==='STABLE'&&!$disabled&&is_array($stableProvision);$health=$disabled?'DISABLED':($intake==='PREVIEW'?'PREVIEW':($update?'UPDATE_AVAILABLE':($state==='STABLE'?($count>0?'READY':'STABLE_NOT_INSTALLED'):($state==='PREVIEW'?'PREVIEW':'CATALOG_ONLY'))));
            $items[]=[
                'capability'=>$cap,'providerId'=>(string)$entry['id'],'provider'=>(string)$entry['displayName'],'repository'=>(string)$entry['repository'],
                'runtimeKind'=>(string)($entry['runtimeKind']??'REFERENCE'),'integrationMode'=>(string)$entry['integrationMode'],'installPolicy'=>(string)($entry['installPolicy']??'REFERENCE_ONLY'),
                'lifecycleState'=>$state,'intakeState'=>is_string($meta['intakeState']??null)?$meta['intakeState']:null,'intakeRevision'=>is_string($meta['intakeRevision']??null)?$meta['intakeRevision']:null,
                'installedOnDevices'=>$count,'pinnedRevision'=>(string)$entry['revision'],'upstreamRevision'=>is_string($meta['upstreamRevision']??null)?$meta['upstreamRevision']:null,
                'stableRevision'=>$stableRevision,
                'previewRevision'=>is_string($meta['previewRevision']??null)?$meta['previewRevision']:null,'rollbackRevision'=>is_string($meta['previousStableRevision']??null)?$meta['previousStableRevision']:null,
                'updateAvailable'=>$update,'health'=>$health,'license'=>(string)$entry['license'],'lastDiscoveryAt'=>is_string($meta['lastDiscoveryAt']??null)?$meta['lastDiscoveryAt']:null,
                'lastQa'=>is_string($meta['qaState']??null)?['state'=>$meta['qaState'],'revision'=>$meta['qaRevision']??null]:null,'provisionable'=>$provisionable,'provisionVersion'=>$provisionable&&is_string($stableProvision['version']??null)?$stableProvision['version']:null,'disabled'=>$disabled,
            ];
        }
        usort($items,static fn(array $a,array $b):int=>strcmp((string)$a['capability'],(string)$b['capability']));
        return ['schemaVersion'=>1,'authority'=>'AWH_UPDATE_CENTER','policy'=>'awh.tool-fabric.update.v1','items'=>$items];
    }

    /** Safe worker-facing desired runtime catalog. It never includes credentials. */
    public function provisionCatalog(string $platform,string $arch,?string $now=null): array
    {
        $platform=strtolower(trim($platform));$arch=strtolower(trim($arch));
        $target=match($platform){
            'darwin'=>$arch==='arm64'?'darwin-arm64':($arch==='x64'?'darwin-x64':null),
            'win32'=>$arch==='x64'?'windows-x64':null,
            'linux'=>$arch==='x64'?'linux-x64':null,
            default=>null,
        };
        if($target===null) return ['schemaVersion'=>1,'authority'=>'AWH_UPDATE_CENTER','items'=>[]];
        $at=$this->timestamp($now??gmdate('c'));$this->syncCatalog($at);$entries=$this->entriesByCapability();$items=[];
        foreach($entries as $capability=>$entry){
            [$row,$meta]=$this->sourceMeta($entry);
            $state=(string)($meta['lifecycleState']??$entry['lifecycleState']??'DISCOVERED');
            $disabled=(bool)($meta['disabled']??false)||((int)($row['enabled']??1)!==1);
            $stable=is_string($meta['stableRevision']??null)?(string)$meta['stableRevision']:($state==='STABLE'?(string)$entry['revision']:null);
            if($state!=='STABLE'||$disabled||$stable===null)continue;
            $provision=is_array($meta['stableProvision']??null)?$meta['stableProvision']:(is_array($entry['provision']??null)?$entry['provision']:null);
            if(!is_array($provision)||!is_string($provision['revision']??null)||!hash_equals($stable,(string)$provision['revision']))continue;
            $kind=(string)($provision['kind']??'');
            if($kind==='GITHUB_RELEASE_BINARY'){
                $artifacts=is_array($provision['artifacts']??null)?$provision['artifacts']:[];$artifact=$artifacts[$target]??null;
                if(!is_array($artifact)||!is_string($artifact['url']??null)||!is_string($artifact['sha256']??null)||!is_string($artifact['archive']??null))continue;
                $items[]=[
                    'capability'=>$capability,'providerId'=>(string)$entry['id'],'runtimeKind'=>(string)($entry['runtimeKind']??'MCP'),
                    'revision'=>$stable,'version'=>(string)($provision['version']??''),'provisionKind'=>$kind,'target'=>$target,
                    'artifact'=>['url'=>(string)$artifact['url'],'sha256'=>(string)$artifact['sha256'],'archive'=>(string)$artifact['archive']],
                    'executable'=>(string)($provision['executable']??''),'args'=>array_values(array_filter(is_array($provision['args']??null)?$provision['args']:[],'is_string')),
                    'authProviderId'=>is_string($provision['authProviderId']??null)?$provision['authProviderId']:null,
                    'credentialEnv'=>is_string($provision['credentialEnv']??null)?$provision['credentialEnv']:null,
                    'networkPolicy'=>(string)($entry['networkPolicy']??'NONE'),'license'=>(string)$entry['license'],
                ];
            }elseif($kind==='NPM_CLI'){
                $items[]=[
                    'capability'=>$capability,'providerId'=>(string)$entry['id'],'runtimeKind'=>(string)($entry['runtimeKind']??'CLI'),
                    'revision'=>$stable,'version'=>(string)($provision['version']??''),'provisionKind'=>$kind,'target'=>$target,
                    'packageName'=>(string)($provision['packageName']??''),'integrity'=>(string)($provision['integrity']??''),
                    'bin'=>(string)($provision['bin']??''),'nodeMinimum'=>(string)($provision['nodeMinimum']??''),
                    'authProviderId'=>null,'credentialEnv'=>null,'networkPolicy'=>(string)($entry['networkPolicy']??'NONE'),'license'=>(string)$entry['license'],
                ];
            }
        }
        usort($items,static fn(array $a,array $b):int=>strcmp((string)$a['capability'],(string)$b['capability']));
        return ['schemaVersion'=>1,'authority'=>'AWH_UPDATE_CENTER','items'=>$items];
    }

    public function provisionPlan(string $capability,string $platform,string $arch,?string $now=null): ?array
    {
        $capability=$this->capability($capability);
        foreach($this->provisionCatalog($platform,$arch,$now)['items'] as $item)if(($item['capability']??null)===$capability)return $item;
        return null;
    }

    public function recordQaEvidence(string $capability,string $revision,array $evidence,?string $now=null): array
    {
        $capability=$this->capability($capability);$revision=strtolower($revision);if(preg_match(self::SHA,$revision)!==1)throw new HubToolFabricException('Tool QA revision is invalid','TOOL_FABRIC_QA_INVALID');
        $entry=$this->entry($capability);$required=['license','integrity','smoke','capabilityContract','regression','rollback'];if(($entry['runtimeKind']??null)==='MCP')$required[]='mcpQa';foreach($required as $key)if(($evidence[$key]??null)!=='PASS'&&!(($key==='rollback')&&($evidence[$key]??null)==='READY'))throw new HubToolFabricException('Tool QA evidence is incomplete','TOOL_FABRIC_QA_INVALID');
        $this->syncCatalog($now);[$row,$meta]=$this->sourceMeta($entry);
        $meta['qaRevision']=$revision;$meta['qaState']='PASS';$meta['licenseState']='VERIFIED';$meta['integrityState']='VERIFIED';$meta['smokeState']='PASS';$meta['capabilityContractState']='PASS';$meta['regressionState']='PASS';$meta['rollbackState']='READY';if(($entry['runtimeKind']??null)==='MCP')$meta['mcpQaState']='PASS';$meta['lastQaAt']=$this->timestamp($now??gmdate('c'));
        $this->saveMeta(self::sourceId($entry),$meta,null);
        return ['schemaVersion'=>1,'capability'=>$capability,'revision'=>$revision,'state'=>'PASS'];
    }

    public function transition(string $capability,string $action,?string $now=null): array
    {
        $capability=$this->capability($capability);$action=strtoupper(trim($action));$entry=$this->entry($capability);$this->syncCatalog($now);[$row,$meta]=$this->sourceMeta($entry);
        $state=(string)($meta['lifecycleState']??$entry['lifecycleState']??'DISCOVERED');
        $stable=is_string($meta['stableRevision']??null)?(string)$meta['stableRevision']:($state==='STABLE'?(string)$entry['revision']:null);
        $hasStable=$stable!==null;
        $workflow=$hasStable?(is_string($meta['intakeState']??null)?(string)$meta['intakeState']:null):$state;
        $candidate=$hasStable?(is_string($meta['intakeRevision']??null)?(string)$meta['intakeRevision']:null):(is_string($meta['upstreamRevision']??null)?(string)$meta['upstreamRevision']:(string)$entry['revision']);
        if($action==='REVIEW'){
            if(!in_array($workflow,['DISCOVERED','REJECTED','RETIRED'],true))throw new HubToolFabricException('Tool review transition is not allowed','TOOL_FABRIC_TRANSITION_INVALID');
            if($hasStable)$meta['intakeState']='REVIEWED';else $state='REVIEWED';
        }
        elseif($action==='APPROVE'){
            if($workflow!=='REVIEWED')throw new HubToolFabricException('Tool is not reviewable','TOOL_FABRIC_TRANSITION_INVALID');
            if($hasStable)$meta['intakeState']='APPROVED';else $state='APPROVED';
        }
        elseif($action==='PROMOTE_PREVIEW'){
            if($workflow!=='APPROVED'||!is_string($candidate))throw new HubToolFabricException('Tool preview promotion is not allowed','TOOL_FABRIC_TRANSITION_INVALID');
            $runtime=(string)($entry['runtimeKind']??'REFERENCE');$provision=is_array($entry['provision']??null)?$entry['provision']:null;if(in_array($runtime,['MCP','CLI','MODEL_RUNTIME'],true)){if($provision===null||!is_string($provision['revision']??null)||!hash_equals($candidate,(string)$provision['revision']))throw new HubToolFabricException('Exact provision pin is required before Preview','TOOL_FABRIC_PROVISION_PIN_REQUIRED');}
            $meta['previewRevision']=$candidate;if($hasStable)$meta['intakeState']='PREVIEW';else $state='PREVIEW';
        }
        elseif($action==='PROMOTE_STABLE'){
            $preview=is_string($meta['previewRevision']??null)?(string)$meta['previewRevision']:null;
            $effective=$hasStable?(string)($meta['intakeState']??''):$state;
            if($effective!=='PREVIEW'||$preview===null)throw new HubToolFabricException('Tool preview is required','TOOL_FABRIC_QA_REQUIRED');
            foreach(['qaState'=>'PASS','licenseState'=>'VERIFIED','integrityState'=>'VERIFIED','smokeState'=>'PASS','capabilityContractState'=>'PASS','regressionState'=>'PASS','rollbackState'=>'READY'] as $key=>$expected)if(($meta[$key]??null)!==$expected)throw new HubToolFabricException('Tool QA evidence is required','TOOL_FABRIC_QA_REQUIRED');
            if(!is_string($meta['qaRevision']??null)||!hash_equals($preview,(string)$meta['qaRevision']))throw new HubToolFabricException('Tool QA revision does not match preview','TOOL_FABRIC_QA_REQUIRED');
            if(($entry['runtimeKind']??null)==='MCP'&&($meta['mcpQaState']??null)!=='PASS')throw new HubToolFabricException('MCP QA evidence is required','TOOL_FABRIC_QA_REQUIRED');
            $old=$stable;if($old!==null&&!hash_equals($old,$preview)){$meta['previousStableRevision']=$old;if(is_array($meta['stableProvision']??null))$meta['previousStableProvision']=$meta['stableProvision'];}
            if(is_array($entry['provision']??null))$meta['stableProvision']=$entry['provision'];
            $meta['stableRevision']=$preview;$meta['previewRevision']=null;$meta['intakeState']=null;$meta['intakeRevision']=null;$meta['rejectedRevision']=null;$meta['updateAvailable']=false;$state='STABLE';
        }
        elseif($action==='ROLLBACK'){
            if($state!=='STABLE'||!is_string($meta['previousStableRevision']??null))throw new HubToolFabricException('Tool rollback is unavailable','TOOL_FABRIC_ROLLBACK_UNAVAILABLE');
            $previous=(string)$meta['previousStableRevision'];$current=$stable;$meta['stableRevision']=$previous;$meta['previousStableRevision']=$current;if(is_array($meta['previousStableProvision']??null)){$currentProvision=is_array($meta['stableProvision']??null)?$meta['stableProvision']:null;$meta['stableProvision']=$meta['previousStableProvision'];$meta['previousStableProvision']=$currentProvision;} $meta['intakeState']=null;$meta['intakeRevision']=null;$meta['previewRevision']=null;$state='STABLE';
        }
        elseif($action==='DISABLE'){$meta['disabled']=true;}
        elseif($action==='ENABLE'){$meta['disabled']=false;}
        elseif($action==='RETIRE'){
            if(!in_array($state,['APPROVED','PREVIEW','STABLE','REJECTED'],true))throw new HubToolFabricException('Tool retire transition is not allowed','TOOL_FABRIC_TRANSITION_INVALID');
            $state='RETIRED';$meta['disabled']=true;$meta['intakeState']=null;$meta['intakeRevision']=null;$meta['previewRevision']=null;
        }
        elseif($action==='REJECT'){
            if(!in_array($workflow,['DISCOVERED','REVIEWED','APPROVED'],true))throw new HubToolFabricException('Tool reject transition is not allowed','TOOL_FABRIC_TRANSITION_INVALID');
            if($hasStable){$meta['intakeState']='REJECTED';if(is_string($candidate))$meta['rejectedRevision']=$candidate;$meta['previewRevision']=null;$meta['updateAvailable']=false;}
            else{$state='REJECTED';$meta['disabled']=true;}
        }
        else throw new HubToolFabricException('Tool lifecycle action is invalid','TOOL_FABRIC_TRANSITION_INVALID');
        $meta['lifecycleState']=$state;$meta['lastLifecycleAction']=$action;$meta['lastLifecycleAt']=$this->timestamp($now??gmdate('c'));$this->saveMeta(self::sourceId($entry),$meta,((bool)($meta['disabled']??false))?0:1);
        foreach($this->snapshot($now)['items'] as $item)if(($item['capability']??null)===$capability)return ['schemaVersion'=>1,'tool'=>$item];throw new HubToolFabricException('Tool lifecycle projection is unavailable','TOOL_FABRIC_FAILED');
    }

    /** @return array<string,mixed> */
    private function entry(string $capability): array
    {
        $entries=$this->entriesByCapability();if(!isset($entries[$capability]))throw new HubToolFabricException('Tool capability is unknown','TOOL_FABRIC_CAPABILITY_UNKNOWN');return $entries[$capability];
    }

    /** @return array{0:array<string,mixed>,1:array<string,mixed>} */
    private function sourceMeta(array $entry): array
    {
        $q=$this->pdo->prepare('SELECT * FROM control_capability_sources WHERE source_id=:id');$q->execute(['id'=>self::sourceId($entry)]);$row=$q->fetch();
        if(!is_array($row))throw new HubToolFabricException('Tool source is unavailable','TOOL_FABRIC_SOURCE_UNAVAILABLE');
        try{$meta=json_decode((string)$row['metadata_json'],true,32,JSON_THROW_ON_ERROR);}catch(Throwable){$meta=[];}if(!is_array($meta))$meta=[];
        return [$row,$meta];
    }

    /** @param array<string,mixed> $meta */
    private function saveMeta(string $sourceId,array $meta,?int $enabled): void
    {
        $json=json_encode($meta,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        if($enabled===null){$q=$this->pdo->prepare('UPDATE control_capability_sources SET metadata_json=:meta WHERE source_id=:id');$q->execute(['meta'=>$json,'id'=>$sourceId]);return;}
        $q=$this->pdo->prepare('UPDATE control_capability_sources SET metadata_json=:meta,enabled=:enabled WHERE source_id=:id');$q->execute(['meta'=>$json,'enabled'=>$enabled,'id'=>$sourceId]);
    }

    private function capability(string $value): string
    {
        $value=trim($value);if(preg_match(self::CAPABILITY,$value)!==1)throw new HubToolFabricException('Tool capability is invalid','TOOL_FABRIC_CAPABILITY_INVALID');return $value;
    }

    private function timestamp(string $value): string
    {
        $time=strtotime($value);if($time===false)throw new HubToolFabricException('Tool Fabric timestamp is invalid','TOOL_FABRIC_TIMESTAMP_INVALID');return gmdate('c',$time);
    }
}
