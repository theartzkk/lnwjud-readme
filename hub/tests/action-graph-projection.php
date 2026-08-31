<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubActionGraphService.php';
function ag_assert(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$task = [
    'task_id' => '11111111-1111-4111-8111-111111111111',
    'project_id' => '22222222-2222-4222-8222-222222222222',
    'goal' => 'ค้นข้อมูลที่เกี่ยวข้อง สร้างเอกสาร และตรวจผลลัพธ์',
    'state' => 'RUNNING',
    'progress' => 55,
];
$execution = [
    'execution_id' => '33333333-3333-4333-8333-333333333333',
    'executor_kind' => 'VPS',
    'required_capability' => 'project.search',
    'state' => 'RUNNING',
];
$graph = HubActionGraphService::project($task, $execution, null, 0);
ag_assert($graph['graphId'] === $task['task_id'], 'graph must reuse canonical task id');
ag_assert($graph['authority'] === 'TASK_EXECUTION_PROJECTION' && $graph['live'] === true, 'graph must be a live projection');
$ids = array_column($graph['nodes'], 'nodeId');
ag_assert($ids === ['plan', 'research', 'execute', 'verify', 'output'], 'read-only graph phase order must be deterministic');
ag_assert(($graph['nodes'][0]['state'] ?? null) === 'COMPLETED', 'plan must complete once canonical execution exists');
ag_assert(($graph['nodes'][1]['state'] ?? null) === 'COMPLETED', 'research must reflect progress beyond research phase');
ag_assert(($graph['nodes'][2]['state'] ?? null) === 'RUNNING', 'execute must reflect live running task');
ag_assert(count($graph['edges']) === count($graph['nodes']) - 1, 'graph must remain a bounded DAG');

$mutation = $execution;
$mutation['required_capability'] = 'project.mutate.assisted';
$waiting = $task;
$waiting['state'] = 'WAITING_FOR_APPROVAL'; $waiting['progress'] = 90;
$approvalGraph = HubActionGraphService::project($waiting, $mutation, 'PENDING', 1);
$approvalNodes = array_column($approvalGraph['nodes'], null, 'nodeId');
ag_assert(isset($approvalNodes['approval']) && $approvalNodes['approval']['state'] === 'BLOCKED', 'approval must stop the graph truthfully');
ag_assert($approvalNodes['execute']['undoPolicy'] === 'SNAPSHOT_REQUIRED', 'mutation must require a recovery snapshot');
ag_assert($approvalNodes['output']['state'] !== 'COMPLETED', 'output must not claim completion before approval');

$done = $task; $done['state'] = 'COMPLETED'; $done['progress'] = 100;
$doneGraph = HubActionGraphService::project($done, ['executor_kind'=>'VPS','required_capability'=>'artifact.object','state'=>'COMPLETED'], null, 1);
ag_assert(count(array_filter($doneGraph['nodes'], static fn(array $n): bool => $n['state'] !== 'COMPLETED')) === 0, 'completed task graph must be complete');
fwrite(STDOUT, "AWH Action Graph projection: PASS\n");
