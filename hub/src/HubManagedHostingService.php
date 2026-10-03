<?php

declare(strict_types=1);

require_once __DIR__ . '/HubAccountHostingMigration.php';
require_once __DIR__ . '/HubOwnerAuthService.php';
require_once __DIR__ . '/HubTrustPolicy.php';
require_once __DIR__ . '/HubProviderCredentialStore.php';
require_once __DIR__ . '/HubInfrastructureService.php';

final class HubManagedHostingException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='HOSTING_FAILED') { parent::__construct($message); }
}

final class HubDnsProviderAdapter
{
    public static function plan(string $hostname): array
    {
        $provider=strtoupper(trim((string)(getenv('AWH_DNS_PROVIDER')?:'MANUAL')));
        if(!preg_match('/^[A-Z0-9_-]{2,32}$/',$provider))$provider='MANUAL';
        $configured=getenv('AWH_PUBLIC_IPV4');$root=strtolower(trim((string)(getenv('AWH_ROOT_DOMAIN')?:'kruart.online')));$authority=$root;$target=null;
        if(is_string($configured)&&filter_var($configured,FILTER_VALIDATE_IP,FILTER_FLAG_IPV4)!==false){$target=$configured;$authority='AWH_PUBLIC_IPV4';}
        else{$answers=gethostbynamel($root)?:[];foreach($answers as $answer)if(filter_var($answer,FILTER_VALIDATE_IP,FILTER_FLAG_IPV4)!==false){$target=$answer;break;}}
        return ['provider'=>$provider,'mode'=>$provider==='MANUAL'?'MANUAL':'ADAPTER','automatic'=>false,'recordType'=>'A','hostname'=>$hostname,'target'=>$target,'targetAuthority'=>$authority?:null];
    }
}

/**
 * Owner-facing Managed Site authority. Mutations materialize into the existing
 * canonical control_tasks/control_task_executions queue; this service is not a
 * second job system and never executes shell commands.
 */
final class HubManagedHostingService
{
    private function __construct(private readonly PDO $pdo, private readonly HubOwnerAuthService $auth) {}
    public static function fromPdo(PDO $pdo): self { return new self($pdo, HubOwnerAuthService::fromPdo($pdo)); }

    public function sites(string $token): array
    {
        $owner=$this->ownerSession($token); $q=$this->pdo->prepare("SELECT s.*,p.name AS project_name,b.binding_kind,b.host AS binding_host,b.port AS binding_port,b.tls_mode,b.state AS binding_state,d.engine AS db_engine,d.state AS db_state,(SELECT host FROM control_site_bindings x WHERE x.site_id=s.site_id AND x.binding_kind='DOMAIN' AND x.state<>'DISABLED' ORDER BY x.updated_at DESC LIMIT 1) AS domain_host,(SELECT state FROM control_site_bindings x WHERE x.site_id=s.site_id AND x.binding_kind='DOMAIN' AND x.state<>'DISABLED' ORDER BY x.updated_at DESC LIMIT 1) AS domain_state,(SELECT event_name FROM control_site_events e WHERE e.site_id=s.site_id ORDER BY e.occurred_at DESC LIMIT 1) AS last_event_name,(SELECT state FROM control_site_events e WHERE e.site_id=s.site_id ORDER BY e.occurred_at DESC LIMIT 1) AS last_event_state,(SELECT message FROM control_site_events e WHERE e.site_id=s.site_id ORDER BY e.occurred_at DESC LIMIT 1) AS last_event_message,(SELECT occurred_at FROM control_site_events e WHERE e.site_id=s.site_id ORDER BY e.occurred_at DESC LIMIT 1) AS last_event_at,(SELECT e.task_id FROM control_site_events e JOIN control_tasks t ON t.task_id=e.task_id JOIN control_task_executions x ON x.task_id=t.task_id WHERE e.site_id=s.site_id AND x.required_capability='hosting.site.deploy' AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY e.occurred_at DESC LIMIT 1) AS active_deploy_task_id,(SELECT t.state FROM control_site_events e JOIN control_tasks t ON t.task_id=e.task_id JOIN control_task_executions x ON x.task_id=t.task_id WHERE e.site_id=s.site_id AND x.required_capability='hosting.site.deploy' AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY e.occurred_at DESC LIMIT 1) AS active_deploy_task_state,v.active_revision_id AS source_revision_id,COALESCE(v.sync_state,'EMPTY') AS source_sync_state,(SELECT e.last_error_code FROM control_task_executions e WHERE e.project_id=s.project_id AND e.required_capability IN ('hosting.site.provision','hosting.site.deploy') AND e.state IN ('WAITING_FOR_CAPABILITY','FAILED') ORDER BY e.updated_at DESC LIMIT 1) AS source_blocker_code,(SELECT r.vault_revision_id FROM control_site_releases r WHERE r.release_id=s.current_release_id AND r.site_id=s.site_id LIMIT 1) AS current_release_revision_id FROM control_managed_sites s JOIN projects p ON p.project_id=s.project_id LEFT JOIN control_site_bindings b ON b.site_id=s.site_id AND b.is_primary=1 AND b.state<>'DISABLED' LEFT JOIN control_site_database_bindings d ON d.site_id=s.site_id LEFT JOIN control_project_vaults v ON v.project_id=s.project_id WHERE s.created_by_user_id=:owner ORDER BY CASE s.state WHEN 'READY' THEN 0 WHEN 'PROVISIONING' THEN 1 WHEN 'QUEUED' THEN 2 ELSE 3 END,s.updated_at DESC LIMIT 200");
        $q->execute(['owner'=>$owner['user_id']]); $rows=array_map([self::class,'siteRow'],$q->fetchAll()); $root=strtolower(trim((string)(getenv('AWH_ROOT_DOMAIN')?:'kruart.online'))); $now=gmdate('c');
        try{$telemetry=HubInfrastructureService::fromEnvironment()->status($now);}catch(Throwable){$telemetry=['state'=>'UNAVAILABLE','generatedAt'=>null,'server'=>null];}
        $inventory=$this->hostingInventory($rows,$telemetry,$root);
        return ['schemaVersion'=>1,'sites'=>$rows,'inventory'=>$inventory['sites'],'inventoryMeta'=>$inventory['meta'],'domains'=>$inventory['domains'],'dns'=>HubDnsProviderAdapter::plan($root),'ecosystem'=>$this->ecosystemStatus($now),'policy'=>HubTrustPolicy::catalog(['hosting.site.create','hosting.site.deploy','hosting.site.rollback','hosting.site.disable','hosting.site.bind_domain'])];
    }

