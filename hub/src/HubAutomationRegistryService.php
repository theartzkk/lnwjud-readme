<?php

declare(strict_types=1);

final class HubAutomationRegistryException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'AUTOMATION_FAILED') { parent::__construct($message); }
}

/**
 * Durable persistence adapter for the canonical AutomationDefinition contract.
 * This service never schedules, executes, enqueues, dispatches or materializes work.
 */
final class HubAutomationRegistryService
{
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';
    private const CONDITION_KEY = '/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/';
    private const DTSTART = '/^DTSTART(?:;TZID=[A-Za-z0-9_+\/-]{1,64})?:\d{8}T\d{6}$/';
    private const RRULE = '/^RRULE:[A-Z0-9=;,+-]{1,500}$/';
    private const SECRET = '/(?:^|\s)(?:Bearer\s+|password\s*[=:]|secret\s*[=:]|token\s*[=:]|api[_-]?key\s*[=:])/i';
    private const EXECUTABLE_CONDITION = '/(?:javascript:|\beval\s*\(|\bexec\s*\(|\bsql\s*:|\bshell\s*:)/i';
    private const MODES = ['exact_schedule', 'flexible_schedule', 'condition_watch'];
    private const DEFINITION_INPUT_KEYS = ['condition', 'conversationId', 'enabled', 'goal', 'name', 'projectId', 'schedule', 'schemaVersion', 'timingMode'];
    private const CONDITION_KEYS = ['description', 'key', 'schemaVersion'];

    public function __construct(private readonly PDO $pdo)
    {
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->pdo->exec('PRAGMA foreign_keys = ON');
    }

    /** @return list<array<string,mixed>> */
    public function listForUser(string $userId, bool $includeArchived = false): array
    {
        $this->assertUser($userId);
        $sql = 'SELECT * FROM control_automations WHERE user_id=:user';
        if (!$includeArchived) $sql .= ' AND archived_at IS NULL';
        $sql .= ' ORDER BY updated_at DESC, automation_id ASC LIMIT 500';
        $q = $this->pdo->prepare($sql);
        $q->execute(['user' => strtolower($userId)]);
        return array_map([self::class, 'present'], $q->fetchAll());
    }

    /** @return array<string,mixed> */
    public function get(string $userId, string $automationId): array
    {
        $this->assertUser($userId);
        $automationId = $this->uuid($automationId, 'automation');
        $q = $this->pdo->prepare('SELECT * FROM control_automations WHERE automation_id=:id AND user_id=:user');
        $q->execute(['id' => $automationId, 'user' => strtolower($userId)]);
        $row = $q->fetch();
        if (!is_array($row)) throw new HubAutomationRegistryException('Automation was not found', 'AUTOMATION_NOT_FOUND');
        return self::present($row);
    }

    /** @param array<string,mixed> $input @return array<string,mixed> */
    public function create(string $userId, array $input, ?string $now = null): array
    {
        $this->assertUser($userId);
        $definition = $this->validateDefinitionInput($userId, $input);
        $id = self::newUuid();
        $at = self::timestamp($now ?? gmdate('c'));
        $condition = $definition['condition'];
        $q = $this->pdo->prepare('INSERT INTO control_automations(automation_id,user_id,project_id,conversation_id,name,goal,timing_mode,schedule_ical,condition_key,condition_description,enabled,created_at,updated_at,archived_at) VALUES(:id,:user,:project,:conversation,:name,:goal,:mode,:schedule,:conditionKey,:conditionDescription,:enabled,:at,:at,NULL)');
        $q->execute([
            'id' => $id,
            'user' => strtolower($userId),
            'project' => $definition['projectId'],
            'conversation' => $definition['conversationId'],
            'name' => $definition['name'],
            'goal' => $definition['goal'],
            'mode' => $definition['timingMode'],
            'schedule' => $definition['schedule'],
            'conditionKey' => is_array($condition) ? $condition['key'] : null,
            'conditionDescription' => is_array($condition) ? $condition['description'] : null,
            'enabled' => $definition['enabled'] ? 1 : 0,
            'at' => $at,
        ]);
        return $this->get($userId, $id);
    }

