<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubExecutionTriageService.php';

function failure_policy_assert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$at = '2026-09-02T10:00:00+00:00';
$rate = HubExecutionFailurePolicy::decide('PROVIDER_RATE_LIMITED', 1, ['retryAfterSeconds'=>90], $at, 3, '11111111-1111-4111-8111-111111111111');
failure_policy_assert($rate['category'] === 'TRANSIENT', 'rate limit is transient');
failure_policy_assert($rate['state'] === 'QUEUED' && $rate['automaticRetry'] === true, 'rate limit queues bounded retry');
failure_policy_assert($rate['retryAfterSeconds'] === 90, 'provider retry-after is preserved');
failure_policy_assert(is_int($rate['delaySeconds']) && $rate['delaySeconds'] >= 90 && $rate['delaySeconds'] <= 120, 'retry-after plus jitter stays bounded');
failure_policy_assert(is_string($rate['nextEligibleAt']) && strtotime($rate['nextEligibleAt']) > strtotime($at), 'next eligible time is in the future');

$checkpoint = HubExecutionFailurePolicy::checkpointWithDecision('{"mode":"NATIVE_CONVERSATION","messageId":"22222222-2222-4222-8222-222222222222"}', 'PROVIDER_RATE_LIMITED', $rate);
$parsed = json_decode($checkpoint, true, 32, JSON_THROW_ON_ERROR);
failure_policy_assert(($parsed['mode'] ?? null) === 'NATIVE_CONVERSATION', 'existing checkpoint mode is preserved');
failure_policy_assert(($parsed['_executionPolicy']['code'] ?? null) === 'PROVIDER_RATE_LIMITED', 'retry schedule is stored in canonical execution checkpoint');
failure_policy_assert(($parsed['_executionPolicy']['version'] ?? null) === HubExecutionFailurePolicy::VERSION, 'retry schedule is versioned');
$row = ['execution_id'=>'11111111-1111-4111-8111-111111111111','last_error_code'=>'PROVIDER_RATE_LIMITED','attempt_count'=>1,'checkpoint_json'=>$checkpoint,'updated_at'=>$at];
failure_policy_assert(HubExecutionFailurePolicy::eligible($row, gmdate('c', strtotime((string)$rate['nextEligibleAt']) - 1), 3) === false, 'claim is blocked before next eligible time');
failure_policy_assert(HubExecutionFailurePolicy::eligible($row, (string)$rate['nextEligibleAt'], 3) === true, 'claim becomes eligible at scheduled time');

$exhausted = HubExecutionFailurePolicy::decide('PROVIDER_UNAVAILABLE', 3, [], $at, 3, 'seed');
failure_policy_assert($exhausted['state'] === 'WAITING_FOR_CAPABILITY' && $exhausted['automaticRetry'] === false, 'provider transient exhausts to preserved capability wait');
$notConfigured = HubExecutionFailurePolicy::decide('PROVIDER_UNAVAILABLE', 1, ['retryable'=>false,'category'=>'credential'], $at, 3, 'seed');
failure_policy_assert($notConfigured['category'] === 'CAPABILITY_WAIT' && $notConfigured['state'] === 'WAITING_FOR_CAPABILITY' && $notConfigured['automaticRetry'] === false, 'explicit provider non-retryable diagnostic prevents pointless retry');
$leaseExhausted = HubExecutionFailurePolicy::decide('LEASE_EXPIRED', 3, [], $at, 3, 'seed');
failure_policy_assert($leaseExhausted['state'] === 'FAILED', 'internal lease exhaustion remains terminal at bounded limit');
$auth = HubExecutionFailurePolicy::decide('PROVIDER_AUTH_FAILED', 1, [], $at, 3, 'seed');
failure_policy_assert($auth['category'] === 'AUTH_REQUIRED' && $auth['state'] === 'FAILED', 'auth failures are never blind retried');
$quota = HubExecutionFailurePolicy::decide('PROVIDER_QUOTA_EXHAUSTED', 1, [], $at, 3, 'seed');
failure_policy_assert($quota['category'] === 'CAPABILITY_WAIT' && $quota['state'] === 'WAITING_FOR_CAPABILITY', 'quota exhaustion preserves work without retry storm');
$unknown = HubExecutionFailurePolicy::decide('SOME_NEW_UNKNOWN_FAILURE', 1, [], $at, 3, 'seed');
failure_policy_assert($unknown['category'] === 'TERMINAL_DEFECT' && $unknown['state'] === 'FAILED', 'unknown failure fails closed instead of blind retry');
failure_policy_assert(HubExecutionFailurePolicy::retryAfterSeconds(999999) === 3600, 'retry-after is capped at one hour');
failure_policy_assert(HubExecutionFailurePolicy::retryAfterSeconds('0') === null, 'zero retry-after is rejected');
failure_policy_assert(HubExecutionFailurePolicy::retryAfterSeconds('secret') === null, 'non-numeric retry-after is rejected by persisted policy boundary');

