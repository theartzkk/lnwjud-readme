<?php

declare(strict_types=1);

final class HubCapabilityRegistryException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'CAPABILITY_REGISTRY_FAILED') { parent::__construct($message); }
}

/**
 * M13 discovery/routing projection. It never owns Projects, tasks, memory,
 * source, approvals or worker authentication; those remain existing AWH authorities.
 */
final class HubCapabilityRegistryService
{
    private const PROVIDER_KINDS = ['VPS','DEVICE','CODEX','MCP','API','BURST'];
    private const AVAILABILITY = ['ALWAYS_ON','ON_DEMAND','OPTIONAL_DEVICE'];
    private const COST = ['INCLUDED','PREPAID','LOCAL_FREE','METERED'];
    private const ENVELOPE_STATES = ['OPEN','ACTIVE','WAITING','RELEASED','CONFLICT','CANCELLED'];
    public const EXECUTION_POLICY_VERSION = '2.1-resource';

    public function __construct(private readonly PDO $pdo) {}

    public static function schemaPresent(PDO $pdo): bool
    {
        $q = $pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('control_capability_sources','control_capability_catalog','control_execution_providers','control_execution_provider_capabilities','control_execution_envelopes')");
        return (int) $q->fetchColumn() === 5;
    }

    /** @param list<string> $capabilities @param array<string,mixed> $metadata */
    public function advertiseProvider(string $providerId, string $kind, string $displayName, string $availabilityMode, string $costClass, int $priority, array $capabilities, string $now, ?string $expiresAt = null, array $metadata = []): void
    {
        $this->assertReady(); $providerId = self::providerId($providerId); $kind = strtoupper($kind); $availabilityMode = strtoupper($availabilityMode); $costClass = strtoupper($costClass);
        if (!in_array($kind, self::PROVIDER_KINDS, true) || !in_array($availabilityMode, self::AVAILABILITY, true) || !in_array($costClass, self::COST, true) || $priority < 0 || $priority > 999) throw new HubCapabilityRegistryException('Execution provider policy is invalid', 'CAPABILITY_PROVIDER_INVALID');
        $displayName = self::text($displayName, 80); $at = self::timestamp($now); $expires = $expiresAt === null ? null : self::timestamp($expiresAt); $meta = self::metadata($metadata);
        $caps = []; foreach ($capabilities as $capability) { if (!is_string($capability)) throw new HubCapabilityRegistryException('Execution capability is invalid', 'CAPABILITY_INVALID'); $caps[] = self::capability($capability); }
        $caps = array_values(array_unique($caps)); if (count($caps) > 64) throw new HubCapabilityRegistryException('Execution provider advertises too many capabilities', 'CAPABILITY_PROVIDER_INVALID');        try {
            $this->pdo->beginTransaction();
            $upsert = $this->pdo->prepare('INSERT INTO control_execution_providers(provider_id,provider_kind,display_name,availability_mode,cost_class,priority,enabled,observed_at,expires_at,metadata_json) VALUES(:id,:kind,:name,:availability,:cost,:priority,1,:at,:expires,:meta) ON CONFLICT(provider_id) DO UPDATE SET provider_kind=excluded.provider_kind,display_name=excluded.display_name,availability_mode=excluded.availability_mode,cost_class=excluded.cost_class,priority=excluded.priority,enabled=1,observed_at=excluded.observed_at,expires_at=excluded.expires_at,metadata_json=excluded.metadata_json');
            $upsert->execute(['id'=>$providerId,'kind'=>$kind,'name'=>$displayName,'availability'=>$availabilityMode,'cost'=>$costClass,'priority'=>$priority,'at'=>$at,'expires'=>$expires,'meta'=>$meta]);
            $this->pdo->prepare('DELETE FROM control_execution_provider_capabilities WHERE provider_id=:id')->execute(['id'=>$providerId]);
            $exists = $this->pdo->prepare('SELECT maturity FROM control_capability_catalog WHERE capability=:cap AND enabled=1');
            $insert = $this->pdo->prepare('INSERT INTO control_execution_provider_capabilities(provider_id,capability,version,cost_rank,quality_rank,latency_rank,enabled,observed_at,expires_at,metadata_json) VALUES(:provider,:cap,NULL,:cost,:quality,:latency,1,:at,:expires,\'{}\')');
            foreach ($caps as $capability) {
                $exists->execute(['cap'=>$capability]); if ($exists->fetchColumn() === false) continue;
                [$costRank,$qualityRank,$latencyRank] = self::defaultRanks($availabilityMode,$costClass);
                $insert->execute(['provider'=>$providerId,'cap'=>$capability,'cost'=>$costRank,'quality'=>$qualityRank,'latency'=>$latencyRank,'at'=>$at,'expires'=>$expires]);
            }
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            if ($error instanceof HubCapabilityRegistryException) throw $error;
            throw new HubCapabilityRegistryException('Execution provider could not be advertised', 'CAPABILITY_PROVIDER_FAILED');
        }
    }