    /** @param array<string,mixed> $input @return array<string,mixed> */
    public function replace(string $userId, string $automationId, array $input, ?string $now = null): array
    {
        $automationId = $this->uuid($automationId, 'automation');
        $current = $this->get($userId, $automationId);
        if ($current['archivedAt'] !== null) throw new HubAutomationRegistryException('Archived automation cannot be changed', 'AUTOMATION_ARCHIVED');
        $definition = $this->validateDefinitionInput($userId, $input);
        $condition = $definition['condition'];
        $at = self::timestamp($now ?? gmdate('c'));
        $q = $this->pdo->prepare('UPDATE control_automations SET project_id=:project,conversation_id=:conversation,name=:name,goal=:goal,timing_mode=:mode,schedule_ical=:schedule,condition_key=:conditionKey,condition_description=:conditionDescription,enabled=:enabled,updated_at=:at WHERE automation_id=:id AND user_id=:user AND archived_at IS NULL');
        $q->execute([
            'project' => $definition['projectId'],
            'conversation' => $definition['conversationId'],
            'name' => $definition['name'],
            'goal' => $definition['goal'],
            'mode' => $definition['timingMode'],
            'schedule' => $definition['schedule'],
            'conditionKey' => is_array($condition) ? $condition['key'] : null,
            'conditionDescription' => is_array($condition) ? $condition['description'] : null,
            'enabled' => $definition['enabled'] ? 1 : 0,
            'at' => $at,
            'id' => $automationId,
            'user' => strtolower($userId),
        ]);
        if ($q->rowCount() !== 1) throw new HubAutomationRegistryException('Automation update conflicted', 'AUTOMATION_CONFLICT');
        return $this->get($userId, $automationId);
    }

    /** @return array<string,mixed> */
    public function setEnabled(string $userId, string $automationId, bool $enabled, ?string $now = null): array
    {
        $automationId = $this->uuid($automationId, 'automation');
        $current = $this->get($userId, $automationId);
        if ($current['archivedAt'] !== null) throw new HubAutomationRegistryException('Archived automation cannot be enabled', 'AUTOMATION_ARCHIVED');
        $at = self::timestamp($now ?? gmdate('c'));
        $q = $this->pdo->prepare('UPDATE control_automations SET enabled=:enabled,updated_at=:at WHERE automation_id=:id AND user_id=:user AND archived_at IS NULL');
        $q->execute(['enabled' => $enabled ? 1 : 0, 'at' => $at, 'id' => $automationId, 'user' => strtolower($userId)]);
        if ($q->rowCount() !== 1) throw new HubAutomationRegistryException('Automation update conflicted', 'AUTOMATION_CONFLICT');
        return $this->get($userId, $automationId);
    }

    /** @return array<string,mixed> */
    public function archive(string $userId, string $automationId, ?string $now = null): array
    {
        $automationId = $this->uuid($automationId, 'automation');
        $current = $this->get($userId, $automationId);
        if ($current['archivedAt'] !== null) return $current;
        $at = self::timestamp($now ?? gmdate('c'));
        $q = $this->pdo->prepare('UPDATE control_automations SET enabled=0,archived_at=:at,updated_at=:at WHERE automation_id=:id AND user_id=:user AND archived_at IS NULL');
        $q->execute(['at' => $at, 'id' => $automationId, 'user' => strtolower($userId)]);
        if ($q->rowCount() !== 1) throw new HubAutomationRegistryException('Automation archive conflicted', 'AUTOMATION_CONFLICT');
        return $this->get($userId, $automationId);
    }

    /** @param array<string,mixed> $input @return array<string,mixed> */
    private function validateDefinitionInput(string $userId, array $input): array
    {
        self::exactKeys($input, self::DEFINITION_INPUT_KEYS, 'AUTOMATION_FIELDS_INVALID');
        if (($input['schemaVersion'] ?? null) !== 1) throw new HubAutomationRegistryException('Automation schema is invalid', 'AUTOMATION_SCHEMA');

        $projectId = $this->uuid($input['projectId'] ?? null, 'project');
        $this->assertProjectAccess($userId, $projectId);
        $conversationId = $input['conversationId'] ?? null;
        if ($conversationId !== null) {
            $conversationId = $this->uuid($conversationId, 'conversation');
            $this->assertConversation($userId, $projectId, $conversationId);
        }

        $name = self::text($input['name'] ?? null, 1, 120, 'AUTOMATION_NAME_INVALID');
        $goal = self::text($input['goal'] ?? null, 1, 2000, 'AUTOMATION_GOAL_INVALID', true);
        if (preg_match(self::SECRET, $goal)) throw new HubAutomationRegistryException('Automation goal appears to contain a secret', 'AUTOMATION_GOAL_SECRET');

        $timingMode = $input['timingMode'] ?? null;
        if (!is_string($timingMode) || !in_array($timingMode, self::MODES, true)) throw new HubAutomationRegistryException('Automation timing mode is invalid', 'AUTOMATION_TIMING_MODE_INVALID');
        $schedule = self::schedule($input['schedule'] ?? null, $timingMode);
        $condition = self::condition($input['condition'] ?? null, $timingMode);
        $enabled = $input['enabled'] ?? null;
        if (!is_bool($enabled)) throw new HubAutomationRegistryException('Automation enabled state is invalid', 'AUTOMATION_ENABLED_INVALID');

        return [
            'schemaVersion' => 1,
            'projectId' => $projectId,
            'conversationId' => $conversationId,
            'name' => $name,
            'goal' => $goal,
            'timingMode' => $timingMode,
            'schedule' => $schedule,
            'condition' => $condition,
            'enabled' => $enabled,
        ];
    }