    public function siteSecrets(string $token,string $siteId): array
    {
        $owner=$this->ownerSession($token);$site=$this->siteForOwner($siteId,(string)$owner['user_id']);
        $values=$this->readSiteSecretBundle((string)$site['site_id']);
        return ['schemaVersion'=>1,'siteId'=>(string)$site['site_id'],'configured'=>$values!==[],'names'=>array_keys($values),'valuesNeverReturned'=>true];
    }

    public function updateSiteSecrets(string $token,string $csrf,string $siteId,array $payload,?string $now=null): array
    {
        $owner=$this->ownerMutation($token,$csrf,'hosting.site.secrets',$now);$site=$this->siteForOwner($siteId,(string)$owner['user_id']);
        self::keys($payload,['action','schemaVersion','values']);if(($payload['schemaVersion']??null)!==1||!is_string($payload['action']??null)||!is_array($payload['values']??null)||array_is_list($payload['values']))throw new HubManagedHostingException('Runtime secret request is invalid','HOSTING_SECRET_INVALID');
        $action=strtoupper(trim((string)$payload['action']));$store=$this->siteSecretStore((string)$site['site_id']);
        if($action==='CLEAR'){
            if($payload['values']!==[])throw new HubManagedHostingException('Runtime secret request is invalid','HOSTING_SECRET_INVALID');
            try{$store->remove();}catch(HubProviderCredentialStoreException $e){throw new HubManagedHostingException('Runtime secrets could not be removed',$e->codeName);}
            return ['schemaVersion'=>1,'siteId'=>(string)$site['site_id'],'configured'=>false,'names'=>[],'valuesNeverReturned'=>true,'redeployRequired'=>(string)$site['state']==='READY'];
        }
        if($action!=='SET'||count($payload['values'])<1||count($payload['values'])>20)throw new HubManagedHostingException('Runtime secret request is invalid','HOSTING_SECRET_INVALID');
        $merged=$this->readSiteSecretBundle((string)$site['site_id']);
        foreach($payload['values'] as $name=>$value){
            if(!is_string($name)||preg_match('/^[A-Z][A-Z0-9_]{1,63}$/',$name)!==1||!is_string($value)||strlen($value)<1||strlen($value)>4096||preg_match('/[\x00-\x20\x7f]/',$value))throw new HubManagedHostingException('Runtime secret request is invalid','HOSTING_SECRET_INVALID');
            $merged[$name]=$value;
        }
        ksort($merged);
        try{$store->replace(self::encodeSecretBundle($merged));}catch(HubProviderCredentialStoreException $e){throw new HubManagedHostingException('Runtime secrets could not be stored',$e->codeName);}
        return ['schemaVersion'=>1,'siteId'=>(string)$site['site_id'],'configured'=>true,'names'=>array_keys($merged),'valuesNeverReturned'=>true,'redeployRequired'=>(string)$site['state']==='READY'];
    }