    /** Mirror the real M12 VPS executor; this is availability metadata only. */
    public function advertiseVps(array $capabilities, string $now, string $expiresAt): void
    {
        $this->advertiseProvider('vps-native','VPS','AWH Cloud','ALWAYS_ON','PREPAID',10,$capabilities,$now,$expiresAt,['authority'=>'m12-native-executor']);
    }
    /** Existing authenticated worker heartbeat remains authority for online state. */
    public function syncDeviceWorker(string $deviceId, array $advertisedCapabilities, string $state, string $now): void
    {
        self::uuid($deviceId); $state = strtoupper($state); if (!in_array($state,['READY','WORKING','OFFLINE'],true)) throw new HubCapabilityRegistryException('Worker state is invalid', 'CAPABILITY_PROVIDER_INVALID');
        $at = self::timestamp($now); $this->ensureDeviceFabricCatalog($at);
        $mapped = $this->mapWorkerCapabilities($advertisedCapabilities); $expires = gmdate('c', strtotime($at) + 180);
        if ($state === 'OFFLINE') {
            $this->pdo->prepare('UPDATE control_execution_providers SET enabled=0, observed_at=:at, expires_at=:at WHERE provider_id=:id')->execute(['at'=>$at,'id'=>'device:'.$deviceId]);
            return;
        }
        $name = 'อุปกรณ์เสริม';
        $q = $this->pdo->prepare('SELECT display_name FROM devices WHERE device_id=:id'); $q->execute(['id'=>$deviceId]); $display = $q->fetchColumn(); if (is_string($display) && trim($display) !== '') $name = trim($display);
        $this->advertiseProvider('device:'.$deviceId,'DEVICE',$name,'OPTIONAL_DEVICE','LOCAL_FREE',60,$mapped,$at,$expires,['deviceId'=>$deviceId,'role'=>'optional-worker']);
    }

    /** @return array{primaryRoute:string,requiresRealDeviceEvidence:bool,realSchoolEvidenceRequired:bool,generatedSchoolRealityAllowed:bool,permanentRepairRequired:bool,mixedBoundary:bool,evidenceDimensions:array{requiresDeviceState:bool,requiresServerState:bool,requiresConnectedFiles:bool,requiresRealSchoolEvidence:bool,requiresNativeApp:bool,requiresPublicWeb:bool},reason:string} */
    public static function workProfileForGoal(string $goal): array
    {
        $value = function_exists('mb_strtolower') ? mb_strtolower(trim($goal), 'UTF-8') : strtolower(trim($goal));
        $namedDevice = preg_match('/(?:\\bay(?:-)?student|\\bay(?:-)?teacher|ay[- ]?(?:student|teacher|[0-9]+)|macbook|mac(?:\\s|$)|windows|เครื่อง(?:เด็ก|ครู|นักเรียน|นี้)|คอม(?:พิวเตอร์)?)/u', $value) === 1;
        $nativeDesktop = preg_match('/(?:after effects?|photoshop|adobe|premiere|office desktop|netsupport|registry|โปรแกรม(?:บน)?เครื่อง|หน้าจอจริง|gui)/u', $value) === 1;
        $realClient = preg_match('/(?:browser|client|กด(?:ไม่ได้|ไม่ทำงาน)|เข้า(?:เรียน|ระบบ)ไม่ได้|permission|สิทธิ์|ติดตั้ง|install)/u', $value) === 1;
        $server = preg_match('/(?:nginx|php[- ]?fpm|vps|server|service|systemd|database|db|deploy|deployment|migration|runtime|production)/u', $value) === 1;
        $files = preg_match('/(?:หา|ค้น|ดึง|ไฟล์|เอกสาร|รายงาน|ประเมิน|drive|project sources?|asset vault)/u', $value) === 1;
        $schoolContext = preg_match('/(?:โรงเรียนบ้านเอือดใหญ่|โรงเรียน|นักเรียน|ครู|อาคาร|ห้องเรียน)/u', $value) === 1;
        $visualEvidenceIntent = preg_match('/(?:รูป|ภาพ|photo|image|กิจกรรม|vtr|ประชาสัมพันธ์|หลักฐาน|media|asset)/u', $value) === 1;
        $schoolVisual = $schoolContext && $visualEvidenceIntent;
        $failure = preg_match('/(?:fail|failed|ล้ม|พัง|ไม่ได้|ไม่ทำงาน|error|ผิดพลาด|ขัดข้อง|ซ้ำ|อีกแล้ว)/u', $value) === 1;
        $publicWeb = preg_match('/(?:public web|public site|เว็บไซต์|หน้าเว็บ|production surface|release\.json|https?:\/\/)/u', $value) === 1;

        $requiresDeviceState = $namedDevice || $realClient;
        $requiresServerState = $server;
        $requiresConnectedFiles = $files || $schoolVisual;
        $requiresRealSchoolEvidence = $schoolVisual;
        $requiresNativeApp = $nativeDesktop;
        $requiresPublicWeb = $publicWeb;
        $device = $requiresDeviceState || $requiresNativeApp;
        $mixed = $device && $requiresServerState;
        $route = $mixed ? 'DIRECT_PLUS_REMOTE' : ($device ? 'REMOTE_DEVICE' : ($requiresServerState ? 'VPS_DIRECT' : ($requiresConnectedFiles ? 'CONNECTED_FILES' : 'AUTO_FIT')));
        $reason = match ($route) {
            'DIRECT_PLUS_REMOTE' => 'server evidence and real-device proof are both required',
            'REMOTE_DEVICE' => 'the outcome depends on named-device, GUI, native-app or real-client state',
            'VPS_DIRECT' => 'the outcome is primarily server/runtime/deployment state',
            'CONNECTED_FILES' => $schoolVisual ? 'verified first-party school files/evidence are required before visual output' : 'the outcome is primarily retrieval from durable files or connected sources',
            default => 'no stronger route trigger was proven; choose the best-fit authoritative capability',
        };
        return [
            'primaryRoute'=>$route,
            'requiresRealDeviceEvidence'=>$device,
            'realSchoolEvidenceRequired'=>$schoolVisual,
            'generatedSchoolRealityAllowed'=>false,
            'permanentRepairRequired'=>$failure,
            'mixedBoundary'=>$mixed,
            'evidenceDimensions'=>[
                'requiresDeviceState'=>$requiresDeviceState,
                'requiresServerState'=>$requiresServerState,
                'requiresConnectedFiles'=>$requiresConnectedFiles,
                'requiresRealSchoolEvidence'=>$requiresRealSchoolEvidence,
                'requiresNativeApp'=>$requiresNativeApp,
                'requiresPublicWeb'=>$requiresPublicWeb,
            ],
            'reason'=>$reason,
        ];
    }