    private function assertProjectAccess(string $userId, string $projectId): void
    {
        $q = $this->pdo->prepare('SELECT 1 FROM user_project_memberships WHERE user_id=:user AND project_id=:project AND revoked_at IS NULL');
        $q->execute(['user' => strtolower($userId), 'project' => $projectId]);
        if ($q->fetchColumn() === false) throw new HubAutomationRegistryException('Project is not available to this user', 'PROJECT_ACCESS_DENIED');
    }

    private function assertConversation(string $userId, string $projectId, string $conversationId): void
    {
        $q = $this->pdo->prepare('SELECT 1 FROM control_conversations WHERE conversation_id=:conversation AND user_id=:user AND project_id=:project AND archived_at IS NULL');
        $q->execute(['conversation' => $conversationId, 'user' => strtolower($userId), 'project' => $projectId]);
        if ($q->fetchColumn() === false) throw new HubAutomationRegistryException('Conversation does not belong to this project and user', 'CONVERSATION_ACCESS_DENIED');
    }

    private function assertUser(string $userId): void
    {
        $userId = $this->uuid($userId, 'user');
        $q = $this->pdo->prepare('SELECT 1 FROM hub_users WHERE user_id=:user AND revoked_at IS NULL');
        $q->execute(['user' => $userId]);
        if ($q->fetchColumn() === false) throw new HubAutomationRegistryException('User is unavailable', 'USER_UNAVAILABLE');
    }

    private function uuid(mixed $value, string $field): string
    {
        if (!is_string($value) || !preg_match(self::UUID, $value)) throw new HubAutomationRegistryException("Automation {$field} identifier is invalid", 'AUTOMATION_ID_INVALID');
        return strtolower($value);
    }

    /** @param array<string,mixed> $value @param list<string> $expected */
    private static function exactKeys(array $value, array $expected, string $code): void
    {
        $keys = array_keys($value);
        sort($keys);
        $wanted = $expected;
        sort($wanted);
        if ($keys !== $wanted) throw new HubAutomationRegistryException('Automation fields are invalid', $code);
    }