    public function createSite(string $token,string $csrf,array $payload,?string $now=null): array
    {
        $owner=$this->ownerMutation($token,$csrf,'hosting.site.create',$now); self::keys($payload,['backupEnabled','databaseMode','environment','healthPath','name','projectId','publicMode','runtimeType','schemaVersion','slug']);
        if(($payload['schemaVersion']??null)!==1||!is_bool($payload['backupEnabled']??null))throw new HubManagedHostingException('Website request is invalid','HOSTING_INVALID');
        $project=self::uuid((string)($payload['projectId']??'')); $this->assertOwnerProject((string)$owner['user_id'],$project);
        $name=self::text($payload['name']??null,120); $slug=self::slug((string)($payload['slug']??'')); $environment=self::enum($payload['environment']??'PRODUCTION',['PRODUCTION','STAGING','PREVIEW']);
        $runtime=self::enum($payload['runtimeType']??'AUTO',['AUTO','STATIC','PHP','NODE']); $database=self::enum($payload['databaseMode']??'AUTO',['AUTO','NONE','SQLITE','MARIADB']); $public=self::enum($payload['publicMode']??'IP_PORT',['IP_PORT','DOMAIN']);
        if($public==='DOMAIN')throw new HubManagedHostingException('เพิ่ม Domain ได้หลังสร้างเว็บไซต์แล้ว','DOMAIN_BINDING_REQUIRED');
        $health=self::healthPath((string)($payload['healthPath']??'/')); $at=self::time($now??gmdate('c')); $siteId=self::uuid(); $port=$this->nextPort(); $taskId=self::uuid(); $executionId=self::uuid();
        $revision=$this->activeRevision($project); $checkpoint=['mode'=>'HOSTING_PROVISION','siteId'=>$siteId,'requestedRuntime'=>$runtime,'requestedDatabase'=>$database,'publicMode'=>'IP_PORT'];
        try{$this->pdo->exec('BEGIN IMMEDIATE');
            $this->pdo->prepare("INSERT INTO control_managed_sites(site_id,project_id,name,slug,environment,runtime_type,runtime_version,database_mode,state,public_mode,listen_port,primary_host,health_path,backup_enabled,current_release_id,rollback_release_id,created_by_user_id,created_at,updated_at) VALUES(:id,:project,:name,:slug,:env,:runtime,NULL,:db,'QUEUED','IP_PORT',:port,NULL,:health,:backup,NULL,NULL,:owner,:at,:at)")->execute(['id'=>$siteId,'project'=>$project,'name'=>$name,'slug'=>$slug,'env'=>$environment,'runtime'=>$runtime,'db'=>$database,'port'=>$port,'health'=>$health,'backup'=>$payload['backupEnabled']?1:0,'owner'=>$owner['user_id'],'at'=>$at]);
            $this->pdo->prepare("INSERT INTO control_site_database_bindings(site_id,engine,database_name,credential_ref,state,updated_at) VALUES(:site,'NONE',NULL,NULL,'REQUESTED',:at)")->execute(['site'=>$siteId,'at'=>$at]);
            $this->insertTask($taskId,$executionId,(string)$owner['user_id'],$project,$revision,"เตรียมเว็บไซต์ {$name} บน AWH Hosting",'hosting.site.provision',$checkpoint,$at);
            $this->event($siteId,$taskId,'SITE_CREATED','QUEUED','AWH รับคำขอสร้างเว็บไซต์แล้ว',$at); $this->pdo->exec('COMMIT');
        }catch(Throwable $error){$this->rollback();if($error instanceof HubManagedHostingException)throw $error;if($error instanceof PDOException&&str_contains(strtolower($error->getMessage()),'unique'))throw new HubManagedHostingException('ชื่อย่อเว็บไซต์นี้ถูกใช้แล้ว','SITE_SLUG_UNAVAILABLE');throw new HubManagedHostingException('Website could not be created','HOSTING_CREATE_FAILED');}
        return ['siteId'=>$siteId,'taskId'=>$taskId,'state'=>'QUEUED','port'=>$port,'sourceReady'=>$revision!==null,'message'=>$revision===null?'สร้างเว็บไซต์แล้ว AWH กำลังรอ Source ของโปรเจกต์ก่อนเตรียม Production':'สร้างเว็บไซต์แล้ว AWH กำลังเตรียม Production'];
    }

    public function deploySite(string $token,string $csrf,string $siteId,array $payload,?string $now=null): array
    {
        $owner=$this->ownerMutation($token,$csrf,'hosting.site.deploy',$now); self::keys($payload,['schemaVersion']);if(($payload['schemaVersion']??null)!==1)throw new HubManagedHostingException('Deploy request is invalid','HOSTING_INVALID');
        $site=$this->siteForOwner($siteId,(string)$owner['user_id']);$revision=$this->activeRevision((string)$site['project_id']);if($revision===null)throw new HubManagedHostingException('โปรเจกต์นี้ยังไม่มี Source ที่พร้อม Deploy','PROJECT_SOURCE_NOT_READY');
        $at=self::time($now??gmdate('c'));$task=self::uuid();$execution=self::uuid();try{$this->pdo->exec('BEGIN IMMEDIATE');$this->insertTask($task,$execution,(string)$owner['user_id'],(string)$site['project_id'],$revision,'Deploy รุ่นล่าสุดของ '.$site['name'],'hosting.site.deploy',['mode'=>'HOSTING_DEPLOY','siteId'=>$site['site_id']],$at);$this->event((string)$site['site_id'],$task,'DEPLOY_REQUESTED','QUEUED','AWH กำลังเตรียมรุ่นใหม่',$at);$this->pdo->exec('COMMIT');}catch(Throwable $error){$this->rollback();if($error instanceof HubManagedHostingException)throw $error;throw new HubManagedHostingException('Deploy could not be queued','HOSTING_DEPLOY_FAILED');}return ['siteId'=>$site['site_id'],'taskId'=>$task,'state'=>'QUEUED'];
    }

    public function rollbackSite(string $token,string $csrf,string $siteId,array $payload,?string $now=null): array
    {
        $owner=$this->ownerMutation($token,$csrf,'hosting.site.rollback',$now);self::keys($payload,['schemaVersion']);if(($payload['schemaVersion']??null)!==1)throw new HubManagedHostingException('Rollback request is invalid','HOSTING_INVALID');$site=$this->siteForOwner($siteId,(string)$owner['user_id']);if(!is_string($site['rollback_release_id'])||$site['rollback_release_id']==='')throw new HubManagedHostingException('ยังไม่มี rollback point ที่ตรวจสอบแล้ว','ROLLBACK_NOT_READY');
        $at=self::time($now??gmdate('c'));$task=self::uuid();$execution=self::uuid();try{$this->pdo->exec('BEGIN IMMEDIATE');$this->insertTask($task,$execution,(string)$owner['user_id'],(string)$site['project_id'],null,'Rollback '.$site['name'].' ไปยังรุ่นก่อนหน้า','hosting.site.rollback',['mode'=>'HOSTING_ROLLBACK','siteId'=>$site['site_id'],'releaseId'=>$site['rollback_release_id']],$at);$this->event((string)$site['site_id'],$task,'ROLLBACK_REQUESTED','QUEUED','AWH กำลังตรวจ rollback point',$at);$this->pdo->exec('COMMIT');}catch(Throwable $error){$this->rollback();if($error instanceof HubManagedHostingException)throw $error;throw new HubManagedHostingException('Rollback could not be queued','HOSTING_ROLLBACK_FAILED');}return ['siteId'=>$site['site_id'],'taskId'=>$task,'state'=>'QUEUED'];
    }

