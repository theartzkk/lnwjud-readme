<?php

declare(strict_types=1);

require_once __DIR__ . '/HubAutomationRegistryService.php';

final class HubAutomationSchedulerException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'AUTOMATION_SCHEDULER_FAILED') { parent::__construct($message); }
}

/**
 * Computes bounded automation occurrences and delegates materialization to the
 * canonical Work authority supplied by the caller. It never inserts tasks,
 * messages, executions, approvals or artifacts itself.
 */
final class HubAutomationSchedulerService
{
    private const CONDITION_KEYS = ['project.task.failed', 'project.approval.pending', 'project.worker.offline'];
    private const MAX_DEFINITIONS = 500;
    private const MAX_STEPS = 20000;

    /** @var Closure(string,array<string,mixed>,string):array<string,mixed> */
    private readonly Closure $materialize;
    private readonly HubAutomationRegistryService $registry;

    /** @param callable(string,array<string,mixed>,string):array<string,mixed> $materialize */
    public function __construct(private readonly PDO $pdo, callable $materialize)
    {
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->pdo->exec('PRAGMA foreign_keys = ON');
        $this->registry = new HubAutomationRegistryService($pdo);
        $this->materialize = Closure::fromCallable($materialize);
    }

    /** @return array{schemaVersion:int,checked:int,due:int,materialized:int,conditionFalse:int,unsupported:int,errors:int} */
    public function tick(?string $now = null): array
    {
        $nowAt = self::time($now ?? gmdate('c'));
        $q = $this->pdo->query('SELECT automation_id,user_id FROM control_automations WHERE enabled=1 AND archived_at IS NULL ORDER BY updated_at,automation_id LIMIT ' . self::MAX_DEFINITIONS);
        $summary = ['schemaVersion'=>1,'checked'=>0,'due'=>0,'materialized'=>0,'conditionFalse'=>0,'unsupported'=>0,'errors'=>0];
        foreach ($q->fetchAll() as $row) {
            $summary['checked']++;
            try {
                $record = $this->registry->get((string)$row['user_id'], (string)$row['automation_id']);
                $definition = $record['definition'] ?? null;
                if (!is_array($definition) || ($definition['enabled'] ?? false) !== true) continue;
                $occurrence = $this->latestDueOccurrence($record, $nowAt);
                if ($occurrence === null) continue;
                $summary['due']++;
                if (($definition['timingMode'] ?? null) === 'condition_watch') {
                    $condition = $definition['condition'] ?? null;
                    $key = is_array($condition) && is_string($condition['key'] ?? null) ? $condition['key'] : '';
                    if (!in_array($key, self::CONDITION_KEYS, true)) { $summary['unsupported']++; continue; }
                    if (!$this->conditionTrue((string)$row['user_id'], $definition, $key, $occurrence, $nowAt)) { $summary['conditionFalse']++; continue; }
                }
                ($this->materialize)((string)$row['user_id'], $definition, $occurrence->format('c'));
                $summary['materialized']++;
            } catch (Throwable) {
                $summary['errors']++;
            }
        }
        return $summary;
    }

    /** @param array<string,mixed> $record */
    private function latestDueOccurrence(array $record, DateTimeImmutable $now): ?DateTimeImmutable
    {
        $definition = $record['definition'] ?? null;
        if (!is_array($definition) || !is_string($definition['schedule'] ?? null)) return null;
        $created = self::time((string)($record['createdAt'] ?? ''));
        $updated = self::time((string)($record['updatedAt'] ?? ''));
        $eligibleFrom = $updated > $created ? $updated : $created;
        [$start, $rule] = self::parseSchedule($definition['schedule'], $created);
        if ($rule === null) return $start <= $now && $start >= $eligibleFrom ? $start : null;
        return self::latestRecurring($start, $rule, $eligibleFrom, $now);
    }

    /** @return array{0:DateTimeImmutable,1:?array<string,string>} */
    private static function parseSchedule(string $schedule, DateTimeImmutable $fallback): array
    {
        $lines = preg_split('/\r?\n/', trim($schedule));
        if (!is_array($lines) || ($lines[0] ?? '') !== 'BEGIN:VEVENT' || ($lines[count($lines)-1] ?? '') !== 'END:VEVENT') throw new HubAutomationSchedulerException('Automation schedule is invalid', 'AUTOMATION_SCHEDULE_INVALID');
        $start = null; $rule = null;
        foreach (array_slice($lines, 1, -1) as $line) {
            if (str_starts_with($line, 'DTSTART')) { $start = self::parseDtStart($line); continue; }
            if (str_starts_with($line, 'RRULE:')) { $rule = self::parseRule(substr($line, 6)); continue; }
            throw new HubAutomationSchedulerException('Automation schedule field is unsupported', 'AUTOMATION_SCHEDULE_UNSUPPORTED');
        }
        return [$start ?? $fallback, $rule];
    }

