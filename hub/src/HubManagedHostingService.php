<?php

declare(strict_types=1);

require_once __DIR__ . '/HubAccountHostingMigration.php';
require_once __DIR__ . '/HubOwnerAuthService.php';

final class HubManagedHostingException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='HOSTING_FAILED') { parent::__construct($message); }
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
        $owner=$this->ownerSession($token); $q=$this->pdo->prepare("SELECT s.*,p.name AS project_name,b.binding_kind,b.host AS binding_host,b.port AS binding_port,b.tls_mode,b.state AS binding_state,d.engine AS db_engine,d.state AS db_state FROM control_managed_sites s JOIN projects p ON p.project_id=s.project_id LEFT JOIN control_site_bindings b ON b.site_id=s.site_id AND b.is_primary=1 AND b.state<>'DISABLED' LEFT JOIN control_site_database_bindings d ON d.site_id=s.site_id WHERE s.created_by_user_id=:owner ORDER BY CASE s.state WHEN 'READY' THEN 0 WHEN 'PROVISIONING' THEN 1 WHEN 'QUEUED' THEN 2 ELSE 3 END,s.updated_at DESC LIMIT 200");
        $q->execute(['owner'=>$owner['user_id']]); return ['schemaVersion'=>1,'sites'=>array_map([self::class,'siteRow'],$q->fetchAll())];
    }

    public function createSite(string $token,string $csrf,array $payload,?string $now=null): array
    {
        $owner=$this->ownerMutation($token,$csrf,$now); self::keys($payload,['backupEnabled','databaseMode','environment','healthPath','name','projectId','publicMode','runtimeType','schemaVersion','slug']);
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
        $owner=$this->ownerMutation($token,$csrf,$now); self::keys($payload,['schemaVersion']);if(($payload['schemaVersion']??null)!==1)throw new HubManagedHostingException('Deploy request is invalid','HOSTING_INVALID');
        $site=$this->siteForOwner($siteId,(string)$owner['user_id']);$revision=$this->activeRevision((string)$site['project_id']);if($revision===null)throw new HubManagedHostingException('โปรเจกต์นี้ยังไม่มี Source ที่พร้อม Deploy','PROJECT_SOURCE_NOT_READY');
        $at=self::time($now??gmdate('c'));$task=self::uuid();$execution=self::uuid();try{$this->pdo->exec('BEGIN IMMEDIATE');$this->insertTask($task,$execution,(string)$owner['user_id'],(string)$site['project_id'],$revision,'Deploy รุ่นล่าสุดของ '.$site['name'],'hosting.site.deploy',['mode'=>'HOSTING_DEPLOY','siteId'=>$site['site_id']],$at);$this->event((string)$site['site_id'],$task,'DEPLOY_REQUESTED','QUEUED','AWH กำลังเตรียมรุ่นใหม่',$at);$this->pdo->exec('COMMIT');}catch(Throwable $error){$this->rollback();if($error instanceof HubManagedHostingException)throw $error;throw new HubManagedHostingException('Deploy could not be queued','HOSTING_DEPLOY_FAILED');}return ['siteId'=>$site['site_id'],'taskId'=>$task,'state'=>'QUEUED'];
    }

    public function rollbackSite(string $token,string $csrf,string $siteId,array $payload,?string $now=null): array
    {
        $owner=$this->ownerMutation($token,$csrf,$now);self::keys($payload,['schemaVersion']);if(($payload['schemaVersion']??null)!==1)throw new HubManagedHostingException('Rollback request is invalid','HOSTING_INVALID');$site=$this->siteForOwner($siteId,(string)$owner['user_id']);if(!is_string($site['rollback_release_id'])||$site['rollback_release_id']==='')throw new HubManagedHostingException('ยังไม่มี rollback point ที่ตรวจสอบแล้ว','ROLLBACK_NOT_READY');
        $at=self::time($now??gmdate('c'));$task=self::uuid();$execution=self::uuid();try{$this->pdo->exec('BEGIN IMMEDIATE');$this->insertTask($task,$execution,(string)$owner['user_id'],(string)$site['project_id'],null,'Rollback '.$site['name'].' ไปยังรุ่นก่อนหน้า','hosting.site.rollback',['mode'=>'HOSTING_ROLLBACK','siteId'=>$site['site_id'],'releaseId'=>$site['rollback_release_id']],$at);$this->event((string)$site['site_id'],$task,'ROLLBACK_REQUESTED','QUEUED','AWH กำลังตรวจ rollback point',$at);$this->pdo->exec('COMMIT');}catch(Throwable $error){$this->rollback();if($error instanceof HubManagedHostingException)throw $error;throw new HubManagedHostingException('Rollback could not be queued','HOSTING_ROLLBACK_FAILED');}return ['siteId'=>$site['site_id'],'taskId'=>$task,'state'=>'QUEUED'];
    }

    public function disableSite(string $token,string $csrf,string $siteId,array $payload,?string $now=null): array
    {
        $owner=$this->ownerMutation($token,$csrf,$now);self::keys($payload,['schemaVersion']);if(($payload['schemaVersion']??null)!==1)throw new HubManagedHostingException('Disable request is invalid','HOSTING_INVALID');$site=$this->siteForOwner($siteId,(string)$owner['user_id']);$at=self::time($now??gmdate('c'));$task=self::uuid();$execution=self::uuid();try{$this->pdo->exec('BEGIN IMMEDIATE');$this->insertTask($task,$execution,(string)$owner['user_id'],(string)$site['project_id'],null,'ปิดการเผยแพร่ '.$site['name'],'hosting.site.disable',['mode'=>'HOSTING_DISABLE','siteId'=>$site['site_id']],$at);$this->event((string)$site['site_id'],$task,'DISABLE_REQUESTED','QUEUED','AWH กำลังปิด public route อย่างปลอดภัย',$at);$this->pdo->exec('COMMIT');}catch(Throwable $error){$this->rollback();if($error instanceof HubManagedHostingException)throw $error;throw new HubManagedHostingException('Disable could not be queued','HOSTING_DISABLE_FAILED');}return ['siteId'=>$site['site_id'],'taskId'=>$task,'state'=>'QUEUED'];
    }

    private function ownerSession(string $token): array { $this->ready();$session=$this->auth->authenticatedUser($token);$this->assertOwner((string)$session['userId']);return ['user_id'=>$session['userId']]; }
    private function ownerMutation(string $token,string $csrf,?string $now): array { $this->ready();$row=$this->auth->authorize($token,$csrf,$now);$this->assertOwner((string)$row['user_id']);HubOwnerAuthService::assertRecentStepUpSession($row,$now);return $row; }
    private function ready(): void { HubAccountHostingMigration::assertCapabilityReady($this->pdo,dirname(__DIR__).'/migrations/016_account_hosting.sql'); }
    private function assertOwner(string $user): void { $owner=$this->pdo->query('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id=1 AND bootstrap_closed=1')->fetchColumn();if(!is_string($owner)||!hash_equals($owner,$user))throw new HubManagedHostingException('Owner access is required','OWNER_FORBIDDEN'); }
    private function assertOwnerProject(string $user,string $project): void { $q=$this->pdo->prepare("SELECT 1 FROM control_project_capabilities WHERE user_id=:user AND project_id=:project AND capability='project.read' AND revoked_at IS NULL");$q->execute(['user'=>$user,'project'=>$project]);if($q->fetchColumn()===false)throw new HubManagedHostingException('Project is not available','PROJECT_FORBIDDEN'); }
    private function activeRevision(string $project): ?string { $q=$this->pdo->prepare("SELECT active_revision_id FROM control_project_vaults WHERE project_id=:project AND sync_state='SYNCED'");$q->execute(['project'=>$project]);$v=$q->fetchColumn();return is_string($v)&&self::validUuid($v)?strtolower($v):null; }
    private function nextPort(): int { $used=array_map('intval',array_column($this->pdo->query("SELECT listen_port FROM control_managed_sites WHERE listen_port IS NOT NULL AND state<>'DISABLED'")->fetchAll(),'listen_port'));for($p=8400;$p<=8999;$p++)if(!in_array($p,$used,true))return $p;throw new HubManagedHostingException('VPS public port pool is full','HOSTING_CAPACITY_FULL'); }
    private function siteForOwner(string $siteId,string $owner): array { $id=self::uuid($siteId);$q=$this->pdo->prepare('SELECT * FROM control_managed_sites WHERE site_id=:site AND created_by_user_id=:owner');$q->execute(['site'=>$id,'owner'=>$owner]);$row=$q->fetch();if(!is_array($row))throw new HubManagedHostingException('Website was not found','SITE_NOT_FOUND');return $row; }
    private function insertTask(string $task,string $execution,string $user,string $project,?string $revision,string $goal,string $capability,array $checkpoint,string $at): void { $key='hosting-'.substr(hash('sha256',$task),0,48);$this->pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,:goal,'QUEUED',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$task,'user'=>$user,'project'=>$project,'goal'=>$goal,'key'=>$key,'at'=>$at]);$this->pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,:revision,'VPS',:capability,'QUEUED',NULL,NULL,0,NULL,:checkpoint,NULL,:at,:at)")->execute(['execution'=>$execution,'task'=>$task,'project'=>$project,'revision'=>$revision,'capability'=>$capability,'checkpoint'=>json_encode($checkpoint,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'at'=>$at]);$this->pdo->prepare('INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:id,:task,\'QUEUED\',0,:message,:at)')->execute(['id'=>self::uuid(),'task'=>$task,'message'=>'AWH Hosting รับงานแล้ว','at'=>$at]); }
    private function event(string $site,?string $task,string $name,string $state,string $message,string $at): void { $this->pdo->prepare('INSERT INTO control_site_events(event_id,site_id,task_id,event_name,state,message,occurred_at) VALUES(:id,:site,:task,:name,:state,:message,:at)')->execute(['id'=>self::uuid(),'site'=>$site,'task'=>$task,'name'=>$name,'state'=>$state,'message'=>$message,'at'=>$at]); }
    private function rollback(): void { try{$this->pdo->exec('ROLLBACK');}catch(Throwable){} }
    private static function siteRow(array $r): array { $url=null;if(($r['binding_state']??null)==='ACTIVE'&&is_string($r['binding_host']??null)){if(($r['binding_kind']??null)==='IP_PORT'&&is_numeric($r['binding_port']))$url='https://'.$r['binding_host'].':'.(int)$r['binding_port'].'/';elseif(($r['binding_kind']??null)==='DOMAIN')$url='https://'.$r['binding_host'].'/';}return ['siteId'=>(string)$r['site_id'],'projectId'=>(string)$r['project_id'],'projectName'=>(string)$r['project_name'],'name'=>(string)$r['name'],'slug'=>(string)$r['slug'],'environment'=>(string)$r['environment'],'runtimeType'=>(string)$r['runtime_type'],'runtimeVersion'=>$r['runtime_version'],'databaseMode'=>(string)$r['database_mode'],'databaseState'=>$r['db_state'],'state'=>(string)$r['state'],'publicMode'=>(string)$r['public_mode'],'port'=>$r['listen_port']===null?null:(int)$r['listen_port'],'url'=>$url,'tlsMode'=>$r['tls_mode'],'bindingState'=>$r['binding_state'],'backupEnabled'=>(int)$r['backup_enabled']===1,'currentReleaseId'=>$r['current_release_id'],'rollbackReleaseId'=>$r['rollback_release_id'],'updatedAt'=>(string)$r['updated_at']]; }
    private static function keys(array $v,array $allowed): void { $a=array_keys($v);sort($a);sort($allowed);if($a!==$allowed)throw new HubManagedHostingException('Website fields are invalid','HOSTING_INVALID'); }
    private static function enum(mixed $v,array $allowed): string { if(!is_string($v)||!in_array(strtoupper($v),$allowed,true))throw new HubManagedHostingException('Website option is invalid','HOSTING_INVALID');return strtoupper($v); }
    private static function text(mixed $v,int $max): string { if(!is_string($v))throw new HubManagedHostingException('Website name is invalid','HOSTING_INVALID');$v=trim($v);if($v===''||strlen($v)>$max||preg_match('/[\x00-\x1f\x7f]/',$v))throw new HubManagedHostingException('Website name is invalid','HOSTING_INVALID');return $v; }
    private static function slug(string $v): string { $v=strtolower(trim($v));if(!preg_match('/^[a-z0-9][a-z0-9-]{1,47}$/',$v))throw new HubManagedHostingException('ชื่อย่อเว็บไซต์ใช้ a-z, 0-9 และ - เท่านั้น','HOSTING_INVALID');return $v; }
    private static function healthPath(string $v): string { $v=trim($v);if(!preg_match('#^/[A-Za-z0-9._~!$&\'()*+,;=:@%/-]{0,240}$#',$v)||str_contains($v,'..'))throw new HubManagedHostingException('Health path is invalid','HOSTING_INVALID');return $v; }
    private static function time(string $v): string { if(strtotime($v)===false)throw new HubManagedHostingException('Time is invalid','HOSTING_INVALID');return gmdate('c',strtotime($v)); }
    private static function validUuid(string $v): bool { return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$v)===1; }
    private static function uuid(?string $v=null): string { if($v!==null){if(!self::validUuid($v))throw new HubManagedHostingException('Identifier is invalid','HOSTING_INVALID');return strtolower($v);} $b=random_bytes(16);$b[6]=chr((ord($b[6])&15)|64);$b[8]=chr((ord($b[8])&63)|128);return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($b),4)); }
}