    /** @return array<string,mixed>|null */
    public function route(string $capability, ?string $now = null): ?array
    {
        $this->assertReady(); $capability = self::capability($capability); $at = self::timestamp($now ?? gmdate('c'));
        $sql = "SELECT p.provider_id,p.provider_kind,p.display_name,p.availability_mode,p.cost_class,p.priority,pc.cost_rank,pc.quality_rank,pc.latency_rank,c.maturity FROM control_execution_provider_capabilities pc JOIN control_execution_providers p ON p.provider_id=pc.provider_id JOIN control_capability_catalog c ON c.capability=pc.capability WHERE pc.capability=:cap AND pc.enabled=1 AND p.enabled=1 AND c.enabled=1 AND c.maturity <> 'PLANNED' AND (p.expires_at IS NULL OR p.expires_at>:at) AND (pc.expires_at IS NULL OR pc.expires_at>:at) ORDER BY CASE p.availability_mode WHEN 'ALWAYS_ON' THEN 0 WHEN 'ON_DEMAND' THEN 1 ELSE 2 END, pc.cost_rank, p.priority, pc.latency_rank, pc.quality_rank DESC, p.provider_id LIMIT 1";
        $q = $this->pdo->prepare($sql); $q->execute(['cap'=>$capability,'at'=>$at]); $row = $q->fetch();
        if (!is_array($row)) return null;
        return ['providerId'=>(string)$row['provider_id'],'kind'=>(string)$row['provider_kind'],'displayName'=>(string)$row['display_name'],'availabilityMode'=>(string)$row['availability_mode'],'costClass'=>(string)$row['cost_class'],'capability'=>$capability,'maturity'=>(string)$row['maturity'],'executionPolicyVersion'=>self::EXECUTION_POLICY_VERSION];
    }
    /** Keep the persisted scope compatible with the existing schema enum. */
    public static function mutationScopeForExecution(string $requiredCapability, string $executorKind): string
    {
        $required = trim($requiredCapability); $kind = strtoupper(trim($executorKind));
        if (preg_match('/^(?:agent\.conversation|project\.(?:read|search)|artifact\.object|qa\.cloud|review\.visual)$/', $required) === 1) return 'READ';
        if (str_starts_with($required, 'project.mutate.')) return 'PROJECT_CANDIDATE';
        if (in_array($kind, ['DEVICE','CODEX'], true)) return 'DEVICE_WORKSPACE';
        return 'EXTERNAL';
    }

    /**
     * Derive the coordination resource from canonical execution metadata.
     * No new lock table or schema column is needed.
     */
    public static function mutationResourceForExecution(string $requiredCapability, string $executorKind): string
    {
        $required = trim($requiredCapability); $kind = strtoupper(trim($executorKind));
        if (preg_match('/^(?:agent\.conversation|project\.(?:read|search)|artifact\.object|qa\.cloud|review\.visual)$/', $required) === 1) return 'READ';
        if ($required === 'source.promote') return 'CANONICAL:SOURCE';
        if (in_array($required, ['project.mutate.deploy','system.core.release','system.learnlab.release','system.assessment.release','bay.remote_update.install'], true)) return 'CANONICAL:DEPLOY';
        if ($required === 'bay.remote_update.stage') return 'RESOURCE:RELEASE_STAGE';
        if (str_starts_with($required, 'hosting.')) return 'RESOURCE:HOSTING';
        if (str_starts_with($required, 'project.mutate.')) return 'CANDIDATE';
        if (in_array($kind, ['DEVICE','CODEX'], true)) return 'WORKSPACE';
        return 'CANONICAL:PROJECT';
    }

    /** Serialize only executions whose derived resources actually conflict. */
    public static function mutationResourcesConflict(string $left, string $right): bool
    {
        $left = strtoupper(trim($left)); $right = strtoupper(trim($right));
        if ($left === 'READ' || $right === 'READ') return false;
        if ($left === 'CANONICAL:PROJECT' || $right === 'CANONICAL:PROJECT') return true;
        if (in_array($left, ['CANDIDATE','WORKSPACE'], true) || in_array($right, ['CANDIDATE','WORKSPACE'], true)) return false;
        $known = static fn(string $resource): bool => str_starts_with($resource, 'CANONICAL:') || str_starts_with($resource, 'RESOURCE:');
        if (!$known($left) || !$known($right)) return true;
        return hash_equals($left, $right);
    }

    /** Resources that are physically shared across projects on the VPS. */
    public static function mutationResourceIsGlobal(string $resource): bool
    {
        return strtoupper(trim($resource)) === 'CANONICAL:DEPLOY';
    }

