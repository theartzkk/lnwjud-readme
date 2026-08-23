<?php

declare(strict_types=1);

require_once __DIR__ . '/HubCentralProjectAuthorityMigration.php';
require_once __DIR__ . '/HubProjectVaultService.php';
require_once __DIR__ . '/HubNativeAgentService.php';
require_once __DIR__ . '/HubAttachmentStore.php';
require_once __DIR__ . '/HubArtifactStore.php';
require_once __DIR__ . '/HubFoundingMemoryService.php';

/**
 * Durable server-side execution projection for existing control_tasks.  It is
 * intentionally not a second task queue: each execution has a one-to-one FK
 * to the canonical task and writes progress/result back to that task and its
 * existing conversation stream.
 *
 * The native executor never receives shell or deployment authority.  Its one
 * mutating capability is a deliberately narrow deterministic text transform:
 * it materialises an isolated Vault revision, creates a candidate, records an
 * object-backed report, then waits for the existing approval authority before
 * any canonical promotion.
 */
final class HubDurableExecutionException extends RuntimeException
{
    /** @param array<string,mixed> $diagnostic Sanitized machine-readable metadata only. */
    public function __construct(string $message, public readonly string $codeName = 'EXECUTION_FAILED', public readonly array $diagnostic = []) { parent::__construct($message); }
}

final class HubDurableExecutionService
{
    private const EXECUTOR_ID = 'vps-native';
    private const LEASE_SECONDS = 300;
    private const MAX_ATTEMPTS = 3;

    public function __construct(private readonly PDO $pdo, private readonly HubProjectVaultService $vaults, private readonly ?HubNativeAgentService $agent = null, private readonly ?HubArtifactStore $artifacts = null) {}
    public static function fromEnvironment(PDO $pdo): self { return new self($pdo, HubProjectVaultService::fromEnvironment($pdo), new HubNativeAgentService($pdo), HubArtifactStore::fromEnvironment()); }

    /** Registers only bounded server-native capabilities.  This is an
     * observation, not a blanket authorization to execute arbitrary commands. */
    public function advertise(?string $now = null): void
    {
        $this->assertReady(); $at = self::timestamp($now ?? gmdate('c')); $expires = gmdate('c', strtotime($at) + 300);
        foreach (['agent.conversation', 'project.read', 'project.search', 'project.mutate.text', 'artifact.object'] as $capability) $this->pdo->prepare('INSERT INTO control_executor_capabilities(executor_id, executor_kind, capability, version, observed_at, expires_at) VALUES(:id, \'VPS\', :capability, :version, :at, :expires) ON CONFLICT(executor_id, capability) DO UPDATE SET executor_kind=excluded.executor_kind, version=excluded.version, observed_at=excluded.observed_at, expires_at=excluded.expires_at')->execute(['id' => self::EXECUTOR_ID, 'capability' => $capability, 'version' => 'm12', 'at' => $at, 'expires' => $expires]);
    }

