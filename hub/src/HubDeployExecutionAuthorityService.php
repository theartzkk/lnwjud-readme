<?php

declare(strict_types=1);

require_once __DIR__ . '/HubCapabilityRegistryService.php';
require_once __DIR__ . '/HubCoreReleaseService.php';

final class HubDeployExecutionAuthorityException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'DEPLOY_AUTHORITY_FAILED')
    {
        parent::__construct($message);
    }
}

final class HubDeployExecutionAuthorityService
{
    public function __construct(private readonly PDO $pdo)
    {
        $this->pdo->exec('PRAGMA foreign_keys = ON');
        $this->pdo->exec('PRAGMA busy_timeout = 5000');
    }

    /** @return array{releasedTerminal:int,releasedExpired:int} */
    public function reconcile(?string $now = null): array
    {
        $this->assertSchema();
        try {
            return (new HubCapabilityRegistryService($this->pdo))
                ->reconcileExecutionAuthority(self::timestamp($now ?? gmdate('c')));
        } catch (HubCapabilityRegistryException $error) {
            throw new HubDeployExecutionAuthorityException('Execution authority reconciliation failed', $error->codeName);
        }
    }

    /** @return array{executionId:string,taskId:string,projectId:string,leaseExpiresAt:string,borrowed:bool} */
    public function acquire(string $releaseId, int $leaseSeconds = 1800, ?string $now = null): array
    {
        $this->assertSchema();
        if (preg_match('/^(awh|platform|m[0-9]+)-([0-9a-f]{12})(?:-r[1-9][0-9]{0,2})?$/i', $releaseId, $releaseMatch) !== 1) {
            throw new HubDeployExecutionAuthorityException('Release identity is invalid', 'DEPLOY_AUTHORITY_INVALID');
        }
        $releaseFamily = strtolower((string)$releaseMatch[1]);
        $releasePrefix = strtolower((string)$releaseMatch[2]);
        $expectedParentCapability = $releaseFamily === 'awh' ? HubCoreReleaseService::CAPABILITY : ($releaseFamily === 'platform' ? HubCoreReleaseService::PLATFORM_CAPABILITY : null);
        $expectedTrack = $releaseFamily === 'awh' ? 'awh' : ($releaseFamily === 'platform' ? 'vps-platform' : null);
        if ($leaseSeconds < 300 || $leaseSeconds > 3600) {
            throw new HubDeployExecutionAuthorityException('Deploy lease is outside the safety bound', 'DEPLOY_AUTHORITY_INVALID');
        }
        $at = self::timestamp($now ?? gmdate('c'));
        $lease = gmdate('c', strtotime($at) + $leaseSeconds);
        $this->reconcile($at);

        $this->pdo->exec('BEGIN IMMEDIATE');
        try {
            $projects = $this->pdo->query("SELECT project_id FROM projects WHERE name='Art’s Workspace Hub' ORDER BY project_id LIMIT 2")->fetchAll();
            if (count($projects) !== 1 || !is_string($projects[0]['project_id'] ?? null)) {
                throw new HubDeployExecutionAuthorityException('Canonical AWH Project is unavailable', 'DEPLOY_AUTHORITY_PROJECT');
            }
            $projectId = (string) $projects[0]['project_id'];
            $owner = $this->pdo->query("SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id=1 AND bootstrap_closed=1")->fetchColumn();
            if (!is_string($owner) || !self::validUuid($owner)) {
                throw new HubDeployExecutionAuthorityException('Owner authority is unavailable', 'DEPLOY_AUTHORITY_OWNER');
            }

            // AWH and VPS Platform releases must reuse their exact Owner-approved
            // parent execution. This prevents a nested guarded deploy from creating
            // a second or broader writer authority.
            $parent = $this->pdo->prepare("SELECT e.execution_id,e.task_id,e.required_capability,e.checkpoint_json FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id WHERE e.project_id=:project AND e.required_capability IN (:core,:platform) AND e.executor_kind='VPS' AND e.state IN ('LEASED','RUNNING') AND t.state IN ('RUNNING','WAITING_FOR_WORKER') AND EXISTS(SELECT 1 FROM control_approvals a WHERE a.task_id=e.task_id AND a.action='deployment.approve' AND a.status='APPROVED') ORDER BY e.updated_at DESC,e.execution_id DESC");
            $parent->execute(['project'=>$projectId,'core'=>HubCoreReleaseService::CAPABILITY,'platform'=>HubCoreReleaseService::PLATFORM_CAPABILITY]);
            foreach ($parent->fetchAll() as $candidate) {
                $candidateCapability=(string)($candidate['required_capability']??'');
                $legacyPlatformBootstrap=false;
                try {
                    if ($expectedParentCapability === null) {
                        $checkpoint=json_decode((string)$candidate['checkpoint_json'],true,16,JSON_THROW_ON_ERROR);
                        if(!is_array($checkpoint)||array_is_list($checkpoint))continue;
                    } elseif (
                        $releaseFamily==='platform'
                        && hash_equals(HubCoreReleaseService::CAPABILITY,$candidateCapability)
                    ) {
                        $checkpoint=json_decode((string)$candidate['checkpoint_json'],true,16,JSON_THROW_ON_ERROR);
                        if(!is_array($checkpoint)||array_is_list($checkpoint))continue;
                        $legacyPlatformBootstrap=($checkpoint['releaseMode']??null)==='PLATFORM_HARDENING'
                            && !array_key_exists('releaseTrack',$checkpoint);
                        if(!$legacyPlatformBootstrap)continue;
                    } else {
                        $checkpoint=HubCoreReleaseService::checkpoint((string)$candidate['checkpoint_json']);
                    }
                } catch (Throwable) { continue; }
                $sha=strtolower((string)($checkpoint['releaseSha']??''));
                $candidateTrack=$legacyPlatformBootstrap?'vps-platform':(string)($checkpoint['releaseTrack']??'');
                if (preg_match('/^[0-9a-f]{40}$/',$sha)!==1 || !hash_equals(substr($sha,0,12),$releasePrefix)) continue;
                if (is_string($expectedParentCapability) && !hash_equals($expectedParentCapability,$candidateCapability) && !$legacyPlatformBootstrap) continue;
                if (is_string($expectedTrack) && !hash_equals($expectedTrack,$candidateTrack)) continue;
                $registry=new HubCapabilityRegistryService($this->pdo);
                if($releaseFamily==='platform'){
                    $registry->updateEnvelopeState((string)$candidate['execution_id'],'WAITING',null,$at,true);
                    $this->updateReleaseExecutionPhase((string)$candidate['execution_id'],'CUTOVER',$at);
                }
                $authority=$registry->activateExecutionAuthority((string)$candidate['execution_id'],$lease,$at,true);
                if (($authority['granted']??false)!==true) throw new HubDeployExecutionAuthorityException('Owner-approved release authority is blocked','DEPLOY_AUTHORITY_CONFLICT');
                $this->pdo->prepare("UPDATE control_task_executions SET lease_expires_at=:lease,updated_at=:at WHERE execution_id=:execution AND state IN ('LEASED','RUNNING')")
                    ->execute(['lease'=>$lease,'at'=>$at,'execution'=>$candidate['execution_id']]);
                $this->pdo->prepare("UPDATE control_tasks SET state='RUNNING',assigned_device_id=NULL,lease_expires_at=:lease,progress=CASE WHEN progress<55 THEN 55 ELSE progress END,updated_at=:at WHERE task_id=:task AND state IN ('RUNNING','WAITING_FOR_WORKER')")
                    ->execute(['lease'=>$lease,'at'=>$at,'task'=>$candidate['task_id']]);
                $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:id,:task,'RUNNING',35,'Guarded deployment borrowed owner-approved release authority',:at)")
                    ->execute(['id'=>self::uuid(),'task'=>$candidate['task_id'],'at'=>$at]);
                $this->pdo->exec('COMMIT');
                return ['executionId'=>(string)$candidate['execution_id'],'taskId'=>(string)$candidate['task_id'],'projectId'=>$projectId,'leaseExpiresAt'=>$lease,'borrowed'=>true];
            }
            if ($expectedParentCapability !== null) {
                throw new HubDeployExecutionAuthorityException('Owner-approved release parent is required for this release track','DEPLOY_AUTHORITY_PARENT_REQUIRED');
            }

            $taskId = self::uuid();
            $executionId = self::uuid();
            $activeRevision = $this->pdo->prepare("SELECT active_revision_id FROM control_project_vaults WHERE project_id=:project");
            $activeRevision->execute(['project' => $projectId]);
            $baseRevision = $activeRevision->fetchColumn();
            if (!is_string($baseRevision) || !self::validUuid($baseRevision)) $baseRevision = null;
            $goal = 'Guarded deploy ' . $releaseId;
            $idempotency = 'guarded-deploy-' . strtolower($releaseId) . '-' . substr($executionId, 0, 8);

            $task = $this->pdo->prepare("INSERT INTO control_tasks
                (task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at)
                VALUES(:task,:user,:project,:goal,'RUNNING',NULL,:lease,0,NULL,NULL,:key,NULL,:at,:at,NULL)");
            $task->execute(['task'=>$taskId,'user'=>$owner,'project'=>$projectId,'goal'=>$goal,'lease'=>$lease,'key'=>$idempotency,'at'=>$at]);
            $execution = $this->pdo->prepare("INSERT INTO control_task_executions
                (execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at)
                VALUES(:execution,:task,:project,:revision,'VPS','project.mutate.deploy','RUNNING',:owner,:lease,1,NULL,:checkpoint,NULL,:at,:at)");
            $execution->execute([
                'execution'=>$executionId,'task'=>$taskId,'project'=>$projectId,'revision'=>$baseRevision,
                'owner'=>'guarded-deploy:'.$releaseId,'lease'=>$lease,
                'checkpoint'=>json_encode(['releaseId'=>$releaseId], JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'at'=>$at
            ]);
            $registry = new HubCapabilityRegistryService($this->pdo);
            $authority = $registry->activateExecutionAuthority($executionId, $lease, $at, true);
            if (($authority['granted'] ?? false) !== true) {
                throw new HubDeployExecutionAuthorityException(
                    'Another mutating execution owns this project',
                    'DEPLOY_AUTHORITY_CONFLICT'
                );
            }
            $event = $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at)
                VALUES(:id,:task,'RUNNING',0,'Guarded deployment acquired single-writer authority',:at)");
            $event->execute(['id'=>self::uuid(),'task'=>$taskId,'at'=>$at]);
            $this->pdo->exec('COMMIT');
            return ['executionId'=>$executionId,'taskId'=>$taskId,'projectId'=>$projectId,'leaseExpiresAt'=>$lease,'borrowed'=>false];
        } catch (Throwable $error) {
            $this->rollback();
            if ($error instanceof HubDeployExecutionAuthorityException) throw $error;
            throw new HubDeployExecutionAuthorityException('Deploy authority could not be acquired');
        }
    }

    /** @return array{executionId:string,projectId:string,leaseExpiresAt:string} */
    public function verify(string $executionId, int $leaseSeconds = 1800, ?string $now = null): array
    {
        $this->assertSchema();
        if (!self::validUuid($executionId) || $leaseSeconds < 300 || $leaseSeconds > 3600) {
            throw new HubDeployExecutionAuthorityException('Execution identity is invalid', 'DEPLOY_AUTHORITY_INVALID');
        }
        $at=self::timestamp($now??gmdate('c'));$lease=gmdate('c',strtotime($at)+$leaseSeconds);
        $this->pdo->exec('BEGIN IMMEDIATE');
        try {
            $row=$this->pdo->prepare("SELECT e.project_id,e.state,t.state AS task_state FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id WHERE e.execution_id=:execution");
            $row->execute(['execution'=>$executionId]);$meta=$row->fetch();
            if(!is_array($meta)||!in_array((string)$meta['state'],['LEASED','RUNNING'],true)||(string)$meta['task_state']!=='RUNNING')
                throw new HubDeployExecutionAuthorityException('Deploy execution is not runnable','DEPLOY_AUTHORITY_INVALID');
            $authority=(new HubCapabilityRegistryService($this->pdo))->activateExecutionAuthority($executionId,$lease,$at,true);
            if(($authority['granted']??false)!==true)throw new HubDeployExecutionAuthorityException('Deploy authority is blocked','DEPLOY_AUTHORITY_CONFLICT');
            $this->pdo->prepare("UPDATE control_task_executions SET lease_expires_at=:lease,updated_at=:at WHERE execution_id=:execution")
                ->execute(['lease'=>$lease,'at'=>$at,'execution'=>$executionId]);
            $this->pdo->exec('COMMIT');
            return ['executionId'=>$executionId,'projectId'=>(string)$meta['project_id'],'leaseExpiresAt'=>$lease];
        } catch(Throwable $error) {
            $this->rollback();
            if($error instanceof HubDeployExecutionAuthorityException)throw $error;
            throw new HubDeployExecutionAuthorityException('Deploy authority could not be verified');
        }
    }

    /** @return array{recorded:bool,progress:int,message:?string} */
    public function stage(string $executionId,string $stage,?string $now=null): array
    {
        $this->assertSchema();
        if(!self::validUuid($executionId)||preg_match('/^[A-Z][A-Z0-9_]{2,63}$/',$stage)!==1)
            throw new HubDeployExecutionAuthorityException('Deploy stage identity is invalid','DEPLOY_AUTHORITY_INVALID');
        $detail=self::stageDetail($stage);
        if($detail===null)return ['recorded'=>false,'progress'=>0,'message'=>null];
        $at=self::timestamp($now??gmdate('c'));
        $this->pdo->exec('BEGIN IMMEDIATE');
        try{
            $q=$this->pdo->prepare("SELECT e.task_id,e.state,e.required_capability,t.state AS task_state,t.progress
                FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id
                WHERE e.execution_id=:execution");
            $q->execute(['execution'=>strtolower($executionId)]);$row=$q->fetch();
            if(!is_array($row)||!in_array((string)$row['state'],['LEASED','RUNNING'],true)||(string)$row['task_state']!=='RUNNING'
                ||!in_array((string)$row['required_capability'],[HubCoreReleaseService::CAPABILITY,HubCoreReleaseService::PLATFORM_CAPABILITY,'project.mutate.deploy'],true))
                throw new HubDeployExecutionAuthorityException('Deploy execution is not runnable','DEPLOY_AUTHORITY_INVALID');
            if(is_string($detail['phase']??null))$this->updateReleaseExecutionPhase(strtolower($executionId),(string)$detail['phase'],$at);
            $currentProgress=(int)$row['progress'];
            if((int)$detail['progress']<$currentProgress){
                $this->pdo->exec('COMMIT');
                return ['recorded'=>false,'progress'=>$currentProgress,'message'=>null];
            }
            $progress=max($currentProgress,(int)$detail['progress']);
            $taskId=(string)$row['task_id'];
            $last=$this->pdo->prepare("SELECT progress,message FROM control_task_events WHERE task_id=:task ORDER BY occurred_at DESC,event_id DESC LIMIT 1");
            $last->execute(['task'=>$taskId]);$previous=$last->fetch();
            if(is_array($previous)&&(int)$previous['progress']===$progress&&(string)($previous['message']??'')===(string)$detail['message']){
                $this->pdo->prepare("UPDATE control_tasks SET updated_at=:at WHERE task_id=:task AND state='RUNNING'")->execute(['at'=>$at,'task'=>$taskId]);
                $this->pdo->prepare("UPDATE control_task_executions SET updated_at=:at WHERE execution_id=:execution AND state IN ('LEASED','RUNNING')")->execute(['at'=>$at,'execution'=>strtolower($executionId)]);
                $this->pdo->exec('COMMIT');
                return ['recorded'=>false,'progress'=>$progress,'message'=>(string)$detail['message']];
            }
            $this->pdo->prepare("UPDATE control_tasks SET progress=:progress,updated_at=:at WHERE task_id=:task AND state='RUNNING'")
                ->execute(['progress'=>$progress,'at'=>$at,'task'=>$taskId]);
            $this->pdo->prepare("UPDATE control_task_executions SET updated_at=:at WHERE execution_id=:execution AND state IN ('LEASED','RUNNING')")
                ->execute(['at'=>$at,'execution'=>strtolower($executionId)]);
            $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at)
                VALUES(:id,:task,'RUNNING',:progress,:message,:at)")
                ->execute(['id'=>self::uuid(),'task'=>$taskId,'progress'=>$progress,'message'=>(string)$detail['message'],'at'=>$at]);
            $this->pdo->exec('COMMIT');
            return ['recorded'=>true,'progress'=>$progress,'message'=>(string)$detail['message']];
        }catch(Throwable $error){
            $this->rollback();
            if($error instanceof HubDeployExecutionAuthorityException)throw $error;
            throw new HubDeployExecutionAuthorityException('Deploy stage could not be recorded');
        }
    }

    /** @return array{progress:int,message:string,phase?:string}|null */
    private static function stageDetail(string $stage): ?array
    {
        return match($stage){
            'RELEASE_PREFLIGHT'=>['progress'=>24,'message'=>'ตรวจ Source และเครื่องมือเรียบร้อยแล้ว · กำลังเตรียม QA','phase'=>'PREFLIGHT'],
            'RELEASE_QA_STARTED'=>['progress'=>28,'message'=>'กำลังรัน QA ตามความเสี่ยงของรุ่นนี้','phase'=>'QA'],
            'RELEASE_QA_PASSED'=>['progress'=>38,'message'=>'QA ผ่านแล้ว · กำลังเตรียม dry-run และ rollback rehearsal','phase'=>'QA'],
            'RELEASE_REHEARSAL_STARTED'=>['progress'=>42,'message'=>'กำลังจำลอง deploy และ rollback ก่อนแตะ Production','phase'=>'REHEARSAL'],
            'RELEASE_REHEARSAL_PASSED'=>['progress'=>50,'message'=>'Dry-run และ rollback rehearsal ผ่านแล้ว','phase'=>'REHEARSAL'],
            'RELEASE_CUTOVER_WAIT'=>['progress'=>52,'message'=>'พร้อมติดตั้ง · กำลังรอเฉพาะช่วง shared-host cutover ที่ปลอดภัย','phase'=>'WAIT_CUTOVER'],
            'EXECUTION_AUTHORITY_ACQUIRED'=>['progress'=>55,'message'=>'สำรองข้อมูลและไฟล์รุ่นใหม่พร้อมแล้ว · กำลังเริ่มติดตั้ง','phase'=>'CUTOVER'],
            'RUNTIME_LINEAGE_READY'=>['progress'=>60,'message'=>'Runtime lineage พร้อมแล้ว กำลังตรวจ dependency และ migration'],
            'NATIVE_EXECUTOR_QUIESCED','HOSTING_OPERATOR_QUIESCED'=>['progress'=>64,'message'=>'พัก writer ชั่วคราวอย่างปลอดภัย กำลังปรับระบบ'],
            'PLATFORM_HARDENING_MIGRATION_VERIFIED','IDENTITY_CONVERGENCE_MIGRATION_VERIFIED','VAULT_SOURCE_MIGRATION_VERIFIED','PROJECTS_READY'=>['progress'=>68,'message'=>'ฐานข้อมูลและ migration ผ่านการตรวจแล้ว'],
            'CONTROL_POINTER'=>['progress'=>74,'message'=>'เปิด Control Plane รุ่นใหม่แล้ว'],
            'PLATFORM_RUNTIME_READY','MAINTENANCE_RUNTIME_READY'=>['progress'=>77,'message'=>'Runtime service พร้อมแล้ว'],
            'PHP_FPM_RELOAD'=>['progress'=>79,'message'=>'กำลังโหลดบริการเว็บรุ่นใหม่'],
            'WEB_MANIFEST_VERIFIED'=>['progress'=>82,'message'=>'ไฟล์เว็บรุ่นใหม่ผ่าน manifest verification แล้ว'],
            'WEB_POINTER_SWITCH'=>['progress'=>84,'message'=>'สลับหน้าเว็บไปยังรุ่นใหม่แล้ว'],
            'NGINX_CONFIGURED','SERVICE_RELOAD'=>['progress'=>88,'message'=>'เปิดบริการรุ่นใหม่แล้ว กำลังตรวจการทำงาน'],
            'OWNER_AUTH_WEB_SURFACE','CONTROL_ROUTE'=>['progress'=>90,'message'=>'หน้าเว็บและเส้นทาง Control ผ่านการตรวจแล้ว'],
            'M3D_REGRESSION'=>['progress'=>92,'message'=>'Regression ชุดแรกผ่านแล้ว'],
            'M3E_POST_SCHEMA_REGRESSION'=>['progress'=>94,'message'=>'Regression หลัง schema ผ่านแล้ว'],
            'PROJECT_VAULT_SOURCE_SYNC'=>['progress'=>95,'message'=>'Source และ AWH Vault ซิงก์แล้ว'],
            'SOURCE_DRIFT_VERIFY'=>['progress'=>97,'message'=>'กำลังตรวจ Source drift รอบสุดท้าย'],
            'SOURCE_DRIFT_VERIFIED'=>['progress'=>99,'message'=>'ตรวจ Source drift ผ่านแล้ว กำลังปิด release'],
            'RELEASE_FINALIZE'=>['progress'=>99,'message'=>'Production cutover ผ่านแล้ว · กำลังยืนยัน public release และปิดงาน','phase'=>'FINALIZE'],
            default=>null,
        };
    }

    public function release(string $executionId, bool $success, ?string $now = null): void
    {
        $this->assertSchema();
        if (!self::validUuid($executionId)) {
            throw new HubDeployExecutionAuthorityException('Execution identity is invalid', 'DEPLOY_AUTHORITY_INVALID');
        }
        $at = self::timestamp($now ?? gmdate('c'));
        $this->pdo->exec('BEGIN IMMEDIATE');
        try {
            $q = $this->pdo->prepare("SELECT x.task_id,e.required_capability FROM control_execution_envelopes x JOIN control_task_executions e ON e.execution_id=x.execution_id WHERE x.execution_id=:execution");
            $q->execute(['execution'=>$executionId]);
            $row=$q->fetch();
            if (!is_array($row)) {
                $this->pdo->exec('COMMIT');
                return;
            }
            // Borrowed AWH/VPS Platform release authority is owned by the parent
            // operator; guarded deploy must never terminate that task itself.
            if (in_array((string)$row['required_capability'],[HubCoreReleaseService::CAPABILITY,HubCoreReleaseService::PLATFORM_CAPABILITY],true)) {
                $this->updateReleaseExecutionPhase($executionId,'FINALIZE',$at);
                $this->pdo->prepare("UPDATE control_task_executions SET updated_at=:at WHERE execution_id=:execution AND state IN ('LEASED','RUNNING')")->execute(['at'=>$at,'execution'=>$executionId]);
                $this->pdo->prepare("UPDATE control_tasks SET updated_at=:at WHERE task_id=:task AND state='RUNNING'")->execute(['at'=>$at,'task'=>$row['task_id']]);
                $this->pdo->exec('COMMIT');
                return;
            }
            $taskId=(string)$row['task_id'];
            $terminal = $success ? 'COMPLETED' : 'FAILED';
            $summary = $success ? 'Guarded deployment completed' : 'Guarded deployment failed and released authority';
            (new HubCapabilityRegistryService($this->pdo))
                ->updateEnvelopeState($executionId, 'RELEASED', null, $at);
            $this->pdo->prepare("UPDATE control_task_executions
                SET state=:state,lease_owner=NULL,lease_expires_at=NULL,last_error_code=:error,updated_at=:at
                WHERE execution_id=:execution")
                ->execute(['state'=>$terminal,'error'=>$success?null:'DEPLOY_FAILED','at'=>$at,'execution'=>$executionId]);
            $this->pdo->prepare("UPDATE control_tasks
                SET state=:state,lease_expires_at=NULL,progress=100,result_summary=:summary,failure_code=:error,updated_at=:at
                WHERE task_id=:task")
                ->execute(['state'=>$terminal,'summary'=>$summary,'error'=>$success?null:'DEPLOY_FAILED','at'=>$at,'task'=>$taskId]);
            $event = $this->pdo->prepare("INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at)
                VALUES(:id,:task,:state,100,:message,:at)");
            $event->execute(['id'=>self::uuid(),'task'=>$taskId,'state'=>$terminal,'message'=>$summary,'at'=>$at]);
            $this->pdo->exec('COMMIT');
        } catch (Throwable $error) {
            $this->rollback();
            if ($error instanceof HubDeployExecutionAuthorityException) throw $error;
            throw new HubDeployExecutionAuthorityException('Deploy authority could not be released');
        }
    }

    private function updateReleaseExecutionPhase(string $executionId,string $phase,string $at): void
    {
        if(!in_array($phase,['QUEUED','PREFLIGHT','QA','REHEARSAL','WAIT_CUTOVER','CUTOVER','ROLLBACK','FINALIZE'],true))
            throw new HubDeployExecutionAuthorityException('Release execution phase is invalid','DEPLOY_AUTHORITY_INVALID');
        $q=$this->pdo->prepare("SELECT required_capability,checkpoint_json FROM control_task_executions WHERE execution_id=:execution");
        $q->execute(['execution'=>strtolower($executionId)]);$row=$q->fetch();
        if(!is_array($row)||!in_array((string)$row['required_capability'],[HubCoreReleaseService::CAPABILITY,HubCoreReleaseService::PLATFORM_CAPABILITY],true))return;
        $checkpoint=HubCoreReleaseService::checkpoint((string)$row['checkpoint_json'],false);
        $current=$checkpoint['releaseExecution']??null;
        if(!is_array($current))return;
        if(($current['phase']??null)===$phase)return;
        $checkpoint['releaseExecution']=['schemaVersion'=>1,'phase'=>$phase,'phaseStartedAt'=>$at];
        $json=json_encode($checkpoint,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        HubCoreReleaseService::checkpoint($json);
        $this->pdo->prepare("UPDATE control_task_executions SET checkpoint_json=:checkpoint,updated_at=:at WHERE execution_id=:execution")
            ->execute(['checkpoint'=>$json,'at'=>$at,'execution'=>strtolower($executionId)]);
    }

    private function assertSchema(): void
    {
        foreach (['projects','owner_bootstrap','control_tasks','control_task_executions','control_execution_envelopes','control_task_events'] as $table) {
            $q = $this->pdo->prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=:name");
            $q->execute(['name'=>$table]);
            if ((int)$q->fetchColumn() !== 1) {
                throw new HubDeployExecutionAuthorityException('Execution authority schema is not ready', 'DEPLOY_AUTHORITY_SCHEMA');
            }
        }
    }

    private function rollback(): void
    {
        try { $this->pdo->exec('ROLLBACK'); } catch (Throwable) {}
    }

    private static function validUuid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value) === 1;
    }

    private static function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }

    private static function timestamp(string $value): string
    {
        $time = strtotime($value);
        if ($time === false) throw new HubDeployExecutionAuthorityException('Authority time is invalid', 'DEPLOY_AUTHORITY_INVALID');
        return gmdate('c', $time);
    }
}