    /**
     * Apply project identity to resource arbitration.
     * Candidate/workspace lanes remain isolated. Canonical source cannot move
     * while the same project's deploy lane is active, and the shared deploy
     * lane serializes across projects.
     */
    public static function mutationResourcesConflictForProjects(string $left,string $leftProject,string $right,string $rightProject): bool
    {
        $left=strtoupper(trim($left));$right=strtoupper(trim($right));
        if($left==='READ'||$right==='READ')return false;
        $sameProject=hash_equals(strtolower(trim($leftProject)),strtolower(trim($rightProject)));
        if(!$sameProject){
            return self::mutationResourceIsGlobal($left)
                && self::mutationResourceIsGlobal($right)
                && self::mutationResourcesConflict($left,$right);
        }
        if($left==='CANONICAL:PROJECT'||$right==='CANONICAL:PROJECT')return true;
        if(in_array($left,['CANDIDATE','WORKSPACE'],true)||in_array($right,['CANDIDATE','WORKSPACE'],true))return false;
        if(($left==='CANONICAL:DEPLOY'&&$right==='CANONICAL:SOURCE')||($right==='CANONICAL:DEPLOY'&&$left==='CANONICAL:SOURCE'))return true;
        if(($left==='CANONICAL:DEPLOY'&&$right==='RESOURCE:RELEASE_STAGE')||($right==='CANONICAL:DEPLOY'&&$left==='RESOURCE:RELEASE_STAGE'))return true;
        return self::mutationResourcesConflict($left,$right);
    }

    /** One descriptive envelope per M12 execution; it is not another task queue or lock authority. */
    public function ensureExecutionEnvelope(string $executionId, ?string $now = null): array
    {
        $this->assertReady(); self::uuid($executionId); $at = self::timestamp($now ?? gmdate('c'));
        $q = $this->pdo->prepare('SELECT e.execution_id,e.task_id,e.project_id,e.vault_revision_id,e.executor_kind,e.required_capability,t.conversation_id FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id WHERE e.execution_id=:id');
        $q->execute(['id'=>$executionId]); $row = $q->fetch(); if (!is_array($row)) throw new HubCapabilityRegistryException('Execution was not found', 'EXECUTION_NOT_FOUND');
        $required = (string)$row['required_capability']; $scope = self::mutationScopeForExecution($required, (string)$row['executor_kind']);
        $conversation = is_string($row['conversation_id'] ?? null) ? (string)$row['conversation_id'] : null; $sessionKey = $conversation === null ? 'task:'.$row['task_id'] : 'conversation:'.$conversation;
        $routeCapability = $required === 'codex:cli' ? 'code.specialist' : $required;
        $route = $this->route($routeCapability,$at); $provider = is_array($route) ? $route['providerId'] : null;
        $existing = $this->pdo->prepare('SELECT * FROM control_execution_envelopes WHERE execution_id=:id'); $existing->execute(['id'=>$executionId]); $value = $existing->fetch();
        if (is_array($value)) {
            $mutable = in_array((string)($value['state'] ?? ''), ['OPEN','WAITING'], true);
            $scopeChanged = (string)($value['mutation_scope'] ?? '') !== $scope;
            $providerMissing = ($value['provider_id'] ?? null) === null && $provider !== null;
            if ($mutable && ($scopeChanged || $providerMissing)) {
                $this->pdo->prepare("UPDATE control_execution_envelopes SET mutation_scope=:scope,provider_id=COALESCE(provider_id,:provider),updated_at=:at WHERE execution_id=:id AND state IN ('OPEN','WAITING')")->execute(['scope'=>$scope,'provider'=>$provider,'at'=>$at,'id'=>$executionId]);
                $existing->execute(['id'=>$executionId]); $refreshed=$existing->fetch(); if (is_array($refreshed)) $value=$refreshed;
            }
            return self::envelopeRow($value);
        }
        $envelopeId = self::uuid();
        $insert = $this->pdo->prepare('INSERT OR IGNORE INTO control_execution_envelopes(envelope_id,execution_id,task_id,project_id,conversation_id,base_revision_id,session_key,mutation_scope,state,provider_id,lease_expires_at,created_at,updated_at) VALUES(:envelope,:execution,:task,:project,:conversation,:revision,:session,:scope,\'OPEN\',:provider,NULL,:at,:at)');
        $insert->execute(['envelope'=>$envelopeId,'execution'=>$executionId,'task'=>$row['task_id'],'project'=>$row['project_id'],'conversation'=>$conversation,'revision'=>$row['vault_revision_id'],'session'=>$sessionKey,'scope'=>$scope,'provider'=>$provider,'at'=>$at]);
        $existing->execute(['id'=>$executionId]); $value = $existing->fetch(); if (!is_array($value)) throw new HubCapabilityRegistryException('Execution envelope could not be created', 'EXECUTION_ENVELOPE_FAILED');
        return self::envelopeRow($value);
    }

