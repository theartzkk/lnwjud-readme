<?php

declare(strict_types=1);

/**
 * One bounded failure policy shared by executor and read-only triage.
 *
 * The policy never creates another task/execution queue. It only decides what
 * the existing canonical execution may do next and, for automatic retries,
 * produces a bounded not-before timestamp that can be stored inside the
 * execution's existing checkpoint_json.
 */
final class HubExecutionFailurePolicy
{
    public const VERSION = 'execution-failure-v1';
    public const MAX_RETRY_AFTER_SECONDS = 3600;
    private const DEFAULT_MAX_ATTEMPTS = 3;

    /** @var list<string> */
    private const RETRY_THEN_WAIT = [
        'PROVIDER_RATE_LIMITED',
        'PROVIDER_UNAVAILABLE',
        'PROVIDER_FAILED',
        'PROVIDER_USAGE_PERSIST_FAILED',
        'DATABASE_BUSY',
    ];

    /** @var list<string> */
    private const RETRY_THEN_FAIL = [
        'LEASE_EXPIRED',
        'EXECUTION_FAILED',
        'EXECUTION_CLAIM_FAILED',
        'ARTIFACT_STORAGE_FAILED',
    ];

    /** @var list<string> */
    private const CAPABILITY_WAIT = [
        'WAITING_FOR_CAPABILITY',
        'PROJECT_VAULT_EMPTY',
        'BUDGET_EXHAUSTED',
        'PROVIDER_QUOTA_EXHAUSTED',
        'TASK_WORKSPACE_UNAVAILABLE',
        'ARTIFACT_STORAGE_UNAVAILABLE',
        'IMAGE_INPUT_RUNTIME_UNAVAILABLE',
        'PROVIDER_PRICING_UNAVAILABLE',
    ];

    /** @var list<string> */
    private const AUTH_REQUIRED = [
        'PROVIDER_AUTH_FAILED',
        'PROVIDER_CREDENTIAL_STATE_UNCERTAIN',
    ];

    /** @var list<string> */
    private const EXTERNAL_POLICY = [
        'PROVIDER_PERMISSION_DENIED',
        'PROVIDER_MODEL_UNAVAILABLE',
        'PROVIDER_POLICY_INVALID',
    ];

    /** @var list<string> */
    private const TERMINAL_DEFECT = [
        'PROVIDER_REQUEST_INVALID',
        'CANDIDATE_SECRET_CONTENT',
        'CANDIDATE_QA_FAILED',
        'EXECUTION_INVALID',
        'PROJECT_CONTEXT_FORBIDDEN',
        'ATTACHMENT_AI_INPUT_TOO_LARGE',
    ];

