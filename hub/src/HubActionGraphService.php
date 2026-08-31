<?php

declare(strict_types=1);

/**
 * Read-only Action Graph projection over canonical task/execution authority.
 * It never stores work, leases workers, mutates artifacts, or creates a queue.
 */
final class HubActionGraphService
{
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';

    /** @param array<string,mixed> $task @param null|array<string,mixed> $execution */
    public static function project(array $task, ?array $execution, ?string $approvalStatus, int $artifactCount): array
    {
        $taskId = self::uuid($task['task_id'] ?? null, 'task');
        $projectId = self::uuid($task['project_id'] ?? null, 'project');
        $goal = self::text($task['goal'] ?? null, 2000, 'งานที่ได้รับมอบหมาย');
        $taskState = strtoupper((string) ($task['state'] ?? 'QUEUED'));
        $progress = max(0, min(100, (int) ($task['progress'] ?? 0)));
        $capability = self::capability($execution['required_capability'] ?? null);
        $executor = strtoupper((string) ($execution['executor_kind'] ?? ''));
        $executionState = strtoupper((string) ($execution['state'] ?? ''));
        $needsResearch = in_array($capability, ['project.read', 'project.search'], true)
            || preg_match('/(?:ค้น|วิจัย|research|วิเคราะห์|ตรวจ|inspect)/iu', $goal) === 1;
        $needsApproval = $approvalStatus === 'PENDING'
            || $taskState === 'WAITING_FOR_APPROVAL'
            || str_starts_with($capability, 'project.mutate.');

        $nodes = [];
        $nodes[] = self::node('plan', 'PLAN', 'วางแผนงาน', 'agent.plan', 'PAID_AI', 'NONE', false,
            self::planState($taskState, $execution !== null));
        if ($needsResearch) {
            $nodes[] = self::node('research', 'RESEARCH', 'ค้นและอ่านข้อมูลที่จำเป็น',
                in_array($capability, ['project.read', 'project.search'], true) ? $capability : 'project.search',
                'LOCAL_FREE', 'NONE', false, self::workState($taskState, $executionState, $progress, 'research'));
        }
        $executeCost = self::costClass($executor, $capability);
        $executeUndo = str_starts_with($capability, 'project.mutate.') ? 'SNAPSHOT_REQUIRED' : 'NONE';
        $nodes[] = self::node('execute', 'EXECUTE', self::executeTitle($capability),
            $capability !== '' ? $capability : 'task.execute', $executeCost, $executeUndo, false,
            self::workState($taskState, $executionState, $progress, 'execute', $needsResearch));

        if ($needsApproval) {
            $nodes[] = self::node('approval', 'APPROVAL', 'รอการอนุมัติเมื่อจำเป็น', 'approval.decision',
                'DETERMINISTIC', 'NONE', true, self::approvalState($taskState, $approvalStatus));
        }
        $nodes[] = self::node('verify', 'VERIFY', 'ตรวจผลลัพธ์', 'task.verify', 'DETERMINISTIC', 'NONE', false,
            self::verifyState($taskState, $progress, $needsApproval, $approvalStatus));
        $nodes[] = self::node('output', 'OUTPUT', $artifactCount > 0 ? 'ส่งไฟล์และผลลัพธ์' : 'ส่งผลลัพธ์',
            $artifactCount > 0 ? 'artifact.object' : 'task.output', 'DETERMINISTIC', $artifactCount > 0 ? 'REVERSIBLE' : 'NONE', false,
            self::outputState($taskState, $artifactCount));
        $edges = [];
        for ($index = 1; $index < count($nodes); $index++) {
            $edges[] = ['from' => $nodes[$index - 1]['nodeId'], 'to' => $nodes[$index]['nodeId']];
        }
        return [
            'schemaVersion' => 1,
            'graphId' => $taskId,
            'projectId' => $projectId,
            'goal' => $goal,
            'nodes' => $nodes,
            'edges' => $edges,
            'authority' => 'TASK_EXECUTION_PROJECTION',
            'live' => true,
        ];
    }

    private static function node(string $id, string $kind, string $title, string $capability, string $cost, string $undo, bool $approval, string $state): array
    {
        return ['nodeId' => $id, 'kind' => $kind, 'state' => $state, 'capability' => $capability,
            'title' => $title, 'costClass' => $cost, 'undoPolicy' => $undo, 'approvalRequired' => $approval];
    }
    private static function planState(string $taskState, bool $hasExecution): string
    {
        if ($taskState === 'CANCELLED') return 'CANCELLED';
        if ($taskState === 'FAILED' && !$hasExecution) return 'FAILED';
        return $hasExecution || !in_array($taskState, ['QUEUED', 'WAITING_FOR_WORKER'], true) ? 'COMPLETED' : 'READY';
    }

