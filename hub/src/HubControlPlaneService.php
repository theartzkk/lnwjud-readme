<?php

declare(strict_types=1);

require_once __DIR__ . '/HubAssistantWorkstreamMigration.php';

final class HubControlPlaneException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'CONTROL_PLANE_FAILED')
    {
        parent::__construct($message);
    }
}

/**
 * Shared lightweight control plane. It uses the existing Hub users, projects,
 * memberships, pairing-code hashes and device-token authentication tables.
 * It never accepts a shell command, a workspace path, source content or a
 * browser-visible permanent bearer token.
 */
final class HubControlPlaneService
{
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';
    private const CODE = '/^[A-Za-z0-9_-]{32,128}$/';
    private const SESSION_TTL = 28800;
    private const SESSION_RATE_WINDOW = 600;
    private const SESSION_RATE_LIMIT = 5;
    private const WORKER_STALE_TTL = 120;
    private const LEASE_TTL = 300;
    private const STATES = ['QUEUED', 'WAITING_FOR_WORKER', 'PREPARING', 'RUNNING', 'QA', 'WAITING_FOR_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED'];
    private const CONVERSATION_KINDS = ['USER', 'ASSISTANT', 'PROGRESS', 'APPROVAL', 'RESULT', 'FAILURE'];

    private function __construct(private readonly PDO $pdo, private readonly HubEnrollmentService $enrollment)
    {
    }

    public static function openExisting(string $databasePath): self
    {
        if ($databasePath === '' || str_contains($databasePath, "\0")) throw new HubControlPlaneException('Control-plane database configuration is invalid', 'DATABASE_CONFIG_INVALID');
        try {
            $pdo = new PDO('sqlite:' . $databasePath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA busy_timeout = 2500');
            $ready = (int) $pdo->query('PRAGMA user_version')->fetchColumn() >= 4 && $pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'control_tasks'")->fetchColumn() === 1;
            if (!$ready) throw new HubControlPlaneException('Control-plane migration is not ready', 'CONTROL_SCHEMA_NOT_READY');
            return new self($pdo, HubEnrollmentService::openExisting($databasePath));
        } catch (HubControlPlaneException $error) {
            throw $error;
        } catch (Throwable) {
            throw new HubControlPlaneException('Control-plane storage is unavailable', 'DATABASE_UNAVAILABLE');
        }
    }

    /** Consume an existing owner-issued pairing code into an HTTP-only control session. */
    public function openSession(string $pairingCode, string $displayName, string $appVersion, ?string $now = null, ?string $rateKey = null): array
    {
        if (!preg_match(self::CODE, $pairingCode)) throw new HubControlPlaneException('Pairing code is malformed', 'PAIRING_CODE_INVALID');
        $displayName = self::portableText($displayName, 'displayName', 80);
        $appVersion = self::portableText($appVersion, 'appVersion', 32);
        $now = self::timestamp($now ?? gmdate('c'));
        $at = strtotime($now);
        $this->assertSessionRateLimit($rateKey, $now);
        $query = $this->pdo->prepare('SELECT pairing_code_id, user_id, expires_at, consumed_at, revoked_at FROM pairing_codes WHERE code_hash = :hash');
        $query->execute(['hash' => hash('sha256', $pairingCode)]);
        $pairing = $query->fetch();
        if (!is_array($pairing) || $pairing['consumed_at'] !== null || $pairing['revoked_at'] !== null || strtotime((string) $pairing['expires_at']) <= $at) throw new HubControlPlaneException('Pairing code is not active', $pairing !== false && is_array($pairing) && $pairing['consumed_at'] !== null ? 'PAIRING_REPLAY' : 'PAIRING_REJECTED');
        $sessionId = self::uuidFromBytes(random_bytes(16));
        $sessionToken = self::base64url(random_bytes(32));
        $csrfToken = self::base64url(random_bytes(24));
        $expires = gmdate('c', $at + self::SESSION_TTL);
        try {
            $this->pdo->beginTransaction();
            $consume = $this->pdo->prepare('UPDATE pairing_codes SET consumed_at = :at WHERE pairing_code_id = :id AND consumed_at IS NULL AND revoked_at IS NULL');
            $consume->execute(['at' => $now, 'id' => $pairing['pairing_code_id']]);
            if ($consume->rowCount() !== 1) throw new HubControlPlaneException('Pairing code was already used', 'PAIRING_REPLAY');
            $insert = $this->pdo->prepare('INSERT INTO control_sessions(session_id, session_hash, user_id, device_id, csrf_hash, created_at, expires_at, last_seen_at, revoked_at) VALUES(:id, :hash, :user, NULL, :csrf, :created, :expires, :last, NULL)');
            $insert->execute(['id' => $sessionId, 'hash' => hash('sha256', $sessionToken), 'user' => $pairing['user_id'], 'csrf' => hash('sha256', $csrfToken), 'created' => $now, 'expires' => $expires, 'last' => $now]);
            $this->pdo->commit();
        } catch (HubControlPlaneException $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw $error;
        } catch (Throwable) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw new HubControlPlaneException('Control session creation failed closed', 'SESSION_CREATE_FAILED');
        }
        return ['sessionToken' => $sessionToken, 'csrfToken' => $csrfToken, 'userId' => (string) $pairing['user_id'], 'displayName' => $displayName, 'appVersion' => $appVersion, 'expiresAt' => $expires];
    }

    public function session(string $sessionToken, ?string $now = null): array
    {
        $row = $this->sessionRow($sessionToken, $now);
        $csrf = self::base64url(random_bytes(24));
        $at = self::timestamp($now ?? gmdate('c'));
        $this->pdo->prepare('UPDATE control_sessions SET csrf_hash = :csrf, last_seen_at = :at WHERE session_id = :id')->execute(['csrf' => hash('sha256', $csrf), 'at' => $at, 'id' => $row['session_id']]);
        return ['userId' => (string) $row['user_id'], 'expiresAt' => (string) $row['expires_at'], 'csrfToken' => $csrf, 'projects' => $this->projectsForUser((string) $row['user_id'])];
    }

    public function listProjectsForSession(string $sessionToken, ?string $now = null): array { $row = $this->sessionRow($sessionToken, $now); return ['schemaVersion' => 1, 'projects' => $this->projectsForUser((string) $row['user_id'])]; }

    /**
     * M6's Work surface is an ordered view over existing canonical tasks.  A
     * project owns one durable conversation; a message can create zero or one
     * task, and task activity is reflected back into the same stream.
     */
    public function conversation(string $sessionToken, string $projectId, ?string $now = null): array
    {
        $session = $this->sessionRow($sessionToken, $now);
        return $this->conversationForUser((string) $session['user_id'], self::uuid($projectId));
    }

    public function submitConversation(string $sessionToken, string $csrfToken, array $payload, ?string $now = null): array
    {
        $session = $this->authorizeSession($sessionToken, $csrfToken, $now);
        return $this->submitConversationForUser((string) $session['user_id'], $payload, $now);
    }

    /** Desktop invokes this only in its privileged main process with the existing M3E credential. */
    public function workerConversation(string $token, string $deviceId, string $projectId, ?string $now = null): array
    {
        $auth = $this->enrollment->authenticateForControlPlane($token, self::uuid($deviceId), $now);
        $projectId = self::uuid($projectId);
        $this->assertDeviceProjectMember((string) $auth['deviceId'], $projectId);
        return $this->conversationForUser((string) $auth['userId'], $projectId);
    }

    public function submitWorkerConversation(string $token, array $payload, ?string $now = null): array
    {
        self::exactKeys($payload, ['deviceId', 'idempotencyKey', 'message', 'projectId', 'schemaVersion']);
        $deviceId = self::uuid((string) ($payload['deviceId'] ?? ''));
        $auth = $this->enrollment->authenticateForControlPlane($token, $deviceId, $now);
        $projectId = self::uuid((string) ($payload['projectId'] ?? ''));
        $this->assertDeviceProjectMember((string) $auth['deviceId'], $projectId);
        return $this->submitConversationForUser((string) $auth['userId'], $payload, $now);
    }