    /** @return array{category:string,state:string,automaticRetry:bool,retryable:bool,delaySeconds:?int,retryAfterSeconds:?int,nextEligibleAt:?string,reason:string,policyVersion:string} */
    public static function decide(string $code, int $attemptNumber, array $diagnostic, string $at, int $maxAttempts = self::DEFAULT_MAX_ATTEMPTS, ?string $seed = null): array
    {
        $attemptNumber = max(1, $attemptNumber);
        $maxAttempts = max(1, min(10, $maxAttempts));
        $timestamp = strtotime($at);
        if ($timestamp === false) return self::terminal('TERMINAL_DEFECT', 'FAILED', 'failure-policy-time-invalid');

        if (in_array($code, self::AUTH_REQUIRED, true)) return self::terminal('AUTH_REQUIRED', 'FAILED', 'owner/provider authentication must be repaired before a new attempt');
        if (in_array($code, self::EXTERNAL_POLICY, true)) return self::terminal('EXTERNAL_POLICY', 'FAILED', 'provider/account policy must change before a new attempt');
        if (in_array($code, self::CAPABILITY_WAIT, true)) return self::terminal('CAPABILITY_WAIT', 'WAITING_FOR_CAPABILITY', 'work is preserved until the required capability, quota, budget, or storage becomes available');
        if (in_array($code, self::TERMINAL_DEFECT, true)) return self::terminal('TERMINAL_DEFECT', 'FAILED', 'request or candidate is not safe to retry automatically');

        $retryThenWait = in_array($code, self::RETRY_THEN_WAIT, true);
        $retryThenFail = in_array($code, self::RETRY_THEN_FAIL, true);
        if (!$retryThenWait && !$retryThenFail) return self::terminal('TERMINAL_DEFECT', 'FAILED', 'unclassified failure is never blind-retried');

        if ($attemptNumber >= $maxAttempts) {
            return self::terminal(
                $retryThenWait ? 'CAPABILITY_WAIT' : 'TERMINAL_DEFECT',
                $retryThenWait ? 'WAITING_FOR_CAPABILITY' : 'FAILED',
                $retryThenWait ? 'bounded automatic retry limit reached; work is preserved for capability recovery' : 'bounded automatic retry limit reached'
            );
        }

        $base = self::baseDelaySeconds($code, $attemptNumber);
        $retryAfter = self::retryAfterSeconds($diagnostic['retryAfterSeconds'] ?? null);
        $notBefore = max($base, $retryAfter ?? 0);
        $jitter = self::deterministicJitter($notBefore, $seed, $code, $attemptNumber);
        $delay = min(self::MAX_RETRY_AFTER_SECONDS, $notBefore + $jitter);
        $next = gmdate('c', $timestamp + $delay);
        return [
            'category' => 'TRANSIENT',
            'state' => 'QUEUED',
            'automaticRetry' => true,
            'retryable' => true,
            'delaySeconds' => $delay,
            'retryAfterSeconds' => $retryAfter,
            'nextEligibleAt' => $next,
            'reason' => $retryAfter !== null && $retryAfter > $base ? 'provider retry-after respected with bounded jitter' : 'bounded transient backoff with deterministic jitter',
            'policyVersion' => self::VERSION,
        ];
    }

    /** @param array<string,mixed> $row */
    public static function eligible(array $row, string $now, int $maxAttempts = self::DEFAULT_MAX_ATTEMPTS): bool
    {
        $code = is_string($row['last_error_code'] ?? null) ? (string) $row['last_error_code'] : '';
        if ($code === '') return true;
        $current = strtotime($now);
        if ($current === false) return false;

        $persisted = self::persistedSchedule((string) ($row['checkpoint_json'] ?? ''), $code);
        if ($persisted !== null) return $current >= $persisted;

        $updatedAt = (string) ($row['updated_at'] ?? '');
        $attempts = max(1, (int) ($row['attempt_count'] ?? 0));
        $decision = self::decide($code, $attempts, [], $updatedAt, $maxAttempts, is_string($row['execution_id'] ?? null) ? (string) $row['execution_id'] : null);
        $next = is_string($decision['nextEligibleAt']) ? strtotime($decision['nextEligibleAt']) : false;
        return $decision['state'] === 'QUEUED' && $next !== false && $current >= $next;
    }