    /** @param array<string,mixed> $checkpoint */
    public function enqueue(string $taskId, string $projectId, ?string $revisionId, string $executorKind, string $requiredCapability, array $checkpoint, ?string $now = null): void
    {
        $this->assertReady(); $taskId = self::uuid($taskId); $projectId = self::uuid($projectId); $revisionId = $revisionId === null ? null : self::uuid($revisionId);
        if (!in_array($executorKind, ['VPS', 'DEVICE', 'CODEX'], true) || preg_match('/^[a-z][a-z0-9:._-]{0,63}$/', $requiredCapability) !== 1) throw new HubDurableExecutionException('Execution capability is invalid', 'EXECUTION_INVALID');
        $at = self::timestamp($now ?? gmdate('c')); $json = json_encode($checkpoint, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $state = $executorKind === 'VPS' ? 'QUEUED' : 'WAITING_FOR_CAPABILITY';
        $q = $this->pdo->prepare('INSERT INTO control_task_executions(execution_id, task_id, project_id, vault_revision_id, executor_kind, required_capability, state, lease_owner, lease_expires_at, attempt_count, cancellation_requested_at, checkpoint_json, last_error_code, created_at, updated_at) VALUES(:id, :task, :project, :revision, :kind, :capability, :state, NULL, NULL, 0, NULL, :checkpoint, NULL, :at, :at) ON CONFLICT(task_id) DO NOTHING');
        $q->execute(['id' => self::uuidFromBytes(random_bytes(16)), 'task' => $taskId, 'project' => $projectId, 'revision' => $revisionId, 'kind' => $executorKind, 'capability' => $requiredCapability, 'state' => $state, 'checkpoint' => $json, 'at' => $at]);
    }

    /** Claims and completes at most one persisted server-native task. */
    public function runOnce(?string $now = null): ?array
    {
        $this->assertReady(); $at = self::timestamp($now ?? gmdate('c')); $this->advertise($at); $this->reconcileRunnableInspections($at); $claimed = $this->claim($at);
        if ($claimed === null) return null;
        try {
            $checkpoint = json_decode((string) $claimed['checkpoint_json'], true, 32, JSON_THROW_ON_ERROR);
            if (!is_array($checkpoint)) throw new HubDurableExecutionException('Execution checkpoint is invalid', 'EXECUTION_INVALID');
            if (($checkpoint['mode'] ?? null) === 'PROJECT_INSPECTION') {
                $context = $this->vaults->context((string) $claimed['project_id'], (string) $claimed['goal']);
                $summary = $this->agentInspection($claimed, $context, $at) ?? $this->inspectionSummary($context, (string) $claimed['goal']);
                $this->complete($claimed, $summary, 'RESULT', $at);
            } elseif (($checkpoint['mode'] ?? null) === 'NATIVE_CONVERSATION') {
                $summary = $this->nativeConversation($claimed, $checkpoint, $at);
                $this->complete($claimed, $summary, 'ASSISTANT', $at);
            } elseif (($checkpoint['mode'] ?? null) === 'PROJECT_TEXT_NORMALIZE') {
                $this->nativeTextNormalize($claimed, $at);
            } else {
                throw new HubDurableExecutionException('This work needs an approved specialist capability', 'WAITING_FOR_CAPABILITY');
            }
            return ['executionId' => (string) $claimed['execution_id'], 'taskId' => (string) $claimed['task_id'], 'state' => ($checkpoint['mode'] ?? null) === 'PROJECT_TEXT_NORMALIZE' ? 'WAITING_FOR_APPROVAL' : 'COMPLETED'];
        } catch (HubProjectVaultException|HubDurableExecutionException $error) {
            $diagnostic = $error instanceof HubDurableExecutionException ? $error->diagnostic : [];
            $state = $this->deferOrFail($claimed, $error->codeName, $at, $diagnostic);
            return ['executionId' => (string) $claimed['execution_id'], 'taskId' => (string) $claimed['task_id'], 'state' => $state];
        } catch (Throwable) { $state = $this->deferOrFail($claimed, 'EXECUTION_FAILED', $at); return ['executionId' => (string) $claimed['execution_id'], 'taskId' => (string) $claimed['task_id'], 'state' => $state]; }
    }

    /**
     * Reconcile accepted read-only work that arrived before a canonical Vault
     * revision existed. Mutation/engineering requests remain worker-bound.
     */
    private function reconcileRunnableInspections(string $at): int
    {
        $q = $this->pdo->query("SELECT t.task_id, t.project_id, t.conversation_id, t.goal, v.active_revision_id FROM control_tasks t JOIN control_project_vaults v ON v.project_id=t.project_id AND v.active_revision_id IS NOT NULL LEFT JOIN control_task_executions e ON e.task_id=t.task_id WHERE t.state='WAITING_FOR_WORKER' AND e.execution_id IS NULL ORDER BY t.created_at, t.task_id LIMIT 25");
        $count = 0;
        foreach ($q->fetchAll() as $row) {
            if (!self::isServerInspectionGoal((string) $row['goal'])) continue;
            try {
                $this->pdo->exec('BEGIN IMMEDIATE');
                $check = $this->pdo->prepare('SELECT state FROM control_tasks WHERE task_id=:task'); $check->execute(['task' => $row['task_id']]);
                if ($check->fetchColumn() !== 'WAITING_FOR_WORKER') { $this->pdo->exec('COMMIT'); continue; }
                $exists = $this->pdo->prepare('SELECT 1 FROM control_task_executions WHERE task_id=:task'); $exists->execute(['task' => $row['task_id']]);
                if ($exists->fetchColumn() !== false) { $this->pdo->exec('COMMIT'); continue; }
                $this->pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:id,:task,:project,:revision,'VPS','project.read','QUEUED',NULL,NULL,0,NULL,:checkpoint,NULL,:at,:at)")->execute(['id' => self::uuidFromBytes(random_bytes(16)), 'task' => $row['task_id'], 'project' => $row['project_id'], 'revision' => $row['active_revision_id'], 'checkpoint' => json_encode(['mode' => 'PROJECT_INSPECTION'], JSON_THROW_ON_ERROR), 'at' => $at]);
                $this->pdo->prepare("UPDATE control_tasks SET state='QUEUED',progress=5,failure_code=NULL,updated_at=:at WHERE task_id=:task")->execute(['at' => $at, 'task' => $row['task_id']]);
                $this->event((string) $row['task_id'], 'QUEUED', 5, 'canonical Project Vault became available; server inspection queued', $at);
                if (is_string($row['conversation_id']) && preg_match('/^[0-9a-f-]{36}$/i', $row['conversation_id'])) $this->appendConversationMessage((string) $row['conversation_id'], (string) $row['task_id'], 'PROGRESS', 'พบ Source of Truth ของโปรเจกต์แล้ว กำลังเริ่มตรวจบน AWH Server', $at);
                $this->pdo->exec('COMMIT'); $count++;
            } catch (Throwable) { $this->rollbackImmediate(); }
        }
        return $count;
    }

    /** @return list<array<string,mixed>> */
    public function recoverExpired(?string $now = null): array
    {
        $this->assertReady(); $at = self::timestamp($now ?? gmdate('c')); $q = $this->pdo->prepare("SELECT execution_id, task_id FROM control_task_executions WHERE state IN ('LEASED', 'RUNNING') AND (lease_expires_at IS NULL OR lease_expires_at <= :at) LIMIT 50"); $q->execute(['at' => $at]); $released = [];
        foreach ($q->fetchAll() as $row) { $update = $this->pdo->prepare("UPDATE control_task_executions SET state = CASE WHEN attempt_count >= :max THEN 'FAILED' ELSE 'QUEUED' END, lease_owner = NULL, lease_expires_at = NULL, last_error_code = 'LEASE_EXPIRED', updated_at = :at WHERE execution_id = :id AND state IN ('LEASED', 'RUNNING') AND (lease_expires_at IS NULL OR lease_expires_at <= :at)"); $update->execute(['max' => self::MAX_ATTEMPTS, 'at' => $at, 'id' => $row['execution_id']]); if ($update->rowCount() === 1) $released[] = ['executionId' => (string) $row['execution_id'], 'taskId' => (string) $row['task_id']]; }
        return $released;
    }

