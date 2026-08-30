<?php

declare(strict_types=1);

/**
 * Read-only classification over canonical failed/waiting executions.
 *
 * This service never retries, deletes, rewrites or hides audit history. It is
 * shared by the Staff artifact and Owner projection so those surfaces cannot
 * drift into competing interpretations of the same execution rows.
 */
final class HubExecutionTriageService
{
    private const MAX_ITEMS = 100;
    private const RETRYABLE_CODES = ['PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_FAILED', 'LEASE_EXPIRED', 'DATABASE_BUSY'];

    public function __construct(private readonly PDO $pdo) {}

    /** @return array<string,mixed> */
    public function snapshot(?string $now = null, int $limit = self::MAX_ITEMS): array
    {
        if ($limit < 1 || $limit > self::MAX_ITEMS) return self::unknown('TRIAGE_LIMIT_INVALID');
        $reference = strtotime($now ?? 'now');
        if ($reference === false) return self::unknown('TRIAGE_TIME_INVALID');
        try {
            $query = $this->pdo->query("SELECT e.execution_id,e.task_id,e.state,e.required_capability,e.attempt_count,e.last_error_code,e.updated_at,t.goal,p.name AS project_name FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id JOIN projects p ON p.project_id=t.project_id WHERE e.state IN ('FAILED','WAITING_FOR_CAPABILITY') ORDER BY e.updated_at DESC,e.execution_id LIMIT " . ($limit + 1));
            $rows = $query === false ? [] : $query->fetchAll();
        } catch (Throwable) {
            return self::unknown('TRIAGE_UNAVAILABLE');
        }

        $bounded = count($rows) > $limit;
        $rows = array_slice($rows, 0, $limit);
        $summary = ['historicalExpected'=>0, 'obsoleteStale'=>0, 'retryable'=>0, 'blockedCapability'=>0, 'currentDefect'=>0];
        $items = [];
        foreach ($rows as $row) {
            if (!is_array($row)) continue;
            $state = (string) ($row['state'] ?? 'FAILED');
            $code = (string) ($row['last_error_code'] ?? 'EXECUTION_FAILED');
            $attempts = max(0, (int) ($row['attempt_count'] ?? 0));
            $updated = strtotime((string) ($row['updated_at'] ?? ''));
            $ageSeconds = $updated === false ? null : max(0, $reference - $updated);
            $goal = (string) ($row['goal'] ?? '');
            if ($state === 'WAITING_FOR_CAPABILITY') {
                $classification = 'BLOCKED_CAPABILITY'; $summary['blockedCapability']++; $reason = 'รอ provider/worker/capability; ไม่ blind retry';
            } elseif (preg_match('/(?:field proof|fixture|expected failure|negative test|ทดสอบ|หลักฐานภาคสนาม)/iu', $goal) === 1) {
                $classification = 'HISTORICAL_EXPECTED'; $summary['historicalExpected']++; $reason = 'goal ระบุ test/field-proof evidence; เก็บไว้เป็น audit';
            } elseif (in_array($code, self::RETRYABLE_CODES, true) && $attempts < 3) {
                $classification = 'RETRYABLE'; $summary['retryable']++; $reason = 'transient code และยังไม่ถึง bounded retry limit';
            } elseif ($ageSeconds !== null && $ageSeconds >= 604800) {
                $classification = 'OBSOLETE_STALE'; $summary['obsoleteStale']++; $reason = 'terminal เกิน 7 วัน; ต้อง review ก่อน retry';
            } else {
                $classification = 'CURRENT_DEFECT'; $summary['currentDefect']++; $reason = 'ยังไม่มีหลักฐานว่า obsolete หรือ retry-safe';
            }
            $items[] = [
                'executionId'=>(string) ($row['execution_id'] ?? ''),
                'taskId'=>(string) ($row['task_id'] ?? ''),
                'project'=>(string) ($row['project_name'] ?? 'Project'),
                'state'=>$state,
                'requiredCapability'=>(string) ($row['required_capability'] ?? 'UNKNOWN'),
                'errorCode'=>$code,
                'attemptCount'=>$attempts,
                'updatedAt'=>(string) ($row['updated_at'] ?? ''),
                'ageSeconds'=>$ageSeconds,
                'classification'=>$classification,
                'reason'=>$reason,
            ];
        }
        return [
            'schemaVersion'=>1,
            'state'=>$items === [] ? 'CLEAR' : 'TRIAGED',
            'observedAt'=>gmdate('c', $reference),
            'summary'=>$summary,
            'total'=>count($items),
            'items'=>$items,
            'bounded'=>$bounded,
            'policyVersion'=>'execution-triage-v1',
            'auditHistoryPreserved'=>true,
            'blindRetry'=>false,
            'nextAction'=>$summary['currentDefect'] > 0 ? 'ตรวจ current defect ก่อนเลือก bounded retry' : ($summary['retryable'] > 0 ? 'ให้ canonical retry policy พิจารณาใน tick ถัดไป' : 'คง blocker/history ตามหลักฐาน'),
        ];
    }

    /** @return array<string,mixed> */
    private static function unknown(string $reason): array
    {
        return ['schemaVersion'=>1,'state'=>'UNKNOWN','observedAt'=>null,'summary'=>['historicalExpected'=>0,'obsoleteStale'=>0,'retryable'=>0,'blockedCapability'=>0,'currentDefect'=>0],'total'=>0,'items'=>[],'bounded'=>true,'policyVersion'=>'execution-triage-v1','auditHistoryPreserved'=>true,'blindRetry'=>false,'reason'=>$reason,'nextAction'=>'ตรวจ canonical execution schema/read authority'];
    }
}