    /** @return array{releasedTerminal:int,releasedExpired:int} */
    public function reconcileExecutionAuthority(?string $now = null): array
    {
        $this->assertReady(); $at = self::timestamp($now ?? gmdate('c'));
        try {
            // Keep reconciliation transaction-neutral so callers that already
            // hold BEGIN IMMEDIATE (for example DurableExecution::claim) do not
            // attempt a nested SQLite transaction. Each UPDATE is idempotent.
            $terminal = $this->pdo->prepare("UPDATE control_execution_envelopes SET state='RELEASED',lease_expires_at=NULL,updated_at=:at WHERE mutation_scope<>'READ' AND state NOT IN ('RELEASED','CANCELLED') AND (execution_id IN (SELECT execution_id FROM control_task_executions WHERE state IN ('COMPLETED','FAILED','CANCELLED')) OR task_id IN (SELECT task_id FROM control_tasks WHERE state IN ('COMPLETED','FAILED','CANCELLED')))");
            $terminal->execute(['at'=>$at]);
            $expired = $this->pdo->prepare("UPDATE control_execution_envelopes SET state='WAITING',lease_expires_at=NULL,updated_at=:at WHERE mutation_scope<>'READ' AND state='ACTIVE' AND lease_expires_at IS NOT NULL AND lease_expires_at<=:at");
            $expired->execute(['at'=>$at]);
            return ['releasedTerminal'=>$terminal->rowCount(),'releasedExpired'=>$expired->rowCount()];
        } catch (Throwable $error) {
            throw new HubCapabilityRegistryException('Execution authority reconciliation failed','EXECUTION_ENVELOPE_FAILED');
        }
    }

    /**
     * Resource-scoped execution authority. Reads and isolated candidate/workspace
     * work run in parallel; only executions whose resource scopes conflict are
     * serialized. The existing envelope remains the sole authority record.
     *
     * @return array{granted:bool,executionId:string,projectId:string,mutationScope:string,blockingExecutionId:?string,blockingTaskId:?string}
     */
    public function activateExecutionAuthority(string $executionId, ?string $leaseExpiresAt = null, ?string $now = null, bool $transactionHeld = false): array
    {
        $this->assertReady(); self::uuid($executionId); $at = self::timestamp($now ?? gmdate('c')); $lease = $leaseExpiresAt === null ? null : self::timestamp($leaseExpiresAt);
        $ownTransaction = !$transactionHeld;
        try {
            if ($ownTransaction) $this->pdo->exec('BEGIN IMMEDIATE');
            $this->reconcileExecutionAuthority($at);
            $envelope = $this->ensureExecutionEnvelope($executionId, $at); $project = (string)$envelope['projectId']; $scope = (string)$envelope['mutationScope'];
            $meta=$this->pdo->prepare('SELECT required_capability,executor_kind FROM control_task_executions WHERE execution_id=:execution');
            $meta->execute(['execution'=>$executionId]); $metaRow=$meta->fetch();
            if(!is_array($metaRow))throw new HubCapabilityRegistryException('Execution metadata is unavailable','EXECUTION_NOT_FOUND');
            $resource=self::mutationResourceForExecution((string)$metaRow['required_capability'],(string)$metaRow['executor_kind']);
            if ($resource === 'READ') {
                $this->pdo->prepare("UPDATE control_execution_envelopes SET state='ACTIVE',lease_expires_at=:lease,updated_at=:at WHERE execution_id=:execution AND state IN ('OPEN','WAITING','ACTIVE')")->execute(['lease'=>$lease,'at'=>$at,'execution'=>$executionId]);
                if ($ownTransaction) $this->pdo->exec('COMMIT');
                return ['granted'=>true,'executionId'=>$executionId,'projectId'=>$project,'mutationScope'=>$scope,'mutationResource'=>$resource,'blockingExecutionId'=>null,'blockingTaskId'=>null];
            }

            $unscoped=$this->pdo->prepare("SELECT e.execution_id,e.task_id,e.project_id,e.required_capability,e.executor_kind FROM control_task_executions e LEFT JOIN control_execution_envelopes x ON x.execution_id=e.execution_id WHERE e.execution_id<>:execution AND e.state IN ('LEASED','RUNNING') AND x.execution_id IS NULL ORDER BY e.updated_at,e.execution_id");
            $unscoped->execute(['execution'=>$executionId]);
            $blocking=null;
            foreach($unscoped->fetchAll() as $candidate){
                $candidateProject=(string)$candidate['project_id'];
                $candidateResource=self::mutationResourceForExecution((string)$candidate['required_capability'],(string)$candidate['executor_kind']);
                if(self::mutationResourcesConflictForProjects($resource,$project,$candidateResource,$candidateProject)){
                    $candidate['mutation_resource']=$candidateResource;$candidate['unscoped']=true;$blocking=$candidate;break;
                }
            }

            if($blocking===null){
                $holder = $this->pdo->prepare("SELECT x.execution_id,x.task_id,x.project_id,x.mutation_scope,e.required_capability,e.executor_kind FROM control_execution_envelopes x JOIN control_task_executions e ON e.execution_id=x.execution_id WHERE x.execution_id<>:execution AND x.mutation_scope<>'READ' AND x.state='ACTIVE' AND (x.lease_expires_at IS NULL OR x.lease_expires_at>:at) ORDER BY x.updated_at,x.execution_id");
                $holder->execute(['execution'=>$executionId,'at'=>$at]);
                foreach ($holder->fetchAll() as $candidate) {
                    $candidateProject=(string)$candidate['project_id'];
                    $candidateResource=self::mutationResourceForExecution((string)$candidate['required_capability'],(string)$candidate['executor_kind']);
                    if (self::mutationResourcesConflictForProjects($resource,$project,$candidateResource,$candidateProject)) { $candidate['mutation_resource']=$candidateResource; $blocking = $candidate; break; }
                }
            }
            if (is_array($blocking)) {
                $this->pdo->prepare("UPDATE control_execution_envelopes SET state='WAITING',lease_expires_at=NULL,updated_at=:at WHERE execution_id=:execution AND state IN ('OPEN','WAITING','CONFLICT')")->execute(['at'=>$at,'execution'=>$executionId]);
                if ($ownTransaction) $this->pdo->exec('COMMIT');
                return ['granted'=>false,'executionId'=>$executionId,'projectId'=>$project,'mutationScope'=>$scope,'mutationResource'=>$resource,'blockingMutationResource'=>(string)$blocking['mutation_resource'],'blockingProjectId'=>(string)$blocking['project_id'],'blockingExecutionId'=>(string)$blocking['execution_id'],'blockingTaskId'=>(string)$blocking['task_id']];
            }

            $claim = $this->pdo->prepare("UPDATE control_execution_envelopes SET state='ACTIVE',lease_expires_at=:lease,updated_at=:at WHERE execution_id=:execution AND state IN ('OPEN','WAITING','ACTIVE')");
            $claim->execute(['lease'=>$lease,'at'=>$at,'execution'=>$executionId]);
            if ($claim->rowCount() !== 1) throw new HubCapabilityRegistryException('Execution authority could not be claimed','EXECUTION_ENVELOPE_FAILED');
            if ($ownTransaction) $this->pdo->exec('COMMIT');
            return ['granted'=>true,'executionId'=>$executionId,'projectId'=>$project,'mutationScope'=>$scope,'mutationResource'=>$resource,'blockingExecutionId'=>null,'blockingTaskId'=>null];
        } catch (Throwable $error) {
            if ($ownTransaction) { try { $this->pdo->exec('ROLLBACK'); } catch (Throwable) {} }
            if ($error instanceof HubCapabilityRegistryException) throw $error;
            throw new HubCapabilityRegistryException('Execution authority claim failed','EXECUTION_ENVELOPE_FAILED');
        }
    }

