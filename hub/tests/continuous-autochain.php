<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
require_once dirname(__DIR__) . '/src/HubDurableExecutionService.php';

function chain_assert(bool $condition, string $message): void { if (!$condition) { fwrite(STDERR, "FAIL: {$message}\n"); exit(1); } }

$continuous = new ReflectionMethod(HubControlPlaneService::class, 'isContinuousAutonomyRequest');
chain_assert($continuous->invoke(null, 'Continue the main project autonomously from canonical source') === true, 'explicit autonomous intent must opt in');
chain_assert($continuous->invoke(null, 'ตรวจ Source of Truth ของ AWH ต่อเนื่องบน VPS แบบ read-only เท่านั้น ห้ามแก้ source deploy secret billing หรือ permission เมื่อขั้นแรกเสร็จให้เลือกหัวข้อ read-only ที่ปลอดภัยถัดไปเอง') === true, 'Thai field-proof continuous intent must opt in');
chain_assert($continuous->invoke(null, 'ตรวจโปรเจกต์ล่าสุด') === false, 'ordinary work must not silently become continuous');

$impact = new ReflectionMethod(HubDurableExecutionService::class, 'highImpactGoal');
chain_assert($impact->invoke(null, 'Deploy this candidate to production') === true, 'production deployment must stop the chain');
chain_assert($impact->invoke(null, 'แก้ regression ใน source แล้วรัน QA') === false, 'reversible source work may continue');

$inspection = new ReflectionMethod(HubControlPlaneService::class, 'isServerInspection');
chain_assert($inspection->invoke(null, 'ตรวจ Source of Truth ต่อเนื่องแบบ read-only เท่านั้น ห้ามแก้ source deploy secret billing หรือ permission') === true, 'negated high-impact words must remain a read-only VPS inspection');
chain_assert($inspection->invoke(null, 'ตรวจ source แล้วแก้ source') === false, 'an unnegated mutation must not route as read-only inspection');

$same = new ReflectionMethod(HubDurableExecutionService::class, 'sameGoal');
chain_assert($same->invoke(null, ' Inspect   source ', 'inspect source') === true, 'same-goal loop detection must normalize whitespace/case');

$continuationFallback = new ReflectionMethod(HubDurableExecutionService::class, 'continuationFallback');
foreach (['PROVIDER_FAILED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_RATE_LIMITED'] as $providerFailure) {
    $next = $continuationFallback->invoke(null, $providerFailure);
    chain_assert(is_string($next) && str_starts_with($next, 'NEXT:'), $providerFailure . ' must preserve a bounded scalar continuation fallback');
}
chain_assert($continuationFallback->invoke(null, 'PROVIDER_AUTH_FAILED') === null, 'non-fallback provider failures must remain blocked');

$control = file_get_contents(dirname(__DIR__) . '/src/HubControlPlaneService.php');
$durable = file_get_contents(dirname(__DIR__) . '/src/HubDurableExecutionService.php');
$executor = file_get_contents(dirname(__DIR__) . '/bin/awh-native-executor.php');
chain_assert(is_string($control) && str_contains($control, "a.status='PENDING'"), 'continuation materialization must pause on pending approval');
chain_assert(str_contains($control, "fetchColumn() !== 'COMPLETED'"), 'only a completed canonical parent may materialize continuation');
chain_assert(is_string($durable) && str_contains($durable, '$maxSteps > 8'), 'continuous chain must have a hard step bound');
chain_assert(str_contains($durable, 'sourceTruth') && str_contains($durable, "TASKS.md"), 'planner must consult bounded project source of truth');
chain_assert(is_string($durable) && !str_contains($durable, "return ['summary' => 'NEXT:"), 'continuation fallback must not return an invalid array from a scalar planner');
chain_assert(is_string($executor) && str_contains($executor, 'materializeContinuationSubmission'), 'native executor must route follow-up creation through canonical control plane');
chain_assert(is_string($control) && str_contains($control, 'checkpoint_json') && str_contains($control, 'executionContinuation'), 'worker task projection must expose validated continuation lineage from the canonical execution checkpoint');

fwrite(STDOUT, "AWH Continuous Auto-Chain: PASS\n");
