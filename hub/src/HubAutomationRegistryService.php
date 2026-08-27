<?php

declare(strict_types=1);

final class HubAutomationRegistryException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'AUTOMATION_FAILED') { parent::__construct($message); }
}

/**
 * Durable automation definitions only.
 * This service never schedules, executes, enqueues or materializes work.
 */
final class HubAutomationRegistryService
{
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';
    private const MODES = ['exact_schedule', 'flexible_schedule', 'condition_watch'];
    private const CONDITION_KEY = '/^[a-z0-9][a-z0-9._:-]{0,79}$/';

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
        $q->execute(['user' => $userId]);
        return array_map([self::class, 'present'], $q->fetchAll());
    }

    /** @return array<string,mixed> */
    public function get(string $userId, string $automationId): array
    {
        $this->assertUser($userId);
        $this->assertUuid($automationId, 'automation');
        $q = $this->pdo->prepare('SELECT * FROM control_automations WHERE automation_id=:id AND user_id=:user');
        $q->execute(['id' => $automationId, 'user' => $userId]);
        $row = $q->fetch();
        if (!is_array($row)) throw new HubAutomationRegistryException('Automation was not found', 'AUTOMATION_NOT_FOUND');
        return self::present($row);
    }

    /** @param array<string,mixed> $input @return array<string,mixed> */
    public function create(string $userId, array $input, ?string $now = null): array
    {
        $this->assertUser($userId);
        $definition = $this->validateDefinition($userId, $input);
        $id = self::uuid();
        $at = self::timestamp($now ?? gmdate('c'));
        $q = $this->pdo->prepare('INSERT INTO control_automations(automation_id,user_id,project_id,conversation_id,name,goal,timing_mode,schedule_ical,condition_key,condition_description,enabled,created_at,updated_at,archived_at) VALUES(:id,:user,:project,:conversation,:name,:goal,:mode,:schedule,:conditionKey,:conditionDescription,:enabled,:at,:at,NULL)');
        $q->execute([
            'id' => $id, 'user' => $userId, 'project' => $definition['projectId'], 'conversation' => $definition['conversationId'],
            'name' => $definition['name'], 'goal' => $definition['goal'], 'mode' => $definition['timingMode'], 'schedule' => $definition['scheduleIcal'],
            'conditionKey' => $definition['conditionKey'], 'conditionDescription' => $definition['conditionDescription'], 'enabled' => $definition['enabled'] ? 1 : 0, 'at' => $at,
        ]);
        return $this->get($userId, $id);
    }

    /** @param array<string,mixed> $input @return array<string,mixed> */
    public function replace(string $userId, string $automationId, array $input, ?string $now = null): array
    {
        $current = $this->get($userId, $automationId);
        if ($current['archivedAt'] !== null) throw new HubAutomationRegistryException('Archived automation cannot be changed', 'AUTOMATION_ARCHIVED');
        $definition = $this->validateDefinition($userId, $input);
        $at = self::timestamp($now ?? gmdate('c'));
        $q = $this->pdo->prepare('UPDATE control_automations SET project_id=:project,conversation_id=:conversation,name=:name,goal=:goal,timing_mode=:mode,schedule_ical=:schedule,condition_key=:conditionKey,condition_description=:conditionDescription,enabled=:enabled,updated_at=:at WHERE automation_id=:id AND user_id=:user AND archived_at IS NULL');
        $q->execute([
            'project' => $definition['projectId'], 'conversation' => $definition['conversationId'], 'name' => $definition['name'], 'goal' => $definition['goal'],
            'mode' => $definition['timingMode'], 'schedule' => $definition['scheduleIcal'], 'conditionKey' => $definition['conditionKey'],
            'conditionDescription' => $definition['conditionDescription'], 'enabled' => $definition['enabled'] ? 1 : 0, 'at' => $at, 'id' => $automationId, 'user' => $userId,
        ]);
        if ($q->rowCount() !== 1) throw new HubAutomationRegistryException('Automation update conflicted', 'AUTOMATION_CONFLICT');
        return $this->get($userId, $automationId);
    }

    /** @return array<string,mixed> */
    public function setEnabled(string $userId, string $automationId, bool $enabled, ?string $now = null): array
    {
        $current = $this->get($userId, $automationId);
        if ($current['archivedAt'] !== null) throw new HubAutomationRegistryException('Archived automation cannot be enabled', 'AUTOMATION_ARCHIVED');
        $at = self::timestamp($now ?? gmdate('c'));
        $q = $this->pdo->prepare('UPDATE control_automations SET enabled=:enabled,updated_at=:at WHERE automation_id=:id AND user_id=:user AND archived_at IS NULL');
        $q->execute(['enabled' => $enabled ? 1 : 0, 'at' => $at, 'id' => $automationId, 'user' => $userId]);
        if ($q->rowCount() !== 1) throw new HubAutomationRegistryException('Automation update conflicted', 'AUTOMATION_CONFLICT');
        return $this->get($userId, $automationId);
    }

    /** @return array<string,mixed> */
    public function archive(string $userId, string $automationId, ?string $now = null): array
    {
        $current = $this->get($userId, $automationId);
        if ($current['archivedAt'] !== null) return $current;
        $at = self::timestamp($now ?? gmdate('c'));
        $q = $this->pdo->prepare('UPDATE control_automations SET enabled=0,archived_at=:at,updated_at=:at WHERE automation_id=:id AND user_id=:user AND archived_at IS NULL');
        $q->execute(['at' => $at, 'id' => $automationId, 'user' => $userId]);
        if ($q->rowCount() !== 1) throw new HubAutomationRegistryException('Automation archive conflicted', 'AUTOMATION_CONFLICT');
        return $this->get($userId, $automationId);
    }

    /** @param array<string,mixed> $input @return array<string,mixed> */
    private function validateDefinition(string $userId, array $input): array
    {
        $projectId = self::text($input['projectId'] ?? null, 36, 'projectId');
        $this->assertUuid($projectId, 'project');
        $this->assertProjectAccess($userId, $projectId);
        $conversationId = $input['conversationId'] ?? null;
        if ($conversationId !== null && $conversationId !== '') {
            $conversationId = self::text($conversationId, 36, 'conversationId');
            $this->assertUuid($conversationId, 'conversation');
            $this->assertConversation($userId, $projectId, $conversationId);
        } else $conversationId = null;

        $name = self::text($input['name'] ?? null, 120, 'name');
        $goal = self::text($input['goal'] ?? null, 2000, 'goal');
        $mode = self::text($input['timingMode'] ?? null, 32, 'timingMode');
        if (!in_array($mode, self::MODES, true)) throw new HubAutomationRegistryException('Automation timing mode is invalid', 'AUTOMATION_TIMING_INVALID');
        $schedule = self::normalizeSchedule(self::text($input['scheduleIcal'] ?? null, 4096, 'scheduleIcal'));
        $this->assertSchedule($schedule, $mode);

        $conditionKey = null;
        $conditionDescription = null;
        if ($mode === 'condition_watch') {
            $conditionKey = strtolower(self::text($input['conditionKey'] ?? null, 80, 'conditionKey'));
            if (!preg_match(self::CONDITION_KEY, $conditionKey)) throw new HubAutomationRegistryException('Automation condition key is invalid', 'AUTOMATION_CONDITION_INVALID');
            $conditionDescription = self::text($input['conditionDescription'] ?? null, 500, 'conditionDescription');
        } elseif (($input['conditionKey'] ?? null) !== null || ($input['conditionDescription'] ?? null) !== null) {
            throw new HubAutomationRegistryException('Only condition-watch automations may define a condition', 'AUTOMATION_CONDITION_INVALID');
        }

        $enabled = array_key_exists('enabled', $input) ? filter_var($input['enabled'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) : true;
        if (!is_bool($enabled)) throw new HubAutomationRegistryException('Automation enabled state is invalid', 'AUTOMATION_ENABLED_INVALID');
        return compact('projectId','conversationId','name','goal','mode','schedule','conditionKey','conditionDescription','enabled') + ['timingMode' => $mode, 'scheduleIcal' => $schedule];
    }

    private function assertProjectAccess(string $userId, string $projectId): void
    {
        $q = $this->pdo->prepare('SELECT 1 FROM user_project_memberships WHERE user_id=:user AND project_id=:project AND revoked_at IS NULL');
        $q->execute(['user' => $userId, 'project' => $projectId]);
        if ($q->fetchColumn() === false) throw new HubAutomationRegistryException('Project is not available to this user', 'PROJECT_ACCESS_DENIED');
    }

    private function assertConversation(string $userId, string $projectId, string $conversationId): void
    {
        $q = $this->pdo->prepare('SELECT 1 FROM control_conversations WHERE conversation_id=:conversation AND user_id=:user AND project_id=:project AND archived_at IS NULL');
        $q->execute(['conversation' => $conversationId, 'user' => $userId, 'project' => $projectId]);
        if ($q->fetchColumn() === false) throw new HubAutomationRegistryException('Conversation does not belong to this project and user', 'CONVERSATION_ACCESS_DENIED');
    }

    private function assertUser(string $userId): void
    {
        $this->assertUuid($userId, 'user');
        $q = $this->pdo->prepare('SELECT 1 FROM hub_users WHERE user_id=:user AND revoked_at IS NULL');
        $q->execute(['user' => $userId]);
        if ($q->fetchColumn() === false) throw new HubAutomationRegistryException('User is unavailable', 'USER_UNAVAILABLE');
    }

    private function assertUuid(string $value, string $field): void
    {
        if (!preg_match(self::UUID, $value)) throw new HubAutomationRegistryException("Automation {$field} identifier is invalid", 'AUTOMATION_ID_INVALID');
    }

    private function assertSchedule(string $schedule, string $mode): void
    {
        if (!str_starts_with($schedule, "BEGIN:VEVENT\n") || !str_ends_with($schedule, "\nEND:VEVENT")) throw new HubAutomationRegistryException('Automation schedule must be one VEVENT', 'AUTOMATION_SCHEDULE_INVALID');
        if (preg_match('/^(?:SUMMARY|DTEND):/m', $schedule)) throw new HubAutomationRegistryException('Automation schedule contains unsupported VEVENT fields', 'AUTOMATION_SCHEDULE_INVALID');
        $hasStart = preg_match('/^DTSTART(?:;[^:]*)?:[^\r\n]+$/m', $schedule) === 1;
        $hasRule = preg_match('/^RRULE:FREQ=(?:HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)(?:;[^\r\n]+)?$/m', $schedule) === 1;
        if (!$hasStart && !$hasRule) throw new HubAutomationRegistryException('Automation schedule needs DTSTART or RRULE', 'AUTOMATION_SCHEDULE_INVALID');
        if ($mode === 'condition_watch' && !$hasRule) throw new HubAutomationRegistryException('Condition watch must be recurring', 'AUTOMATION_SCHEDULE_INVALID');
    }

    private static function normalizeSchedule(string $schedule): string
    {
        $schedule = str_replace(["\r\n", "\r"], "\n", trim($schedule));
        if (str_contains($schedule, "\0")) throw new HubAutomationRegistryException('Automation schedule is invalid', 'AUTOMATION_SCHEDULE_INVALID');
        return $schedule;
    }

    private static function text(mixed $value, int $maximum, string $field): string
    {
        if (!is_string($value)) throw new HubAutomationRegistryException("Automation {$field} is required", 'AUTOMATION_INPUT_INVALID');
        $value = trim($value);
        $length = function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
        if ($value === '' || $length > $maximum || str_contains($value, "\0")) throw new HubAutomationRegistryException("Automation {$field} is invalid", 'AUTOMATION_INPUT_INVALID');
        return $value;
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private static function present(array $row): array
    {
        return [
            'automationId' => (string) $row['automation_id'], 'projectId' => (string) $row['project_id'],
            'conversationId' => is_string($row['conversation_id'] ?? null) ? $row['conversation_id'] : null,
            'name' => (string) $row['name'], 'goal' => (string) $row['goal'], 'timingMode' => (string) $row['timing_mode'],
            'scheduleIcal' => (string) $row['schedule_ical'], 'conditionKey' => is_string($row['condition_key'] ?? null) ? $row['condition_key'] : null,
            'conditionDescription' => is_string($row['condition_description'] ?? null) ? $row['condition_description'] : null,
            'enabled' => (int) $row['enabled'] === 1, 'createdAt' => (string) $row['created_at'], 'updatedAt' => (string) $row['updated_at'],
            'archivedAt' => is_string($row['archived_at'] ?? null) ? $row['archived_at'] : null,
        ];
    }

    private static function timestamp(string $value): string
    {
        if (strtotime($value) === false) throw new HubAutomationRegistryException('Automation time is invalid', 'AUTOMATION_TIME_INVALID');
        return gmdate('c', strtotime($value));
    }

    private static function uuid(): string
    {
        $bytes = random_bytes(16); $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }
}
