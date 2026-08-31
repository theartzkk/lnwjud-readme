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
        $mapped = $this->mapWorkerCapabilities($advertisedCapabilities); $at = self::timestamp($now); $expires = gmdate('c', strtotime($at) + 180);
        if ($state === 'OFFLINE') {
            $this->pdo->prepare('UPDATE control_execution_providers SET enabled=0, observed_at=:at, expires_at=:at WHERE provider_id=:id')->execute(['at'=>$at,'id'=>'device:'.$deviceId]);
            return;
        }
        $name = 'อุปกรณ์เสริม';
        $q = $this->pdo->prepare('SELECT display_name FROM devices WHERE device_id=:id'); $q->execute(['id'=>$deviceId]); $display = $q->fetchColumn(); if (is_string($display) && trim($display) !== '') $name = trim($display);
        $this->advertiseProvider('device:'.$deviceId,'DEVICE',$name,'OPTIONAL_DEVICE','LOCAL_FREE',60,$mapped,$at,$expires,['deviceId'=>$deviceId,'role'=>'optional-worker']);
    }

    /** @return array<string,mixed>|null */
    public function route(string $capability, ?string $now = null): ?array
    {
        $this->assertReady(); $capability = self::capability($capability); $at = self::timestamp($now ?? gmdate('c'));
        $sql = "SELECT p.provider_id,p.provider_kind,p.display_name,p.availability_mode,p.cost_class,p.priority,pc.cost_rank,pc.quality_rank,pc.latency_rank,c.maturity FROM control_execution_provider_capabilities pc JOIN control_execution_providers p ON p.provider_id=pc.provider_id JOIN control_capability_catalog c ON c.capability=pc.capability WHERE pc.capability=:cap AND pc.enabled=1 AND p.enabled=1 AND c.enabled=1 AND c.maturity <> 'PLANNED' AND (p.expires_at IS NULL OR p.expires_at>:at) AND (pc.expires_at IS NULL OR pc.expires_at>:at) ORDER BY CASE p.availability_mode WHEN 'ALWAYS_ON' THEN 0 WHEN 'ON_DEMAND' THEN 1 ELSE 2 END, pc.cost_rank, p.priority, pc.latency_rank, pc.quality_rank DESC, p.provider_id LIMIT 1";
        $q = $this->pdo->prepare($sql); $q->execute(['cap'=>$capability,'at'=>$at]); $row = $q->fetch();
        if (!is_array($row)) return null;
        return ['providerId'=>(string)$row['provider_id'],'kind'=>(string)$row['provider_kind'],'displayName'=>(string)$row['display_name'],'availabilityMode'=>(string)$row['availability_mode'],'costClass'=>(string)$row['cost_class'],'capability'=>$capability,'maturity'=>(string)$row['maturity']];
    }
    /** One descriptive envelope per M12 execution; it is not another task queue or lock authority. */
    public function ensureExecutionEnvelope(string $executionId, ?string $now = null): array
    {
        $this->assertReady(); self::uuid($executionId); $at = self::timestamp($now ?? gmdate('c'));
        $q = $this->pdo->prepare('SELECT e.execution_id,e.task_id,e.project_id,e.vault_revision_id,e.executor_kind,e.required_capability,t.conversation_id FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id WHERE e.execution_id=:id');
        $q->execute(['id'=>$executionId]); $row = $q->fetch(); if (!is_array($row)) throw new HubCapabilityRegistryException('Execution was not found', 'EXECUTION_NOT_FOUND');
        $required = (string)$row['required_capability']; $scope = str_starts_with($required,'project.mutate.') ? 'PROJECT_CANDIDATE' : (in_array((string)$row['executor_kind'],['DEVICE','CODEX'],true) ? 'DEVICE_WORKSPACE' : (preg_match('/^(?:agent\.conversation|project\.(?:read|search)|artifact\.object)$/',$required) ? 'READ' : 'EXTERNAL'));
        $conversation = is_string($row['conversation_id'] ?? null) ? (string)$row['conversation_id'] : null; $sessionKey = $conversation === null ? 'task:'.$row['task_id'] : 'conversation:'.$conversation;
        $routeCapability = $required === 'codex:cli' ? 'code.specialist' : $required;
        $route = $this->route($routeCapability,$at); $provider = is_array($route) ? $route['providerId'] : null;
        $existing = $this->pdo->prepare('SELECT * FROM control_execution_envelopes WHERE execution_id=:id'); $existing->execute(['id'=>$executionId]); $value = $existing->fetch();
        if (is_array($value)) {
            if (($value['provider_id'] ?? null) === null && $provider !== null && in_array((string)($value['state'] ?? ''),['OPEN','WAITING'],true)) {
                $this->pdo->prepare("UPDATE control_execution_envelopes SET provider_id=:provider,updated_at=:at WHERE execution_id=:id AND provider_id IS NULL AND state IN ('OPEN','WAITING')")->execute(['provider'=>$provider,'at'=>$at,'id'=>$executionId]);
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

    public function updateEnvelopeState(string $executionId, string $state, ?string $leaseExpiresAt = null, ?string $now = null): void
    {
        if (!self::schemaPresent($this->pdo)) return; self::uuid($executionId); $state = strtoupper($state); if (!in_array($state,self::ENVELOPE_STATES,true)) throw new HubCapabilityRegistryException('Execution envelope state is invalid','EXECUTION_ENVELOPE_FAILED');
        $at = self::timestamp($now ?? gmdate('c')); $lease = $leaseExpiresAt === null ? null : self::timestamp($leaseExpiresAt);
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
        return ['schemaVersion'=>1,'anywhereFirst'=>true,'deviceRequired'=>false,'summary'=>$summary,'capabilities'=>$items,'providers'=>$providers];
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
            if (preg_match('/^(?:shell|wsl_|process_|project_(?:dev|test|lint|typecheck|build)|sandbox_exec)/',$value)) $out[] = 'system.shell';
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
