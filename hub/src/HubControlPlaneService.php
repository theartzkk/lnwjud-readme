<?php

declare(strict_types=1);

require_once __DIR__ . '/HubAssistantWorkstreamMigration.php';
require_once __DIR__ . '/HubWorkspaceContinuityMigration.php';
require_once __DIR__ . '/HubUnifiedWorkspaceMigration.php';

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
    private const WORKSPACE_LEASE_TTL = 300;
    private const STATES = ['QUEUED', 'WAITING_FOR_WORKER', 'PREPARING', 'RUNNING', 'QA', 'WAITING_FOR_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED'];
    private const CONVERSATION_KINDS = ['USER', 'ASSISTANT', 'PROGRESS', 'APPROVAL', 'RESULT', 'FAILURE'];
    private const WORKSPACE_SYNC_STATES = ['CLEAN', 'SYNCED', 'UNSYNCED'];

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

    /** Legacy project route: returns the most recently active Work thread. */
    public function conversation(string $sessionToken, string $projectId, ?string $now = null): array
    {
        $session = $this->sessionRow($sessionToken, $now);
        return $this->conversationForUser((string) $session['user_id'], self::uuid($projectId));
    }

    /** M8 thread index. It is a projection over M6 tasks/messages, not a new task authority. */
    public function conversations(string $sessionToken, ?string $projectId = null, ?string $query = null, ?string $now = null): array
    {
        $session = $this->sessionRow($sessionToken, $now); $this->assertUnifiedReady();
        $userId = (string) $session['user_id']; $params = ['user' => $userId];
        $sql = 'SELECT c.conversation_id, c.project_id, c.title, c.archived_at, c.origin, c.created_at, c.updated_at, c.last_task_id, p.name AS project_name FROM control_conversations c JOIN projects p ON p.project_id = c.project_id WHERE c.user_id = :user';
        if ($projectId !== null && $projectId !== '') { $projectId = self::uuid($projectId); $this->assertProjectMember($userId, $projectId); $sql .= ' AND c.project_id = :project'; $params['project'] = $projectId; }
        if ($query !== null && trim($query) !== '') { $needle = self::searchText($query); $sql .= ' AND (c.title LIKE :needle ESCAPE \'\\\' OR EXISTS (SELECT 1 FROM control_conversation_messages m WHERE m.conversation_id = c.conversation_id AND m.body LIKE :needle ESCAPE \'\\\'))'; $params['needle'] = '%' . self::escapeLike($needle) . '%'; }
        $sql .= ' ORDER BY c.archived_at IS NOT NULL, c.updated_at DESC, c.conversation_id DESC LIMIT 100';
        $q = $this->pdo->prepare($sql); $q->execute($params);
        return ['schemaVersion' => 2, 'conversations' => array_map(fn (array $row): array => $this->conversationSummaryRow($row), $q->fetchAll())];
    }

    public function conversationById(string $sessionToken, string $conversationId, ?string $now = null): array
    {
        $session = $this->sessionRow($sessionToken, $now); $this->assertUnifiedReady();
        return $this->conversationByIdForUser((string) $session['user_id'], self::uuid($conversationId));
    }

    public function createConversation(string $sessionToken, string $csrfToken, array $payload, ?string $now = null): array
    {
        $session = $this->authorizeSession($sessionToken, $csrfToken, $now); self::exactKeys($payload, ['projectId', 'schemaVersion', 'title']);
        if (($payload['schemaVersion'] ?? null) !== 2) throw new HubControlPlaneException('Unsupported conversation schema', 'SCHEMA_VERSION');
        $this->assertUnifiedReady(); $projectId = self::uuid((string) ($payload['projectId'] ?? '')); $this->assertProjectMember((string) $session['user_id'], $projectId);
        $at = self::timestamp($now ?? gmdate('c')); $title = self::conversationTitle((string) ($payload['title'] ?? ''));
        $id = self::uuidFromBytes(random_bytes(16));
        $this->pdo->prepare("INSERT INTO control_conversations(conversation_id, user_id, project_id, created_at, updated_at, last_task_id, title, archived_at, origin) VALUES(:id, :user, :project, :at, :at, NULL, :title, NULL, 'native')")->execute(['id' => $id, 'user' => $session['user_id'], 'project' => $projectId, 'at' => $at, 'title' => $title]);
        return $this->conversationByIdForUser((string) $session['user_id'], $id);
    }

    public function updateConversation(string $sessionToken, string $csrfToken, string $conversationId, array $payload, ?string $now = null): array
    {
        $session = $this->authorizeSession($sessionToken, $csrfToken, $now); self::exactKeys($payload, ['archived', 'schemaVersion', 'title']);
        if (($payload['schemaVersion'] ?? null) !== 2 || !is_bool($payload['archived'] ?? null)) throw new HubControlPlaneException('Conversation request is invalid', 'SCHEMA_VERSION');
        $this->assertUnifiedReady(); $conversationId = self::uuid($conversationId); $userId = (string) $session['user_id']; $current = $this->conversationRowForUser($userId, $conversationId);
        $title = self::conversationTitle((string) ($payload['title'] ?? $current['title'] ?? 'Work')); $at = self::timestamp($now ?? gmdate('c'));
        $this->pdo->prepare('UPDATE control_conversations SET title = :title, archived_at = :archived, updated_at = :at WHERE conversation_id = :id AND user_id = :user')->execute(['title' => $title, 'archived' => $payload['archived'] ? $at : null, 'at' => $at, 'id' => $conversationId, 'user' => $userId]);
        return $this->conversationByIdForUser($userId, $conversationId);
    }

    /** Structured current-view metadata is bounded and excludes workspace paths/source content. */
    public function setCurrentContext(string $sessionToken, string $csrfToken, array $payload, ?string $now = null): array
    {
        $session = $this->authorizeSession($sessionToken, $csrfToken, $now); self::exactKeys($payload, ['conversationId', 'projectId', 'schemaVersion', 'selectedRef', 'sourceRevision', 'viewKind']);
        if (($payload['schemaVersion'] ?? null) !== 2) throw new HubControlPlaneException('Unsupported context schema', 'SCHEMA_VERSION');
        $this->assertUnifiedReady(); $userId = (string) $session['user_id']; $projectId = self::uuid((string) ($payload['projectId'] ?? '')); $this->assertProjectMember($userId, $projectId);
        $conversationId = $payload['conversationId'] === null ? null : self::uuid((string) $payload['conversationId']); if ($conversationId !== null) { $conversation = $this->conversationRowForUser($userId, $conversationId); if ((string) $conversation['project_id'] !== $projectId) throw new HubControlPlaneException('Conversation does not belong to this project', 'PROJECT_FORBIDDEN'); }
        $viewKind = self::contextKind((string) ($payload['viewKind'] ?? 'work')); $selected = self::optionalText($payload['selectedRef'] ?? null, 160); $revision = self::optionalGitSha($payload['sourceRevision'] ?? null); $at = self::timestamp($now ?? gmdate('c'));
        $this->pdo->prepare("INSERT INTO control_project_contexts(context_id, user_id, project_id, conversation_id, device_id, scope_key, view_kind, selected_ref, preview_ref, source_revision, observed_at, expires_at) VALUES(:id, :user, :project, :conversation, NULL, 'owner', :kind, :selected, NULL, :revision, :at, NULL) ON CONFLICT(user_id, project_id, scope_key, view_kind) DO UPDATE SET conversation_id=excluded.conversation_id, selected_ref=excluded.selected_ref, source_revision=excluded.source_revision, observed_at=excluded.observed_at")->execute(['id' => self::uuidFromBytes(random_bytes(16)), 'user' => $userId, 'project' => $projectId, 'conversation' => $conversationId, 'kind' => $viewKind, 'selected' => $selected, 'revision' => $revision, 'at' => $at]);
        return $this->currentContextForUser($userId, $projectId);
    }

    public function currentContext(string $sessionToken, string $projectId, ?string $now = null): array
    {
        $session = $this->sessionRow($sessionToken, $now); $this->assertUnifiedReady(); return $this->currentContextForUser((string) $session['user_id'], self::uuid($projectId));
    }

    /** Validated structured product configuration; values are never arbitrary CSS/HTML. */
    public function productSettings(string $sessionToken, ?string $now = null): array
    {
        $session = $this->sessionRow($sessionToken, $now); $this->assertUnifiedReady(); return ['schemaVersion' => 2, 'settings' => $this->productSettingsForUser((string) $session['user_id'])];
    }

    public function updateProductSetting(string $sessionToken, string $csrfToken, array $payload, ?string $now = null): array
    {
        $session = $this->authorizeSession($sessionToken, $csrfToken, $now); self::exactKeys($payload, ['schemaVersion', 'settingKey', 'value']); if (($payload['schemaVersion'] ?? null) !== 2) throw new HubControlPlaneException('Unsupported settings schema', 'SCHEMA_VERSION');
        $this->assertUnifiedReady(); $key = self::settingKey((string) ($payload['settingKey'] ?? '')); return $this->saveProductSetting((string) $session['user_id'], $key, self::settingValue($key, $payload['value'] ?? null), $now);
    }

    /** The bounded revision history makes owner configuration reversible without arbitrary code edits. */
    public function productSettingHistory(string $sessionToken, string $key, ?string $now = null): array
    {
        $session = $this->sessionRow($sessionToken, $now); $this->assertUnifiedReady(); $key = self::settingKey($key); $userId = (string) $session['user_id']; $this->productSettingsForUser($userId);
        $q = $this->pdo->prepare('SELECT revision_no, value_json, created_at FROM control_product_setting_revisions WHERE setting_key = :key ORDER BY revision_no DESC LIMIT 20'); $q->execute(['key' => $key]); $revisions = [];
        foreach ($q->fetchAll() as $row) { try { $revisions[] = ['revision' => (int) $row['revision_no'], 'value' => self::settingValue($key, json_decode((string) $row['value_json'], true, 16, JSON_THROW_ON_ERROR)), 'createdAt' => (string) $row['created_at']]; } catch (Throwable) { throw new HubControlPlaneException('Product configuration history is invalid', 'PRODUCT_SETTING_INVALID'); } }
        return ['schemaVersion' => 2, 'settingKey' => $key, 'revisions' => $revisions];
    }

    /** Reset records the product default as a new revision; it never deletes audit history. */
    public function resetProductSetting(string $sessionToken, string $csrfToken, array $payload, ?string $now = null): array
    {
        $session = $this->authorizeSession($sessionToken, $csrfToken, $now); self::exactKeys($payload, ['schemaVersion', 'settingKey']); if (($payload['schemaVersion'] ?? null) !== 2) throw new HubControlPlaneException('Unsupported settings schema', 'SCHEMA_VERSION');
        $this->assertUnifiedReady(); $key = self::settingKey((string) ($payload['settingKey'] ?? '')); return $this->saveProductSetting((string) $session['user_id'], $key, self::productDefaults()[$key]['value'], $now);
    }

    private function saveProductSetting(string $userId, string $key, mixed $value, ?string $now): array
    {
        $encoded = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); $at = self::timestamp($now ?? gmdate('c'));
        try {
            $this->pdo->exec('BEGIN IMMEDIATE'); $q = $this->pdo->prepare('SELECT revision_no FROM control_product_settings WHERE setting_key = :key'); $q->execute(['key' => $key]); $revision = ((int) $q->fetchColumn()) + 1;
            $this->pdo->prepare('INSERT INTO control_product_settings(setting_key, value_json, revision_no, updated_by_user_id, updated_at) VALUES(:key, :value, :revision, :user, :at) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json, revision_no=excluded.revision_no, updated_by_user_id=excluded.updated_by_user_id, updated_at=excluded.updated_at')->execute(['key' => $key, 'value' => $encoded, 'revision' => $revision, 'user' => $userId, 'at' => $at]);
            $this->pdo->prepare('INSERT INTO control_product_setting_revisions(revision_id, setting_key, revision_no, value_json, updated_by_user_id, created_at) VALUES(:id, :key, :revision, :value, :user, :at)')->execute(['id' => self::uuidFromBytes(random_bytes(16)), 'key' => $key, 'revision' => $revision, 'value' => $encoded, 'user' => $userId, 'at' => $at]);
            $this->pdo->exec('COMMIT');
        } catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); throw $error instanceof HubControlPlaneException ? $error : new HubControlPlaneException('Product setting could not be saved', 'PRODUCT_SETTING_FAILED'); }
        return ['schemaVersion' => 2, 'settings' => $this->productSettingsForUser($userId)];
    }

    /** Safe logical export. It excludes credentials, cookies, paths, WIP refs and source contents. */
    public function exportWorkspace(string $sessionToken, ?string $now = null): array
    {
        $session = $this->sessionRow($sessionToken, $now); $this->assertUnifiedReady(); $userId = (string) $session['user_id'];
        $projects = $this->projectsForUser($userId); $threads = $this->conversations($sessionToken, null, null, $now)['conversations'];
        return ['schemaVersion' => 2, 'exportedAt' => self::timestamp($now ?? gmdate('c')), 'product' => $this->productSettingsForUser($userId), 'projects' => $projects, 'conversations' => $threads, 'security' => ['secretsIncluded' => false, 'localPathsIncluded' => false, 'sourceFilesIncluded' => false]];
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
        $conversationQuery = $this->pdo->prepare($this->unifiedSchemaPresent() ? 'SELECT * FROM control_conversations WHERE user_id = :user AND project_id = :project AND archived_at IS NULL ORDER BY updated_at DESC, conversation_id DESC LIMIT 1' : 'SELECT * FROM control_conversations WHERE user_id = :user AND project_id = :project LIMIT 1');
        $conversationQuery->execute(['user' => $userId, 'project' => $projectId]);
        $conversation = $conversationQuery->fetch();
        if (!is_array($conversation)) return ['schemaVersion' => 1, 'conversation' => null, 'messages' => [], 'tasks' => [], 'artifacts' => [], 'approvals' => []];

        return $this->conversationPayload($conversation, $userId);
    }

    private function conversationByIdForUser(string $userId, string $conversationId): array
    {
        $this->assertUnifiedReady();
        return $this->conversationPayload($this->conversationRowForUser($userId, $conversationId), $userId);
    }

    private function conversationPayload(array $conversation, string $userId): array
    {

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
            'schemaVersion' => isset($conversation['title']) ? 2 : 1,
            'conversation' => ['conversationId' => (string) $conversation['conversation_id'], 'projectId' => (string) $conversation['project_id'], 'title' => isset($conversation['title']) ? (string) $conversation['title'] : 'Work', 'archivedAt' => isset($conversation['archived_at']) && $conversation['archived_at'] !== null ? (string) $conversation['archived_at'] : null, 'origin' => isset($conversation['origin']) ? (string) $conversation['origin'] : 'native', 'createdAt' => (string) $conversation['created_at'], 'updatedAt' => (string) $conversation['updated_at'], 'lastTaskId' => $conversation['last_task_id'] === null ? null : (string) $conversation['last_task_id']],
            'messages' => $messages, 'tasks' => $tasks, 'artifacts' => $artifacts, 'approvals' => $approvals,
        ];
    }

    private function submitConversationForUser(string $userId, array $payload, ?string $now): array
    {
        $schema = $payload['schemaVersion'] ?? null;
        if ($schema === 1) self::exactKeys($payload, ['idempotencyKey', 'message', 'projectId', 'schemaVersion']);
        elseif ($schema === 2) self::exactKeys($payload, ['conversationId', 'idempotencyKey', 'message', 'projectId', 'schemaVersion']);
        else throw new HubControlPlaneException('Unsupported conversation schema', 'SCHEMA_VERSION');
        $this->assertAssistantReady();
        $projectId = self::uuid((string) ($payload['projectId'] ?? ''));
        $message = self::goal((string) ($payload['message'] ?? ''));
        $idempotency = self::idempotency((string) ($payload['idempotencyKey'] ?? ''));
        $this->assertProjectMember($userId, $projectId);
        if ($schema === 2) $this->assertUnifiedReady();
        $at = self::timestamp($now ?? gmdate('c'));
        $transactionOpen = false;
        try {
            $this->pdo->exec('BEGIN IMMEDIATE'); $transactionOpen = true;
            $conversation = $schema === 2 ? $this->conversationRowForUser($userId, self::uuid((string) ($payload['conversationId'] ?? ''))) : $this->getOrCreateConversation($userId, $projectId, $at);
            if ((string) $conversation['project_id'] !== $projectId || (isset($conversation['archived_at']) && $conversation['archived_at'] !== null)) throw new HubControlPlaneException('Conversation is not available for this project', 'PROJECT_FORBIDDEN');
            $existing = $this->pdo->prepare('SELECT message_id FROM control_conversation_messages WHERE conversation_id = :conversation AND idempotency_key = :key');
            $existing->execute(['conversation' => $conversation['conversation_id'], 'key' => $idempotency]);
            if ($existing->fetchColumn() !== false) { $this->pdo->exec('COMMIT'); $transactionOpen = false; return $schema === 2 ? $this->conversationByIdForUser($userId, (string) $conversation['conversation_id']) : $this->conversationForUser($userId, $projectId); }
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
        return $schema === 2 ? $this->conversationByIdForUser($userId, (string) $conversation['conversation_id']) : $this->conversationForUser($userId, $projectId);
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
        $transactionOpen = false;
        try {
            $this->pdo->exec('BEGIN IMMEDIATE'); $transactionOpen = true;
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
        $deviceId = self::uuid((string) ($payload['deviceId'] ?? '')); $auth = $this->enrollment->authenticateForControlPlane($token, $deviceId, $now); $taskId = self::uuid($taskId); $state = (string) ($payload['state'] ?? ''); if (!in_array($state, ['WAITING_FOR_WORKER', 'PREPARING', 'RUNNING', 'QA', 'WAITING_FOR_APPROVAL', 'COMPLETED', 'FAILED'], true)) throw new HubControlPlaneException('Task state is invalid', 'FIELD_INVALID');
        $progress = $payload['progress']; if (!is_int($progress) || $progress < 0 || $progress > 100) throw new HubControlPlaneException('Task progress is invalid', 'FIELD_INVALID');
        $message = self::optionalText($payload['message'] ?? null, 240); $result = self::optionalText($payload['resultSummary'] ?? null, 500); $at = self::timestamp($now ?? gmdate('c'));
        $needsApproval = $state === 'WAITING_FOR_APPROVAL'; $releaseWorker = $needsApproval || $state === 'WAITING_FOR_WORKER'; $terminal = in_array($state, ['COMPLETED', 'FAILED'], true);
        $transactionOpen = false;
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            $transactionOpen = true;
            $q = $this->pdo->prepare('SELECT * FROM control_tasks WHERE task_id = :task AND assigned_device_id = :device AND user_id = :user'); $q->execute(['task' => $taskId, 'device' => $auth['deviceId'], 'user' => $auth['userId']]); $row = $q->fetch(); if (!is_array($row)) throw new HubControlPlaneException('Task is not assigned to this worker', 'TASK_FORBIDDEN');
            $update = $this->pdo->prepare('UPDATE control_tasks SET state = :state, progress = :progress, result_summary = COALESCE(:result, result_summary), assigned_device_id = CASE WHEN :release = 1 THEN NULL ELSE assigned_device_id END, lease_expires_at = CASE WHEN :terminal = 1 OR :release = 1 THEN NULL ELSE lease_expires_at END, updated_at = :at WHERE task_id = :task AND assigned_device_id = :device');
            $update->execute(['state' => $state, 'progress' => $progress, 'result' => $result, 'at' => $at, 'terminal' => $terminal ? 1 : 0, 'release' => $releaseWorker ? 1 : 0, 'task' => $taskId, 'device' => $auth['deviceId']]);
            if ($update->rowCount() !== 1) throw new HubControlPlaneException('Task update raced with another worker', 'TASK_UPDATE_RACE');
            $eventId = $this->event($taskId, $state, $progress, $message, $at);
            $this->syncConversationEvent($taskId, $eventId, $state, $progress, $message, $result, $at);
            if ($terminal || $releaseWorker) $this->pdo->prepare('UPDATE control_workers SET state = \'READY\', busy_task_id = NULL, last_seen_at = :at WHERE device_id = :device')->execute(['at' => $at, 'device' => $auth['deviceId']]);
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

    /** Browser-visible, metadata-only continuity state. Source files remain in Git. */
    public function workspace(string $sessionToken, string $projectId, ?string $now = null): array
    {
        $session = $this->sessionRow($sessionToken, $now); $projectId = self::uuid($projectId);
        $this->assertProjectMember((string) $session['user_id'], $projectId); $this->assertWorkspaceReady();
        return ['schemaVersion' => 1, 'workspace' => $this->workspaceState($projectId, self::timestamp($now ?? gmdate('c')), false)];
    }

    /** Device-authenticated state includes only the identifiers needed for its own bounded handoff. */
    public function workerWorkspace(string $token, string $deviceId, string $projectId, ?string $now = null): array
    {
        $projectId = self::uuid($projectId); $auth = $this->enrollment->authenticateForControlPlane($token, self::uuid($deviceId), $now);
        $this->assertDeviceProjectMember((string) $auth['deviceId'], $projectId); $this->assertWorkspaceReady();
        return ['schemaVersion' => 1, 'workspace' => $this->workspaceState($projectId, self::timestamp($now ?? gmdate('c')), true)];
    }

    /** Device-local binding metadata makes a canonical project portable without exposing a filesystem path. */
    public function registerProjectBinding(string $token, array $payload, ?string $now = null): array
    {
        self::exactKeys($payload, ['capabilities', 'deviceId', 'projectId', 'schemaVersion', 'sourceFingerprint', 'workspaceLabel']);
        if (($payload['schemaVersion'] ?? null) !== 2 || !is_array($payload['capabilities']) || count($payload['capabilities']) > 24) throw new HubControlPlaneException('Project binding is invalid', 'PAYLOAD_INVALID');
        $deviceId = self::uuid((string) ($payload['deviceId'] ?? '')); $projectId = self::uuid((string) ($payload['projectId'] ?? '')); $auth = $this->enrollment->authenticateForControlPlane($token, $deviceId, $now); $this->assertDeviceProjectMember((string) $auth['deviceId'], $projectId); $this->assertUnifiedReady();
        $label = self::portableText((string) ($payload['workspaceLabel'] ?? ''), 'workspaceLabel', 120); $fingerprint = $payload['sourceFingerprint'] === null ? null : self::gitSha((string) $payload['sourceFingerprint']); $caps = [];
        foreach ($payload['capabilities'] as $capability) { if (!is_string($capability) || preg_match('/^[a-z][a-z0-9:._-]{0,63}$/', $capability) !== 1) throw new HubControlPlaneException('Project binding capability is invalid', 'FIELD_INVALID'); $caps[] = $capability; }
        $at = self::timestamp($now ?? gmdate('c'));
        $this->pdo->prepare('INSERT INTO control_project_device_bindings(binding_id, project_id, device_id, workspace_label, source_fingerprint, capabilities_json, observed_at, revoked_at) VALUES(:id, :project, :device, :label, :fingerprint, :caps, :at, NULL) ON CONFLICT(project_id, device_id) DO UPDATE SET workspace_label=excluded.workspace_label, source_fingerprint=excluded.source_fingerprint, capabilities_json=excluded.capabilities_json, observed_at=excluded.observed_at, revoked_at=NULL')->execute(['id' => self::uuidFromBytes(random_bytes(16)), 'project' => $projectId, 'device' => $auth['deviceId'], 'label' => $label, 'fingerprint' => $fingerprint, 'caps' => json_encode(array_values(array_unique($caps)), JSON_THROW_ON_ERROR), 'at' => $at]);
        return ['schemaVersion' => 2, 'binding' => ['projectId' => $projectId, 'deviceId' => (string) $auth['deviceId'], 'workspaceLabel' => $label, 'sourceFingerprint' => $fingerprint, 'capabilities' => array_values(array_unique($caps)), 'observedAt' => $at]];
    }

    /**
     * The enrolled owner may publish a portable manifest into the one Hub
     * registry. This is deliberately metadata-only: a desktop folder stays a
     * device-local binding and an existing identity is never duplicated.
     */
    public function registerProjectFromDevice(string $token, array $payload, ?string $now = null): array
    {
        self::exactKeys($payload, ['deviceId', 'project', 'schemaVersion']);
        if (($payload['schemaVersion'] ?? null) !== 2 || !is_array($payload['project'])) throw new HubControlPlaneException('Project registration is invalid', 'PAYLOAD_INVALID');
        self::exactKeys($payload['project'], ['name', 'projectId', 'sourceRevision', 'type']);
        $deviceId = self::uuid((string) ($payload['deviceId'] ?? '')); $auth = $this->enrollment->authenticateForControlPlane($token, $deviceId, $now);
        $owner = $this->pdo->query('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1 AND bootstrap_closed = 1')->fetchColumn();
        if (!is_string($owner) || !hash_equals($owner, (string) $auth['userId'])) throw new HubControlPlaneException('Only the AWH owner may register a project', 'PROJECT_FORBIDDEN');
        $project = $payload['project']; $projectId = self::uuid((string) ($project['projectId'] ?? '')); $name = self::portableText((string) ($project['name'] ?? ''), 'projectName', 120); $type = strtolower(trim((string) ($project['type'] ?? '')));
        if (!preg_match('/^[a-z][a-z0-9-]{0,31}$/', $type)) throw new HubControlPlaneException('Project type is invalid', 'FIELD_INVALID');
        $revision = $project['sourceRevision'] === null ? null : self::gitSha((string) $project['sourceRevision']); $at = self::timestamp($now ?? gmdate('c'));
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            $existing = $this->pdo->prepare('SELECT name, type FROM projects WHERE project_id = :project'); $existing->execute(['project' => $projectId]); $row = $existing->fetch();
            if (is_array($row) && ((string) $row['name'] !== $name || (string) $row['type'] !== $type)) throw new HubControlPlaneException('Project identity conflicts with the Hub registry', 'PROJECT_ID_CONFLICT');
            if (!is_array($row)) $this->pdo->prepare('INSERT INTO projects(project_id, name, type, created_at, source_revision, observed_at, provenance) VALUES(:project, :name, :type, :at, :revision, :at, :provenance)')->execute(['project' => $projectId, 'name' => $name, 'type' => $type, 'at' => $at, 'revision' => $revision, 'provenance' => 'portable-owner-device']);
            elseif ($revision !== null) $this->pdo->prepare('UPDATE projects SET source_revision = :revision, observed_at = :at WHERE project_id = :project')->execute(['project' => $projectId, 'revision' => $revision, 'at' => $at]);
            $this->pdo->prepare("INSERT INTO user_project_memberships(user_id, project_id, role, created_at, revoked_at) VALUES(:user, :project, 'owner', :at, NULL) ON CONFLICT(user_id, project_id) DO UPDATE SET role='owner', revoked_at=NULL")->execute(['user' => $auth['userId'], 'project' => $projectId, 'at' => $at]);
            $this->pdo->prepare("INSERT INTO device_project_memberships(device_id, project_id, role, created_at, revoked_at) VALUES(:device, :project, 'owner', :at, NULL) ON CONFLICT(device_id, project_id) DO UPDATE SET role='owner', revoked_at=NULL")->execute(['device' => $auth['deviceId'], 'project' => $projectId, 'at' => $at]);
            $this->pdo->exec('COMMIT');
        } catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); if ($error instanceof HubControlPlaneException) throw $error; throw new HubControlPlaneException('Project could not be registered', 'PROJECT_REGISTER_FAILED'); }
        return ['schemaVersion' => 2, 'project' => ['projectId' => $projectId, 'name' => $name, 'type' => $type, 'sourceRevision' => $revision, 'observedAt' => $at]];
    }

    public function projectBindings(string $sessionToken, string $projectId, ?string $now = null): array
    {
        $session = $this->sessionRow($sessionToken, $now); $this->assertUnifiedReady(); $projectId = self::uuid($projectId); $this->assertProjectMember((string) $session['user_id'], $projectId);
        $q = $this->pdo->prepare('SELECT b.workspace_label, b.source_fingerprint, b.capabilities_json, b.observed_at, d.display_name, d.platform, d.arch FROM control_project_device_bindings b JOIN devices d ON d.device_id = b.device_id WHERE b.project_id = :project AND b.revoked_at IS NULL AND d.revoked_at IS NULL ORDER BY b.observed_at DESC LIMIT 20'); $q->execute(['project' => $projectId]);
        $bindings = []; foreach ($q->fetchAll() as $row) { try { $capabilities = json_decode((string) $row['capabilities_json'], true, 16, JSON_THROW_ON_ERROR); if (!is_array($capabilities)) $capabilities = []; } catch (Throwable) { $capabilities = []; } $bindings[] = ['workspaceLabel' => (string) $row['workspace_label'], 'sourceFingerprint' => $row['source_fingerprint'] === null ? null : (string) $row['source_fingerprint'], 'capabilities' => array_values(array_filter($capabilities, 'is_string')), 'device' => ['displayName' => (string) $row['display_name'], 'platform' => (string) $row['platform'], 'arch' => (string) $row['arch']], 'observedAt' => (string) $row['observed_at']]; }
        return ['schemaVersion' => 2, 'projectId' => $projectId, 'bindings' => $bindings];
    }

    /** Publish only bounded Git WIP metadata after the source device has verified its private remote ref. */
    public function publishWorkspaceCheckpoint(string $token, array $payload, ?string $now = null): array
    {
        self::exactKeys($payload, ['artifactRefs', 'baseRevision', 'checkpointId', 'deviceId', 'files', 'projectId', 'schemaVersion', 'syncState', 'taskId', 'treeRevision', 'wipRef', 'wipRevision']);
        if (($payload['schemaVersion'] ?? null) !== 1) throw new HubControlPlaneException('Unsupported workspace schema', 'SCHEMA_VERSION');
        $deviceId = self::uuid((string) ($payload['deviceId'] ?? '')); $projectId = self::uuid((string) ($payload['projectId'] ?? ''));
        $auth = $this->enrollment->authenticateForControlPlane($token, $deviceId, $now); $this->assertDeviceProjectMember((string) $auth['deviceId'], $projectId); $this->assertWorkspaceReady();
        $record = $this->workspaceCheckpointPayload($payload, $projectId, (string) $auth['deviceId']); $at = self::timestamp($now ?? gmdate('c')); $expires = gmdate('c', strtotime($at) + self::WORKSPACE_LEASE_TTL);
        $transactionOpen = false;
        try {
            $this->pdo->exec('BEGIN IMMEDIATE'); $transactionOpen = true;
            $existing = $this->pdo->prepare('SELECT * FROM control_workspace_checkpoints WHERE checkpoint_id = :id'); $existing->execute(['id' => $record['checkpointId']]); $row = $existing->fetch();
            if (is_array($row)) {
                if ((string) $row['project_id'] !== $projectId || (string) $row['source_device_id'] !== $auth['deviceId'] || (string) $row['base_revision'] !== $record['baseRevision'] || (string) ($row['wip_revision'] ?? '') !== (string) ($record['wipRevision'] ?? '')) throw new HubControlPlaneException('Workspace checkpoint id conflicts with existing state', 'WORKSPACE_CHECKPOINT_CONFLICT');
            } else {
                $insert = $this->pdo->prepare('INSERT INTO control_workspace_checkpoints(checkpoint_id, project_id, task_id, source_device_id, base_revision, wip_revision, wip_ref, tree_revision, files_json, artifact_refs_json, sync_state, created_at, durable_at) VALUES(:id, :project, :task, :device, :base, :wip, :ref, :tree, :files, :artifacts, :state, :created, :durable)');
                $insert->execute(['id' => $record['checkpointId'], 'project' => $projectId, 'task' => $record['taskId'], 'device' => $auth['deviceId'], 'base' => $record['baseRevision'], 'wip' => $record['wipRevision'], 'ref' => $record['wipRef'], 'tree' => $record['treeRevision'], 'files' => json_encode($record['files'], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), 'artifacts' => json_encode($record['artifactRefs'], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), 'state' => $record['syncState'], 'created' => $at, 'durable' => $record['syncState'] === 'UNSYNCED' ? null : $at]);
                $this->workspaceEvent($projectId, $record['checkpointId'], (string) $auth['deviceId'], 'CHECKPOINT_PUBLISHED', $at);
            }
            $lease = $this->pdo->prepare('SELECT owner_device_id, state, lease_expires_at FROM control_workspace_leases WHERE project_id = :project'); $lease->execute(['project' => $projectId]); $current = $lease->fetch();
            if (is_array($current) && $current['state'] === 'ACTIVE' && (string) $current['owner_device_id'] !== $auth['deviceId'] && strtotime((string) $current['lease_expires_at']) > strtotime($at)) throw new HubControlPlaneException('Another device currently owns this workspace', 'WORKSPACE_LEASE_HELD');
            $upsert = $this->pdo->prepare('INSERT INTO control_workspace_leases(project_id, owner_device_id, checkpoint_id, state, lease_expires_at, acquired_at, updated_at) VALUES(:project, :device, :checkpoint, \'ACTIVE\', :expires, :at, :at) ON CONFLICT(project_id) DO UPDATE SET owner_device_id=excluded.owner_device_id, checkpoint_id=excluded.checkpoint_id, state=\'ACTIVE\', lease_expires_at=excluded.lease_expires_at, updated_at=excluded.updated_at');
            $upsert->execute(['project' => $projectId, 'device' => $auth['deviceId'], 'checkpoint' => $record['checkpointId'], 'expires' => $expires, 'at' => $at]);
            $this->workspaceEvent($projectId, $record['checkpointId'], (string) $auth['deviceId'], 'LEASE_ACQUIRED', $at);
            $this->pdo->exec('COMMIT'); $transactionOpen = false;
        } catch (Throwable $error) {
            if ($transactionOpen) { try { $this->pdo->exec('ROLLBACK'); } catch (Throwable) {} }
            if ($error instanceof HubControlPlaneException) throw $error;
            throw new HubControlPlaneException('Workspace checkpoint could not be stored', 'WORKSPACE_CHECKPOINT_FAILED');
        }
        return ['schemaVersion' => 1, 'workspace' => $this->workspaceState($projectId, $at, true)];
    }

    /** Atomically give one trusted target device the writer lease for a known durable checkpoint. */
    public function claimWorkspaceLease(string $token, array $payload, ?string $now = null): array
    {
        self::exactKeys($payload, ['checkpointId', 'deviceId', 'projectId', 'schemaVersion']); if (($payload['schemaVersion'] ?? null) !== 1) throw new HubControlPlaneException('Unsupported workspace schema', 'SCHEMA_VERSION');
        $deviceId = self::uuid((string) ($payload['deviceId'] ?? '')); $projectId = self::uuid((string) ($payload['projectId'] ?? '')); $checkpointId = $payload['checkpointId'] === null ? null : self::uuid((string) $payload['checkpointId']);
        $auth = $this->enrollment->authenticateForControlPlane($token, $deviceId, $now); $this->assertDeviceProjectMember((string) $auth['deviceId'], $projectId); $this->assertWorkspaceReady(); $at = self::timestamp($now ?? gmdate('c')); $expires = gmdate('c', strtotime($at) + self::WORKSPACE_LEASE_TTL);
        $transactionOpen = false;
        try {
            $this->pdo->exec('BEGIN IMMEDIATE'); $transactionOpen = true;
            $latest = $this->latestWorkspaceCheckpoint($projectId);
            if ($checkpointId !== null) {
                if (!is_array($latest) || (string) $latest['checkpoint_id'] !== $checkpointId || !in_array((string) $latest['sync_state'], ['CLEAN', 'SYNCED'], true)) throw new HubControlPlaneException('Requested workspace checkpoint is not the latest durable state', 'WORKSPACE_CHECKPOINT_STALE');
            } elseif (is_array($latest) && in_array((string) $latest['sync_state'], ['CLEAN', 'SYNCED'], true)) throw new HubControlPlaneException('A durable workspace checkpoint must be selected before takeover', 'WORKSPACE_CHECKPOINT_REQUIRED');
            $lease = $this->pdo->prepare('SELECT * FROM control_workspace_leases WHERE project_id = :project'); $lease->execute(['project' => $projectId]); $current = $lease->fetch();
            if (is_array($current) && $current['state'] === 'ACTIVE' && (string) $current['owner_device_id'] !== $auth['deviceId'] && strtotime((string) $current['lease_expires_at']) > strtotime($at)) throw new HubControlPlaneException('Another device currently owns this workspace', 'WORKSPACE_LEASE_HELD');
            if (is_array($current) && $current['state'] === 'ACTIVE' && (string) $current['owner_device_id'] !== $auth['deviceId']) $this->workspaceEvent($projectId, $current['checkpoint_id'] === null ? null : (string) $current['checkpoint_id'], (string) $current['owner_device_id'], 'LEASE_EXPIRED', $at);
            $upsert = $this->pdo->prepare('INSERT INTO control_workspace_leases(project_id, owner_device_id, checkpoint_id, state, lease_expires_at, acquired_at, updated_at) VALUES(:project, :device, :checkpoint, \'ACTIVE\', :expires, :at, :at) ON CONFLICT(project_id) DO UPDATE SET owner_device_id=excluded.owner_device_id, checkpoint_id=excluded.checkpoint_id, state=\'ACTIVE\', lease_expires_at=excluded.lease_expires_at, acquired_at=excluded.acquired_at, updated_at=excluded.updated_at');
            $upsert->execute(['project' => $projectId, 'device' => $auth['deviceId'], 'checkpoint' => $checkpointId, 'expires' => $expires, 'at' => $at]); $this->workspaceEvent($projectId, $checkpointId, (string) $auth['deviceId'], 'LEASE_ACQUIRED', $at); $this->pdo->exec('COMMIT'); $transactionOpen = false;
        } catch (Throwable $error) { if ($transactionOpen) { try { $this->pdo->exec('ROLLBACK'); } catch (Throwable) {} } if ($error instanceof HubControlPlaneException) throw $error; throw new HubControlPlaneException('Workspace takeover could not be completed', 'WORKSPACE_LEASE_FAILED'); }
        return ['schemaVersion' => 1, 'workspace' => $this->workspaceState($projectId, $at, true)];
    }

    public function renewWorkspaceLease(string $token, array $payload, ?string $now = null): array
    {
        self::exactKeys($payload, ['deviceId', 'projectId', 'schemaVersion']); if (($payload['schemaVersion'] ?? null) !== 1) throw new HubControlPlaneException('Unsupported workspace schema', 'SCHEMA_VERSION');
        $deviceId = self::uuid((string) ($payload['deviceId'] ?? '')); $projectId = self::uuid((string) ($payload['projectId'] ?? '')); $auth = $this->enrollment->authenticateForControlPlane($token, $deviceId, $now); $this->assertDeviceProjectMember((string) $auth['deviceId'], $projectId); $this->assertWorkspaceReady();
        $at = self::timestamp($now ?? gmdate('c')); $expires = gmdate('c', strtotime($at) + self::WORKSPACE_LEASE_TTL);
        $update = $this->pdo->prepare("UPDATE control_workspace_leases SET lease_expires_at = :expires, updated_at = :at WHERE project_id = :project AND owner_device_id = :device AND state = 'ACTIVE'"); $update->execute(['expires' => $expires, 'at' => $at, 'project' => $projectId, 'device' => $auth['deviceId']]);
        if ($update->rowCount() !== 1) throw new HubControlPlaneException('This device does not own the workspace lease', 'WORKSPACE_LEASE_FORBIDDEN');
        return ['schemaVersion' => 1, 'workspace' => $this->workspaceState($projectId, $at, true)];
    }

    public function releaseWorkspaceLease(string $token, array $payload, ?string $now = null): array
    {
        self::exactKeys($payload, ['deviceId', 'projectId', 'schemaVersion']); if (($payload['schemaVersion'] ?? null) !== 1) throw new HubControlPlaneException('Unsupported workspace schema', 'SCHEMA_VERSION');
        $deviceId = self::uuid((string) ($payload['deviceId'] ?? '')); $projectId = self::uuid((string) ($payload['projectId'] ?? '')); $auth = $this->enrollment->authenticateForControlPlane($token, $deviceId, $now); $this->assertDeviceProjectMember((string) $auth['deviceId'], $projectId); $this->assertWorkspaceReady(); $at = self::timestamp($now ?? gmdate('c'));
        $transactionOpen = false;
        try {
            $this->pdo->exec('BEGIN IMMEDIATE'); $transactionOpen = true; $q = $this->pdo->prepare("SELECT checkpoint_id FROM control_workspace_leases WHERE project_id = :project AND owner_device_id = :device AND state = 'ACTIVE'"); $q->execute(['project' => $projectId, 'device' => $auth['deviceId']]); $checkpointId = $q->fetchColumn();
            if ($checkpointId === false) throw new HubControlPlaneException('This device does not own the workspace lease', 'WORKSPACE_LEASE_FORBIDDEN');
            $this->pdo->prepare("UPDATE control_workspace_leases SET state = 'RELEASED', lease_expires_at = :at, updated_at = :at WHERE project_id = :project")->execute(['at' => $at, 'project' => $projectId]); $this->workspaceEvent($projectId, $checkpointId === null ? null : (string) $checkpointId, (string) $auth['deviceId'], 'LEASE_RELEASED', $at); $this->pdo->exec('COMMIT'); $transactionOpen = false;
        } catch (Throwable $error) { if ($transactionOpen) { try { $this->pdo->exec('ROLLBACK'); } catch (Throwable) {} } if ($error instanceof HubControlPlaneException) throw $error; throw new HubControlPlaneException('Workspace lease could not be released', 'WORKSPACE_LEASE_FAILED'); }
        return ['schemaVersion' => 1, 'workspace' => $this->workspaceState($projectId, $at, true)];
    }
    private function event(string $taskId, string $state, int $progress, ?string $message, string $at): string { $id = self::uuidFromBytes(random_bytes(16)); $this->pdo->prepare('INSERT INTO control_task_events(event_id, task_id, state, progress, message, occurred_at) VALUES(:id, :task, :state, :progress, :message, :at)')->execute(['id' => $id, 'task' => $taskId, 'state' => $state, 'progress' => $progress, 'message' => $message, 'at' => $at]); return $id; }

    private function assertAssistantReady(): void { HubAssistantWorkstreamMigration::assertCapabilityReady($this->pdo, dirname(__DIR__) . '/migrations/005_assistant_workstream.sql'); }
    private function assertWorkspaceReady(): void { HubWorkspaceContinuityMigration::assertCapabilityReady($this->pdo, dirname(__DIR__) . '/migrations/006_workspace_continuity.sql'); }
    private function assertUnifiedReady(): void { HubUnifiedWorkspaceMigration::assertCapabilityReady($this->pdo, dirname(__DIR__) . '/migrations/007_unified_workspace.sql'); }
    private function workspaceEvent(string $projectId, ?string $checkpointId, string $deviceId, string $event, string $at): void { $q = $this->pdo->prepare('INSERT INTO control_workspace_events(event_id, project_id, checkpoint_id, device_id, event_type, occurred_at) VALUES(:id, :project, :checkpoint, :device, :event, :at)'); $q->execute(['id' => self::uuidFromBytes(random_bytes(16)), 'project' => $projectId, 'checkpoint' => $checkpointId, 'device' => $deviceId, 'event' => $event, 'at' => $at]); }
    private function latestWorkspaceCheckpoint(string $projectId): array|false { $q = $this->pdo->prepare('SELECT * FROM control_workspace_checkpoints WHERE project_id = :project ORDER BY created_at DESC, checkpoint_id DESC LIMIT 1'); $q->execute(['project' => $projectId]); return $q->fetch(); }
    private function workspaceState(string $projectId, string $at, bool $includeIds): array
    {
        $checkpoint = $this->latestWorkspaceCheckpoint($projectId);
        $q = $this->pdo->prepare('SELECT l.*, d.display_name, d.platform, w.last_seen_at FROM control_workspace_leases l JOIN devices d ON d.device_id = l.owner_device_id LEFT JOIN control_workers w ON w.device_id = l.owner_device_id WHERE l.project_id = :project'); $q->execute(['project' => $projectId]); $lease = $q->fetch();
        $leaseActive = is_array($lease) && $lease['state'] === 'ACTIVE' && strtotime((string) $lease['lease_expires_at']) > strtotime($at);
        $sync = !is_array($checkpoint) ? 'NO_CHECKPOINT' : ((string) $checkpoint['sync_state'] === 'UNSYNCED' ? 'UNSYNCED_CHANGES' : ($leaseActive ? 'HANDOFF_REQUIRED' : 'SYNCED'));
        if (is_array($lease) && $lease['state'] === 'ACTIVE' && !$leaseActive) $sync = is_array($checkpoint) && in_array((string) $checkpoint['sync_state'], ['CLEAN', 'SYNCED'], true) ? 'SOURCE_OFFLINE' : 'UNSYNCED_CHANGES';
        $checkpointOut = !is_array($checkpoint) ? null : ['checkpointId' => (string) $checkpoint['checkpoint_id'], 'taskId' => $checkpoint['task_id'] === null ? null : (string) $checkpoint['task_id'], ...($includeIds ? ['sourceDeviceId' => (string) $checkpoint['source_device_id']] : []), 'baseRevision' => (string) $checkpoint['base_revision'], 'wipRevision' => $checkpoint['wip_revision'] === null ? null : (string) $checkpoint['wip_revision'], ...($includeIds && $checkpoint['wip_ref'] !== null ? ['wipRef' => (string) $checkpoint['wip_ref']] : []), 'treeRevision' => (string) $checkpoint['tree_revision'], 'files' => self::workspaceFiles((string) $checkpoint['files_json']), 'artifactRefs' => self::workspaceRefs((string) $checkpoint['artifact_refs_json']), 'syncState' => (string) $checkpoint['sync_state'], 'createdAt' => (string) $checkpoint['created_at'], 'durableAt' => $checkpoint['durable_at'] === null ? null : (string) $checkpoint['durable_at']];
        $leaseOut = !is_array($lease) ? null : ['active' => $leaseActive, 'state' => $leaseActive ? 'ACTIVE' : 'EXPIRED', 'checkpointId' => $includeIds && $lease['checkpoint_id'] !== null ? (string) $lease['checkpoint_id'] : null, 'owner' => ['displayName' => (string) $lease['display_name'], 'platform' => (string) $lease['platform'], 'lastSeenAt' => $lease['last_seen_at'] === null ? null : (string) $lease['last_seen_at'], ...($includeIds ? ['deviceId' => (string) $lease['owner_device_id']] : [])], 'leaseExpiresAt' => (string) $lease['lease_expires_at']];
        return ['projectId' => $projectId, 'syncStatus' => $sync, 'checkpoint' => $checkpointOut, 'lease' => $leaseOut];
    }
    private function workspaceCheckpointPayload(array $payload, string $projectId, string $deviceId): array
    {
        $checkpointId = self::uuid((string) ($payload['checkpointId'] ?? '')); $taskId = $payload['taskId'] === null ? null : self::uuid((string) $payload['taskId']); $base = self::gitSha((string) ($payload['baseRevision'] ?? '')); $tree = self::gitSha((string) ($payload['treeRevision'] ?? '')); $state = (string) ($payload['syncState'] ?? '');
        if (!in_array($state, self::WORKSPACE_SYNC_STATES, true)) throw new HubControlPlaneException('Workspace sync state is invalid', 'FIELD_INVALID');
        $wipRevision = $payload['wipRevision'] === null ? null : self::gitSha((string) $payload['wipRevision']); $wipRef = $payload['wipRef'] === null ? null : self::wipRef((string) $payload['wipRef']);
        if (($state === 'CLEAN' && ($wipRevision !== null || $wipRef !== null || $payload['files'] !== [])) || ($state === 'SYNCED' && ($wipRevision === null || $wipRef === null)) || ($state === 'UNSYNCED' && ($wipRevision !== null || $wipRef !== null))) throw new HubControlPlaneException('Workspace checkpoint state is inconsistent', 'FIELD_INVALID');
        $files = self::workspaceFilesPayload($payload['files'] ?? null); $refs = self::workspaceRefsPayload($payload['artifactRefs'] ?? null);
        return ['checkpointId' => $checkpointId, 'projectId' => $projectId, 'sourceDeviceId' => $deviceId, 'taskId' => $taskId, 'baseRevision' => $base, 'wipRevision' => $wipRevision, 'wipRef' => $wipRef, 'treeRevision' => $tree, 'files' => $files, 'artifactRefs' => $refs, 'syncState' => $state];
    }
    private static function workspaceFilesPayload(mixed $value): array
    {
        if (!is_array($value) || count($value) > 80 || array_is_list($value) === false) throw new HubControlPlaneException('Workspace file list is invalid', 'FIELD_INVALID'); $out = [];
        foreach ($value as $file) { if (!is_array($file)) throw new HubControlPlaneException('Workspace file metadata is invalid', 'FIELD_INVALID'); self::exactKeys($file, ['path', 'sha256', 'sizeBytes', 'state']); $path = self::portableRelative((string) ($file['path'] ?? '')); $state = (string) ($file['state'] ?? ''); $sha = $file['sha256'] ?? null; $size = $file['sizeBytes'] ?? null; if (!in_array($state, ['modified', 'untracked', 'deleted'], true) || ($state === 'deleted' ? $sha !== null || $size !== null : !is_string($sha) || preg_match('/^[0-9a-f]{64}$/i', $sha) !== 1 || !is_int($size) || $size < 0 || $size > 524288)) throw new HubControlPlaneException('Workspace file metadata is invalid', 'FIELD_INVALID'); $out[] = ['path' => $path, 'state' => $state, 'sha256' => $sha, 'sizeBytes' => $size]; }
        return $out;
    }
    private static function workspaceRefsPayload(mixed $value): array { if (!is_array($value) || count($value) > 20 || array_is_list($value) === false) throw new HubControlPlaneException('Workspace artifact references are invalid', 'FIELD_INVALID'); $out = []; foreach ($value as $ref) $out[] = self::portableRelative(is_string($ref) ? $ref : ''); return array_values(array_unique($out)); }
    private static function workspaceFiles(string $json): array { try { $value = json_decode($json, true, 32, JSON_THROW_ON_ERROR); return self::workspaceFilesPayload($value); } catch (HubControlPlaneException $error) { throw $error; } catch (Throwable) { throw new HubControlPlaneException('Workspace checkpoint metadata is invalid', 'WORKSPACE_CHECKPOINT_INVALID'); } }
    private static function workspaceRefs(string $json): array { try { $value = json_decode($json, true, 32, JSON_THROW_ON_ERROR); return self::workspaceRefsPayload($value); } catch (HubControlPlaneException $error) { throw $error; } catch (Throwable) { throw new HubControlPlaneException('Workspace checkpoint metadata is invalid', 'WORKSPACE_CHECKPOINT_INVALID'); } }
    private static function gitSha(string $value): string { if (preg_match('/^[0-9a-f]{40,64}$/i', $value) !== 1) throw new HubControlPlaneException('Git revision is invalid', 'FIELD_INVALID'); return strtolower($value); }
    private static function wipRef(string $value): string { if (preg_match('#^refs/awh/wip/[0-9a-f-]{36}/[0-9a-f-]{36}$#i', $value) !== 1) throw new HubControlPlaneException('Workspace reference is invalid', 'FIELD_INVALID'); return $value; }
    private static function portableRelative(string $value): string { if ($value === '' || strlen($value) > 240 || str_contains($value, "\0") || str_contains($value, '\\') || str_starts_with($value, '/') || preg_match('#^(?:[A-Za-z]:|~)#', $value) || str_contains($value, '..') || preg_match('/(?:^|\/)(?:\.git|node_modules|\.env)(?:\/|$)/i', $value)) throw new HubControlPlaneException('Workspace path is invalid', 'FIELD_INVALID'); return $value; }
    private function assertDeviceProjectMember(string $deviceId, string $projectId): void { $q = $this->pdo->prepare('SELECT 1 FROM device_project_memberships WHERE device_id = :device AND project_id = :project AND revoked_at IS NULL'); $q->execute(['device' => $deviceId, 'project' => $projectId]); if ($q->fetchColumn() === false) throw new HubControlPlaneException('Project is not available to this device', 'PROJECT_FORBIDDEN'); }

    private function getOrCreateConversation(string $userId, string $projectId, string $at): array
    {
        $q = $this->pdo->prepare($this->unifiedSchemaPresent() ? 'SELECT * FROM control_conversations WHERE user_id = :user AND project_id = :project AND archived_at IS NULL ORDER BY updated_at DESC, conversation_id DESC LIMIT 1' : 'SELECT * FROM control_conversations WHERE user_id = :user AND project_id = :project LIMIT 1'); $q->execute(['user' => $userId, 'project' => $projectId]); $row = $q->fetch();
        if (is_array($row)) return $row;
        $id = self::uuidFromBytes(random_bytes(16));
        if ($this->unifiedSchemaPresent()) {
            $this->pdo->prepare("INSERT INTO control_conversations(conversation_id, user_id, project_id, created_at, updated_at, last_task_id, title, archived_at, origin) VALUES(:id, :user, :project, :at, :at, NULL, 'Work', NULL, 'native')")->execute(['id' => $id, 'user' => $userId, 'project' => $projectId, 'at' => $at]);
            return ['conversation_id' => $id, 'user_id' => $userId, 'project_id' => $projectId, 'created_at' => $at, 'updated_at' => $at, 'last_task_id' => null, 'title' => 'Work', 'archived_at' => null, 'origin' => 'native'];
        }
        $this->pdo->prepare('INSERT INTO control_conversations(conversation_id, user_id, project_id, created_at, updated_at, last_task_id) VALUES(:id, :user, :project, :at, :at, NULL)')->execute(['id' => $id, 'user' => $userId, 'project' => $projectId, 'at' => $at]);
        return ['conversation_id' => $id, 'user_id' => $userId, 'project_id' => $projectId, 'created_at' => $at, 'updated_at' => $at, 'last_task_id' => null, 'archived_at' => null];
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

    private function conversationRowForUser(string $userId, string $conversationId): array
    {
        $q = $this->pdo->prepare('SELECT * FROM control_conversations WHERE conversation_id = :id AND user_id = :user'); $q->execute(['id' => $conversationId, 'user' => $userId]); $row = $q->fetch();
        if (!is_array($row)) throw new HubControlPlaneException('Conversation was not found', 'CONVERSATION_NOT_FOUND');
        $this->assertProjectMember($userId, (string) $row['project_id']); return $row;
    }

    private function conversationSummaryRow(array $row): array
    {
        return ['conversationId' => (string) $row['conversation_id'], 'projectId' => (string) $row['project_id'], 'projectName' => (string) $row['project_name'], 'title' => (string) $row['title'], 'archivedAt' => $row['archived_at'] === null ? null : (string) $row['archived_at'], 'origin' => (string) $row['origin'], 'createdAt' => (string) $row['created_at'], 'updatedAt' => (string) $row['updated_at'], 'lastTaskId' => $row['last_task_id'] === null ? null : (string) $row['last_task_id']];
    }

    private function currentContextForUser(string $userId, string $projectId): array
    {
        $this->assertProjectMember($userId, $projectId); $q = $this->pdo->prepare('SELECT * FROM control_project_contexts WHERE user_id = :user AND project_id = :project ORDER BY observed_at DESC, context_id DESC LIMIT 1'); $q->execute(['user' => $userId, 'project' => $projectId]); $row = $q->fetch();
        return ['schemaVersion' => 2, 'context' => !is_array($row) ? null : ['projectId' => (string) $row['project_id'], 'conversationId' => $row['conversation_id'] === null ? null : (string) $row['conversation_id'], 'viewKind' => (string) $row['view_kind'], 'selectedRef' => $row['selected_ref'] === null ? null : (string) $row['selected_ref'], 'sourceRevision' => $row['source_revision'] === null ? null : (string) $row['source_revision'], 'observedAt' => (string) $row['observed_at']]];
    }

    private function productSettingsForUser(string $userId): array
    {
        $owner = $this->pdo->prepare('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1 AND bootstrap_closed = 1'); $owner->execute(); if ($owner->fetchColumn() !== $userId) throw new HubControlPlaneException('Product configuration is owner-only', 'PROJECT_FORBIDDEN');
        $q = $this->pdo->query('SELECT setting_key, value_json, revision_no, updated_at FROM control_product_settings ORDER BY setting_key'); $out = self::productDefaults();
        foreach ($q->fetchAll() as $row) { try { $value = json_decode((string) $row['value_json'], true, 16, JSON_THROW_ON_ERROR); $out[(string) $row['setting_key']] = ['value' => $value, 'revision' => (int) $row['revision_no'], 'updatedAt' => (string) $row['updated_at']]; } catch (Throwable) { throw new HubControlPlaneException('Product configuration is invalid', 'PRODUCT_SETTING_INVALID'); } }
        return $out;
    }

    private static function productDefaults(): array
    {
        return ['productName' => ['value' => 'Art’s Workspace Hub', 'revision' => 0, 'updatedAt' => null], 'shortName' => ['value' => 'AWH', 'revision' => 0, 'updatedAt' => null], 'tagline' => ['value' => 'Your Projects. One Workspace. Anywhere.', 'revision' => 0, 'updatedAt' => null], 'accent' => ['value' => '#ff7a1a', 'revision' => 0, 'updatedAt' => null], 'welcome' => ['value' => 'เริ่มคุยกับ Art’s Workspace Hub ได้เลย', 'revision' => 0, 'updatedAt' => null], 'starterPrompts' => ['value' => ['ตรวจสถานะล่าสุด', 'ทำต่อจากงานล่าสุด', 'ตรวจอย่างเดียว ห้ามแก้'], 'revision' => 0, 'updatedAt' => null]];
    }

    private static function conversationTitle(string $value): string { $value = trim($value); if ($value === '' || strlen($value) > 120 || preg_match('/[\x00-\x1f\x7f]/', $value)) throw new HubControlPlaneException('Conversation title is invalid', 'FIELD_INVALID'); return $value; }
    private static function contextKind(string $value): string { $value = strtolower(trim($value)); if (!in_array($value, ['work', 'project', 'result', 'preview', 'settings'], true)) throw new HubControlPlaneException('Current view is invalid', 'FIELD_INVALID'); return $value; }
    private static function optionalGitSha(mixed $value): ?string { if ($value === null || $value === '') return null; if (!is_string($value) || preg_match('/^[0-9a-f]{40,64}$/i', $value) !== 1) throw new HubControlPlaneException('Source revision is invalid', 'FIELD_INVALID'); return strtolower($value); }
    private static function searchText(string $value): string { $value = trim($value); if ($value === '' || strlen($value) > 120 || preg_match('/[\x00-\x1f\x7f]/', $value)) throw new HubControlPlaneException('Conversation search is invalid', 'FIELD_INVALID'); return $value; }
    private static function escapeLike(string $value): string { return strtr($value, ['\\' => '\\\\', '%' => '\\%', '_' => '\\_']); }
    private static function settingKey(string $value): string { if (!in_array($value, ['productName', 'shortName', 'tagline', 'accent', 'welcome', 'starterPrompts'], true)) throw new HubControlPlaneException('Product setting is not supported', 'FIELD_INVALID'); return $value; }
    private static function settingValue(string $key, mixed $value): mixed
    {
        if (in_array($key, ['productName', 'shortName', 'tagline', 'welcome'], true)) { if (!is_string($value) || trim($value) === '' || strlen($value) > ($key === 'welcome' ? 240 : 120) || preg_match('/[\x00-\x1f\x7f<>]/', $value)) throw new HubControlPlaneException('Product setting is invalid', 'FIELD_INVALID'); return trim($value); }
        if ($key === 'accent') { if (!is_string($value) || preg_match('/^#[0-9a-f]{6}$/i', $value) !== 1) throw new HubControlPlaneException('Accent color is invalid', 'FIELD_INVALID'); return strtolower($value); }
        if (!is_array($value) || array_is_list($value) === false || count($value) > 6) throw new HubControlPlaneException('Starter prompts are invalid', 'FIELD_INVALID'); $out = []; foreach ($value as $prompt) { if (!is_string($prompt) || trim($prompt) === '' || strlen($prompt) > 120 || preg_match('/[\x00-\x1f\x7f<>]/', $prompt)) throw new HubControlPlaneException('Starter prompt is invalid', 'FIELD_INVALID'); $out[] = trim($prompt); } return $out;
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
    private function unifiedSchemaPresent(): bool { try { return (int) $this->pdo->query('PRAGMA user_version')->fetchColumn() >= 8 && $this->pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'control_product_settings'")->fetchColumn() === 1; } catch (Throwable) { return false; } }
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
