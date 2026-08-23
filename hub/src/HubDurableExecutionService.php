<?php

declare(strict_types=1);

require_once __DIR__ . '/HubCentralProjectAuthorityMigration.php';
require_once __DIR__ . '/HubProjectVaultService.php';
require_once __DIR__ . '/HubNativeAgentService.php';
require_once __DIR__ . '/HubAttachmentStore.php';
require_once __DIR__ . '/HubFoundingMemoryService.php';

/**
 * Durable server-side execution projection for existing control_tasks.  It is
 * intentionally not a second task queue: each execution has a one-to-one FK
 * to the canonical task and writes progress/result back to that task and its
 * existing conversation stream.
 *
 * The initial VPS executor is deliberately read-only.  It can also complete
 * a persisted native conversation turn, but it never grants a model shell,
 * write, deployment, or network-tool authority.  Mutating work remains in an
 * isolated candidate/worker path until a project-specific capability is
 * explicitly available.
 */
final class HubDurableExecutionException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'EXECUTION_FAILED') { parent::__construct($message); }
}

final class HubDurableExecutionService
{
    private const EXECUTOR_ID = 'vps-native';
    private const LEASE_SECONDS = 300;
    private const MAX_ATTEMPTS = 3;

    public function __construct(private readonly PDO $pdo, private readonly HubProjectVaultService $vaults, private readonly ?HubNativeAgentService $agent = null) {}
    public static function fromEnvironment(PDO $pdo): self { return new self($pdo, HubProjectVaultService::fromEnvironment($pdo), new HubNativeAgentService($pdo)); }