    /** @param array<string,mixed> $decision */
    public static function checkpointWithDecision(string $checkpointJson, string $code, array $decision): string
    {
        $checkpoint = json_decode($checkpointJson, true, 64);
        if (!is_array($checkpoint)) $checkpoint = [];
        unset($checkpoint['_executionPolicy']);
        if (($decision['state'] ?? null) === 'QUEUED' && is_string($decision['nextEligibleAt'] ?? null)) {
            $policy = [
                'version' => self::VERSION,
                'code' => $code,
                'category' => (string) ($decision['category'] ?? 'TRANSIENT'),
                'nextEligibleAt' => (string) $decision['nextEligibleAt'],
                'delaySeconds' => max(1, min(self::MAX_RETRY_AFTER_SECONDS, (int) ($decision['delaySeconds'] ?? 1))),
            ];
            if (is_int($decision['retryAfterSeconds'] ?? null)) $policy['retryAfterSeconds'] = $decision['retryAfterSeconds'];
            $checkpoint['_executionPolicy'] = $policy;
        }
        return json_encode($checkpoint, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    public static function retryAfterSeconds(mixed $value): ?int
    {
        if (is_int($value)) return $value >= 1 ? min(self::MAX_RETRY_AFTER_SECONDS, $value) : null;
        if (!is_string($value)) return null;
        $value = trim($value);
        if ($value === '' || preg_match('/^[0-9]{1,10}$/', $value) !== 1) return null;
        $seconds = (int) $value;
        return $seconds >= 1 ? min(self::MAX_RETRY_AFTER_SECONDS, $seconds) : null;
    }

    public static function category(string $code): string
    {
        if (in_array($code, self::AUTH_REQUIRED, true)) return 'AUTH_REQUIRED';
        if (in_array($code, self::EXTERNAL_POLICY, true)) return 'EXTERNAL_POLICY';
        if (in_array($code, self::CAPABILITY_WAIT, true)) return 'CAPABILITY_WAIT';
        if (in_array($code, self::RETRY_THEN_WAIT, true) || in_array($code, self::RETRY_THEN_FAIL, true)) return 'TRANSIENT';
        return 'TERMINAL_DEFECT';
    }

    /** @return array{category:string,state:string,automaticRetry:bool,retryable:bool,delaySeconds:?int,retryAfterSeconds:?int,nextEligibleAt:?string,reason:string,policyVersion:string} */
    private static function terminal(string $category, string $state, string $reason): array
    {
        return ['category'=>$category,'state'=>$state,'automaticRetry'=>false,'retryable'=>false,'delaySeconds'=>null,'retryAfterSeconds'=>null,'nextEligibleAt'=>null,'reason'=>$reason,'policyVersion'=>self::VERSION];
    }

    private static function baseDelaySeconds(string $code, int $attempt): int
    {
        return match ($code) {
            'PROVIDER_RATE_LIMITED' => $attempt <= 1 ? 30 : 120,
            'PROVIDER_UNAVAILABLE', 'PROVIDER_FAILED', 'PROVIDER_USAGE_PERSIST_FAILED', 'LEASE_EXPIRED' => $attempt <= 1 ? 60 : 300,
            'DATABASE_BUSY', 'EXECUTION_CLAIM_FAILED', 'ARTIFACT_STORAGE_FAILED', 'EXECUTION_FAILED' => $attempt <= 1 ? 15 : 60,
            default => 60,
        };
    }

    private static function deterministicJitter(int $base, ?string $seed, string $code, int $attempt): int
    {
        if (!is_string($seed) || $seed === '') return 0;
        $window = min(30, max(1, (int) ceil($base * 0.10)));
        $hash = hash('sha256', $seed . '|' . $code . '|' . $attempt);
        return hexdec(substr($hash, 0, 8)) % ($window + 1);
    }

    private static function persistedSchedule(string $checkpointJson, string $code): ?int
    {
        $checkpoint = json_decode($checkpointJson, true, 64);
        $policy = is_array($checkpoint) && is_array($checkpoint['_executionPolicy'] ?? null) ? $checkpoint['_executionPolicy'] : null;
        if (!is_array($policy) || ($policy['version'] ?? null) !== self::VERSION || ($policy['code'] ?? null) !== $code || !is_string($policy['nextEligibleAt'] ?? null)) return null;
        $timestamp = strtotime((string) $policy['nextEligibleAt']);
        return $timestamp === false ? null : $timestamp;
    }
}

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

    public function __construct(private readonly PDO $pdo) {}

    /** @return array<string,mixed> */
    public function snapshot(?string $now = null, int $limit = self::MAX_ITEMS): array
    {
        if ($limit < 1 || $limit > self::MAX_ITEMS) return self::unknown('TRIAGE_LIMIT_INVALID');
        $reference = strtotime($now ?? 'now');
        if ($reference === false) return self::unknown('TRIAGE_TIME_INVALID');
        try {
            $query = $this->pdo->query("SELECT e.execution_id,e.task_id,e.project_id,e.state,e.required_capability,e.attempt_count,e.last_error_code,e.checkpoint_json,e.updated_at,t.goal,p.name AS project_name,
                (SELECT successor.execution_id FROM control_task_executions successor WHERE successor.project_id=e.project_id AND successor.required_capability=e.required_capability AND successor.state='COMPLETED' AND successor.updated_at>e.updated_at ORDER BY successor.updated_at ASC,successor.execution_id ASC LIMIT 1) AS superseded_execution_id,
                (SELECT successor.updated_at FROM control_task_executions successor WHERE successor.project_id=e.project_id AND successor.required_capability=e.required_capability AND successor.state='COMPLETED' AND successor.updated_at>e.updated_at ORDER BY successor.updated_at ASC,successor.execution_id ASC LIMIT 1) AS superseded_at
                FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id JOIN projects p ON p.project_id=t.project_id WHERE e.state IN ('FAILED','WAITING_FOR_CAPABILITY') ORDER BY e.updated_at DESC,e.execution_id LIMIT " . ($limit + 1));
            $rows = $query === false ? [] : $query->fetchAll();
        } catch (Throwable) {
            return self::unknown('TRIAGE_UNAVAILABLE');
        }

        $bounded = count($rows) > $limit;
        $rows = array_slice($rows, 0, $limit);
        $summary = ['historicalExpected'=>0,'obsoleteStale'=>0,'retryable'=>0,'blockedCapability'=>0,'authRequired'=>0,'externalPolicy'=>0,'currentDefect'=>0,'active'=>0];
        $currentSummary = ['retryable'=>0,'blockedCapability'=>0,'authRequired'=>0,'externalPolicy'=>0,'currentDefect'=>0];
        $items = []; $currentItems = [];
        foreach ($rows as $row) {
            if (!is_array($row)) continue;
            $state = (string) ($row['state'] ?? 'FAILED');
            $code = (string) ($row['last_error_code'] ?? 'EXECUTION_FAILED');
            $attempts = max(0, (int) ($row['attempt_count'] ?? 0));
            $updated = strtotime((string) ($row['updated_at'] ?? ''));
            $ageSeconds = $updated === false ? null : max(0, $reference - $updated);
            $goal = (string) ($row['goal'] ?? '');
            $supersededBy = (string) ($row['superseded_execution_id'] ?? '');
            $supersededAt = (string) ($row['superseded_at'] ?? '');
            $policyCategory = HubExecutionFailurePolicy::category($code);
            $policyDecision = HubExecutionFailurePolicy::decide($code, max(1, $attempts), [], (string) ($row['updated_at'] ?? gmdate('c', $reference)), 3, (string) ($row['execution_id'] ?? ''));

            $active = false;
            if (preg_match('/(?:field proof|fixture|expected failure|negative test|ทดสอบ|หลักฐานภาคสนาม)/iu', $goal) === 1) {
                $classification = 'HISTORICAL_EXPECTED'; $summary['historicalExpected']++; $reason = 'goal ระบุ test/field-proof evidence; เก็บไว้เป็น audit';
            } elseif ($supersededBy !== '') {
                $classification = 'OBSOLETE_STALE'; $summary['obsoleteStale']++; $reason = 'มี execution ที่สำเร็จภายหลังใน project/capability เดียวกัน; failure เดิมคงอยู่เฉพาะ audit';
            } elseif ($state === 'FAILED' && $ageSeconds !== null && $ageSeconds >= 604800) {
                $classification = 'OBSOLETE_STALE'; $summary['obsoleteStale']++; $reason = 'terminal failure เกิน 7 วันและไม่มีหลักฐานใหม่; ต้อง review ก่อนนำกลับมาเป็น incident';
            } elseif ($state === 'WAITING_FOR_CAPABILITY') {
                $classification = $policyCategory === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : ($policyCategory === 'EXTERNAL_POLICY' ? 'EXTERNAL_POLICY' : 'BLOCKED_CAPABILITY');
                $reason = 'งานยังถูกเก็บไว้และรอเงื่อนไขภายนอก/ความสามารถที่จำเป็น; ไม่ blind retry'; $active = true;
            } elseif ($policyCategory === 'TRANSIENT' && $attempts < 3) {
                $classification = 'RETRYABLE'; $reason = 'transient code และยังอยู่ใน bounded retry policy'; $active = true;
            } elseif ($policyCategory === 'AUTH_REQUIRED') {
                $classification = 'AUTH_REQUIRED'; $reason = 'ต้องแก้ credential/authentication ก่อนเริ่ม attempt ใหม่'; $active = true;
            } elseif ($policyCategory === 'EXTERNAL_POLICY') {
                $classification = 'EXTERNAL_POLICY'; $reason = 'ต้องเปลี่ยน provider/account/model policy ก่อนเริ่ม attempt ใหม่'; $active = true;
            } else {
                $classification = 'CURRENT_DEFECT'; $reason = 'ยังไม่มีหลักฐานว่า obsolete หรือ retry-safe'; $active = true;
            }

            if ($active) {
                $summary['active']++;
                $key = match ($classification) {
                    'RETRYABLE' => 'retryable',
                    'BLOCKED_CAPABILITY' => 'blockedCapability',
                    'AUTH_REQUIRED' => 'authRequired',
                    'EXTERNAL_POLICY' => 'externalPolicy',
                    default => 'currentDefect',
                };
                $summary[$key]++; $currentSummary[$key]++;
            }

            $item = [
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
                'active'=>$active,
                'failureCategory'=>$policyCategory,
                'nextEligibleAt'=>$classification === 'RETRYABLE' ? $policyDecision['nextEligibleAt'] : null,
                'reason'=>$reason,
                'supersededByExecutionId'=>$supersededBy !== '' ? $supersededBy : null,
                'supersededAt'=>$supersededAt !== '' ? $supersededAt : null,
            ];
            $items[] = $item;
            if ($active) $currentItems[] = $item;
        }

        $nextAction = $currentSummary['currentDefect'] > 0 ? 'ตรวจ current defect ก่อนทำ attempt ใหม่'
            : ($currentSummary['authRequired'] > 0 ? 'แก้ provider credential/authentication ผ่าน Owner authority'
            : ($currentSummary['externalPolicy'] > 0 ? 'ตรวจ provider/account/model policy'
            : ($currentSummary['retryable'] > 0 ? 'ให้ canonical retry policy พิจารณาหลัง nextEligibleAt'
            : ($currentSummary['blockedCapability'] > 0 ? 'คงงานไว้จน capability/quota/budget พร้อม' : 'ไม่มี current blocker'))));

        return [
            'schemaVersion'=>2,
            'state'=>$items === [] ? 'CLEAR' : 'TRIAGED',
            'observedAt'=>gmdate('c', $reference),
            'summary'=>$summary,
            'total'=>count($items),
            'items'=>$items,
            'current'=>['state'=>$currentItems === [] ? 'CLEAR' : 'BLOCKED','total'=>count($currentItems),'summary'=>$currentSummary,'items'=>$currentItems],
            'bounded'=>$bounded,
            'policyVersion'=>HubExecutionFailurePolicy::VERSION . '+execution-triage-v3',
            'auditHistoryPreserved'=>true,
            'blindRetry'=>false,
            'nextAction'=>$nextAction,
        ];
    }

    /** @return array<string,mixed> */
    private static function unknown(string $reason): array
    {
        $summary=['historicalExpected'=>0,'obsoleteStale'=>0,'retryable'=>0,'blockedCapability'=>0,'authRequired'=>0,'externalPolicy'=>0,'currentDefect'=>0,'active'=>0];
        $current=['retryable'=>0,'blockedCapability'=>0,'authRequired'=>0,'externalPolicy'=>0,'currentDefect'=>0];
        return ['schemaVersion'=>2,'state'=>'UNKNOWN','observedAt'=>null,'summary'=>$summary,'total'=>0,'items'=>[],'current'=>['state'=>'UNKNOWN','total'=>0,'summary'=>$current,'items'=>[]],'bounded'=>true,'policyVersion'=>HubExecutionFailurePolicy::VERSION . '+execution-triage-v3','auditHistoryPreserved'=>true,'blindRetry'=>false,'reason'=>$reason,'nextAction'=>'ตรวจ canonical execution schema/read authority'];
    }
}