    public function bindDomain(string $token,string $csrf,string $siteId,array $payload,?string $now=null): array
    {
        $owner=$this->ownerMutation($token,$csrf,'hosting.site.bind_domain',$now); self::keys($payload,['hostname','schemaVersion']);
        if(($payload['schemaVersion']??null)!==1)throw new HubManagedHostingException('Domain request is invalid','HOSTING_INVALID');
        $site=$this->siteForOwner($siteId,(string)$owner['user_id']); if((string)$site['state']!=='READY')throw new HubManagedHostingException('เว็บไซต์ต้องพร้อมใช้งานก่อนเชื่อมโดเมน','HOSTING_SITE_NOT_READY');
        $hostname=self::domainHost((string)($payload['hostname']??'')); $root=strtolower(trim((string)(getenv('AWH_ROOT_DOMAIN')?:'kruart.online')));
        if($hostname!==$root&&!str_ends_with($hostname,'.'.$root))throw new HubManagedHostingException('โดเมนต้องอยู่ภายใต้ '.$root,'DOMAIN_NOT_MANAGED');
        $at=self::time($now??gmdate('c'));$task=self::uuid();$execution=self::uuid();$binding=self::uuid();
        try{$this->pdo->exec('BEGIN IMMEDIATE');
            $conflict=$this->pdo->prepare("SELECT site_id FROM control_site_bindings WHERE lower(host)=:host AND state<>'DISABLED' LIMIT 1");$conflict->execute(['host'=>$hostname]);$other=$conflict->fetchColumn();if(is_string($other)&&$other!==$site['site_id'])throw new HubManagedHostingException('โดเมนนี้ถูกใช้กับเว็บไซต์อื่นแล้ว','DOMAIN_UNAVAILABLE');
            $existing=$this->pdo->prepare("SELECT binding_id FROM control_site_bindings WHERE site_id=:site AND binding_kind='DOMAIN' AND lower(host)=:host AND state<>'DISABLED' LIMIT 1");$existing->execute(['site'=>$site['site_id'],'host'=>$hostname]);$existingId=$existing->fetchColumn();
            if(is_string($existingId)){$binding=$existingId;$this->pdo->prepare("UPDATE control_site_bindings SET state='REQUESTED',tls_mode='AUTO_DOMAIN',is_primary=0,updated_at=:at WHERE binding_id=:id")->execute(['at'=>$at,'id'=>$binding]);}
            else{$this->pdo->prepare("INSERT INTO control_site_bindings(binding_id,site_id,binding_kind,host,port,tls_mode,state,is_primary,created_at,updated_at) VALUES(:id,:site,'DOMAIN',:host,NULL,'AUTO_DOMAIN','REQUESTED',0,:at,:at)")->execute(['id'=>$binding,'site'=>$site['site_id'],'host'=>$hostname,'at'=>$at]);}
            $this->insertTask($task,$execution,(string)$owner['user_id'],(string)$site['project_id'],null,'เชื่อมโดเมน '.$hostname.' กับ '.$site['name'],'hosting.site.bind_domain',['mode'=>'HOSTING_BIND_DOMAIN','siteId'=>$site['site_id'],'bindingId'=>$binding,'hostname'=>$hostname],$at);
            $this->event((string)$site['site_id'],$task,'DOMAIN_REQUESTED','WAITING','AWH กำลังตรวจ DNS และ HTTPS ของ '.$hostname,$at);$this->pdo->exec('COMMIT');
        }catch(Throwable $error){$this->rollback();if($error instanceof HubManagedHostingException)throw $error;throw new HubManagedHostingException('Domain binding could not be queued','DOMAIN_BIND_FAILED');}
        return ['siteId'=>$site['site_id'],'bindingId'=>$binding,'taskId'=>$task,'hostname'=>$hostname,'state'=>'REQUESTED','dnsPlan'=>HubDnsProviderAdapter::plan($hostname)];
    }

    public function disableSite(string $token,string $csrf,string $siteId,array $payload,?string $now=null): array
    {
        $owner=$this->ownerMutation($token,$csrf,'hosting.site.disable',$now);self::keys($payload,['schemaVersion']);if(($payload['schemaVersion']??null)!==1)throw new HubManagedHostingException('Disable request is invalid','HOSTING_INVALID');$site=$this->siteForOwner($siteId,(string)$owner['user_id']);$at=self::time($now??gmdate('c'));$task=self::uuid();$execution=self::uuid();try{$this->pdo->exec('BEGIN IMMEDIATE');$this->insertTask($task,$execution,(string)$owner['user_id'],(string)$site['project_id'],null,'ปิดการเผยแพร่ '.$site['name'],'hosting.site.disable',['mode'=>'HOSTING_DISABLE','siteId'=>$site['site_id']],$at);$this->event((string)$site['site_id'],$task,'DISABLE_REQUESTED','QUEUED','AWH กำลังปิด public route อย่างปลอดภัย',$at);$this->pdo->exec('COMMIT');}catch(Throwable $error){$this->rollback();if($error instanceof HubManagedHostingException)throw $error;throw new HubManagedHostingException('Disable could not be queued','HOSTING_DISABLE_FAILED');}return ['siteId'=>$site['site_id'],'taskId'=>$task,'state'=>'QUEUED'];
    }