    /** Owner-safe projection of the existing canonical execution envelopes. */
    public function executionAuthorityStatus(?string $now = null): array
    {
        $this->assertReady(); $at = self::timestamp($now ?? gmdate('c'));
        $this->reconcileExecutionAuthority($at);
        $q = $this->pdo->prepare("SELECT x.execution_id,x.task_id,x.project_id,x.mutation_scope,x.state,x.provider_id,x.lease_expires_at,x.updated_at,t.goal,p.name AS project_name,e.required_capability,e.executor_kind FROM control_execution_envelopes x JOIN control_task_executions e ON e.execution_id=x.execution_id JOIN control_tasks t ON t.task_id=x.task_id JOIN projects p ON p.project_id=x.project_id WHERE x.mutation_scope<>'READ' AND e.state NOT IN ('COMPLETED','FAILED','CANCELLED') AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED') AND ((x.state='ACTIVE' AND (x.lease_expires_at IS NULL OR x.lease_expires_at>:at)) OR x.state IN ('OPEN','WAITING','CONFLICT')) ORDER BY CASE x.state WHEN 'ACTIVE' THEN 0 ELSE 1 END,x.updated_at DESC LIMIT 40");
        $q->execute(['at'=>$at]); $active=[]; $waiting=[];
        foreach ($q->fetchAll() as $row) {
            $item=['executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'projectId'=>(string)$row['project_id'],'projectName'=>(string)$row['project_name'],'goal'=>(string)$row['goal'],'mutationScope'=>(string)$row['mutation_scope'],'mutationResource'=>self::mutationResourceForExecution((string)$row['required_capability'],(string)$row['executor_kind']),'requiredCapability'=>(string)$row['required_capability'],'providerId'=>$row['provider_id']===null?null:(string)$row['provider_id'],'state'=>(string)$row['state'],'leaseExpiresAt'=>$row['lease_expires_at']===null?null:(string)$row['lease_expires_at'],'updatedAt'=>(string)$row['updated_at']];
            if ($item['state']==='ACTIVE') $active[]=$item; else $waiting[]=$item;
        }
        return ['schemaVersion'=>1,'mode'=>'RESOURCE_SCOPED_CONCURRENCY','parallelReadsAllowed'=>true,'parallelNonConflictingMutationsAllowed'=>true,'mutationBoundary'=>'CONFLICTING_RESOURCE','activeMutationCount'=>count($active),'waitingMutationCount'=>count($waiting),'activeMutations'=>$active,'waitingMutations'=>$waiting];
    }

    public function updateEnvelopeState(string $executionId, string $state, ?string $leaseExpiresAt = null, ?string $now = null, bool $transactionHeld = false): void
    {
        if (!self::schemaPresent($this->pdo)) return; self::uuid($executionId); $state = strtoupper($state); if (!in_array($state,self::ENVELOPE_STATES,true)) throw new HubCapabilityRegistryException('Execution envelope state is invalid','EXECUTION_ENVELOPE_FAILED');
        $at = self::timestamp($now ?? gmdate('c')); $lease = $leaseExpiresAt === null ? null : self::timestamp($leaseExpiresAt);
        if ($state === 'ACTIVE') {
            $authority = $this->activateExecutionAuthority($executionId, $lease, $at, $transactionHeld);
            if (($authority['granted'] ?? false) !== true) throw new HubCapabilityRegistryException('Another execution owns a conflicting project resource', 'EXECUTION_AUTHORITY_CONFLICT');
            return;
        }
        $this->pdo->prepare('UPDATE control_execution_envelopes SET state=:state,lease_expires_at=:lease,updated_at=:at WHERE execution_id=:execution')->execute(['state'=>$state,'lease'=>$lease,'at'=>$at,'execution'=>$executionId]);
    }
    /** @return array<string,mixed> */
    public function status(bool $technical = false, ?string $now = null): array
    {
        $this->assertReady(); $at = self::timestamp($now ?? gmdate('c'));
        $rows = $this->pdo->query("SELECT c.capability,c.category,c.display_name,c.description,c.maturity,c.risk_class,s.display_name AS source_name,s.version AS source_version,s.license_id FROM control_capability_catalog c JOIN control_capability_sources s ON s.source_id=c.source_id WHERE c.enabled=1 AND c.user_visible=1 ORDER BY c.category,c.display_name,c.capability")->fetchAll();
        $items = []; $summary = ['ready'=>0,'cloudReady'=>0,'optional'=>0,'planned'=>0];
        foreach ($rows as $row) {
            $route = $this->route((string)$row['capability'],$at); $maturity = (string)$row['maturity'];
            $state = $maturity === 'PLANNED' ? 'PLANNED' : ($route !== null ? 'READY' : ($maturity === 'OPTIONAL' ? 'OPTIONAL' : 'UNAVAILABLE'));
            if ($state === 'READY') { $summary['ready']++; if (($route['availabilityMode'] ?? null) !== 'OPTIONAL_DEVICE') $summary['cloudReady']++; }
            elseif ($state === 'OPTIONAL') $summary['optional']++; elseif ($state === 'PLANNED') $summary['planned']++;
            $item = ['capability'=>(string)$row['capability'],'category'=>(string)$row['category'],'displayName'=>(string)$row['display_name'],'description'=>(string)$row['description'],'state'=>$state,'cloudReady'=>$route !== null && ($route['availabilityMode'] ?? null) !== 'OPTIONAL_DEVICE'];
            if ($technical) $item += ['maturity'=>$maturity,'riskClass'=>(string)$row['risk_class'],'source'=>['name'=>(string)$row['source_name'],'version'=>$row['source_version'],'license'=>$row['license_id']],'provider'=>$route];
            $items[] = $item;
        }
        $providers = [];
        if ($technical) {
            $q = $this->pdo->prepare("SELECT p.provider_id,p.provider_kind,p.display_name,p.availability_mode,p.cost_class,p.enabled,p.observed_at,p.expires_at,COUNT(pc.capability) AS capability_count FROM control_execution_providers p LEFT JOIN control_execution_provider_capabilities pc ON pc.provider_id=p.provider_id AND pc.enabled=1 WHERE p.enabled=1 AND (p.expires_at IS NULL OR p.expires_at>:at) GROUP BY p.provider_id ORDER BY CASE p.availability_mode WHEN 'ALWAYS_ON' THEN 0 WHEN 'ON_DEMAND' THEN 1 ELSE 2 END,p.priority,p.display_name LIMIT 100");
            $q->execute(['at'=>$at]); foreach ($q->fetchAll() as $row) $providers[] = ['providerId'=>(string)$row['provider_id'],'kind'=>(string)$row['provider_kind'],'displayName'=>(string)$row['display_name'],'availabilityMode'=>(string)$row['availability_mode'],'costClass'=>(string)$row['cost_class'],'capabilityCount'=>(int)$row['capability_count'],'observedAt'=>(string)$row['observed_at'],'expiresAt'=>$row['expires_at']];
        }
        return ['schemaVersion'=>1,'anywhereFirst'=>true,'deviceRequired'=>false,'executionPolicy'=>self::executionPolicy(),'summary'=>$summary,'capabilities'=>$items,'providers'=>$providers];
    }
    /** @return array<string,mixed> */
    public static function executionPolicy(): array
    {
        return [
            'version'=>self::EXECUTION_POLICY_VERSION,
            'mode'=>'CONTEXT_ONLY',
            'enforcement'=>'ADVISORY',
            'userRestatementRequired'=>false,
            'decisionAuthority'=>'CURRENT_REQUEST_CURRENT_EVIDENCE_CURRENT_CAPABILITIES',
            'prescriptiveRouting'=>false,
            'mandatoryToolOrder'=>false,
            'quotaBudgetingRequired'=>false,
            'remoteMissionRequired'=>false,
            'sourceAuthorityRequiredForMutation'=>true,
            'singleWriterMutationBoundary'=>true,
            'mutationBoundary'=>'CONFLICTING_RESOURCE',
            'parallelNonConflictingMutationsAllowed'=>true,
            'candidateWorkspaceIsolation'=>true,
            'exactRevisionPromotion'=>true,
            'ownerApprovalForCanonicalPromotion'=>true,
            'actualOutcomeVerification'=>true,
        ];
    }

    /** Built-in provider-neutral capability labels. The catalog is operational
     * metadata, so new device capabilities can be registered idempotently
     * without advancing the persistent DB schema or creating another authority. */
    private function ensureDeviceFabricCatalog(string $at): void
    {
        $rows = [
            ['device.screen.inspect','device','ตรวจหน้าจอจริง','ตรวจภาพหน้าจอจากอุปกรณ์ที่เชื่อมต่อ','READ','LOW'],
            ['device.gui.inspect','device','ตรวจ UI บนอุปกรณ์','อ่านหน้าต่างและองค์ประกอบ UI โดยไม่เปลี่ยนสถานะ','READ','LOW'],
            ['device.gui.operate','device','ควบคุม UI บนอุปกรณ์','โต้ตอบกับโปรแกรมบนอุปกรณ์ตามงานที่ผู้ใช้สั่ง','EXECUTE','MEDIUM'],
            ['device.process','device','จัดการโปรเซสอุปกรณ์','ตรวจและควบคุมโปรเซสบนอุปกรณ์ที่เชื่อมต่อ','EXECUTE','HIGH'],
        ];
        $insert = $this->pdo->prepare("INSERT OR IGNORE INTO control_capability_catalog(capability,source_id,category,display_name,description,mutation_kind,risk_class,maturity,user_visible,enabled,created_at,updated_at) VALUES(:cap,'awh-core',:category,:name,:description,:mutation,:risk,'OPTIONAL',1,1,:at,:at)");
        foreach ($rows as $row) $insert->execute(['cap'=>$row[0],'category'=>$row[1],'name'=>$row[2],'description'=>$row[3],'mutation'=>$row[4],'risk'=>$row[5],'at'=>$at]);
    }

    /** @return list<string> */
    private function mapWorkerCapabilities(array $raw): array
    {
        $out = [];
        foreach ($raw as $value) {
            if (!is_string($value) || !preg_match('/^[a-z][a-z0-9:._-]{0,63}$/',$value)) continue;
            if ($this->catalogHas($value)) $out[] = $value;
            if ($value === 'codex:cli' || str_starts_with($value,'codex_')) $out[] = 'code.specialist';
            if ($value === 'git' || str_starts_with($value,'git_') || str_starts_with($value,'git:')) $out[] = 'code.git';
            if (preg_match('/^(?:file|read_file|read_files|write_file|edit_file|apply_patch|copy_file|move_file|delete_file|workspace_)/',$value)) $out[] = 'workspace.files';
            if (preg_match('/^(?:browser|dom_|web_|ui_target_action|capture_screenshot|compare_screenshot|form_context|network_context|console_context)/',$value)) $out[] = 'browser.automation';
            if (preg_match('/^(?:office|inspect_workbook|compare_workbook|render_excel|docx_)/',$value)) $out[] = 'document.office';
            if (preg_match('/^(?:pdf_|inspect_pdf|compare_pdf)/',$value)) $out[] = 'document.pdf';
            if (preg_match('/ocr/',$value)) $out[] = 'document.ocr';
            // Policy 1.2: workers expose named capabilities only. Generic shell/process
            // advertisements never become routable AWH capabilities.
        }
        return array_values(array_unique($out));
    }

    private function catalogHas(string $capability): bool
    {
        $q = $this->pdo->prepare('SELECT 1 FROM control_capability_catalog WHERE capability=:cap AND enabled=1'); $q->execute(['cap'=>$capability]); return $q->fetchColumn() !== false;
    }

    /** @return array{0:int,1:int,2:int} */
    private static function defaultRanks(string $availability, string $cost): array
    {
        $costRank = match ($cost) { 'INCLUDED','PREPAID','LOCAL_FREE' => 5, default => 60 };
        $quality = $availability === 'OPTIONAL_DEVICE' ? 70 : 80; $latency = $availability === 'ALWAYS_ON' ? 20 : ($availability === 'ON_DEMAND' ? 50 : 35);
        return [$costRank,$quality,$latency];
    }
    /** @return array<string,mixed> */
    private static function envelopeRow(array $row): array
    {
        return ['envelopeId'=>(string)$row['envelope_id'],'executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'projectId'=>(string)$row['project_id'],'conversationId'=>$row['conversation_id'],'baseRevisionId'=>$row['base_revision_id'],'sessionKey'=>(string)$row['session_key'],'mutationScope'=>(string)$row['mutation_scope'],'state'=>(string)$row['state'],'providerId'=>$row['provider_id'],'leaseExpiresAt'=>$row['lease_expires_at'],'createdAt'=>(string)$row['created_at'],'updatedAt'=>(string)$row['updated_at']];
    }

    private function assertReady(): void
    {
        if (!self::schemaPresent($this->pdo)) throw new HubCapabilityRegistryException('Anywhere Execution capability is not ready', 'ANYWHERE_EXECUTION_SCHEMA_NOT_READY');
    }

    private static function providerId(string $value): string
    {
        $value = trim($value); if (preg_match('/^[a-z0-9][a-z0-9:._-]{1,95}$/',$value) !== 1) throw new HubCapabilityRegistryException('Execution provider identity is invalid','CAPABILITY_PROVIDER_INVALID'); return $value;
    }

    private static function capability(string $value): string
    {
        $value = trim($value); if (preg_match('/^[a-z][a-z0-9:._-]{1,63}$/',$value) !== 1) throw new HubCapabilityRegistryException('Capability identity is invalid','CAPABILITY_INVALID'); return $value;
    }

    private static function text(string $value, int $max): string
    {
        $value = trim($value); $length = function_exists('mb_strlen') ? mb_strlen($value,'UTF-8') : strlen($value); if ($value === '' || $length > $max || preg_match('/[\x00-\x1f\x7f]/',$value)) throw new HubCapabilityRegistryException('Capability text is invalid','CAPABILITY_INVALID'); return $value;
    }

    private static function metadata(array $value): string
    {
        $json = json_encode($value,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR); if (strlen($json) > 4096) throw new HubCapabilityRegistryException('Capability metadata is too large','CAPABILITY_INVALID'); return $json;
    }
    private static function timestamp(string $value): string
    {
        if (strtotime($value) === false) throw new HubCapabilityRegistryException('Capability time is invalid','CAPABILITY_INVALID'); return gmdate('c',strtotime($value));
    }

    private static function uuid(?string $value = null): string
    {
        if ($value !== null) { if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$value) !== 1) throw new HubCapabilityRegistryException('Capability UUID is invalid','CAPABILITY_INVALID'); return strtolower($value); }
        $bytes = random_bytes(16); $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128); return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($bytes),4));
    }
}