    private static function text(mixed $value, int $minimum, int $maximumBytes, string $code, bool $normalizeNewlines = false): string
    {
        if (!is_string($value)) throw new HubAutomationRegistryException('Automation text field is invalid', $code);
        $value = trim($value);
        if ($normalizeNewlines) $value = str_replace(["\r\n", "\r"], "\n", $value);
        if (strlen($value) < $minimum || strlen($value) > $maximumBytes || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $value)) {
            throw new HubAutomationRegistryException('Automation text field is invalid', $code);
        }
        return $value;
    }

    private static function schedule(mixed $value, string $timingMode): string
    {
        $input = self::text($value, 1, 4096, 'AUTOMATION_SCHEDULE_INVALID', true);
        $lines = explode("\n", $input);
        if (($lines[0] ?? null) !== 'BEGIN:VEVENT' || ($lines[count($lines) - 1] ?? null) !== 'END:VEVENT' || count($lines) < 3 || count($lines) > 10) {
            throw new HubAutomationRegistryException('Automation schedule must be one bounded VEVENT', 'AUTOMATION_SCHEDULE_INVALID');
        }
        foreach ($lines as $line) if (strlen($line) > 512) throw new HubAutomationRegistryException('Automation schedule line is too long', 'AUTOMATION_SCHEDULE_INVALID');
        $body = array_slice($lines, 1, -1);
        $starts = [];
        $rules = [];
        foreach ($body as $line) {
            if (preg_match(self::DTSTART, $line)) { $starts[] = $line; continue; }
            if (preg_match(self::RRULE, $line)) { $rules[] = $line; continue; }
            throw new HubAutomationRegistryException('Automation schedule contains a forbidden field', 'AUTOMATION_SCHEDULE_FIELD_FORBIDDEN');
        }
        if (count($starts) > 1 || count($rules) > 1 || (count($starts) === 0 && count($rules) === 0)) {
            throw new HubAutomationRegistryException('Automation schedule is invalid', 'AUTOMATION_SCHEDULE_INVALID');
        }
        $rule = $rules[0] ?? null;
        if (is_string($rule)) {
            if (preg_match('/FREQ=(?:SECONDLY|MINUTELY)(?:;|$)/', $rule)) throw new HubAutomationRegistryException('Automation frequency is too high', 'AUTOMATION_FREQUENCY_TOO_HIGH');
            if (!preg_match('/FREQ=(?:HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|$)/', $rule)) throw new HubAutomationRegistryException('Automation recurrence is invalid', 'AUTOMATION_RRULE_INVALID');
        }
        if ($timingMode === 'condition_watch' && $rule === null) throw new HubAutomationRegistryException('Condition watch must be recurring', 'AUTOMATION_CONDITION_REQUIRES_RECURRENCE');
        return $input;
    }

    /** @return array<string,mixed>|null */
    private static function condition(mixed $value, string $timingMode): ?array
    {
        if ($timingMode !== 'condition_watch') {
            if ($value !== null) throw new HubAutomationRegistryException('Condition is not allowed for this timing mode', 'AUTOMATION_CONDITION_NOT_ALLOWED');
            return null;
        }
        if (!is_array($value)) throw new HubAutomationRegistryException('Condition watch requires a condition', 'AUTOMATION_CONDITION_REQUIRED');
        self::exactKeys($value, self::CONDITION_KEYS, 'AUTOMATION_FIELDS_INVALID');
        if (($value['schemaVersion'] ?? null) !== 1) throw new HubAutomationRegistryException('Condition schema is invalid', 'AUTOMATION_CONDITION_SCHEMA');
        $key = self::text($value['key'] ?? null, 3, 80, 'AUTOMATION_CONDITION_KEY_INVALID');
        if (!preg_match(self::CONDITION_KEY, $key)) throw new HubAutomationRegistryException('Condition key is invalid', 'AUTOMATION_CONDITION_KEY_INVALID');
        $description = self::text($value['description'] ?? null, 1, 500, 'AUTOMATION_CONDITION_DESCRIPTION_INVALID');
        if (preg_match(self::SECRET, $description)) throw new HubAutomationRegistryException('Condition appears to contain a secret', 'AUTOMATION_CONDITION_SECRET');
        if (preg_match(self::EXECUTABLE_CONDITION, $description)) throw new HubAutomationRegistryException('Condition contains executable-like content', 'AUTOMATION_CONDITION_EXECUTABLE_FORBIDDEN');
        return ['schemaVersion' => 1, 'key' => $key, 'description' => $description];
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private static function present(array $row): array
    {
        $condition = null;
        if (($row['timing_mode'] ?? null) === 'condition_watch') {
            $condition = ['schemaVersion' => 1, 'key' => (string) $row['condition_key'], 'description' => (string) $row['condition_description']];
        }
        return [
            'definition' => [
                'schemaVersion' => 1,
                'automationId' => (string) $row['automation_id'],
                'projectId' => (string) $row['project_id'],
                'conversationId' => is_string($row['conversation_id'] ?? null) ? $row['conversation_id'] : null,
                'name' => (string) $row['name'],
                'goal' => (string) $row['goal'],
                'timingMode' => (string) $row['timing_mode'],
                'schedule' => (string) $row['schedule_ical'],
                'condition' => $condition,
                'enabled' => (int) $row['enabled'] === 1,
            ],
            'createdAt' => (string) $row['created_at'],
            'updatedAt' => (string) $row['updated_at'],
            'archivedAt' => is_string($row['archived_at'] ?? null) ? $row['archived_at'] : null,
        ];
    }

    private static function timestamp(string $value): string
    {
        if (strtotime($value) === false) throw new HubAutomationRegistryException('Automation time is invalid', 'AUTOMATION_TIME_INVALID');
        return gmdate('c', strtotime($value));
    }

    private static function newUuid(): string
    {
        $bytes = random_bytes(16); $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }
}