    private function hostingInventory(array $managed,array $telemetry,string $root): array
    {
        $server=is_array($telemetry['server']??null)?$telemetry['server']:[];
        $routes=is_array($server['sites']??null)?$server['sites']:[];
        $domainRows=is_array($server['domains']??null)?$server['domains']:[];
        $domainMap=[];$domains=[];
        foreach($domainRows as $domain){
            if(!is_array($domain)||!is_string($domain['name']??null))continue;
            $host=strtolower((string)$domain['name']);$domainMap[$host]=$domain;
            $domains[]=['host'=>$host,'tls'=>($domain['tls']??false)===true,'certificateExpiresAt'=>$domain['certificateExpiresAt']??null,'certificateDaysRemaining'=>$domain['certificateDaysRemaining']??null,'managedSiteId'=>null,'ownership'=>'DISCOVERED'];
        }
        $routeMap=[];foreach($routes as $route)if(is_array($route)&&is_string($route['primaryHost']??null))$routeMap[strtolower((string)$route['primaryHost'])]=$route;
        $claimed=[];$sites=[];
        foreach($managed as $site){
            if(!is_array($site))continue;
            $hosts=[];
            foreach([$site['domainHost']??null,$site['primaryHost']??null,isset($site['slug'])?(string)$site['slug'].'.'.$root:null] as $host){
                if(!is_string($host)||$host==='')continue;$host=strtolower($host);$hosts[$host]=true;$claimed[$host]=(string)$site['siteId'];
            }
            $primary=is_string($site['domainHost']??null)&&$site['domainHost']!==''?strtolower((string)$site['domainHost']):(is_string($site['primaryHost']??null)&&$site['primaryHost']!==''?strtolower((string)$site['primaryHost']):strtolower((string)$site['slug'].'.'.$root));
            $route=$routeMap[$primary]??null;$domain=$domainMap[$primary]??null;
            $routeType=is_array($route)?(string)($route['routeType']??'UNKNOWN'):match((string)($site['runtimeType']??'AUTO')){'STATIC'=>'STATIC','PHP'=>'PHP','NODE'=>'PROXY',default=>'UNKNOWN'};
            $sites[]=[
                'inventoryId'=>'managed-'.(string)$site['siteId'],'ownership'=>'MANAGED','managedSiteId'=>(string)$site['siteId'],
                'projectId'=>$site['projectId']??null,'projectName'=>$site['projectName']??null,'name'=>(string)($site['name']??$primary),
                'primaryHost'=>$primary,'hosts'=>array_keys($hosts),'environment'=>(string)($site['environment']??'PRODUCTION'),
                'state'=>(string)($site['state']??'UNKNOWN'),'routeDetected'=>is_array($route),'routeType'=>$routeType,
                'runtimeType'=>(string)($site['runtimeType']??'AUTO'),'upstreamPort'=>is_array($route)?($route['upstreamPort']??$site['port']??null):($site['port']??null),
                'rootClass'=>is_array($route)?($route['rootClass']??null):null,'configName'=>is_array($route)?($route['configName']??null):null,
                'tls'=>is_array($domain)?(($domain['tls']??false)===true):false,'certificateExpiresAt'=>is_array($domain)?($domain['certificateExpiresAt']??null):null,
                'certificateDaysRemaining'=>is_array($domain)?($domain['certificateDaysRemaining']??null):null,'redirectHost'=>is_array($route)?($route['redirectHost']??null):null,
                'url'=>$site['url']??null,'source'=>$site['source']??null,'backupEnabled'=>($site['backupEnabled']??false)===true,
                'databaseMode'=>$site['databaseMode']??null,'databaseState'=>$site['databaseState']??null,
                'currentReleaseId'=>$site['currentReleaseId']??null,'rollbackReleaseId'=>$site['rollbackReleaseId']??null,'lastEvent'=>$site['lastEvent']??null,
            ];
        }
        foreach($routes as $route){
            if(!is_array($route)||!is_string($route['primaryHost']??null))continue;$host=strtolower((string)$route['primaryHost']);
            if(isset($claimed[$host]))continue;
            $domain=$domainMap[$host]??null;$routeType=(string)($route['routeType']??'UNKNOWN');$isAlias=$routeType==='REDIRECT';
            $sites[]=[
                'inventoryId'=>(string)($route['inventoryId']??('nginx-'.substr(hash('sha256',$host),0,20))),'ownership'=>$isAlias?'ALIAS':'DISCOVERED','managedSiteId'=>null,
                'projectId'=>null,'projectName'=>null,'name'=>$host,'primaryHost'=>$host,'hosts'=>$route['hosts']??[$host],
                'environment'=>str_contains($host,'staging')?'STAGING':(str_contains($host,'preview')?'PREVIEW':'PRODUCTION'),
                'state'=>$isAlias?'ALIAS':'ROUTED','routeDetected'=>true,'routeType'=>$routeType,'runtimeType'=>match($routeType){'STATIC'=>'STATIC','PHP'=>'PHP','PROXY'=>'SERVICE','REDIRECT'=>'REDIRECT',default=>'UNKNOWN'},
                'upstreamPort'=>$route['upstreamPort']??null,'rootClass'=>$route['rootClass']??null,'configName'=>$route['configName']??null,
                'tls'=>is_array($domain)?(($domain['tls']??false)===true):(($route['tls']??false)===true),'certificateExpiresAt'=>is_array($domain)?($domain['certificateExpiresAt']??null):null,
                'certificateDaysRemaining'=>is_array($domain)?($domain['certificateDaysRemaining']??null):null,'redirectHost'=>$route['redirectHost']??null,
                'url'=>(($domain['tls']??$route['tls']??false)===true?'https://':'http://').$host.'/','source'=>null,'backupEnabled'=>false,'currentReleaseId'=>null,'rollbackReleaseId'=>null,'lastEvent'=>null,
            ];
        }
        usort($sites,static function(array $a,array $b):int{$weight=['MANAGED'=>0,'DISCOVERED'=>1,'ALIAS'=>2];return ($weight[$a['ownership']]??9)<=>($weight[$b['ownership']]??9)?:strcmp((string)$a['primaryHost'],(string)$b['primaryHost']);});
        $siteByHost=[];foreach($sites as $site)if(is_string($site['primaryHost']??null))$siteByHost[strtolower((string)$site['primaryHost'])]=$site;
        foreach($domains as &$domain){$site=$siteByHost[$domain['host']]??null;if(is_array($site)){$domain['managedSiteId']=$site['managedSiteId']??null;$domain['ownership']=$site['ownership']??'DISCOVERED';}}unset($domain);
        $managedCount=0;$discoveredCount=0;$aliasCount=0;foreach($sites as $site){$kind=$site['ownership']??null;if($kind==='MANAGED')$managedCount++;elseif($kind==='ALIAS')$aliasCount++;else $discoveredCount++;}
        $storage=is_array($server['storage']??null)?$server['storage']:[];
        $usedPercent=$storage['usedPercent']??null;$usedPercent=(is_int($usedPercent)||is_float($usedPercent))?(float)$usedPercent:null;
        $available=$storage['availableBytes']??null;$available=is_int($available)&&$available>=0?$available:null;
        return ['sites'=>$sites,'domains'=>$domains,'meta'=>['state'=>(string)($telemetry['state']??'UNAVAILABLE'),'generatedAt'=>$telemetry['generatedAt']??null,'managedCount'=>$managedCount,'discoveredCount'=>$discoveredCount,'aliasCount'=>$aliasCount,'domainCount'=>count($domains),'storageUsedPercent'=>$usedPercent,'storageAvailableBytes'=>$available,'readOnlyDiscovery'=>true]];
    }