    private static function parseDtStart(string $line): DateTimeImmutable
    {
        if (preg_match('/^DTSTART(?:;TZID=([A-Za-z0-9_+\/-]{1,64}))?:(\d{8}T\d{6})$/', $line, $m) !== 1) throw new HubAutomationSchedulerException('Automation DTSTART is invalid', 'AUTOMATION_SCHEDULE_INVALID');
        try { $zone = new DateTimeZone(($m[1] ?? '') !== '' ? $m[1] : 'UTC'); } catch (Throwable) { throw new HubAutomationSchedulerException('Automation timezone is invalid', 'AUTOMATION_TIMEZONE_INVALID'); }
        $value = DateTimeImmutable::createFromFormat('!Ymd\THis', $m[2], $zone);
        if (!$value) throw new HubAutomationSchedulerException('Automation DTSTART is invalid', 'AUTOMATION_SCHEDULE_INVALID');
        return $value;
    }

    /** @return array<string,string> */
    private static function parseRule(string $raw): array
    {
        $allowed = ['FREQ','INTERVAL','COUNT','UNTIL','BYHOUR','BYMINUTE','BYSECOND','BYDAY'];
        $out = [];
        foreach (explode(';', $raw) as $part) {
            $pair = explode('=', $part, 2);
            if (count($pair) !== 2 || !in_array($pair[0], $allowed, true) || isset($out[$pair[0]]) || $pair[1] === '') throw new HubAutomationSchedulerException('Automation RRULE is unsupported', 'AUTOMATION_RRULE_UNSUPPORTED');
            $out[$pair[0]] = $pair[1];
        }
        if (!isset($out['FREQ']) || !in_array($out['FREQ'], ['HOURLY','DAILY','WEEKLY','MONTHLY','YEARLY'], true)) throw new HubAutomationSchedulerException('Automation RRULE frequency is invalid', 'AUTOMATION_RRULE_UNSUPPORTED');
        $interval = isset($out['INTERVAL']) ? filter_var($out['INTERVAL'], FILTER_VALIDATE_INT, ['options'=>['min_range'=>1,'max_range'=>365]]) : 1;
        if (!is_int($interval)) throw new HubAutomationSchedulerException('Automation RRULE interval is invalid', 'AUTOMATION_RRULE_UNSUPPORTED');
        $out['INTERVAL'] = (string)$interval;
        foreach (['BYHOUR'=>[0,23],'BYMINUTE'=>[0,59],'BYSECOND'=>[0,59]] as $key=>$range) if (isset($out[$key])) {
            $value = filter_var($out[$key], FILTER_VALIDATE_INT, ['options'=>['min_range'=>$range[0],'max_range'=>$range[1]]]);
            if (!is_int($value)) throw new HubAutomationSchedulerException('Automation RRULE clock field is invalid', 'AUTOMATION_RRULE_UNSUPPORTED');
            $out[$key] = (string)$value;
        }
        if (isset($out['BYDAY']) && preg_match('/^(MO|TU|WE|TH|FR|SA|SU)$/', $out['BYDAY']) !== 1) throw new HubAutomationSchedulerException('Automation BYDAY is unsupported', 'AUTOMATION_RRULE_UNSUPPORTED');
        if (isset($out['COUNT'])) { $count = filter_var($out['COUNT'], FILTER_VALIDATE_INT, ['options'=>['min_range'=>1,'max_range'=>100000]]); if (!is_int($count)) throw new HubAutomationSchedulerException('Automation COUNT is invalid', 'AUTOMATION_RRULE_UNSUPPORTED'); $out['COUNT']=(string)$count; }
        if (isset($out['UNTIL']) && preg_match('/^\d{8}T\d{6}Z$/', $out['UNTIL']) !== 1) throw new HubAutomationSchedulerException('Automation UNTIL is unsupported', 'AUTOMATION_RRULE_UNSUPPORTED');
        return $out;
    }