    private static function workState(string $taskState, string $executionState, int $progress, string $phase, bool $researchBefore = false): string
    {
        if ($taskState === 'CANCELLED') return 'CANCELLED';
        if ($taskState === 'COMPLETED' || $taskState === 'WAITING_FOR_APPROVAL') return 'COMPLETED';
        if ($taskState === 'FAILED') return $phase === 'research' || !$researchBefore ? 'FAILED' : 'BLOCKED';
        if ($taskState === 'QA') return 'COMPLETED';
        if (in_array($taskState, ['RUNNING', 'PREPARING'], true)) {
            if ($phase === 'research') return $progress < 45 ? 'RUNNING' : 'COMPLETED';
            if ($researchBefore && $progress < 45) return 'PLANNED';
            return 'RUNNING';
        }
        if ($executionState === 'WAITING_FOR_CAPABILITY' || $taskState === 'WAITING_FOR_WORKER') return 'BLOCKED';
        return $phase === 'research' || !$researchBefore ? 'READY' : 'PLANNED';
    }
    private static function approvalState(string $taskState, ?string $approvalStatus): string
    {
        if ($taskState === 'CANCELLED') return 'CANCELLED';
        if ($approvalStatus === 'APPROVED' || $taskState === 'COMPLETED') return 'COMPLETED';
        if ($approvalStatus === 'REJECTED' || $taskState === 'FAILED') return 'FAILED';
        if ($approvalStatus === 'PENDING' || $taskState === 'WAITING_FOR_APPROVAL') return 'BLOCKED';
        return 'PLANNED';
    }

    private static function verifyState(string $taskState, int $progress, bool $needsApproval, ?string $approvalStatus): string
    {
        if ($taskState === 'CANCELLED') return 'CANCELLED';
        if ($taskState === 'COMPLETED') return 'COMPLETED';
        if ($taskState === 'FAILED') return 'BLOCKED';
        if ($needsApproval && !in_array($approvalStatus, ['APPROVED'], true)) return 'PLANNED';
        if ($taskState === 'QA') return 'RUNNING';
        return $progress >= 80 ? 'READY' : 'PLANNED';
    }

    private static function outputState(string $taskState, int $artifactCount): string
    {
        if ($taskState === 'CANCELLED') return 'CANCELLED';
        if ($taskState === 'FAILED') return 'BLOCKED';
        if ($taskState === 'COMPLETED') return 'COMPLETED';
        return $artifactCount > 0 ? 'READY' : 'PLANNED';
    }
    private static function costClass(string $executor, string $capability): string
    {
        if ($executor === 'CODEX' || $capability === 'agent.conversation' || str_starts_with($capability, 'codex:')) return 'PAID_AI';
        if ($executor === 'DEVICE' || str_starts_with($capability, 'office.') || str_starts_with($capability, 'project.')) return 'LOCAL_FREE';
        return $capability === 'artifact.object' ? 'DETERMINISTIC' : 'PAID_AI';
    }

    private static function executeTitle(string $capability): string
    {
        if ($capability === 'artifact.object') return 'สร้างผลลัพธ์';
        if (str_starts_with($capability, 'office.')) return 'จัดทำไฟล์สำนักงาน';
        if (in_array($capability, ['project.read', 'project.search'], true)) return 'วิเคราะห์ข้อมูล';
        if (str_starts_with($capability, 'project.mutate.')) return 'จัดทำฉบับแก้ไข';
        if ($capability === 'agent.conversation') return 'คิดและจัดการคำขอ';
        return 'ลงมือทำงาน';
    }

    private static function capability(mixed $value): string
    {
        return is_string($value) && preg_match('/^[a-z][a-z0-9:._-]{0,63}$/', $value) === 1 ? $value : '';
    }
    private static function uuid(mixed $value, string $name): string
    {
        if (!is_string($value) || preg_match(self::UUID, $value) !== 1) throw new RuntimeException("Action Graph {$name} id is invalid");
        return strtolower($value);
    }

    private static function text(mixed $value, int $max, string $fallback): string
    {
        if (!is_string($value)) return $fallback;
        $text = trim($value);
        if ($text === '' || strlen($text) > $max || preg_match('/[\x00-\x1f\x7f]/', $text) === 1) return $fallback;
        if (preg_match('/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)\s*[:=]/i', $text) === 1) return $fallback;
        return $text;
    }
}