    private function ecosystemStatus(string $at): array
    {
        $required=['hosting.site.provision','hosting.site.deploy','hosting.site.rollback','hosting.site.disable','hosting.site.bind_domain'];
        $q=$this->pdo->prepare("SELECT capability,observed_at,expires_at FROM control_executor_capabilities WHERE executor_id='vps-hosting' AND capability LIKE 'hosting.%'");$q->execute();$rows=$q->fetchAll();$fresh=[];$observed=[];$latest=null;foreach($rows as $row){$cap=is_string($row['capability']??null)?(string)$row['capability']:null;if(is_string($row['observed_at']??null)&&($latest===null||strcmp($row['observed_at'],$latest)>0))$latest=$row['observed_at'];if($cap!==null&&is_string($row['expires_at']??null)&&strcmp($row['expires_at'],$at)>0){$fresh[$cap]=true;if(is_string($row['observed_at']??null))$observed[$cap]=$row['observed_at'];}}
        $missing=array_values(array_filter($required,static fn($cap)=>!isset($fresh[$cap])));$freshRequired=count(array_filter($required,static fn($cap)=>isset($fresh[$cap])));$renewalReady=isset($fresh['hosting.tls.renewal']);
        $counts=['queued'=>0,'running'=>0,'waiting'=>0,'failed'=>0];$tasks=$this->pdo->query("SELECT state,COUNT(*) AS total FROM control_task_executions WHERE required_capability LIKE 'hosting.%' GROUP BY state")->fetchAll();foreach($tasks as $row){$state=(string)($row['state']??'');$total=(int)($row['total']??0);if($state==='QUEUED')$counts['queued']+=$total;elseif($state==='RUNNING')$counts['running']+=$total;elseif($state==='WAITING_FOR_CAPABILITY')$counts['waiting']+=$total;elseif($state==='FAILED')$counts['failed']+=$total;}
        return ['operator'=>['state'=>$missing===[]?'ONLINE':'OFFLINE','freshCapabilities'=>$freshRequired,'requiredCapabilities'=>count($required),'missingCapabilities'=>$missing,'lastObservedAt'=>$latest],'tasks'=>$counts,'routing'=>['engine'=>'NGINX','mode'=>'TYPED_CONFIG'],'tls'=>['mode'=>'LETS_ENCRYPT','activation'=>'AFTER_DNS_AND_HEALTH','renewal'=>['mode'=>'CERTBOT_TIMER','state'=>$renewalReady?'READY':'ATTENTION','lastObservedAt'=>$observed['hosting.tls.renewal']??null]]];
    }