    /** @param array<string,string> $rule */
    private static function latestRecurring(DateTimeImmutable $start, array $rule, DateTimeImmutable $eligibleFrom, DateTimeImmutable $now): ?DateTimeImmutable
    {
        $candidate = self::applyClock($start, $rule);
        if (isset($rule['BYDAY'])) $candidate = self::alignWeekday($candidate, $rule['BYDAY']);
        $count = 0; $latest = null; $limit = isset($rule['COUNT']) ? (int)$rule['COUNT'] : PHP_INT_MAX;
        $until = isset($rule['UNTIL']) ? self::time(DateTimeImmutable::createFromFormat('!Ymd\THis\Z', $rule['UNTIL'], new DateTimeZone('UTC'))?->format('c') ?? '') : null;
        while ($count < $limit && $count < self::MAX_STEPS && $candidate <= $now) {
            $count++;
            if (($until === null || $candidate <= $until) && $candidate >= $eligibleFrom) $latest = $candidate;
            $candidate = self::advance($candidate, $rule['FREQ'], (int)$rule['INTERVAL']);
            if (isset($rule['BYDAY'])) $candidate = self::alignWeekday($candidate, $rule['BYDAY']);
            $candidate = self::applyClock($candidate, $rule);
        }
        if ($count >= self::MAX_STEPS && $candidate <= $now) throw new HubAutomationSchedulerException('Automation recurrence exceeds the safe evaluation bound', 'AUTOMATION_RRULE_TOO_LARGE');
        return $latest;
    }

    /** @param array<string,string> $rule */
    private static function applyClock(DateTimeImmutable $value, array $rule): DateTimeImmutable
    {
        return $value->setTime(isset($rule['BYHOUR']) ? (int)$rule['BYHOUR'] : (int)$value->format('H'), isset($rule['BYMINUTE']) ? (int)$rule['BYMINUTE'] : (int)$value->format('i'), isset($rule['BYSECOND']) ? (int)$rule['BYSECOND'] : (int)$value->format('s'));
    }

    private static function alignWeekday(DateTimeImmutable $value, string $day): DateTimeImmutable
    {
        $map=['MO'=>1,'TU'=>2,'WE'=>3,'TH'=>4,'FR'=>5,'SA'=>6,'SU'=>7]; $target=$map[$day]; $current=(int)$value->format('N'); $delta=($target-$current+7)%7;
        return $delta === 0 ? $value : $value->modify('+' . $delta . ' days');
    }

    private static function advance(DateTimeImmutable $value, string $freq, int $interval): DateTimeImmutable
    {
        return match($freq) {
            'HOURLY'=>$value->modify("+{$interval} hours"), 'DAILY'=>$value->modify("+{$interval} days"), 'WEEKLY'=>$value->modify("+{$interval} weeks"),
            'MONTHLY'=>$value->modify("+{$interval} months"), 'YEARLY'=>$value->modify("+{$interval} years"),
            default=>throw new HubAutomationSchedulerException('Automation frequency is unsupported', 'AUTOMATION_RRULE_UNSUPPORTED'),
        };
    }

    /** @param array<string,mixed> $definition */
    private function conditionTrue(string $userId, array $definition, string $key, DateTimeImmutable $occurrence, DateTimeImmutable $now): bool
    {
        $projectId = (string)($definition['projectId'] ?? '');
        if ($key === 'project.task.failed') {
            $q=$this->pdo->prepare("SELECT 1 FROM control_tasks WHERE user_id=:user AND project_id=:project AND state='FAILED' AND updated_at>=:since AND updated_at<=:now LIMIT 1");
            $q->execute(['user'=>$userId,'project'=>$projectId,'since'=>$occurrence->modify('-1 hour')->format('c'),'now'=>$now->format('c')]); return $q->fetchColumn() !== false;
        }
        if ($key === 'project.approval.pending') {
            $q=$this->pdo->prepare("SELECT 1 FROM control_approvals a JOIN control_tasks t ON t.task_id=a.task_id WHERE t.user_id=:user AND t.project_id=:project AND a.status='PENDING' AND a.expires_at>:now LIMIT 1");
            $q->execute(['user'=>$userId,'project'=>$projectId,'now'=>$now->format('c')]); return $q->fetchColumn() !== false;
        }
        if ($key === 'project.worker.offline') {
            $q=$this->pdo->prepare("SELECT 1 FROM device_project_memberships dpm JOIN control_workers w ON w.device_id=dpm.device_id JOIN devices d ON d.device_id=w.device_id WHERE dpm.project_id=:project AND dpm.revoked_at IS NULL AND d.revoked_at IS NULL AND w.last_seen_at>=:fresh LIMIT 1");
            $q->execute(['project'=>$projectId,'fresh'=>$now->modify('-2 minutes')->format('c')]); return $q->fetchColumn() === false;
        }
        return false;
    }

    private static function time(string $value): DateTimeImmutable
    {
        try { return (new DateTimeImmutable($value))->setTimezone(new DateTimeZone('UTC')); } catch (Throwable) { throw new HubAutomationSchedulerException('Automation time is invalid', 'AUTOMATION_TIME_INVALID'); }
    }
}