    /** Registers only bounded server-native capabilities.  This is an
     * observation, not a blanket authorization to execute arbitrary commands. */
    public function advertise(?string $now = null): void
    {
        $this->assertReady(); $at = self::timestamp($now ?? gmdate('c')); $expires = gmdate('c', strtotime($at) + 300);
        foreach (['agent.conversation', 'project.read', 'project.search', 'artifact.metadata'] as $capability) $this->pdo->prepare('INSERT INTO control_executor_capabilities(executor_id, executor_kind, capability, version, observed_at, expires_at) VALUES(:id, \'VPS\', :capability, :version, :at, :expires) ON CONFLICT(executor_id, capability) DO UPDATE SET executor_kind=excluded.executor_kind, version=excluded.version, observed_at=excluded.observed_at, expires_at=excluded.expires_at')->execute(['id' => self::EXECUTOR_ID, 'capability' => $capability, 'version' => 'm12', 'at' => $at, 'expires' => $expires]);
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
        $this->assertReady(); $at = self::timestamp($now ?? gmdate('c')); $this->advertise($at); $claimed = $this->claim($at);
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
            } else {
                throw new HubDurableExecutionException('This work needs an approved specialist capability', 'WAITING_FOR_CAPABILITY');
            }
            return ['executionId' => (string) $claimed['execution_id'], 'taskId' => (string) $claimed['task_id'], 'state' => 'COMPLETED'];
        } catch (HubProjectVaultException|HubDurableExecutionException $error) {
            $this->deferOrFail($claimed, $error->codeName, $at); return ['executionId' => (string) $claimed['execution_id'], 'taskId' => (string) $claimed['task_id'], 'state' => $error->codeName === 'WAITING_FOR_CAPABILITY' ? 'WAITING_FOR_CAPABILITY' : 'FAILED'];
        } catch (Throwable) { $this->deferOrFail($claimed, 'EXECUTION_FAILED', $at); return ['executionId' => (string) $claimed['execution_id'], 'taskId' => (string) $claimed['task_id'], 'state' => 'FAILED']; }
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
            $q = $this->pdo->prepare("SELECT e.*, t.goal, t.conversation_id, t.user_id FROM control_task_executions e JOIN control_tasks t ON t.task_id = e.task_id WHERE e.state = 'QUEUED' AND e.executor_kind = 'VPS' AND e.required_capability IN ('agent.conversation', 'project.read') AND t.state IN ('QUEUED', 'WAITING_FOR_WORKER') ORDER BY e.created_at, e.execution_id LIMIT 1"); $q->execute(); $row = $q->fetch();
            if (!is_array($row)) { $this->pdo->exec('COMMIT'); return null; }
            $update = $this->pdo->prepare("UPDATE control_task_executions SET state = 'RUNNING', lease_owner = :owner, lease_expires_at = :expires, attempt_count = attempt_count + 1, updated_at = :at WHERE execution_id = :id AND state = 'QUEUED'"); $update->execute(['owner' => self::EXECUTOR_ID, 'expires' => $expires, 'at' => $at, 'id' => $row['execution_id']]);
            if ($update->rowCount() !== 1) { $this->pdo->exec('ROLLBACK'); return null; }
            $this->pdo->prepare("UPDATE control_tasks SET state = 'RUNNING', progress = 15, updated_at = :at WHERE task_id = :task AND state IN ('QUEUED', 'WAITING_FOR_WORKER')")->execute(['at' => $at, 'task' => $row['task_id']]); $this->event((string) $row['task_id'], 'RUNNING', 15, 'server-native inspection started', $at); $this->pdo->exec('COMMIT'); return $row;
        } catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); if ($error instanceof HubDurableExecutionException) throw $error; throw new HubDurableExecutionException('Server execution claim failed', 'EXECUTION_CLAIM_FAILED'); }
    }

    private function complete(array $claimed, string $summary, string $messageKind, string $at): void
    {
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            $update = $this->pdo->prepare("UPDATE control_task_executions SET state = 'COMPLETED', lease_expires_at = NULL, updated_at = :at, last_error_code = NULL WHERE execution_id = :id AND state = 'RUNNING' AND lease_owner = :owner"); $update->execute(['at' => $at, 'id' => $claimed['execution_id'], 'owner' => self::EXECUTOR_ID]); if ($update->rowCount() !== 1) throw new HubDurableExecutionException('Server execution lease was lost', 'EXECUTION_LEASE_LOST');
            $this->pdo->prepare("UPDATE control_tasks SET state = 'COMPLETED', progress = 100, result_summary = :summary, failure_code = NULL, lease_expires_at = NULL, updated_at = :at WHERE task_id = :task")->execute(['summary' => $summary, 'at' => $at, 'task' => $claimed['task_id']]); $this->event((string) $claimed['task_id'], 'COMPLETED', 100, 'server-native execution completed', $at); $this->appendConversationMessage((string) $claimed['conversation_id'], (string) $claimed['task_id'], $messageKind, $summary, $at); $this->pdo->exec('COMMIT');
        } catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); if ($error instanceof HubDurableExecutionException) throw $error; throw new HubDurableExecutionException('Server execution could not be completed', 'EXECUTION_FAILED'); }
    }

    private function deferOrFail(array $claimed, string $code, string $at): void
    {
        $wait = in_array($code, ['WAITING_FOR_CAPABILITY', 'PROJECT_VAULT_EMPTY', 'PROVIDER_UNAVAILABLE', 'BUDGET_EXHAUSTED'], true); $terminal = !$wait && (((int) $claimed['attempt_count'] + 1) >= self::MAX_ATTEMPTS);
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            $state = $terminal ? 'FAILED' : ($wait ? 'WAITING_FOR_CAPABILITY' : 'QUEUED');
            $this->pdo->prepare('UPDATE control_task_executions SET state = :state, lease_owner = NULL, lease_expires_at = NULL, last_error_code = :code, updated_at = :at WHERE execution_id = :id')->execute(['state' => $state, 'code' => $code, 'at' => $at, 'id' => $claimed['execution_id']]);
            $taskState = $terminal ? 'FAILED' : 'WAITING_FOR_WORKER'; $summary = $wait ? 'งานถูกเก็บไว้และกำลังรอความสามารถที่เหมาะสม' : null;
            $this->pdo->prepare('UPDATE control_tasks SET state = :state, progress = 0, failure_code = :code, result_summary = COALESCE(:summary, result_summary), lease_expires_at = NULL, updated_at = :at WHERE task_id = :task')->execute(['state' => $taskState, 'code' => $code, 'summary' => $summary, 'at' => $at, 'task' => $claimed['task_id']]); $this->event((string) $claimed['task_id'], $taskState, 0, $wait ? 'waiting for a safe execution capability' : 'server-native execution failed', $at);
            $this->appendConversationMessage((string) $claimed['conversation_id'], (string) $claimed['task_id'], $terminal ? 'FAILURE' : 'PROGRESS', $terminal ? 'งานนี้หยุดไว้โดยปลอดภัย และยังไม่ได้เลื่อนผลลัพธ์ทับ Project หลัก' : ($code === 'BUDGET_EXHAUSTED' ? 'งบ AI ถึงขีดจำกัด งานนี้ถูกเก็บไว้และจะไม่สูญหาย' : 'งานถูกเก็บไว้และกำลังรอความสามารถที่เหมาะสม'), $at); $this->pdo->exec('COMMIT');
        } catch (Throwable) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); }
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
            throw new HubDurableExecutionException('Native inspection provider failed', $error->codeName);
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
        if ($this->agent === null) return $this->conversationFallback($context);
        try {
            $result = $this->agent->respond((string) $claimed['user_id'], (string) $claimed['project_id'], $conversationId, $messageId, (string) $claimed['goal'], $turns, $attachments, $at, $context);
            $summary = trim((string) ($result['summary'] ?? ''));
            if ($summary === '') return $this->conversationFallback($context);
            return function_exists('mb_substr') ? mb_substr($summary, 0, 6000) : substr($summary, 0, 6000);
        } catch (HubNativeAgentException $error) {
            if ($error->codeName === 'BUDGET_EXHAUSTED') throw new HubDurableExecutionException('Owner AI budget is exhausted', 'BUDGET_EXHAUSTED');
            return $this->conversationFallback($context);
        }
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

    /** @param array<string,mixed> $context */
    private function conversationFallback(array $context): string
    {
        $project = is_array($context['project'] ?? null) ? $context['project'] : null; $name = is_array($project) && is_string($project['name'] ?? null) ? $project['name'] : 'โปรเจกต์นี้';
        $latest = is_array($context['recentTasks'] ?? null) ? ($context['recentTasks'][0] ?? null) : null;
        if (is_array($latest) && is_string($latest['state'] ?? null)) return 'ผมบันทึกข้อความนี้ไว้กับ ' . $name . ' แล้ว สถานะงานล่าสุดคือ ' . (string) $latest['state'] . ' และยังไม่ได้ดำเนินการเปลี่ยนแปลงใดเพิ่ม';
        return 'ผมบันทึกข้อความนี้ไว้กับ ' . $name . ' แล้ว ตอนนี้ยังไม่มี provider ที่พร้อมตอบเชิงลึก แต่บทสนทนาและบริบทจะคงอยู่เพื่อทำต่อได้อย่างปลอดภัย';
    }

    private function appendConversationMessage(string $conversationId, string $taskId, string $kind, string $summary, string $at): void
    {
        if (!preg_match('/^[0-9a-f-]{36}$/i', $conversationId) || !in_array($kind, ['ASSISTANT', 'PROGRESS', 'RESULT', 'FAILURE'], true)) return;
        $q = $this->pdo->prepare('SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM control_conversation_messages WHERE conversation_id = :conversation'); $q->execute(['conversation' => $conversationId]); $sequence = (int) $q->fetchColumn();
        $this->pdo->prepare('INSERT INTO control_conversation_messages(message_id, conversation_id, task_id, message_kind, sequence_no, body, created_at, idempotency_key) VALUES(:id, :conversation, :task, :kind, :sequence, :body, :at, NULL)')->execute(['id' => self::uuidFromBytes(random_bytes(16)), 'conversation' => $conversationId, 'task' => $taskId, 'kind' => $kind, 'sequence' => $sequence, 'body' => $summary, 'at' => $at]);
        $this->pdo->prepare('UPDATE control_conversations SET updated_at = :at WHERE conversation_id = :conversation')->execute(['at' => $at, 'conversation' => $conversationId]);
    }

    private function event(string $task, string $state, int $progress, string $message, string $at): void { $this->pdo->prepare('INSERT INTO control_task_events(event_id, task_id, state, progress, message, occurred_at) VALUES(:id, :task, :state, :progress, :message, :at)')->execute(['id' => self::uuidFromBytes(random_bytes(16)), 'task' => $task, 'state' => $state, 'progress' => $progress, 'message' => $message, 'at' => $at]); }
    private function assertReady(): void { try { HubCentralProjectAuthorityMigration::assertCapabilityReady($this->pdo, dirname(__DIR__) . '/migrations/011_central_project_authority.sql'); } catch (HubCentralProjectAuthorityMigrationException $error) { throw new HubDurableExecutionException('Central Project Authority is not ready', $error->codeName); } }
    private static function uuid(string $value): string { if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value) !== 1) throw new HubDurableExecutionException('Execution reference is invalid', 'EXECUTION_INVALID'); return $value; }
    private static function uuidFromBytes(string $bytes): string { $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40); $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
    private static function timestamp(string $value): string { if (strtotime($value) === false) throw new HubDurableExecutionException('Execution time is invalid', 'EXECUTION_INVALID'); return gmdate('c', strtotime($value)); }
}