    private function ownerSession(string $token): array { $this->ready();try{$session=$this->auth->authenticatedUser($token);}catch(HubOwnerAuthException $error){throw new HubManagedHostingException('Hosting authentication needs attention',$error->codeName);}$this->assertOwner((string)$session['userId']);return ['user_id'=>$session['userId']]; }
    private function ownerMutation(string $token,string $csrf,string $action,?string $now): array { $this->ready();try{$row=$this->auth->authorize($token,$csrf,$now);if(HubTrustPolicy::requiresStepUp($action))HubOwnerAuthService::assertRecentStepUpSession($row,$now);}catch(HubOwnerAuthException $error){throw new HubManagedHostingException('Hosting authentication needs attention',$error->codeName);}catch(HubTrustPolicyException){throw new HubManagedHostingException('Hosting trust policy is unavailable','HOSTING_INVALID');}$this->assertOwner((string)$row['user_id']);return $row; }
    private function ready(): void { HubAccountHostingMigration::assertCapabilityReady($this->pdo,dirname(__DIR__).'/migrations/016_account_hosting.sql'); }
    private function assertOwner(string $user): void { $owner=$this->pdo->query('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id=1 AND bootstrap_closed=1')->fetchColumn();if(!is_string($owner)||!hash_equals($owner,$user))throw new HubManagedHostingException('Owner access is required','OWNER_FORBIDDEN'); }
    private function siteSecretStore(string $siteId): HubProviderCredentialStore
    {
        return HubProviderCredentialStore::fromEnvironment('hosting.site.'.str_replace('-','',self::uuid($siteId)));
    }

    private function readSiteSecretBundle(string $siteId): array
    {
        try{$raw=$this->siteSecretStore($siteId)->read();}catch(HubProviderCredentialStoreException $e){throw new HubManagedHostingException('Runtime secrets are unavailable',$e->codeName);}
        if($raw===null)return [];
        $decoded=strtr($raw,'-_','+/');$decoded.=str_repeat('=',(4-strlen($decoded)%4)%4);$json=base64_decode($decoded,true);
        if(!is_string($json))throw new HubManagedHostingException('Runtime secret bundle is invalid','HOSTING_SECRET_INVALID');
        try{$values=json_decode($json,true,32,JSON_THROW_ON_ERROR);}catch(Throwable){throw new HubManagedHostingException('Runtime secret bundle is invalid','HOSTING_SECRET_INVALID');}
        if(!is_array($values)||array_is_list($values)||count($values)>20)throw new HubManagedHostingException('Runtime secret bundle is invalid','HOSTING_SECRET_INVALID');
        foreach($values as $name=>$value)if(!is_string($name)||preg_match('/^[A-Z][A-Z0-9_]{1,63}$/',$name)!==1||!is_string($value)||strlen($value)<1||strlen($value)>4096||preg_match('/[\x00-\x20\x7f]/',$value))throw new HubManagedHostingException('Runtime secret bundle is invalid','HOSTING_SECRET_INVALID');
        ksort($values);return $values;
    }