    public function submitTask(string $sessionToken, string $csrfToken, array $payload, ?string $now = null): array
    {
        $session = $this->authorizeSession($sessionToken, $csrfToken, $now);
        self::exactKeys($payload, ['goal', 'idempotencyKey', 'projectId', 'schemaVersion']);
        if (($payload['schemaVersion'] ?? null) !== 1) throw new HubControlPlaneException('Unsupported task schema', 'SCHEMA_VERSION');
        $projectId = self::uuid((string) ($payload['projectId'] ?? ''));
        $goal = self::goal((string) ($payload['goal'] ?? ''));
        $idempotency = self::idempotency((string) ($payload['idempotencyKey'] ?? ''));
        $this->assertProjectMember((string) $session['user_id'], $projectId);
        $now = self::timestamp($now ?? gmdate('c'));
        $existing = $this->pdo->prepare('SELECT * FROM control_tasks WHERE user_id = :user AND idempotency_key = :key');
        $existing->execute(['user' => $session['user_id'], 'key' => $idempotency]);
        $row = $existing->fetch();
        if (is_array($row)) return $this->taskRow($row);
        $taskId = self::uuidFromBytes(random_bytes(16));
        try {
            $insert = $this->pdo->prepare('INSERT INTO control_tasks(task_id, user_id, project_id, goal, state, assigned_device_id, lease_expires_at, progress, result_summary, failure_code, idempotency_key, created_at, updated_at, cancelled_at) VALUES(:id, :user, :project, :goal, \'WAITING_FOR_WORKER\', NULL, NULL, 0, NULL, NULL, :key, :created, :updated, NULL)');
            $insert->execute(['id' => $taskId, 'user' => $session['user_id'], 'project' => $projectId, 'goal' => $goal, 'key' => $idempotency, 'created' => $now, 'updated' => $now]);
            $this->event($taskId, 'WAITING_FOR_WORKER', 0, 'received', $now);
        } catch (Throwable) { throw new HubControlPlaneException('Task could not be queued', 'TASK_CREATE_FAILED'); }
        return $this->taskById($taskId, (string) $session['user_id']);
    }

    /** @return array{schemaVersion:int,conversation:?array,messages:list<array>,tasks:list<array>,artifacts:list<array>,approvals:list<array>} */
    private function conversationForUser(string $userId, string $projectId): array
    {
        $this->assertAssistantReady();
        $this->assertProjectMember($userId, $projectId);
        $conversationQuery = $this->pdo->prepare('SELECT * FROM control_conversations WHERE user_id = :user AND project_id = :project');
        $conversationQuery->execute(['user' => $userId, 'project' => $projectId]);
        $conversation = $conversationQuery->fetch();
        if (!is_array($conversation)) return ['schemaVersion' => 1, 'conversation' => null, 'messages' => [], 'tasks' => [], 'artifacts' => [], 'approvals' => []];

        $messageQuery = $this->pdo->prepare('SELECT message_id, task_id, message_kind, sequence_no, body, created_at FROM control_conversation_messages WHERE conversation_id = :conversation ORDER BY sequence_no ASC LIMIT 250');
        $messageQuery->execute(['conversation' => $conversation['conversation_id']]);
        $messages = array_map(static fn (array $row): array => [
            'messageId' => (string) $row['message_id'], 'taskId' => $row['task_id'] === null ? null : (string) $row['task_id'],
            'kind' => strtolower((string) $row['message_kind']), 'sequence' => (int) $row['sequence_no'],
            'body' => (string) $row['body'], 'createdAt' => (string) $row['created_at'],
        ], $messageQuery->fetchAll());
        $taskQuery = $this->pdo->prepare('SELECT * FROM control_tasks WHERE conversation_id = :conversation AND user_id = :user ORDER BY created_at ASC, task_id ASC LIMIT 100');
        $taskQuery->execute(['conversation' => $conversation['conversation_id'], 'user' => $userId]);
        $tasks = array_map(fn (array $row): array => $this->taskRow($row), $taskQuery->fetchAll());
        $taskIds = array_map(static fn (array $task): string => (string) $task['taskId'], $tasks);
        $artifacts = $this->conversationArtifacts($taskIds);
        $approvals = $this->conversationApprovals($taskIds);
        return [
            'schemaVersion' => 1,
            'conversation' => ['conversationId' => (string) $conversation['conversation_id'], 'projectId' => (string) $conversation['project_id'], 'createdAt' => (string) $conversation['created_at'], 'updatedAt' => (string) $conversation['updated_at'], 'lastTaskId' => $conversation['last_task_id'] === null ? null : (string) $conversation['last_task_id']],
            'messages' => $messages, 'tasks' => $tasks, 'artifacts' => $artifacts, 'approvals' => $approvals,
        ];
    }

    private function submitConversationForUser(string $userId, array $payload, ?string $now): array
    {
        self::exactKeys($payload, ['idempotencyKey', 'message', 'projectId', 'schemaVersion']);
        if (($payload['schemaVersion'] ?? null) !== 1) throw new HubControlPlaneException('Unsupported conversation schema', 'SCHEMA_VERSION');
        $this->assertAssistantReady();
        $projectId = self::uuid((string) ($payload['projectId'] ?? ''));
        $message = self::goal((string) ($payload['message'] ?? ''));
        $idempotency = self::idempotency((string) ($payload['idempotencyKey'] ?? ''));
        $this->assertProjectMember($userId, $projectId);
        $at = self::timestamp($now ?? gmdate('c'));
        $transactionOpen = false;
        try {
            $this->pdo->exec('BEGIN IMMEDIATE'); $transactionOpen = true;
            $conversation = $this->getOrCreateConversation($userId, $projectId, $at);
            $existing = $this->pdo->prepare('SELECT message_id FROM control_conversation_messages WHERE conversation_id = :conversation AND idempotency_key = :key');
            $existing->execute(['conversation' => $conversation['conversation_id'], 'key' => $idempotency]);
            if ($existing->fetchColumn() !== false) { $this->pdo->exec('COMMIT'); $transactionOpen = false; return $this->conversationForUser($userId, $projectId); }
            $this->appendConversationMessage((string) $conversation['conversation_id'], null, 'USER', $message, $at, $idempotency);
            if (self::isConversationOnly($message)) {
                $this->appendConversationMessage((string) $conversation['conversation_id'], null, 'ASSISTANT', $this->conversationAnswer($projectId, $message), $at);
            } else {
                $taskId = self::uuidFromBytes(random_bytes(16));
                $taskKey = 'conversation-' . $idempotency;
                $effectiveGoal = $this->resolveConversationGoal((string) $conversation['conversation_id'], $message);
                $insert = $this->pdo->prepare('INSERT INTO control_tasks(task_id, user_id, project_id, goal, state, assigned_device_id, lease_expires_at, progress, result_summary, failure_code, idempotency_key, conversation_id, created_at, updated_at, cancelled_at) VALUES(:id, :user, :project, :goal, \'WAITING_FOR_WORKER\', NULL, NULL, 0, NULL, NULL, :key, :conversation, :created, :updated, NULL)');
                $insert->execute(['id' => $taskId, 'user' => $userId, 'project' => $projectId, 'goal' => $effectiveGoal, 'key' => $taskKey, 'conversation' => $conversation['conversation_id'], 'created' => $at, 'updated' => $at]);
                $this->event($taskId, 'WAITING_FOR_WORKER', 0, 'received', $at);
                $this->pdo->prepare('UPDATE control_conversations SET last_task_id = :task, updated_at = :at WHERE conversation_id = :conversation')->execute(['task' => $taskId, 'at' => $at, 'conversation' => $conversation['conversation_id']]);
                $this->appendConversationMessage((string) $conversation['conversation_id'], $taskId, 'ASSISTANT', $effectiveGoal === $message ? 'รับเรื่องแล้ว ผมกำลังเตรียมบริบทของโปรเจกต์และรออุปกรณ์ที่เหมาะสมเริ่มงานอย่างปลอดภัย' : 'รับเรื่องต่อจากงานล่าสุดแล้ว ผมจะใช้บริบทเดิมร่วมกับคำขอใหม่นี้อย่างปลอดภัย', $at);
            }
            $this->pdo->exec('COMMIT'); $transactionOpen = false;
        } catch (HubControlPlaneException $error) {
            if ($transactionOpen) { try { $this->pdo->exec('ROLLBACK'); } catch (Throwable) {} }
            throw $error;
        } catch (Throwable) {
            if ($transactionOpen) { try { $this->pdo->exec('ROLLBACK'); } catch (Throwable) {} }
            throw new HubControlPlaneException('Conversation could not be saved', 'CONVERSATION_CREATE_FAILED');
        }
        return $this->conversationForUser($userId, $projectId);
    }

    public function listTasks(string $sessionToken, ?string $projectId = null, ?string $now = null): array
    {
        $session = $this->sessionRow($sessionToken, $now);
        $sql = 'SELECT * FROM control_tasks WHERE user_id = :user'; $params = ['user' => $session['user_id']];
        if ($projectId !== null) { $projectId = self::uuid($projectId); $this->assertProjectMember((string) $session['user_id'], $projectId); $sql .= ' AND project_id = :project'; $params['project'] = $projectId; }
        $sql .= ' ORDER BY updated_at DESC, task_id DESC LIMIT 50';
        $query = $this->pdo->prepare($sql); $query->execute($params); return ['schemaVersion' => 1, 'tasks' => array_map(fn (array $row): array => $this->taskRow($row), $query->fetchAll())];
    }

