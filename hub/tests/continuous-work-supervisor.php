<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubDurableExecutionService.php';

function supervisor_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }

$reflection = new ReflectionClass(HubDurableExecutionService::class);
$service = $reflection->newInstanceWithoutConstructor();
$eligible = $reflection->getMethod('retryEligible');
$eligible->setAccessible(true);
$now = '2026-08-29T04:00:00+00:00';

supervisor_assert($eligible->invoke($service, ['last_error_code'=>null,'attempt_count'=>0,'updated_at'=>$now], $now) === true, 'fresh work must be immediately eligible');
supervisor_assert($eligible->invoke($service, ['last_error_code'=>'PROVIDER_RATE_LIMITED','attempt_count'=>1,'updated_at'=>'2026-08-29T03:59:45+00:00'], $now) === false, 'rate limit must not hot-loop before 30 seconds');
supervisor_assert($eligible->invoke($service, ['last_error_code'=>'PROVIDER_RATE_LIMITED','attempt_count'=>1,'updated_at'=>'2026-08-29T03:59:29+00:00'], $now) === true, 'rate limit becomes eligible after first backoff');
supervisor_assert($eligible->invoke($service, ['last_error_code'=>'PROVIDER_UNAVAILABLE','attempt_count'=>2,'updated_at'=>'2026-08-29T03:56:00+00:00'], $now) === false, 'second provider outage retry waits five minutes');
supervisor_assert($eligible->invoke($service, ['last_error_code'=>'PROVIDER_UNAVAILABLE','attempt_count'=>2,'updated_at'=>'2026-08-29T03:55:00+00:00'], $now) === true, 'second provider outage retry resumes after five minutes');
$serviceSource = file_get_contents(dirname(__DIR__) . '/src/HubDurableExecutionService.php');
$executorSource = file_get_contents(dirname(__DIR__) . '/bin/awh-native-executor.php');
supervisor_assert(is_string($serviceSource) && str_contains($serviceSource, 'public function runBatch'), 'bounded batch API is required');
supervisor_assert(is_string($serviceSource) && str_contains($serviceSource, "'recovered' => $recovered"), 'batch must report bounded lease recovery');
supervisor_assert(substr_count($serviceSource, 'control_task_executions') > 0 && !str_contains($serviceSource, 'CREATE TABLE'), 'supervisor must reuse canonical execution authority');
supervisor_assert(str_contains($serviceSource, 'LIMIT 25') && str_contains($serviceSource, 'retryEligible'), 'claim must skip temporarily ineligible retries without blocking later work');
supervisor_assert(str_contains($serviceSource, "expired execution lease recovered; bounded retry delayed"), 'stale lease recovery must update canonical task truthfully');
supervisor_assert(is_string($executorSource) && str_contains($executorSource, '->runBatch(4)'), 'native executor must drain a fixed bounded batch');
supervisor_assert(!str_contains($executorSource, 'while (true)') && !str_contains($executorSource, 'sleep('), 'executor must remain one-shot, not become a daemon');

fwrite(STDOUT, "AWH Continuous Work Supervisor: PASS\n");