    private static function encodeSecretBundle(array $values): string
    {
        $json=json_encode($values,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        return rtrim(strtr(base64_encode($json),'+/','-_'),'=');
    }

    private function assertOwnerProject(string $user,string $project): void { $q=$this->pdo->prepare("SELECT 1 FROM control_project_capabilities WHERE user_id=:user AND project_id=:project AND capability='project.read' AND revoked_at IS NULL");$q->execute(['user'=>$user,'project'=>$project]);if($q->fetchColumn()===false)throw new HubManagedHostingException('Project is not available','PROJECT_FORBIDDEN'); }
    private function activeRevision(string $project): ?string { $q=$this->pdo->prepare("SELECT active_revision_id FROM control_project_vaults WHERE project_id=:project AND sync_state='SYNCED'");$q->execute(['project'=>$project]);$v=$q->fetchColumn();return is_string($v)&&self::validUuid($v)?strtolower($v):null; }
    private function nextPort(): int { $used=array_map('intval',array_column($this->pdo->query("SELECT listen_port FROM control_managed_sites WHERE listen_port IS NOT NULL AND state<>'DISABLED'")->fetchAll(),'listen_port'));for($p=8400;$p<=8999;$p++)if(!in_array($p,$used,true))return $p;throw new HubManagedHostingException('VPS public port pool is full','HOSTING_CAPACITY_FULL'); }
    private function siteForOwner(string $siteId,string $owner): array { $id=self::uuid($siteId);$q=$this->pdo->prepare('SELECT * FROM control_managed_sites WHERE site_id=:site AND created_by_user_id=:owner');$q->execute(['site'=>$id,'owner'=>$owner]);$row=$q->fetch();if(!is_array($row))throw new HubManagedHostingException('Website was not found','SITE_NOT_FOUND');return $row; }
    private function insertTask(string $task,string $execution,string $user,string $project,?string $revision,string $goal,string $capability,array $checkpoint,string $at): void { $key='hosting-'.substr(hash('sha256',$task),0,48);$this->pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,:goal,'QUEUED',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$task,'user'=>$user,'project'=>$project,'goal'=>$goal,'key'=>$key,'at'=>$at]);$this->pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,:revision,'VPS',:capability,'QUEUED',NULL,NULL,0,NULL,:checkpoint,NULL,:at,:at)")->execute(['execution'=>$execution,'task'=>$task,'project'=>$project,'revision'=>$revision,'capability'=>$capability,'checkpoint'=>json_encode($checkpoint,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'at'=>$at]);$this->pdo->prepare('INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:id,:task,\'QUEUED\',0,:message,:at)')->execute(['id'=>self::uuid(),'task'=>$task,'message'=>'AWH Hosting รับงานแล้ว','at'=>$at]); }
    private function event(string $site,?string $task,string $name,string $state,string $message,string $at): void { $this->pdo->prepare('INSERT INTO control_site_events(event_id,site_id,task_id,event_name,state,message,occurred_at) VALUES(:id,:site,:task,:name,:state,:message,:at)')->execute(['id'=>self::uuid(),'site'=>$site,'task'=>$task,'name'=>$name,'state'=>$state,'message'=>$message,'at'=>$at]); }
    private function rollback(): void { try{$this->pdo->exec('ROLLBACK');}catch(Throwable){} }
    private static function siteRow(array $r): array { $url=null;if(($r['binding_state']??null)==='ACTIVE'&&is_string($r['binding_host']??null)){if(($r['binding_kind']??null)==='IP_PORT'&&is_numeric($r['binding_port']))$url='https://'.$r['binding_host'].':'.(int)$r['binding_port'].'/';elseif(($r['binding_kind']??null)==='DOMAIN')$url='https://'.$r['binding_host'].'/';}return ['siteId'=>(string)$r['site_id'],'projectId'=>(string)$r['project_id'],'projectName'=>(string)$r['project_name'],'name'=>(string)$r['name'],'slug'=>(string)$r['slug'],'environment'=>(string)$r['environment'],'runtimeType'=>(string)$r['runtime_type'],'runtimeVersion'=>$r['runtime_version'],'databaseMode'=>(string)$r['database_mode'],'databaseState'=>$r['db_state'],'state'=>(string)$r['state'],'publicMode'=>(string)$r['public_mode'],'port'=>$r['listen_port']===null?null:(int)$r['listen_port'],'url'=>$url,'tlsMode'=>$r['tls_mode'],'bindingState'=>$r['binding_state'],'domainHost'=>$r['domain_host']??null,'domainState'=>$r['domain_state']??null,'primaryHost'=>$r['primary_host']??null,'source'=>['ready'=>is_string($r['source_revision_id']??null)&&self::validUuid((string)$r['source_revision_id'])&&($r['source_sync_state']??null)==='SYNCED','syncState'=>(string)($r['source_sync_state']??'EMPTY'),'revisionId'=>$r['source_revision_id']??null,'blockerCode'=>$r['source_blocker_code']??null],'lastEvent'=>['name'=>$r['last_event_name']??null,'state'=>$r['last_event_state']??null,'message'=>$r['last_event_message']??null,'at'=>$r['last_event_at']??null],'taskId'=>$r['active_deploy_task_id']??null,'taskState'=>$r['active_deploy_task_state']??null,'canCancel'=>is_string($r['active_deploy_task_state']??null)&&in_array((string)$r['active_deploy_task_state'],['QUEUED','WAITING_FOR_WORKER','WAITING_FOR_APPROVAL'],true),'backupEnabled'=>(int)$r['backup_enabled']===1,'currentReleaseId'=>$r['current_release_id'],'currentSourceRevisionId'=>$r['current_release_revision_id']??null,'rollbackReleaseId'=>$r['rollback_release_id'],'updatedAt'=>(string)$r['updated_at']]; }
    private static function domainHost(string $value): string { $host=strtolower(trim(rtrim($value,'.')));if(strlen($host)<1||strlen($host)>253||!preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/',$host))throw new HubManagedHostingException('ชื่อโดเมนไม่ถูกต้อง','DOMAIN_INVALID');return $host; }
    private static function keys(array $v,array $allowed): void { $a=array_keys($v);sort($a);sort($allowed);if($a!==$allowed)throw new HubManagedHostingException('Website fields are invalid','HOSTING_INVALID'); }
    private static function enum(mixed $v,array $allowed): string { if(!is_string($v)||!in_array(strtoupper($v),$allowed,true))throw new HubManagedHostingException('Website option is invalid','HOSTING_INVALID');return strtoupper($v); }
    private static function text(mixed $v,int $max): string { if(!is_string($v))throw new HubManagedHostingException('Website name is invalid','HOSTING_INVALID');$v=trim($v);if($v===''||strlen($v)>$max||preg_match('/[\x00-\x1f\x7f]/',$v))throw new HubManagedHostingException('Website name is invalid','HOSTING_INVALID');return $v; }
    private static function slug(string $v): string { $v=strtolower(trim($v));if(!preg_match('/^[a-z0-9][a-z0-9-]{1,47}$/',$v))throw new HubManagedHostingException('ชื่อย่อเว็บไซต์ใช้ a-z, 0-9 และ - เท่านั้น','HOSTING_INVALID');return $v; }
    private static function healthPath(string $v): string { $v=trim($v);if(!preg_match('#^/[A-Za-z0-9._~!$&\'()*+,;=:@%/-]{0,240}$#',$v)||str_contains($v,'..'))throw new HubManagedHostingException('Health path is invalid','HOSTING_INVALID');return $v; }
    private static function time(string $v): string { if(strtotime($v)===false)throw new HubManagedHostingException('Time is invalid','HOSTING_INVALID');return gmdate('c',strtotime($v)); }
    private static function validUuid(string $v): bool { return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$v)===1; }
    private static function uuid(?string $v=null): string { if($v!==null){if(!self::validUuid($v))throw new HubManagedHostingException('Identifier is invalid','HOSTING_INVALID');return strtolower($v);} $b=random_bytes(16);$b[6]=chr((ord($b[6])&15)|64);$b[8]=chr((ord($b[8])&63)|128);return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($b),4)); }
}