    public function getTask(string $sessionToken, string $taskId, ?string $now = null): array { $session = $this->sessionRow($sessionToken, $now); return $this->taskById($taskId, (string) $session['user_id']); }

    /** Only work that has not been claimed by a worker is safely cancellable. */
    public function cancelTask(string $sessionToken, string $csrfToken, string $taskId, ?string $now = null): array
    {
        $session = $this->authorizeSession($sessionToken, $csrfToken, $now); $taskId = self::uuid($taskId); $at = self::timestamp($now ?? gmdate('c')); $transactionOpen = false;
        try {
            $this->pdo->exec('BEGIN IMMEDIATE'); $transactionOpen = true;
            $q = $this->pdo->prepare('SELECT state FROM control_tasks WHERE task_id = :task AND user_id = :user'); $q->execute(['task' => $taskId, 'user' => $session['user_id']]); $state = $q->fetchColumn();
            if (!is_string($state)) throw new HubControlPlaneException('Task was not found', 'TASK_NOT_FOUND');
            if ($state === 'CANCELLED') { $this->pdo->exec('COMMIT'); $transactionOpen = false; return $this->taskById($taskId, (string) $session['user_id']); }
            if (!in_array($state, ['WAITING_FOR_WORKER', 'WAITING_FOR_APPROVAL'], true)) throw new HubControlPlaneException('Task can no longer be stopped safely', 'TASK_NOT_CANCELLABLE');
            $update = $this->pdo->prepare("UPDATE control_tasks SET state = 'CANCELLED', assigned_device_id = NULL, lease_expires_at = NULL, cancelled_at = :at, updated_at = :at WHERE task_id = :task AND user_id = :user AND state IN ('WAITING_FOR_WORKER', 'WAITING_FOR_APPROVAL')");
            $update->execute(['at' => $at, 'task' => $taskId, 'user' => $session['user_id']]);
            if ($update->rowCount() !== 1) throw new HubControlPlaneException('Task cancellation raced with a worker', 'TASK_CANCEL_RACE');
            $eventId = $this->event($taskId, 'CANCELLED', 0, 'cancelled by owner', $at);
            $this->syncConversationEvent($taskId, $eventId, 'CANCELLED', 0, 'cancelled by owner', 'ยกเลิกงานนี้แล้ว ยังไม่มีการเริ่มงานใหม่', $at);
            $this->pdo->exec('COMMIT'); $transactionOpen = false;
        } catch (Throwable $error) {
            if ($transactionOpen) { try { $this->pdo->exec('ROLLBACK'); } catch (Throwable) {} }
            if ($error instanceof HubControlPlaneException) throw $error;
            throw new HubControlPlaneException('Task cancellation failed closed', 'TASK_CANCEL_FAILED');
        }
        return $this->taskById($taskId, (string) $session['user_id']);
    }

    /** Results are task-scoped, bounded and never include source content or local paths. */
    public function results(string $sessionToken, ?string $projectId = null, ?string $now = null): array
    {
        $session = $this->sessionRow($sessionToken, $now);
        $sql = 'SELECT * FROM control_tasks WHERE user_id = :user AND state IN (\'COMPLETED\', \'FAILED\', \'WAITING_FOR_APPROVAL\')';
        $params = ['user' => $session['user_id']];
        if ($projectId !== null) { $projectId = self::uuid($projectId); $this->assertProjectMember((string) $session['user_id'], $projectId); $sql .= ' AND project_id = :project'; $params['project'] = $projectId; }
        $sql .= ' ORDER BY updated_at DESC, task_id DESC LIMIT 50';
        $query = $this->pdo->prepare($sql); $query->execute($params);
        return ['schemaVersion' => 1, 'results' => array_map(fn (array $row): array => $this->taskRow($row), $query->fetchAll())];
    }

    public function artifacts(string $sessionToken, ?string $taskId = null, ?string $now = null): array
    {
        $session = $this->sessionRow($sessionToken, $now);
        $sql = 'SELECT a.artifact_id, a.task_id, a.project_id, a.kind, a.name, a.sha256, a.size_bytes, a.relative_ref, a.created_at FROM control_artifacts a JOIN control_tasks t ON t.task_id = a.task_id WHERE t.user_id = :user';
        $params = ['user' => $session['user_id']];
        if ($taskId !== null) { $taskId = self::uuid($taskId); $sql .= ' AND a.task_id = :task'; $params['task'] = $taskId; }
        $sql .= ' ORDER BY a.created_at DESC, a.artifact_id DESC LIMIT 100';
        $query = $this->pdo->prepare($sql); $query->execute($params);
        return ['schemaVersion' => 1, 'artifacts' => array_map([self::class, 'artifactRow'], $query->fetchAll())];
    }

    /** Device-authenticated read for the Desktop worker; the device never receives another device's credential. */
    public function workerResults(string $token, string $deviceId, ?string $now = null): array
    {
        $auth = $this->enrollment->authenticateForControlPlane($token, self::uuid($deviceId), $now);
        $query = $this->pdo->prepare("SELECT * FROM control_tasks WHERE user_id = :user AND state IN ('COMPLETED', 'FAILED', 'WAITING_FOR_APPROVAL') ORDER BY updated_at DESC, task_id DESC LIMIT 50"); $query->execute(['user' => $auth['userId']]);
        $artifact = $this->pdo->prepare('SELECT a.artifact_id, a.task_id, a.project_id, a.kind, a.name, a.sha256, a.size_bytes, a.relative_ref, a.created_at FROM control_artifacts a JOIN control_tasks t ON t.task_id = a.task_id WHERE t.user_id = :user ORDER BY a.created_at DESC, a.artifact_id DESC LIMIT 100'); $artifact->execute(['user' => $auth['userId']]);
        $approval = $this->pdo->prepare('SELECT a.approval_id, a.task_id, t.project_id, a.action, a.status, a.expires_at, a.decided_at FROM control_approvals a JOIN control_tasks t ON t.task_id = a.task_id WHERE t.user_id = :user ORDER BY a.expires_at DESC, a.approval_id DESC LIMIT 50'); $approval->execute(['user' => $auth['userId']]);
        return ['schemaVersion' => 1, 'results' => array_map(fn (array $row): array => $this->taskRow($row), $query->fetchAll()), 'artifacts' => array_map([self::class, 'artifactRow'], $artifact->fetchAll()), 'approvals' => array_map([self::class, 'approvalRow'], $approval->fetchAll())];
    }

    public function approvals(string $sessionToken, ?string $now = null): array
    {
        $session = $this->sessionRow($sessionToken, $now); $at = strtotime(self::timestamp($now ?? gmdate('c')));
        $query = $this->pdo->prepare('SELECT a.approval_id, a.task_id, t.project_id, a.action, a.scope_json, a.status, a.expires_at, a.decided_at FROM control_approvals a JOIN control_tasks t ON t.task_id = a.task_id WHERE t.user_id = :user ORDER BY a.expires_at DESC, a.approval_id DESC LIMIT 50');
        $query->execute(['user' => $session['user_id']]);
        return ['schemaVersion' => 1, 'approvals' => array_map(static function (array $row) use ($at): array { $status = (string) $row['status']; if ($status === 'PENDING' && strtotime((string) $row['expires_at']) <= $at) $status = 'EXPIRED'; return self::approvalRow($row, $status); }, $query->fetchAll())];
    }