$base = dirname(__DIR__);
$adapterSource = file_get_contents($base . '/src/HubOpenAiProviderAdapter.php');
$durableSource = file_get_contents($base . '/src/HubDurableExecutionService.php');
failure_policy_assert(is_string($adapterSource) && str_contains($adapterSource, 'CURLOPT_HEADERFUNCTION') && str_contains($adapterSource, 'Retry-After'), 'provider adapter captures Retry-After through bounded header callback');
failure_policy_assert(str_contains((string)$adapterSource, 'strlen($candidate) <= 100'), 'provider header capture is bounded');
failure_policy_assert(str_contains((string)$durableSource, 'HubExecutionFailurePolicy::eligible'), 'durable claim consumes central eligibility policy');
failure_policy_assert(str_contains((string)$durableSource, 'HubExecutionFailurePolicy::checkpointWithDecision'), 'durable defer persists central schedule in existing checkpoint');
failure_policy_assert(!str_contains((string)$durableSource, '$retryableProvider = in_array'), 'legacy duplicate retry classifier is removed');

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDOUT, "AWH Execution Failure Policy: PASS (policy/source); triage SQLite fixture skipped\n");
    exit(0);
}

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE projects(project_id TEXT PRIMARY KEY,name TEXT NOT NULL)');
$pdo->exec('CREATE TABLE control_tasks(task_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,goal TEXT NOT NULL)');
$pdo->exec('CREATE TABLE control_task_executions(execution_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,project_id TEXT NOT NULL,state TEXT NOT NULL,required_capability TEXT NOT NULL,attempt_count INTEGER NOT NULL,last_error_code TEXT,checkpoint_json TEXT NOT NULL,updated_at TEXT NOT NULL)');
$pdo->exec("INSERT INTO projects VALUES('p1','AWH')");
$insertTask = $pdo->prepare('INSERT INTO control_tasks(task_id,project_id,goal) VALUES(:task,\'p1\',:goal)');
$insertExecution = $pdo->prepare('INSERT INTO control_task_executions(execution_id,task_id,project_id,state,required_capability,attempt_count,last_error_code,checkpoint_json,updated_at) VALUES(:id,:task,\'p1\',:state,:capability,:attempts,:code,:checkpoint,:updated)');

$insertTask->execute(['task'=>'t-old','goal'=>'production read']);
$insertExecution->execute(['id'=>'e-old','task'=>'t-old','state'=>'FAILED','capability'=>'project.read','attempts'=>1,'code'=>'PROVIDER_FAILED','checkpoint'=>'{}','updated'=>'2026-09-02T08:00:00+00:00']);
$insertTask->execute(['task'=>'t-success','goal'=>'production read recovered']);
$insertExecution->execute(['id'=>'e-success','task'=>'t-success','state'=>'COMPLETED','capability'=>'project.read','attempts'=>1,'code'=>null,'checkpoint'=>'{}','updated'=>'2026-09-02T08:30:00+00:00']);
$insertTask->execute(['task'=>'t-quota','goal'=>'owner conversation']);
$insertExecution->execute(['id'=>'e-quota','task'=>'t-quota','state'=>'WAITING_FOR_CAPABILITY','capability'=>'agent.conversation','attempts'=>1,'code'=>'PROVIDER_QUOTA_EXHAUSTED','checkpoint'=>'{}','updated'=>'2026-09-02T09:00:00+00:00']);
$insertTask->execute(['task'=>'t-auth','goal'=>'owner conversation auth']);
$insertExecution->execute(['id'=>'e-auth','task'=>'t-auth','state'=>'FAILED','capability'=>'agent.conversation','attempts'=>1,'code'=>'PROVIDER_AUTH_FAILED','checkpoint'=>'{}','updated'=>'2026-09-02T09:10:00+00:00']);

$snapshot = (new HubExecutionTriageService($pdo))->snapshot($at);
failure_policy_assert(($snapshot['schemaVersion'] ?? null) === 2, 'triage projection schema v2');
failure_policy_assert(($snapshot['total'] ?? null) === 3, 'triage audit retains three failed/waiting rows');
failure_policy_assert(($snapshot['current']['total'] ?? null) === 2, 'current blocker projection excludes superseded ghost failure');
failure_policy_assert(($snapshot['summary']['obsoleteStale'] ?? null) === 1, 'superseded failure remains audit-only stale evidence');
failure_policy_assert(($snapshot['current']['summary']['blockedCapability'] ?? null) === 1, 'quota wait remains one current capability blocker');
failure_policy_assert(($snapshot['current']['summary']['authRequired'] ?? null) === 1, 'auth failure remains one current auth blocker');
$old = array_values(array_filter($snapshot['items'], static fn(array $item): bool => ($item['executionId'] ?? null) === 'e-old'))[0] ?? null;
failure_policy_assert(is_array($old) && ($old['classification'] ?? null) === 'OBSOLETE_STALE' && ($old['active'] ?? true) === false, 'successful successor removes old failure from active blocker projection without deleting audit');

fwrite(STDOUT, "AWH Execution Failure Policy: PASS\n");