    private function claim(string $at): ?array
    {
        $this->recoverExpired($at); $expires = gmdate('c', strtotime($at) + self::LEASE_SECONDS);
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            $q = $this->pdo->prepare("SELECT e.*, t.goal, t.conversation_id, t.user_id FROM control_task_executions e JOIN control_tasks t ON t.task_id = e.task_id WHERE e.state = 'QUEUED' AND e.executor_kind = 'VPS' AND e.required_capability IN ('agent.conversation', 'project.read', 'project.mutate.text') AND t.state IN ('QUEUED', 'WAITING_FOR_WORKER') ORDER BY e.created_at, e.execution_id LIMIT 1"); $q->execute(); $row = $q->fetch();
            if (!is_array($row)) { $this->pdo->exec('COMMIT'); return null; }
            $update = $this->pdo->prepare("UPDATE control_task_executions SET state = 'RUNNING', lease_owner = :owner, lease_expires_at = :expires, attempt_count = attempt_count + 1, updated_at = :at WHERE execution_id = :id AND state = 'QUEUED'"); $update->execute(['owner' => self::EXECUTOR_ID, 'expires' => $expires, 'at' => $at, 'id' => $row['execution_id']]);
            if ($update->rowCount() !== 1) { $this->pdo->exec('ROLLBACK'); return null; }
            $this->pdo->prepare("UPDATE control_tasks SET state = 'RUNNING', progress = 15, updated_at = :at WHERE task_id = :task AND state IN ('QUEUED', 'WAITING_FOR_WORKER')")->execute(['at' => $at, 'task' => $row['task_id']]); $this->event((string) $row['task_id'], 'RUNNING', 15, (string) $row['required_capability'] === 'project.mutate.text' ? 'server-native candidate workspace started' : 'server-native inspection started', $at); $this->pdo->exec('COMMIT'); return $row;
        } catch (Throwable $error) { $this->rollbackImmediate(); if ($error instanceof HubDurableExecutionException) throw $error; throw new HubDurableExecutionException('Server execution claim failed', 'EXECUTION_CLAIM_FAILED'); }
    }

    private function complete(array $claimed, string $summary, string $messageKind, string $at): void
    {
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            $update = $this->pdo->prepare("UPDATE control_task_executions SET state = 'COMPLETED', lease_expires_at = NULL, updated_at = :at, last_error_code = NULL WHERE execution_id = :id AND state = 'RUNNING' AND lease_owner = :owner"); $update->execute(['at' => $at, 'id' => $claimed['execution_id'], 'owner' => self::EXECUTOR_ID]); if ($update->rowCount() !== 1) throw new HubDurableExecutionException('Server execution lease was lost', 'EXECUTION_LEASE_LOST');
            $this->pdo->prepare("UPDATE control_tasks SET state = 'COMPLETED', progress = 100, result_summary = :summary, failure_code = NULL, lease_expires_at = NULL, updated_at = :at WHERE task_id = :task")->execute(['summary' => $summary, 'at' => $at, 'task' => $claimed['task_id']]); $this->event((string) $claimed['task_id'], 'COMPLETED', 100, 'server-native execution completed', $at); $this->appendConversationMessage((string) $claimed['conversation_id'], (string) $claimed['task_id'], $messageKind, $summary, $at); $this->pdo->exec('COMMIT');
        } catch (Throwable $error) { $this->rollbackImmediate(); if ($error instanceof HubDurableExecutionException) throw $error; throw new HubDurableExecutionException('Server execution could not be completed', 'EXECUTION_FAILED'); }
    }

    /** @param array<string,mixed> $diagnostic @return string resulting execution state */
    private function deferOrFail(array $claimed, string $code, string $at, array $diagnostic = []): string
    {
        $attempt = (int) $claimed['attempt_count'] + 1;
        $retryableProvider = in_array($code, ['PROVIDER_UNAVAILABLE', 'PROVIDER_RATE_LIMITED'], true);
        $manualWait = in_array($code, ['WAITING_FOR_CAPABILITY', 'PROJECT_VAULT_EMPTY', 'BUDGET_EXHAUSTED', 'PROVIDER_QUOTA_EXHAUSTED'], true);
        $nonRetryable = in_array($code, ['PROVIDER_AUTH_FAILED', 'PROVIDER_PERMISSION_DENIED', 'PROVIDER_MODEL_UNAVAILABLE', 'PROVIDER_REQUEST_INVALID'], true);
        if ($nonRetryable) $state = 'FAILED';
        elseif ($manualWait) $state = 'WAITING_FOR_CAPABILITY';
        elseif ($retryableProvider) $state = $attempt < self::MAX_ATTEMPTS ? 'QUEUED' : 'WAITING_FOR_CAPABILITY';
        else $state = $attempt < self::MAX_ATTEMPTS ? 'QUEUED' : 'FAILED';
        $terminal = $state === 'FAILED';
        $waiting = $state === 'WAITING_FOR_CAPABILITY';
        $retrying = $state === 'QUEUED';
        $safeDiagnostic = self::safeDiagnostic($diagnostic);
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            $this->pdo->prepare('UPDATE control_task_executions SET state = :state, lease_owner = NULL, lease_expires_at = NULL, last_error_code = :code, updated_at = :at WHERE execution_id = :id')->execute(['state' => $state, 'code' => $code, 'at' => $at, 'id' => $claimed['execution_id']]);
            $taskState = $terminal ? 'FAILED' : 'WAITING_FOR_WORKER';
            $summary = $terminal ? self::providerFailureSummary($code) : null;
            $this->pdo->prepare('UPDATE control_tasks SET state = :state, progress = 0, failure_code = :code, result_summary = COALESCE(:summary, result_summary), lease_expires_at = NULL, updated_at = :at WHERE task_id = :task')->execute(['state' => $taskState, 'code' => $code, 'summary' => $summary, 'at' => $at, 'task' => $claimed['task_id']]);
            $eventMessage = $retrying ? 'bounded retry queued on the same task' : ($waiting ? 'work preserved; automatic retry paused' : 'server-native execution failed');
            if ($safeDiagnostic !== []) $eventMessage .= ' provider_failure=' . json_encode(['code' => $code] + $safeDiagnostic, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $this->event((string) $claimed['task_id'], $taskState, 0, $eventMessage, $at);
            $userMessage = $terminal ? (self::providerFailureSummary($code) ?? 'งานนี้หยุดไว้โดยปลอดภัย และยังไม่ได้เลื่อนผลลัพธ์ทับ Project หลัก') : 'ผมเก็บงานนี้ไว้แล้ว และจะทำต่อในเบื้องหลังเมื่อความสามารถที่ต้องใช้พร้อม';
            $this->appendConversationMessage((string) $claimed['conversation_id'], (string) $claimed['task_id'], $terminal ? 'FAILURE' : 'PROGRESS', $userMessage, $at);
            $this->pdo->exec('COMMIT');
        } catch (Throwable) { $this->rollbackImmediate(); }
        return $state;
    }

    private static function providerFailureSummary(string $code): ?string
    {
        return match ($code) {
            'PROVIDER_AUTH_FAILED' => 'การเชื่อมต่อ AI ถูกปฏิเสธ กรุณาตรวจ API key ในการตั้งค่า AI',
            'PROVIDER_PERMISSION_DENIED' => 'OpenAI ยังไม่อนุญาตให้บัญชีหรือโปรเจกต์นี้ใช้คำขอที่ตั้งไว้ งานถูกหยุดไว้โดยไม่อ้างว่าเสร็จแล้ว',
            'PROVIDER_MODEL_UNAVAILABLE' => 'โมเดล AI ที่ตั้งไว้ยังใช้กับบัญชีนี้ไม่ได้ กรุณาเลือกโมเดลอื่นแล้วทดสอบการเชื่อมต่อ',
            'PROVIDER_REQUEST_INVALID' => 'AWH ส่งคำขอ AI ไม่สำเร็จ ระบบหยุดงานไว้โดยไม่อ้างว่าเสร็จแล้ว',
            default => null,
        };
    }

    private static function providerWaitSummary(string $code, bool $retrying): string
    {
        return match ($code) {
            'BUDGET_EXHAUSTED' => 'งบ AI ของ AWH ถึงขีดจำกัด งานของคุณยังถูกเก็บไว้และระบบจะไม่อ้างว่าเสร็จแล้ว',
            'PROVIDER_QUOTA_EXHAUSTED' => 'โควตาหรือวงเงินของ OpenAI ยังไม่พร้อม งานของคุณยังถูกเก็บไว้และระบบจะไม่อ้างว่าเสร็จแล้ว',
            'PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_FAILED' => $retrying ? 'AI ยังตอบไม่ได้ในขณะนี้ งานของคุณยังถูกเก็บไว้ ระบบจะลองใหม่แบบจำกัดบนงานเดิม' : 'AI ยังตอบไม่ได้ในขณะนี้ งานของคุณยังถูกเก็บไว้ และหยุดการลองอัตโนมัติหลังครบขีดจำกัด',
            default => 'งานของคุณยังถูกเก็บไว้และกำลังรอความสามารถที่เหมาะสม',
        };
    }

    /** @param array<string,mixed> $diagnostic @return array<string,mixed> */
    private static function safeDiagnostic(array $diagnostic): array
    {
        $allowed = ['provider', 'operation', 'category', 'httpStatusClass', 'providerType', 'providerCode', 'model']; $out = [];
        foreach ($allowed as $key) if (is_string($diagnostic[$key] ?? null) && preg_match('/^[A-Za-z0-9._:-]{1,100}$/', (string) $diagnostic[$key]) === 1) $out[$key] = (string) $diagnostic[$key];
        if (is_int($diagnostic['httpStatus'] ?? null) && $diagnostic['httpStatus'] >= 100 && $diagnostic['httpStatus'] <= 599) $out['httpStatus'] = $diagnostic['httpStatus'];
        if (is_int($diagnostic['transportCode'] ?? null) && $diagnostic['transportCode'] > 0 && $diagnostic['transportCode'] < 1000) $out['transportCode'] = $diagnostic['transportCode'];
        if (is_bool($diagnostic['retryable'] ?? null)) $out['retryable'] = $diagnostic['retryable'];
        return $out;
    }

    /** @param array{revisionId:string,contentSha256:string,files:list<array{path:string,sizeBytes:int}>} $context */
    private function inspectionSummary(array $context, string $goal): string
    {
        $files = $context['files']; $names = array_map(static fn (array $file): string => '`' . $file['path'] . '`', array_slice($files, 0, 6));
        $prefix = 'ตรวจจาก Project Vault revision ' . substr($context['contentSha256'], 0, 12) . ' แล้ว';
        return $prefix . ($names === [] ? ' ไม่พบไฟล์ที่ตรงกับคำขอโดยตรง' : ' พบไฟล์ที่เกี่ยวข้อง: ' . implode(', ', $names)) . ' งานนี้เป็นการตรวจแบบอ่านอย่างเดียว จึงไม่ได้แก้ source หรือสร้าง release candidate.';
    }

    /** @param array<string,mixed> $claimed @param array{revisionId:string,contentSha256:string,files:list<array{path:string,sizeBytes:int}>} $context */
    private function agentInspection(array $claimed, array $context, string $at): ?string
    {
        if ($this->agent === null) return null;
        $revision = (string) $context['revisionId']; $project = (string) $claimed['project_id'];
        $tools = [
            ['type' => 'function', 'name' => 'project_search', 'description' => 'Search canonical Project Vault filenames. Read-only.', 'parameters' => ['type' => 'object', 'additionalProperties' => false, 'properties' => ['query' => ['type' => 'string', 'maxLength' => 120]], 'required' => ['query']]],
            ['type' => 'function', 'name' => 'project_read_text', 'description' => 'Read a bounded text file from the immutable canonical revision. Read-only.', 'parameters' => ['type' => 'object', 'additionalProperties' => false, 'properties' => ['path' => ['type' => 'string', 'maxLength' => 900]], 'required' => ['path']]],
        ];
        try {
            $result = $this->agent->respondWithTools((string) $claimed['user_id'], $project, is_string($claimed['conversation_id']) ? $claimed['conversation_id'] : null, null, (string) $claimed['goal'], [], [], ['vaultRevision' => $revision, 'contentSha256' => $context['contentSha256'], 'candidateFiles' => $context['files']], $tools, function (string $name, array $arguments) use ($project, $revision): array {
                if ($name === 'project_search') { $query = $arguments['query'] ?? null; if (!is_string($query)) throw new HubDurableExecutionException('Native tool input is invalid', 'EXECUTION_INVALID'); return ['files' => $this->vaults->vault()->search($project, $revision, $query)]; }
                if ($name === 'project_read_text') { $path = $arguments['path'] ?? null; if (!is_string($path)) throw new HubDurableExecutionException('Native tool input is invalid', 'EXECUTION_INVALID'); return $this->vaults->vault()->readText($project, $revision, $path); }
                throw new HubDurableExecutionException('Native tool is forbidden', 'EXECUTION_INVALID');
            }, $at);
            return is_string($result['summary'] ?? null) ? $result['summary'] : null;
        } catch (HubNativeAgentException $error) {
            // An unavailable provider must not make an ordinary safe
            // inspection vanish: use the deterministic canonical summary.
            // A budget stop remains durable and visible to the Owner.
            if ($error->codeName === 'PROVIDER_UNAVAILABLE') return null;
            throw new HubDurableExecutionException('Native inspection provider failed', $error->codeName, $error->diagnostic);
        }
    }

    /** @param array<string,mixed> $claimed @param array<string,mixed> $checkpoint */
    private function nativeConversation(array $claimed, array $checkpoint, string $at): string
    {
        $conversationId = is_string($claimed['conversation_id'] ?? null) ? (string) $claimed['conversation_id'] : '';
        $messageId = $checkpoint['messageId'] ?? null;
        if (!preg_match('/^[0-9a-f-]{36}$/i', $conversationId) || !is_string($messageId) || preg_match('/^[0-9a-f-]{36}$/i', $messageId) !== 1) throw new HubDurableExecutionException('Native conversation checkpoint is invalid', 'EXECUTION_INVALID');
        $turns = $this->recentConversationTurns($conversationId, $messageId);
        $attachments = $this->attachmentsForMessage($conversationId, $messageId, (string) $claimed['user_id']);
        $context = $this->conversationContext((string) $claimed['user_id'], (string) $claimed['project_id'], (string) $claimed['goal']);
        if ($this->agent === null) throw new HubDurableExecutionException('Native conversation provider is unavailable', 'PROVIDER_UNAVAILABLE', ['provider' => 'openai', 'operation' => 'responses', 'category' => 'unavailable', 'retryable' => true]);
        try {
            $result = $this->agent->respond((string) $claimed['user_id'], (string) $claimed['project_id'], $conversationId, $messageId, (string) $claimed['goal'], $turns, $attachments, $at, $context);
            $summary = trim((string) ($result['summary'] ?? ''));
            if ($summary === '') throw new HubDurableExecutionException('Native conversation provider returned no usable answer', 'PROVIDER_FAILED', ['provider' => 'openai', 'operation' => 'responses', 'category' => 'invalid_response', 'retryable' => true]);
            return function_exists('mb_substr') ? mb_substr($summary, 0, 6000) : substr($summary, 0, 6000);
        } catch (HubNativeAgentException $error) {
            throw new HubDurableExecutionException('Native conversation provider failed', $error->codeName, $error->diagnostic);
        }
    }

    /**
     * A small but real VPS-native mutation path.  It is intentionally limited
     * to an explicit text file and deterministic normalisation, so model text
     * never becomes unrestricted filesystem or shell authority.  Broader code,
     * document, and media changes continue to wait for their advertised
     * specialist capabilities.
     */
    private function nativeTextNormalize(array $claimed, string $at): void
    {
        $projectId = (string) $claimed['project_id']; $taskId = (string) $claimed['task_id']; $userId = (string) $claimed['user_id']; $revision = is_string($claimed['vault_revision_id'] ?? null) ? (string) $claimed['vault_revision_id'] : '';
        if (!preg_match('/^[0-9a-f-]{36}$/i', $revision)) throw new HubDurableExecutionException('Task revision is invalid', 'EXECUTION_INVALID');
        $path = $this->normalizationPath((string) $claimed['goal']);
        $workspace = $this->taskWorkspace((string) $claimed['execution_id']);
        $candidate = null; $candidateRecorded = false;
        try {
            $this->vaults->vault()->materialize($projectId, $revision, $workspace);
            $source = $this->vaults->vault()->readText($projectId, $revision, $path);
            if (($source['truncated'] ?? false) === true) throw new HubDurableExecutionException('Text file is too large for the bounded native transform', 'WAITING_FOR_CAPABILITY');
            $target = $workspace . '/' . (string) $source['path'];
            $normalised = preg_replace('/\r\n?/', "\n", (string) $source['content']);
            if (!is_string($normalised)) throw new HubDurableExecutionException('Text transform could not be prepared', 'EXECUTION_FAILED');
            $normalised = preg_replace('/[ \t]+$/m', '', $normalised);
            if (!is_string($normalised)) throw new HubDurableExecutionException('Text transform could not be prepared', 'EXECUTION_FAILED');
            if ($normalised === (string) $source['content']) {
                $this->complete($claimed, 'ตรวจไฟล์ `' . $source['path'] . '` แล้ว ไม่พบช่องว่างท้ายบรรทัดหรือ line ending ที่ต้องแก้ จึงไม่ได้สร้าง revision ใหม่', 'RESULT', $at);
                return;
            }
            $temporary = dirname($target) . '/.' . basename($target) . '.awh-' . bin2hex(random_bytes(6));
            if (@file_put_contents($temporary, $normalised, LOCK_EX) === false || !@rename($temporary, $target)) { @unlink($temporary); throw new HubDurableExecutionException('Text transform could not be committed to the task workspace', 'EXECUTION_FAILED'); }
            @chmod($target, 0640);
            $candidate = $this->vaults->captureTaskWorkspace($projectId, $workspace, $userId, $taskId, $revision, $at);
            if (!$candidate['changed']) {
                $this->complete($claimed, 'ตรวจไฟล์ `' . $source['path'] . '` แล้ว เนื้อหาเท่ากับ revision เดิม จึงไม่ได้สร้าง candidate ใหม่', 'RESULT', $at);
                return;
            }
            $diff = $this->revisionDiff($projectId, $revision, (string) $candidate['revisionId']);
            $artifactId = $this->storeCandidateReport($claimed, $candidate, $diff, $workspace, $at);
            $summary = 'จัดระเบียบข้อความใน `' . $source['path'] . '` แล้ว สร้าง revision ผู้สมัครและตรวจความสมบูรณ์ของไฟล์เรียบร้อย รออนุมัติก่อนแทนที่ Project Vault หลัก';
            $this->completeCandidate($claimed, $candidate, $artifactId, $summary, $at);
            $candidateRecorded = true;
        } catch (Throwable $error) {
            if (is_array($candidate) && ($candidate['changed'] ?? false) === true && !$candidateRecorded) {
                try { $this->vaults->rejectCandidate($projectId, (string) $candidate['revisionId'], $at); } catch (Throwable) { /* A detached candidate is never canonical and remains auditable for recovery. */ }
            }
            throw $error;
        } finally {
            $this->removeWorkspace($workspace);
        }
    }

    private function normalizationPath(string $goal): string
    {
        if (preg_match('/^(?:normalize|normalise|จัดระเบียบ)(?:\s+(?:text|ข้อความ|ไฟล์))?\s+(?:file|ไฟล์)\s+([A-Za-z0-9._\/-]{1,900})\s*$/iu', trim($goal), $match) !== 1) throw new HubDurableExecutionException('This server-native transform needs an explicit file path', 'WAITING_FOR_CAPABILITY');
        return $match[1];
    }

    /** @param array{revisionId:string,contentSha256:string,contentBytes:int,fileCount:int,parentRevisionId:string,changed:bool} $candidate @param array{added:list<string>,changed:list<string>,deleted:list<string>} $diff */
    private function storeCandidateReport(array $claimed, array $candidate, array $diff, string $workspace, string $at): string
    {
        $store = $this->artifacts;
        if ($store === null) throw new HubDurableExecutionException('Artifact object storage is unavailable', 'ARTIFACT_STORAGE_UNAVAILABLE');
        $artifactId = self::uuidFromBytes(random_bytes(16));
        $report = ['schemaVersion' => 1, 'kind' => 'project-candidate', 'projectId' => (string) $claimed['project_id'], 'taskId' => (string) $claimed['task_id'], 'baseRevisionId' => $candidate['parentRevisionId'], 'candidateRevisionId' => $candidate['revisionId'], 'contentSha256' => $candidate['contentSha256'], 'diff' => $diff, 'qa' => ['workspaceCapture' => 'PASS', 'manifestIntegrity' => 'PASS'], 'createdAt' => $at];
        $file = $workspace . '/.awh-candidate-report.json';
        if (@file_put_contents($file, json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), LOCK_EX) === false) throw new HubDurableExecutionException('Candidate report could not be created', 'ARTIFACT_STORAGE_FAILED');
        try { $stored = $store->storeFile($artifactId, $file); } catch (HubArtifactStoreException $error) { throw new HubDurableExecutionException('Candidate artifact storage is unavailable', $error->codeName); }
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            $this->pdo->prepare('INSERT INTO control_artifacts(artifact_id, task_id, project_id, kind, name, sha256, size_bytes, relative_ref, created_at) VALUES(:id, :task, :project, :kind, :name, :sha, :size, NULL, :at)')->execute(['id' => $artifactId, 'task' => $claimed['task_id'], 'project' => $claimed['project_id'], 'kind' => 'project-candidate', 'name' => 'candidate-' . substr((string) $candidate['revisionId'], 0, 8) . '.json', 'sha' => $stored['sha256'], 'size' => $stored['sizeBytes'], 'at' => $at]);
            $this->pdo->prepare('INSERT INTO control_artifact_objects(artifact_id, storage_key, mime_type, retained_until, deleted_at) VALUES(:id, :key, :mime, NULL, NULL)')->execute(['id' => $artifactId, 'key' => $stored['storageKey'], 'mime' => 'application/json']);
            $this->pdo->exec('COMMIT'); return $artifactId;
        } catch (Throwable $error) {
            $this->rollbackImmediate(); $store->remove($stored['storageKey']);
            throw $error instanceof HubDurableExecutionException ? $error : new HubDurableExecutionException('Candidate artifact could not be saved', 'ARTIFACT_STORAGE_FAILED');
        }
    }

    /** @param array{revisionId:string,contentSha256:string,contentBytes:int,fileCount:int,parentRevisionId:string,changed:bool} $candidate */
    private function completeCandidate(array $claimed, array $candidate, string $artifactId, string $summary, string $at): void
    {
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            $done = $this->pdo->prepare("UPDATE control_task_executions SET state = 'COMPLETED', lease_expires_at = NULL, updated_at = :at, last_error_code = NULL WHERE execution_id = :id AND state = 'RUNNING' AND lease_owner = :owner"); $done->execute(['at' => $at, 'id' => $claimed['execution_id'], 'owner' => self::EXECUTOR_ID]); if ($done->rowCount() !== 1) throw new HubDurableExecutionException('Server execution lease was lost', 'EXECUTION_LEASE_LOST');
            $this->pdo->prepare("UPDATE control_tasks SET state = 'WAITING_FOR_APPROVAL', progress = 90, result_summary = :summary, failure_code = NULL, lease_expires_at = NULL, updated_at = :at WHERE task_id = :task")->execute(['summary' => $summary, 'at' => $at, 'task' => $claimed['task_id']]);
            $scope = json_encode(['taskId' => (string) $claimed['task_id'], 'projectId' => (string) $claimed['project_id'], 'expectedActiveRevisionId' => $candidate['parentRevisionId'], 'candidateRevisionId' => $candidate['revisionId'], 'artifactId' => $artifactId], JSON_THROW_ON_ERROR);
            $this->pdo->prepare("INSERT INTO control_approvals(approval_id, task_id, action, scope_json, status, expires_at, decided_at) VALUES(:id, :task, 'project.revision.promote', :scope, 'PENDING', :expires, NULL)")->execute(['id' => self::uuidFromBytes(random_bytes(16)), 'task' => $claimed['task_id'], 'scope' => $scope, 'expires' => gmdate('c', strtotime($at) + 86400)]);
            $this->event((string) $claimed['task_id'], 'WAITING_FOR_APPROVAL', 90, 'candidate revision is ready for owner approval', $at);
            $this->appendConversationMessage((string) $claimed['conversation_id'], (string) $claimed['task_id'], 'RESULT', $summary . ' [ดูรายงาน candidate]', $at);
            $this->pdo->exec('COMMIT');
        } catch (Throwable $error) { $this->rollbackImmediate(); if ($error instanceof HubDurableExecutionException) throw $error; throw new HubDurableExecutionException('Candidate approval could not be recorded', 'EXECUTION_FAILED'); }
    }

    /** @return array{added:list<string>,changed:list<string>,deleted:list<string>} */
    private function revisionDiff(string $projectId, string $baseRevision, string $candidateRevision): array
    {
        $read = function (string $revision) use ($projectId): array { $q = $this->pdo->prepare('SELECT manifest_json FROM control_project_vault_revisions WHERE project_id = :project AND revision_id = :revision'); $q->execute(['project' => $projectId, 'revision' => $revision]); $json = $q->fetchColumn(); $parsed = is_string($json) ? json_decode($json, true, 64) : null; if (!is_array($parsed) || !is_array($parsed['files'] ?? null)) throw new HubDurableExecutionException('Project revision manifest is invalid', 'EXECUTION_FAILED'); $out = []; foreach ($parsed['files'] as $file) if (is_array($file) && is_string($file['path'] ?? null) && is_string($file['sha256'] ?? null)) $out[$file['path']] = $file['sha256']; return $out; };
        $base = $read($baseRevision); $candidate = $read($candidateRevision); $added = []; $changed = []; $deleted = [];
        foreach ($candidate as $path => $sha) { if (!isset($base[$path])) $added[] = $path; elseif (!hash_equals($base[$path], $sha)) $changed[] = $path; }
        foreach ($base as $path => $_) if (!isset($candidate[$path])) $deleted[] = $path;
        return ['added' => $added, 'changed' => $changed, 'deleted' => $deleted];
    }

    private function taskWorkspace(string $executionId): string
    {
        self::uuid($executionId); $root = getenv('AWH_TASK_WORKSPACE_ROOT'); if (!is_string($root) || $root === '') $root = '/var/lib/awh-hub/task-workspaces';
        if (str_contains($root, "\0") || !str_starts_with($root, '/') || !is_dir($root) || is_link($root) || (((int) (@stat($root)['mode'] ?? 0) & 0o022) !== 0)) throw new HubDurableExecutionException('Task workspace storage is unavailable', 'TASK_WORKSPACE_UNAVAILABLE');
        return rtrim($root, '/') . '/' . strtolower($executionId);
    }

    private function removeWorkspace(string $workspace): void
    {
        if ($workspace === '' || !is_dir($workspace) || is_link($workspace)) return;
        $root = rtrim((string) (getenv('AWH_TASK_WORKSPACE_ROOT') ?: '/var/lib/awh-hub/task-workspaces'), '/');
        if (!str_starts_with($workspace, $root . '/')) return;
        $items = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($workspace, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($items as $item) { if (!$item instanceof SplFileInfo) continue; $path = $item->getPathname(); if ($item->isLink() || $item->isFile()) @unlink($path); elseif ($item->isDir()) @rmdir($path); }
        @rmdir($workspace);
    }

    /** @return list<array{role:string,body:string}> */
    private function recentConversationTurns(string $conversationId, string $excludeMessageId): array
    {
        $q = $this->pdo->prepare("SELECT message_kind, body FROM control_conversation_messages WHERE conversation_id = :conversation AND message_id != :exclude AND message_kind IN ('USER', 'ASSISTANT', 'RESULT', 'FAILURE') ORDER BY sequence_no DESC LIMIT 12"); $q->execute(['conversation' => $conversationId, 'exclude' => $excludeMessageId]);
        $rows = array_reverse($q->fetchAll()); $out = [];
        foreach ($rows as $row) $out[] = ['role' => (string) $row['message_kind'] === 'USER' ? 'user' : 'assistant', 'body' => (string) $row['body']];
        return $out;
    }

    /** @return list<array{name:string,mimeType:string,path:string,sizeBytes:int}> */
    private function attachmentsForMessage(string $conversationId, string $messageId, string $userId): array
    {
        $q = $this->pdo->prepare('SELECT a.display_name, a.mime_type, a.storage_key, a.size_bytes FROM control_conversation_attachments a JOIN control_conversations c ON c.conversation_id = a.conversation_id WHERE a.conversation_id = :conversation AND a.message_id = :message AND c.user_id = :user AND a.deleted_at IS NULL ORDER BY a.created_at, a.attachment_id LIMIT 4'); $q->execute(['conversation' => $conversationId, 'message' => $messageId, 'user' => $userId]);
        $store = HubAttachmentStore::fromEnvironment(); $out = [];
        foreach ($q->fetchAll() as $row) {
            try { $out[] = ['name' => (string) $row['display_name'], 'mimeType' => (string) $row['mime_type'], 'path' => $store->read((string) $row['storage_key']), 'sizeBytes' => (int) $row['size_bytes']]; }
            catch (HubAttachmentStoreException) { /* The record remains auditable; an unavailable upload is not a path disclosure. */ }
        }
        return $out;
    }

    /** @return array<string,mixed> */
    private function conversationContext(string $userId, string $projectId, string $request): array
    {
        $project = $this->pdo->prepare('SELECT name, type, source_revision, observed_at FROM projects WHERE project_id = :project'); $project->execute(['project' => $projectId]); $row = $project->fetch();
        $latest = $this->pdo->prepare('SELECT state, result_summary, updated_at FROM control_tasks WHERE project_id = :project AND user_id = :user ORDER BY updated_at DESC, task_id DESC LIMIT 2'); $latest->execute(['project' => $projectId, 'user' => $userId]);
        $memory = null;
        try {
            $owner = $this->pdo->prepare('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1'); $owner->execute();
            $memory = (new HubFoundingMemoryService($this->pdo))->promptContext($userId, $owner->fetchColumn() === $userId, $projectId, $request);
        } catch (Throwable) { $memory = null; }
        $revision = null;
        try { $revision = $this->vaults->activeRevision($projectId); } catch (HubProjectVaultException) { $revision = null; }
        return ['project' => is_array($row) ? ['name' => (string) $row['name'], 'type' => (string) $row['type'], 'sourceRevision' => $row['source_revision'] === null ? null : (string) $row['source_revision'], 'observedAt' => (string) $row['observed_at']] : null, 'vaultRevision' => $revision, 'recentTasks' => array_map(static fn (array $task): array => ['state' => (string) $task['state'], 'summary' => $task['result_summary'] === null ? null : (string) $task['result_summary'], 'updatedAt' => (string) $task['updated_at']], $latest->fetchAll()), 'durableMemory' => $memory];
    }


    private function appendConversationMessage(string $conversationId, string $taskId, string $kind, string $summary, string $at): void
    {
        if (!preg_match('/^[0-9a-f-]{36}$/i', $conversationId) || !in_array($kind, ['ASSISTANT', 'PROGRESS', 'RESULT', 'FAILURE'], true)) return;
        $q = $this->pdo->prepare('SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM control_conversation_messages WHERE conversation_id = :conversation'); $q->execute(['conversation' => $conversationId]); $sequence = (int) $q->fetchColumn();
        $this->pdo->prepare('INSERT INTO control_conversation_messages(message_id, conversation_id, task_id, message_kind, sequence_no, body, created_at, idempotency_key) VALUES(:id, :conversation, :task, :kind, :sequence, :body, :at, NULL)')->execute(['id' => self::uuidFromBytes(random_bytes(16)), 'conversation' => $conversationId, 'task' => $taskId, 'kind' => $kind, 'sequence' => $sequence, 'body' => $summary, 'at' => $at]);
        $this->pdo->prepare('UPDATE control_conversations SET updated_at = :at WHERE conversation_id = :conversation')->execute(['at' => $at, 'conversation' => $conversationId]);
    }

    private function event(string $task, string $state, int $progress, string $message, string $at): void { $this->pdo->prepare('INSERT INTO control_task_events(event_id, task_id, state, progress, message, occurred_at) VALUES(:id, :task, :state, :progress, :message, :at)')->execute(['id' => self::uuidFromBytes(random_bytes(16)), 'task' => $task, 'state' => $state, 'progress' => $progress, 'message' => $message, 'at' => $at]); }
    /** PDO does not report transactions opened by SQLite BEGIN IMMEDIATE. */
    private function rollbackImmediate(): void { try { $this->pdo->exec('ROLLBACK'); } catch (Throwable) {} }
    private function assertReady(): void { try { HubCentralProjectAuthorityMigration::assertCapabilityReady($this->pdo, dirname(__DIR__) . '/migrations/011_central_project_authority.sql'); } catch (HubCentralProjectAuthorityMigrationException $error) { throw new HubDurableExecutionException('Central Project Authority is not ready', $error->codeName); } }
    private static function isServerInspectionGoal(string $message): bool { return preg_match('/^(?:ตรวจ|วิเคราะห์|ดู|สรุป|สถานะ|ค้นหา|อ่าน|inspect|review|summari[sz]e|status|search|read)(?:\s|$)/iu', trim($message)) === 1 && preg_match('/(?:แก้|เขียน|สร้าง|ลบ|เปลี่ยน|deploy|commit|push|render|edit|write|create|delete|modify|build)/iu', $message) !== 1; }
    private static function uuid(string $value): string { if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value) !== 1) throw new HubDurableExecutionException('Execution reference is invalid', 'EXECUTION_INVALID'); return $value; }
    private static function uuidFromBytes(string $bytes): string { $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40); $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
    private static function timestamp(string $value): string { if (strtotime($value) === false) throw new HubDurableExecutionException('Execution time is invalid', 'EXECUTION_INVALID'); return gmdate('c', strtotime($value)); }
}