    public function decideApproval(string $sessionToken, string $csrfToken, string $approvalId, string $decision, ?string $now = null): array
    {
        $session = $this->authorizeSession($sessionToken, $csrfToken, $now); $approvalId = self::uuid($approvalId); $decision = strtoupper($decision);
        if (!in_array($decision, ['APPROVED', 'REJECTED'], true)) throw new HubControlPlaneException('Approval decision is invalid', 'APPROVAL_DECISION_INVALID');
        $at = self::timestamp($now ?? gmdate('c')); $epoch = strtotime($at);
        $q = $this->pdo->prepare('SELECT a.*, t.project_id, t.user_id, t.goal FROM control_approvals a JOIN control_tasks t ON t.task_id = a.task_id WHERE a.approval_id = :approval AND t.user_id = :user');
        $q->execute(['approval' => $approvalId, 'user' => $session['user_id']]); $row = $q->fetch();
        if (!is_array($row)) throw new HubControlPlaneException('Approval was not found', 'APPROVAL_NOT_FOUND');
        $current = (string) $row['status'];
        if ($current !== 'PENDING') {
            if ($current === $decision) return self::approvalRow($row, $current);
            throw new HubControlPlaneException('Approval was already decided', 'APPROVAL_ALREADY_DECIDED');
        }
        if (strtotime((string) $row['expires_at']) <= $epoch) { $this->pdo->prepare("UPDATE control_approvals SET status = 'EXPIRED' WHERE approval_id = :approval AND status = 'PENDING'")->execute(['approval' => $approvalId]); throw new HubControlPlaneException('Approval has expired', 'APPROVAL_EXPIRED'); }
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            $update = $this->pdo->prepare('UPDATE control_approvals SET status = :status, decided_at = :at WHERE approval_id = :approval AND status = \'PENDING\'');
            $update->execute(['status' => $decision, 'at' => $at, 'approval' => $approvalId]);
            if ($update->rowCount() !== 1) throw new HubControlPlaneException('Approval was already decided', 'APPROVAL_ALREADY_DECIDED');
            $taskState = $decision === 'APPROVED' ? 'WAITING_FOR_WORKER' : 'FAILED';
            $message = $decision === 'APPROVED' ? 'approved' : 'rejected';
            $this->pdo->prepare('UPDATE control_tasks SET state = :state, assigned_device_id = NULL, lease_expires_at = NULL, progress = CASE WHEN :failed = 1 THEN progress ELSE 0 END, failure_code = CASE WHEN :failed = 1 THEN \'APPROVAL_REJECTED\' ELSE NULL END, result_summary = CASE WHEN :failed = 1 THEN \'เจ้าของไม่อนุมัติการดำเนินการ\' ELSE NULL END, updated_at = :at WHERE task_id = :task AND user_id = :user')->execute(['state' => $taskState, 'failed' => $decision === 'REJECTED' ? 1 : 0, 'at' => $at, 'task' => $row['task_id'], 'user' => $session['user_id']]);
            $eventId = $this->event((string) $row['task_id'], $taskState, $decision === 'REJECTED' ? 0 : 0, $message, $at);
            $this->syncConversationEvent((string) $row['task_id'], $eventId, $taskState, 0, $message, $decision === 'REJECTED' ? 'ไม่ได้ดำเนินการต่อ เพราะเจ้าของไม่อนุมัติ' : null, $at);
            $this->pdo->prepare('UPDATE control_workers SET state = \'READY\', busy_task_id = NULL, last_seen_at = :at WHERE busy_task_id = :task')->execute(['at' => $at, 'task' => $row['task_id']]);
            $this->pdo->exec('COMMIT');
        } catch (Throwable $error) { try { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); else $this->pdo->exec('ROLLBACK'); } catch (Throwable) {} if ($error instanceof HubControlPlaneException) throw $error; throw new HubControlPlaneException('Approval decision failed closed', 'APPROVAL_DECISION_FAILED'); }
        $row['status'] = $decision; $row['decided_at'] = $at; return self::approvalRow($row, $decision);
    }

    public function addArtifact(string $token, string $taskId, array $payload, ?string $now = null): array
    {
        self::exactKeys($payload, ['deviceId', 'kind', 'name', 'relativeRef', 'schemaVersion', 'sha256', 'sizeBytes']); if (($payload['schemaVersion'] ?? null) !== 1) throw new HubControlPlaneException('Unsupported artifact schema', 'SCHEMA_VERSION');
        $taskId = self::uuid($taskId); $kind = self::portableText((string) ($payload['kind'] ?? ''), 'kind', 40); $name = self::portableText((string) ($payload['name'] ?? ''), 'name', 160); $sha = $payload['sha256']; if ($sha !== null && (!is_string($sha) || !preg_match('/^[0-9a-f]{64}$/i', $sha))) throw new HubControlPlaneException('Artifact checksum is invalid', 'FIELD_INVALID');
        $size = $payload['sizeBytes']; if (!is_int($size) || $size < 0 || $size > 50 * 1024 * 1024) throw new HubControlPlaneException('Artifact size is invalid', 'FIELD_INVALID');
        $ref = $payload['relativeRef']; if ($ref !== null && (!is_string($ref) || $ref === '' || strlen($ref) > 240 || str_starts_with($ref, '/') || str_contains($ref, '\\') || str_contains($ref, '..') || preg_match('/[\x00-\x1f\x7f]/', $ref))) throw new HubControlPlaneException('Artifact reference is invalid', 'FIELD_INVALID');
        $auth = $this->enrollment->authenticateForControlPlane($token, self::uuid((string) ($payload['deviceId'] ?? '')), $now);
        $at = self::timestamp($now ?? gmdate('c'));
        $transactionOpen = false;
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            $transactionOpen = true;
            $q = $this->pdo->prepare('SELECT project_id, assigned_device_id, user_id FROM control_tasks WHERE task_id = :task'); $q->execute(['task' => $taskId]); $task = $q->fetch(); if (!is_array($task) || $task['assigned_device_id'] !== $auth['deviceId'] || $task['user_id'] !== $auth['userId']) throw new HubControlPlaneException('Task is not assigned to this worker', 'TASK_FORBIDDEN');
            $existing = $this->pdo->prepare('SELECT artifact_id FROM control_artifacts WHERE task_id = :task AND kind = :kind AND name = :name AND ((sha256 IS NULL AND :sha IS NULL) OR sha256 = :sha) AND ((relative_ref IS NULL AND :ref IS NULL) OR relative_ref = :ref)');
            $existing->execute(['task' => $taskId, 'kind' => $kind, 'name' => $name, 'sha' => $sha === null ? null : strtolower($sha), 'ref' => $ref]);
            if ($existing->fetchColumn() === false) $this->pdo->prepare('INSERT INTO control_artifacts(artifact_id, task_id, project_id, kind, name, sha256, size_bytes, relative_ref, created_at) VALUES(:id, :task, :project, :kind, :name, :sha, :size, :ref, :at)')->execute(['id' => self::uuidFromBytes(random_bytes(16)), 'task' => $taskId, 'project' => $task['project_id'], 'kind' => $kind, 'name' => $name, 'sha' => $sha === null ? null : strtolower($sha), 'size' => $size, 'ref' => $ref, 'at' => $at]);
            $this->pdo->exec('COMMIT');
            $transactionOpen = false;
        } catch (Throwable $error) {
            if ($transactionOpen) { try { $this->pdo->exec('ROLLBACK'); } catch (Throwable) {} }
            if ($error instanceof HubControlPlaneException) throw $error;
            throw new HubControlPlaneException('Artifact could not be saved', 'ARTIFACT_CREATE_FAILED');
        }
        return $this->taskById($taskId, (string) $auth['userId']);
    }

    public function workers(string $sessionToken, ?string $now = null): array
    {
        $this->sessionRow($sessionToken, $now);
        $rows = $this->pdo->query("SELECT w.device_id, w.state, w.last_seen_at, d.display_name, d.platform, d.arch FROM control_workers w JOIN devices d ON d.device_id = w.device_id WHERE d.revoked_at IS NULL ORDER BY d.display_name, d.device_id LIMIT 100")->fetchAll();
        $nowAt = time();
        return ['schemaVersion' => 1, 'workers' => array_map(static function (array $row) use ($nowAt): array { $state = strtotime((string) $row['last_seen_at']) < $nowAt - self::WORKER_STALE_TTL ? 'OFFLINE' : (in_array($row['state'], ['READY', 'WORKING', 'OFFLINE'], true) ? $row['state'] : 'OFFLINE'); return ['deviceId' => (string) $row['device_id'], 'displayName' => (string) $row['display_name'], 'platform' => (string) $row['platform'], 'arch' => (string) $row['arch'], 'state' => $state, 'lastSeenAt' => (string) $row['last_seen_at']]; }, $rows)];
    }

    public function heartbeat(string $token, array $payload, ?string $now = null): array
    {
        self::exactKeys($payload, ['capabilities', 'deviceId', 'schemaVersion', 'state']);
        if (($payload['schemaVersion'] ?? null) !== 1 || !is_array($payload['capabilities']) || count($payload['capabilities']) > 24) throw new HubControlPlaneException('Worker payload is invalid', 'PAYLOAD_INVALID');
        $deviceId = self::uuid((string) ($payload['deviceId'] ?? '')); $auth = $this->enrollment->authenticateForControlPlane($token, $deviceId, $now); $state = (string) ($payload['state'] ?? 'READY');
        if (!in_array($state, ['READY', 'WORKING', 'OFFLINE'], true)) throw new HubControlPlaneException('Worker state is invalid', 'FIELD_INVALID');
        $caps = [];
        foreach ($payload['capabilities'] as $cap) { if (!is_string($cap) || !preg_match('/^[a-z][a-z0-9:._-]{0,63}$/', $cap)) throw new HubControlPlaneException('Worker capability is invalid', 'FIELD_INVALID'); $caps[] = $cap; }
        $at = self::timestamp($now ?? gmdate('c'));
        $q = $this->pdo->prepare('INSERT INTO control_workers(device_id, state, capabilities_json, last_seen_at, busy_task_id) VALUES(:device, :state, :caps, :at, NULL) ON CONFLICT(device_id) DO UPDATE SET state=excluded.state, capabilities_json=excluded.capabilities_json, last_seen_at=excluded.last_seen_at');
        $q->execute(['device' => $auth['deviceId'], 'state' => $state, 'caps' => json_encode(array_values(array_unique($caps)), JSON_THROW_ON_ERROR), 'at' => $at]);
        if ($state === 'WORKING') {
            $renew = $this->pdo->prepare("UPDATE control_tasks SET lease_expires_at = :expires WHERE task_id = (SELECT busy_task_id FROM control_workers WHERE device_id = :device) AND assigned_device_id = :device AND state IN ('PREPARING', 'RUNNING', 'QA')");
            $renew->execute(['expires' => gmdate('c', strtotime($at) + self::LEASE_TTL), 'device' => $auth['deviceId']]);
        }
        return ['schemaVersion' => 1, 'deviceId' => $auth['deviceId'], 'state' => $state, 'lastSeenAt' => $at];
    }

    public function claim(string $token, array $payload, ?string $now = null): array
    {
        self::exactKeys($payload, ['deviceId', 'schemaVersion']); if (($payload['schemaVersion'] ?? null) !== 1) throw new HubControlPlaneException('Unsupported worker schema', 'SCHEMA_VERSION');
        $deviceId = self::uuid((string) ($payload['deviceId'] ?? '')); $auth = $this->enrollment->authenticateForControlPlane($token, $deviceId, $now); $at = self::timestamp($now ?? gmdate('c')); $expires = gmdate('c', strtotime($at) + self::LEASE_TTL);
        $stage = 'begin';
        $transactionOpen = false;
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            $transactionOpen = true;
            // A crashed worker must not strand a task forever. Releasing only
            // expired (or corrupt null) leases keeps the original task and
            // conversation lineage intact while allowing a compatible worker
            // to resume it deliberately.
            $stale = $this->pdo->prepare("SELECT task_id FROM control_tasks WHERE state IN ('PREPARING', 'RUNNING', 'QA') AND (lease_expires_at IS NULL OR lease_expires_at <= :at) ORDER BY updated_at, task_id LIMIT 20");
            $stale->execute(['at' => $at]);
            foreach ($stale->fetchAll() as $staleRow) {
                $release = $this->pdo->prepare("UPDATE control_tasks SET state = 'WAITING_FOR_WORKER', assigned_device_id = NULL, lease_expires_at = NULL, updated_at = :at WHERE task_id = :task AND state IN ('PREPARING', 'RUNNING', 'QA') AND (lease_expires_at IS NULL OR lease_expires_at <= :at)");
                $release->execute(['at' => $at, 'task' => $staleRow['task_id']]);
                if ($release->rowCount() === 1) {
                    $this->pdo->prepare("UPDATE control_workers SET state = 'READY', busy_task_id = NULL, last_seen_at = :at WHERE busy_task_id = :task")->execute(['at' => $at, 'task' => $staleRow['task_id']]);
                    $eventId = $this->event((string) $staleRow['task_id'], 'WAITING_FOR_WORKER', 0, 'worker lease expired', $at);
                    $this->syncConversationEvent((string) $staleRow['task_id'], $eventId, 'WAITING_FOR_WORKER', 0, 'การเชื่อมต่ออุปกรณ์เดิมขาดหาย AWH กำลังส่งงานต่ออย่างปลอดภัย', null, $at);
                }
            }
            $stage = 'select';
            $worker = $this->pdo->prepare('SELECT state, busy_task_id, last_seen_at FROM control_workers WHERE device_id = :device');
            $worker->execute(['device' => $auth['deviceId']]);
            $workerRow = $worker->fetch();
            if (!is_array($workerRow)) throw new HubControlPlaneException('Worker heartbeat is required before claiming work', 'WORKER_NOT_READY');
            if ($workerRow['busy_task_id'] !== null) {
                $active = $this->pdo->prepare("SELECT * FROM control_tasks WHERE task_id = :task AND assigned_device_id = :device AND user_id = :user AND state IN ('PREPARING', 'RUNNING', 'QA')");
                $active->execute(['task' => $workerRow['busy_task_id'], 'device' => $auth['deviceId'], 'user' => $auth['userId']]); $activeTask = $active->fetch();
                if (is_array($activeTask)) {
                    $this->pdo->prepare('UPDATE control_tasks SET lease_expires_at = :expires WHERE task_id = :task AND assigned_device_id = :device')->execute(['expires' => $expires, 'task' => $activeTask['task_id'], 'device' => $auth['deviceId']]);
                    $this->pdo->prepare("UPDATE control_workers SET state = 'WORKING', last_seen_at = :at WHERE device_id = :device")->execute(['at' => $at, 'device' => $auth['deviceId']]);
                    $this->pdo->exec('COMMIT'); $transactionOpen = false;
                    return ['schemaVersion' => 1, 'task' => $this->taskById((string) $activeTask['task_id'], (string) $auth['userId'])];
                }
                $this->pdo->prepare("UPDATE control_workers SET state = 'READY', busy_task_id = NULL, last_seen_at = :at WHERE device_id = :device")->execute(['at' => $at, 'device' => $auth['deviceId']]);
            }
            $q = $this->pdo->prepare("SELECT t.* FROM control_tasks t JOIN device_project_memberships m ON m.project_id = t.project_id AND m.device_id = :device AND m.revoked_at IS NULL WHERE t.state = 'WAITING_FOR_WORKER' AND t.assigned_device_id IS NULL ORDER BY t.created_at, t.task_id LIMIT 1"); $q->execute(['device' => $auth['deviceId']]); $row = $q->fetch();
            if (!is_array($row)) { $this->pdo->exec('COMMIT'); $transactionOpen = false; return ['schemaVersion' => 1, 'task' => null]; }
            $stage = 'update-task';
            $update = $this->pdo->prepare("UPDATE control_tasks SET state = 'PREPARING', assigned_device_id = :device, lease_expires_at = :expires, updated_at = :at WHERE task_id = :task AND state = 'WAITING_FOR_WORKER' AND assigned_device_id IS NULL"); $update->execute(['device' => $auth['deviceId'], 'expires' => $expires, 'at' => $at, 'task' => $row['task_id']]);
            if ($update->rowCount() !== 1) throw new HubControlPlaneException('Task claim raced with another worker', 'TASK_CLAIM_RACE');
            $stage = 'update-worker';
            $this->pdo->prepare('UPDATE control_workers SET state = \'WORKING\', busy_task_id = :task, last_seen_at = :at WHERE device_id = :device')->execute(['task' => $row['task_id'], 'at' => $at, 'device' => $auth['deviceId']]);
            $stage = 'event';
            $eventId = $this->event((string) $row['task_id'], 'PREPARING', 0, 'claimed', $at);
            $this->syncConversationEvent((string) $row['task_id'], $eventId, 'PREPARING', 0, 'กำลังเริ่มงานบนอุปกรณ์ที่พร้อม', null, $at);
            $stage = 'commit';
            $this->pdo->exec('COMMIT');
            $transactionOpen = false;
            $stage = 'read-back';
            return ['schemaVersion' => 1, 'task' => $this->taskById((string) $row['task_id'], (string) $auth['userId'])];
        } catch (HubControlPlaneException $error) { if ($transactionOpen) { try { $this->pdo->exec('ROLLBACK'); } catch (Throwable) {} } throw $error; } catch (Throwable) { if ($transactionOpen) { try { $this->pdo->exec('ROLLBACK'); } catch (Throwable) {} } throw new HubControlPlaneException('Task claim failed closed', 'TASK_CLAIM_FAILED'); }
    }

    public function updateTask(string $token, string $taskId, array $payload, ?string $now = null): array
    {
        self::exactKeys($payload, ['deviceId', 'message', 'progress', 'resultSummary', 'schemaVersion', 'state']); if (($payload['schemaVersion'] ?? null) !== 1) throw new HubControlPlaneException('Unsupported worker schema', 'SCHEMA_VERSION');
        $deviceId = self::uuid((string) ($payload['deviceId'] ?? '')); $auth = $this->enrollment->authenticateForControlPlane($token, $deviceId, $now); $taskId = self::uuid($taskId); $state = (string) ($payload['state'] ?? ''); if (!in_array($state, ['PREPARING', 'RUNNING', 'QA', 'WAITING_FOR_APPROVAL', 'COMPLETED', 'FAILED'], true)) throw new HubControlPlaneException('Task state is invalid', 'FIELD_INVALID');
        $progress = $payload['progress']; if (!is_int($progress) || $progress < 0 || $progress > 100) throw new HubControlPlaneException('Task progress is invalid', 'FIELD_INVALID');
        $message = self::optionalText($payload['message'] ?? null, 240); $result = self::optionalText($payload['resultSummary'] ?? null, 500); $at = self::timestamp($now ?? gmdate('c'));
        $needsApproval = $state === 'WAITING_FOR_APPROVAL'; $terminal = in_array($state, ['COMPLETED', 'FAILED'], true);
        $transactionOpen = false;
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            $transactionOpen = true;
            $q = $this->pdo->prepare('SELECT * FROM control_tasks WHERE task_id = :task AND assigned_device_id = :device AND user_id = :user'); $q->execute(['task' => $taskId, 'device' => $auth['deviceId'], 'user' => $auth['userId']]); $row = $q->fetch(); if (!is_array($row)) throw new HubControlPlaneException('Task is not assigned to this worker', 'TASK_FORBIDDEN');
            $update = $this->pdo->prepare('UPDATE control_tasks SET state = :state, progress = :progress, result_summary = COALESCE(:result, result_summary), assigned_device_id = CASE WHEN :waiting = 1 THEN NULL ELSE assigned_device_id END, lease_expires_at = CASE WHEN :terminal = 1 OR :waiting = 1 THEN NULL ELSE lease_expires_at END, updated_at = :at WHERE task_id = :task AND assigned_device_id = :device');
            $update->execute(['state' => $state, 'progress' => $progress, 'result' => $result, 'at' => $at, 'terminal' => $terminal ? 1 : 0, 'waiting' => $needsApproval ? 1 : 0, 'task' => $taskId, 'device' => $auth['deviceId']]);
            if ($update->rowCount() !== 1) throw new HubControlPlaneException('Task update raced with another worker', 'TASK_UPDATE_RACE');
            $eventId = $this->event($taskId, $state, $progress, $message, $at);
            $this->syncConversationEvent($taskId, $eventId, $state, $progress, $message, $result, $at);
            if ($terminal || $needsApproval) $this->pdo->prepare('UPDATE control_workers SET state = \'READY\', busy_task_id = NULL, last_seen_at = :at WHERE device_id = :device')->execute(['at' => $at, 'device' => $auth['deviceId']]);
            if ($needsApproval) { $check = $this->pdo->prepare("SELECT 1 FROM control_approvals WHERE task_id = :task AND status = 'PENDING'"); $check->execute(['task' => $taskId]); if ($check->fetchColumn() === false) $this->pdo->prepare('INSERT INTO control_approvals(approval_id, task_id, action, scope_json, status, expires_at, decided_at) VALUES(:id, :task, :action, :scope, \'PENDING\', :expires, NULL)')->execute(['id' => self::uuidFromBytes(random_bytes(16)), 'task' => $taskId, 'action' => 'task.execute', 'scope' => json_encode(['taskId' => $taskId, 'projectId' => (string) $row['project_id'], 'goalDigest' => hash('sha256', (string) $row['goal'])], JSON_THROW_ON_ERROR), 'expires' => gmdate('c', strtotime($at) + 3600)]); }
            $this->pdo->exec('COMMIT');
            $transactionOpen = false;
        } catch (Throwable $error) {
            if ($transactionOpen) { try { $this->pdo->exec('ROLLBACK'); } catch (Throwable) {} }
            if ($error instanceof HubControlPlaneException) throw $error;
            throw new HubControlPlaneException('Task update failed closed', 'TASK_UPDATE_FAILED');
        }
        return $this->taskById($taskId, (string) $auth['userId']);
    }

    private function taskById(string $taskId, string $userId): array { $taskId = self::uuid($taskId); $q = $this->pdo->prepare('SELECT * FROM control_tasks WHERE task_id = :task AND user_id = :user'); $q->execute(['task' => $taskId, 'user' => $userId]); $row = $q->fetch(); if (!is_array($row)) throw new HubControlPlaneException('Task was not found', 'TASK_NOT_FOUND'); return $this->taskRow($row); }
    private function taskRow(array $row): array
    {
        $q = $this->pdo->prepare('SELECT artifact_id FROM control_artifacts WHERE task_id = :task ORDER BY created_at, artifact_id LIMIT 20'); $q->execute(['task' => $row['task_id']]);
        $approval = $this->pdo->prepare('SELECT status FROM control_approvals WHERE task_id = :task ORDER BY expires_at DESC, approval_id DESC LIMIT 1'); $approval->execute(['task' => $row['task_id']]); $approvalStatus = $approval->fetchColumn();
        $project = $this->pdo->prepare('SELECT name, type FROM projects WHERE project_id = :project'); $project->execute(['project' => $row['project_id']]); $projectRow = $project->fetch();
        $event = $this->pdo->prepare('SELECT state, progress, message FROM control_task_events WHERE task_id = :task ORDER BY occurred_at DESC, event_id DESC LIMIT 1'); $event->execute(['task' => $row['task_id']]); $eventRow = $event->fetch();
        return ['schemaVersion' => 1, 'taskId' => (string) $row['task_id'], 'projectId' => (string) $row['project_id'], 'conversationId' => isset($row['conversation_id']) && $row['conversation_id'] !== null ? (string) $row['conversation_id'] : null, 'projectName' => is_array($projectRow) ? (string) $projectRow['name'] : null, 'projectType' => is_array($projectRow) ? (string) $projectRow['type'] : null, 'goal' => (string) $row['goal'], 'state' => (string) $row['state'], 'progress' => (int) $row['progress'], 'assignedDevice' => $row['assigned_device_id'] === null ? null : (string) $row['assigned_device_id'], 'approvalStatus' => $approvalStatus === false ? null : (string) $approvalStatus, 'createdAt' => (string) $row['created_at'], 'updatedAt' => (string) $row['updated_at'], 'resultSummary' => $row['result_summary'] === null ? null : (string) $row['result_summary'], 'failureCode' => $row['failure_code'] === null ? null : (string) $row['failure_code'], 'lastEvent' => is_array($eventRow) ? ['state' => (string) $eventRow['state'], 'progress' => (int) $eventRow['progress'], 'message' => $eventRow['message'] === null ? null : (string) $eventRow['message']] : null, 'artifactRefs' => array_map(static fn (array $item): string => (string) $item['artifact_id'], $q->fetchAll())];
    }
    private static function artifactRow(array $row): array { return ['schemaVersion' => 1, 'artifactId' => (string) $row['artifact_id'], 'taskId' => (string) $row['task_id'], 'projectId' => (string) $row['project_id'], 'kind' => (string) $row['kind'], 'name' => (string) $row['name'], 'sha256' => $row['sha256'] === null ? null : (string) $row['sha256'], 'sizeBytes' => (int) $row['size_bytes'], 'relativeRef' => $row['relative_ref'] === null ? null : (string) $row['relative_ref'], 'createdAt' => (string) $row['created_at']]; }
    private static function approvalRow(array $row, ?string $status = null): array
    {
        $scope = ['taskId' => (string) $row['task_id'], 'projectId' => (string) $row['project_id']];
        if (isset($row['scope_json']) && is_string($row['scope_json'])) {
            try {
                $parsed = json_decode($row['scope_json'], true, 8, JSON_THROW_ON_ERROR);
                if (is_array($parsed) && isset($parsed['goalDigest']) && is_string($parsed['goalDigest']) && preg_match('/^[0-9a-f]{64}$/i', $parsed['goalDigest'])) $scope['goalDigest'] = strtolower($parsed['goalDigest']);
            } catch (Throwable) {
                // Scope is metadata only; a malformed persisted scope never becomes a reason to expose raw data.
            }
        }
        return ['schemaVersion' => 1, 'approvalId' => (string) $row['approval_id'], 'taskId' => (string) $row['task_id'], 'projectId' => (string) $row['project_id'], 'action' => (string) $row['action'], 'scope' => $scope, 'status' => $status ?? (string) $row['status'], 'expiresAt' => (string) $row['expires_at'], 'decidedAt' => $row['decided_at'] === null ? null : (string) $row['decided_at']];
    }
    private function event(string $taskId, string $state, int $progress, ?string $message, string $at): string { $id = self::uuidFromBytes(random_bytes(16)); $this->pdo->prepare('INSERT INTO control_task_events(event_id, task_id, state, progress, message, occurred_at) VALUES(:id, :task, :state, :progress, :message, :at)')->execute(['id' => $id, 'task' => $taskId, 'state' => $state, 'progress' => $progress, 'message' => $message, 'at' => $at]); return $id; }

    private function assertAssistantReady(): void { HubAssistantWorkstreamMigration::assertCapabilityReady($this->pdo, dirname(__DIR__) . '/migrations/005_assistant_workstream.sql'); }
    private function assertDeviceProjectMember(string $deviceId, string $projectId): void { $q = $this->pdo->prepare('SELECT 1 FROM device_project_memberships WHERE device_id = :device AND project_id = :project AND revoked_at IS NULL'); $q->execute(['device' => $deviceId, 'project' => $projectId]); if ($q->fetchColumn() === false) throw new HubControlPlaneException('Project is not available to this device', 'PROJECT_FORBIDDEN'); }

    private function getOrCreateConversation(string $userId, string $projectId, string $at): array
    {
        $q = $this->pdo->prepare('SELECT * FROM control_conversations WHERE user_id = :user AND project_id = :project'); $q->execute(['user' => $userId, 'project' => $projectId]); $row = $q->fetch();
        if (is_array($row)) return $row;
        $id = self::uuidFromBytes(random_bytes(16));
        $this->pdo->prepare('INSERT INTO control_conversations(conversation_id, user_id, project_id, created_at, updated_at, last_task_id) VALUES(:id, :user, :project, :at, :at, NULL)')->execute(['id' => $id, 'user' => $userId, 'project' => $projectId, 'at' => $at]);
        return ['conversation_id' => $id, 'user_id' => $userId, 'project_id' => $projectId, 'created_at' => $at, 'updated_at' => $at, 'last_task_id' => null];
    }

    private function appendConversationMessage(string $conversationId, ?string $taskId, string $kind, string $body, string $at, ?string $idempotency = null, ?string $sourceEventId = null): void
    {
        if (!in_array($kind, self::CONVERSATION_KINDS, true) || $body === '' || strlen($body) > 800 || preg_match('/[\x00-\x1f\x7f]/', $body)) throw new HubControlPlaneException('Conversation message is invalid', 'FIELD_INVALID');
        $sequence = $this->pdo->prepare('SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM control_conversation_messages WHERE conversation_id = :conversation'); $sequence->execute(['conversation' => $conversationId]);
        $this->pdo->prepare('INSERT INTO control_conversation_messages(message_id, conversation_id, task_id, message_kind, sequence_no, body, idempotency_key, source_event_id, metadata_json, created_at) VALUES(:id, :conversation, :task, :kind, :sequence, :body, :key, :event, NULL, :at)')->execute(['id' => self::uuidFromBytes(random_bytes(16)), 'conversation' => $conversationId, 'task' => $taskId, 'kind' => $kind, 'sequence' => (int) $sequence->fetchColumn(), 'body' => $body, 'key' => $idempotency, 'event' => $sourceEventId, 'at' => $at]);
        $this->pdo->prepare('UPDATE control_conversations SET updated_at = :at WHERE conversation_id = :conversation')->execute(['at' => $at, 'conversation' => $conversationId]);
    }

    private function resolveConversationGoal(string $conversationId, string $message): string
    {
        if (!self::isConversationFollowUp($message)) return $message;
        // `last_task_id` is maintained in the same transaction that creates a
        // Work request. Timestamp/UUID ordering is not a conversation order.
        $q = $this->pdo->prepare('SELECT t.goal FROM control_conversations c JOIN control_tasks t ON t.task_id = c.last_task_id WHERE c.conversation_id = :conversation');
        $q->execute(['conversation' => $conversationId]); $previous = $q->fetchColumn();
        if (!is_string($previous) || $previous === '' || strlen($previous) + strlen($message) + 80 > 2000) return $message;
        return self::goal('ต่อเนื่องจากงานล่าสุด: ' . $previous . ' | คำขอเพิ่มเติม: ' . $message);
    }

    private function syncConversationEvent(string $taskId, string $eventId, string $state, int $progress, ?string $message, ?string $result, string $at): void
    {
        if (!$this->assistantSchemaPresent()) return;
        $q = $this->pdo->prepare('SELECT conversation_id FROM control_tasks WHERE task_id = :task'); $q->execute(['task' => $taskId]); $conversationId = $q->fetchColumn();
        if (!is_string($conversationId) || !preg_match(self::UUID, $conversationId)) return;
        $existing = $this->pdo->prepare('SELECT 1 FROM control_conversation_messages WHERE source_event_id = :event'); $existing->execute(['event' => $eventId]); if ($existing->fetchColumn() !== false) return;
        $kind = 'PROGRESS';
        if ($state === 'WAITING_FOR_APPROVAL') { $kind = 'APPROVAL'; $body = 'ก่อนดำเนินการต่อ AWH ต้องการการอนุมัติสำหรับขอบเขตงานนี้'; }
        elseif ($state === 'COMPLETED') { $kind = 'RESULT'; $body = $result ?: 'งานเสร็จแล้วและมีผลลัพธ์พร้อมตรวจ'; }
        elseif ($state === 'FAILED') { $kind = 'FAILURE'; $body = $result ?: 'งานยังไม่สำเร็จ AWH หยุดไว้โดยปลอดภัยและเก็บสถานะไว้แล้ว'; }
        elseif ($state === 'CANCELLED') { $kind = 'ASSISTANT'; $body = $result ?: 'ยกเลิกงานนี้แล้ว ยังไม่มีการเริ่มงานใหม่'; }
        else { $body = self::workStateMessage($state, $progress, $message); }
        $this->appendConversationMessage($conversationId, $taskId, $kind, self::optionalText($body, 800) ?? 'กำลังอัปเดตงาน', $at, null, $eventId);
    }

    private function conversationArtifacts(array $taskIds): array
    {
        if ($taskIds === []) return [];
        $marks = implode(',', array_fill(0, count($taskIds), '?'));
        $q = $this->pdo->prepare("SELECT artifact_id, task_id, project_id, kind, name, sha256, size_bytes, relative_ref, created_at FROM control_artifacts WHERE task_id IN ($marks) ORDER BY created_at, artifact_id LIMIT 100"); $q->execute($taskIds);
        return array_map([self::class, 'artifactRow'], $q->fetchAll());
    }

    private function conversationApprovals(array $taskIds): array
    {
        if ($taskIds === []) return [];
        $marks = implode(',', array_fill(0, count($taskIds), '?'));
        $q = $this->pdo->prepare("SELECT a.approval_id, a.task_id, t.project_id, a.action, a.scope_json, a.status, a.expires_at, a.decided_at FROM control_approvals a JOIN control_tasks t ON t.task_id = a.task_id WHERE a.task_id IN ($marks) ORDER BY a.expires_at DESC, a.approval_id DESC LIMIT 50"); $q->execute($taskIds);
        return array_map([self::class, 'approvalRow'], $q->fetchAll());
    }

    private function conversationAnswer(string $projectId, string $message): string
    {
        if (preg_match('/^(?:สวัสดี|ช่วยอะไรได้บ้าง|ทำอะไรได้บ้าง|help|what can you do)(?:\s|$|[.!?])/iu', trim($message)) === 1) {
            return 'ผมช่วยตรวจสถานะ สรุป วางแผน ตรวจ source แบบอ่านอย่างเดียว หรือส่งงานที่มีขอบเขตชัดเจนให้กับอุปกรณ์ที่พร้อมได้ คุณพิมพ์สิ่งที่อยากทำต่อได้เลย';
        }
        return $this->contextAnswer($projectId);
    }

    private function contextAnswer(string $projectId): string
    {
        $project = $this->pdo->prepare('SELECT name, source_revision, observed_at FROM projects WHERE project_id = :project'); $project->execute(['project' => $projectId]); $row = $project->fetch();
        $task = $this->pdo->prepare('SELECT state, result_summary, updated_at FROM control_tasks WHERE project_id = :project ORDER BY updated_at DESC, task_id DESC LIMIT 1'); $task->execute(['project' => $projectId]); $latest = $task->fetch();
        $name = is_array($row) ? (string) $row['name'] : 'โปรเจกต์นี้';
        if (!is_array($latest)) return "ตอนนี้ $name ยังไม่มีงานใน Work นี้ คุณบอกสิ่งที่อยากให้ช่วยได้เลย";
        $summary = is_string($latest['result_summary'] ?? null) && $latest['result_summary'] !== '' ? ' ' . (string) $latest['result_summary'] : '';
        return "สถานะล่าสุดของ $name: " . self::workStateMessage((string) $latest['state'], 0, null) . $summary;
    }

    /** Deterministic low-risk intent path: questions are answered from canonical state; project work remains a task. */
    private static function isConversationOnly(string $message): bool { return preg_match('/^(?:สวัสดี|ช่วยอะไรได้บ้าง|ทำอะไรได้บ้าง|สรุป|สถานะ|ยังมีอะไร|มีอะไรเหลือ)|(?:^|\s)(?:what remains|status|summary|help|what can you do)(?:\s|$|[.!?])/iu', trim($message)) === 1; }
    private static function isConversationFollowUp(string $message): bool { return preg_match('/^(?:ทำต่อ|ต่อจาก|ต่อเลย|เอาอัน(?:นี้|นั้น|ล่าสุด)|ยังไม่ใช่|ตรวจอีกที|continue|keep going|that one)(?:\s|$|[.!?])/iu', trim($message)) === 1; }
    private static function workStateMessage(string $state, int $progress, ?string $message): string
    {
        $fallback = match ($state) {
            'WAITING_FOR_WORKER' => 'รับงานแล้ว กำลังรออุปกรณ์ที่เหมาะสม', 'PREPARING' => 'กำลังตรวจบริบทและเตรียมงาน', 'RUNNING' => 'กำลังทำงาน', 'QA' => 'กำลังตรวจผลลัพธ์', 'WAITING_FOR_APPROVAL' => 'กำลังรอการอนุมัติ', 'COMPLETED' => 'งานเสร็จแล้ว', 'FAILED' => 'งานหยุดไว้โดยปลอดภัย', 'CANCELLED' => 'ยกเลิกงานแล้ว', default => 'กำลังอัปเดตงาน',
        };
        return $message !== null && trim($message) !== '' ? trim($message) : ($progress > 0 && $progress < 100 ? $fallback . ' (' . $progress . '%)' : $fallback);
    }

    private function assistantSchemaPresent(): bool { try { return (int) $this->pdo->query('PRAGMA user_version')->fetchColumn() >= 6 && $this->pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'control_conversation_messages'")->fetchColumn() === 1; } catch (Throwable) { return false; } }
    private function assertSessionRateLimit(?string $rateKey, string $now): void
    {
        if ($rateKey === null) return;
        if (!preg_match('/^[0-9a-f]{64}$/', $rateKey)) throw new HubControlPlaneException('Control session rate key is invalid', 'RATE_LIMITED');
        $at = strtotime($now);
        $query = $this->pdo->prepare('SELECT window_started_at, attempts, blocked_until FROM control_session_rate_limits WHERE rate_key = :key');
        $query->execute(['key' => $rateKey]);
        $row = $query->fetch();
        if (is_array($row) && $row['blocked_until'] !== null && strtotime((string) $row['blocked_until']) > $at) throw new HubControlPlaneException('Control session attempts are temporarily rate limited', 'RATE_LIMITED');
        if (!is_array($row) || $at - strtotime((string) $row['window_started_at']) >= self::SESSION_RATE_WINDOW) {
            $this->pdo->prepare('INSERT INTO control_session_rate_limits(rate_key, window_started_at, attempts, blocked_until) VALUES(:key, :at, 1, NULL) ON CONFLICT(rate_key) DO UPDATE SET window_started_at=excluded.window_started_at, attempts=1, blocked_until=NULL')->execute(['key' => $rateKey, 'at' => $now]);
            return;
        }
        $attempts = (int) $row['attempts'] + 1;
        $blocked = $attempts > self::SESSION_RATE_LIMIT ? gmdate('c', $at + self::SESSION_RATE_WINDOW) : null;
        $this->pdo->prepare('UPDATE control_session_rate_limits SET attempts = :attempts, blocked_until = :blocked WHERE rate_key = :key')->execute(['attempts' => $attempts, 'blocked' => $blocked, 'key' => $rateKey]);
        if ($blocked !== null) throw new HubControlPlaneException('Control session attempts are temporarily rate limited', 'RATE_LIMITED');
    }
    private function projectsForUser(string $userId): array { $q = $this->pdo->prepare("SELECT p.project_id, p.name, p.type, p.created_at, p.source_revision, p.observed_at, (SELECT COUNT(*) FROM project_memory pm WHERE pm.project_id = p.project_id AND pm.status = 'present') AS memory_present FROM projects p JOIN user_project_memberships m ON m.project_id = p.project_id WHERE m.user_id = :user AND m.revoked_at IS NULL ORDER BY p.name, p.project_id LIMIT 100"); $q->execute(['user' => $userId]); return array_map(static fn (array $row): array => ['projectId' => (string) $row['project_id'], 'name' => (string) $row['name'], 'type' => (string) $row['type'], 'createdAt' => (string) $row['created_at'], 'sourceRevision' => $row['source_revision'] === null ? null : (string) $row['source_revision'], 'observedAt' => (string) $row['observed_at'], 'memoryReady' => (int) $row['memory_present'] === 5], $q->fetchAll()); }
    private function assertProjectMember(string $userId, string $projectId): void { $q = $this->pdo->prepare('SELECT 1 FROM user_project_memberships WHERE user_id = :user AND project_id = :project AND revoked_at IS NULL'); $q->execute(['user' => $userId, 'project' => $projectId]); if ($q->fetchColumn() === false) throw new HubControlPlaneException('Project is not authorized', 'PROJECT_FORBIDDEN'); }
    private function sessionRow(string $token, ?string $now): array { if ($token === '' || strlen($token) > 512 || preg_match('/[\x00-\x1F\x7F]/', $token)) throw new HubControlPlaneException('Control session is invalid', 'SESSION_INVALID'); $q = $this->pdo->prepare('SELECT * FROM control_sessions WHERE session_hash = :hash'); $q->execute(['hash' => hash('sha256', $token)]); $row = $q->fetch(); $at = strtotime(self::timestamp($now ?? gmdate('c'))); if (!is_array($row) || $row['revoked_at'] !== null || strtotime((string) $row['expires_at']) <= $at) throw new HubControlPlaneException('Control session is expired', 'SESSION_EXPIRED'); return $row; }
    private function authorizeSession(string $token, string $csrf, ?string $now): array { $row = $this->sessionRow($token, $now); if ($csrf === '' || strlen($csrf) > 256 || !hash_equals((string) $row['csrf_hash'], hash('sha256', $csrf))) throw new HubControlPlaneException('Control request failed CSRF validation', 'CSRF_REJECTED'); return $row; }
    private static function exactKeys(array $value, array $allowed): void { $actual = array_keys($value); sort($actual); sort($allowed); if ($actual !== $allowed) throw new HubControlPlaneException('Payload contains unsupported fields', 'SCHEMA_FIELDS'); }
    private static function uuid(string $value): string { if (!preg_match(self::UUID, $value)) throw new HubControlPlaneException('Identifier is invalid', 'ID_INVALID'); return strtolower($value); }
    private static function uuidFromBytes(string $bytes): string { $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
    private static function goal(string $value): string { $value = trim($value); if ($value === '' || strlen($value) > 2000 || preg_match('/[\x00-\x1F\x7F]/', $value) || preg_match('/(?:^|\s)(?:Bearer\s+|password\s*[=:]|secret\s*[=:]|token\s*[=:]|api[_-]?key\s*[=:])/i', $value)) throw new HubControlPlaneException('Goal is invalid or contains credential material', 'GOAL_INVALID'); return $value; }
    private static function idempotency(string $value): string { if (!preg_match('/^[A-Za-z0-9._-]{8,120}$/', $value)) throw new HubControlPlaneException('Idempotency key is invalid', 'IDEMPOTENCY_INVALID'); return $value; }
    private static function optionalText(mixed $value, int $max): ?string { if ($value === null) return null; if (!is_string($value) || strlen($value) > $max || preg_match('/[\x00-\x1F\x7F]/', $value)) throw new HubControlPlaneException('Text field is invalid', 'FIELD_INVALID'); return trim($value); }
    private static function portableText(string $value, string $field, int $max): string { $value = trim($value); if ($value === '' || strlen($value) > $max || preg_match('/[\x00-\x1F\x7F]/', $value) || str_contains($value, '/') || str_contains($value, '\\') || preg_match('#^(?:[A-Za-z]:|~|https?://)#i', $value)) throw new HubControlPlaneException($field . ' is invalid', 'FIELD_INVALID'); return $value; }
    private static function timestamp(string $value): string { if (strtotime($value) === false) throw new HubControlPlaneException('Timestamp is invalid', 'DATE_INVALID'); return $value; }
    private static function base64url(string $bytes): string { return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '='); }
}
