<?php

declare(strict_types=1);

/**
 * Bounded Product Governor for the always-on VPS tick.
 *
 * It never owns a queue or writes task state itself. Existing eligible work is
 * selected from control_task_executions; when none exists, one low-risk daily
 * platform audit is requested through the canonical Control Plane materializer.
 */
final class HubStaffGovernorException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'STAFF_GOVERNOR_FAILED') { parent::__construct($message); }
}

final class HubStaffGovernorService
{
    private const SIGNAL = 'PLATFORM_DAILY_AUDIT';
    /** @var Closure(string,string):array<string,mixed> */
    private readonly Closure $materializer;

    /** @param callable(string,string):array<string,mixed> $materializer */
    public function __construct(private readonly PDO $pdo, callable $materializer)
    {
        $this->materializer = Closure::fromCallable($materializer);
    }

    /** @return array<string,mixed> */
    public function tick(?string $now = null): array
    {
        $at = self::timestamp($now ?? gmdate('c'));
        $eligible = $this->nextEligible();
        $signals = $this->signals($at);
        if ($eligible !== null) return $this->decision('SELECT_EXISTING_CANONICAL_TASK', false, $eligible, $signals, $at, 'ใช้ canonical task ที่พร้อมอยู่แล้ว');

        $key = 'staff.platform-daily-audit.' . substr($at, 0, 10);
        $existing = $this->taskByIdempotency($key);
        if ($existing !== null) {
            $work = self::work($existing);
            return $this->decision('WAIT_FOR_NEXT_CADENCE', false, $work, $signals, $at, 'รอบตรวจประจำวันนี้ถูกบันทึกไว้แล้ว');
        }

        try { $created = ($this->materializer)(self::SIGNAL, $at); }
        catch (Throwable $error) {
            $code = property_exists($error, 'codeName') && is_string($error->codeName) ? $error->codeName : 'STAFF_MATERIALIZATION_FAILED';
            throw new HubStaffGovernorException('Canonical Staff work could not be materialized', $code);
        }
        $task = is_array($created['task'] ?? null) ? $created['task'] : null;
        if ($task === null || !is_string($task['taskId'] ?? null)) throw new HubStaffGovernorException('Canonical Staff materializer returned invalid evidence', 'STAFF_MATERIALIZATION_FAILED');
        return $this->decision('CREATE_CANONICAL_TASK', !($created['idempotent'] ?? false), self::work($task), $signals, $at, 'สร้าง low-risk audit ผ่าน Control Plane authority เดิม');
    }

    /** @return array<string,mixed>|null */
    private function nextEligible(): ?array
    {
        try {
            $q = $this->pdo->query("SELECT e.execution_id,e.task_id,e.required_capability,t.project_id,p.name AS project_name,t.state FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id JOIN projects p ON p.project_id=t.project_id WHERE e.state='QUEUED' AND e.executor_kind='VPS' AND e.required_capability IN ('agent.conversation','project.read','project.search','project.mutate.text','project.mutate.assisted','artifact.object') AND t.state IN ('QUEUED','WAITING_FOR_WORKER') ORDER BY e.created_at,e.execution_id LIMIT 1");
            $row = $q === false ? false : $q->fetch();
            return is_array($row) ? ['taskId'=>(string)$row['task_id'],'executionId'=>(string)$row['execution_id'],'projectId'=>(string)$row['project_id'],'project'=>(string)$row['project_name'],'requiredCapability'=>(string)$row['required_capability'],'state'=>(string)$row['state']] : null;
        } catch (Throwable) { throw new HubStaffGovernorException('Canonical queue is unavailable', 'STAFF_GOVERNOR_UNAVAILABLE'); }
    }

    /** @return array<string,mixed>|null */
    private function taskByIdempotency(string $key): ?array
    {
        try {
            $q = $this->pdo->prepare('SELECT t.task_id,t.project_id,t.state,p.name AS project_name,e.execution_id,e.required_capability FROM owner_bootstrap o JOIN control_tasks t ON t.user_id=o.owner_user_id JOIN projects p ON p.project_id=t.project_id LEFT JOIN control_task_executions e ON e.task_id=t.task_id WHERE o.singleton_id=1 AND o.bootstrap_closed=1 AND t.idempotency_key=:key ORDER BY t.created_at DESC LIMIT 1');
            $q->execute(['key'=>$key]); $row=$q->fetch(); return is_array($row) ? $row : null;
        } catch (Throwable) { throw new HubStaffGovernorException('Canonical Staff cadence could not be read', 'STAFF_GOVERNOR_UNAVAILABLE'); }
    }

    /** @return list<array<string,mixed>> */
    private function signals(string $at): array
    {
        $since = gmdate('c', (strtotime($at) ?: time()) - 86400);
        $signals = [['source'=>'cadence','state'=>'DAILY_PLATFORM_AUDIT_DUE']];
        try {
            $q=$this->pdo->prepare("SELECT COUNT(*) FROM control_task_executions WHERE state='WAITING_FOR_CAPABILITY'"); $q->execute(); $waiting=(int)$q->fetchColumn();
            if($waiting>0)$signals[]=['source'=>'capability','state'=>'WAITING_FOR_CAPABILITY','count'=>$waiting];
            $q=$this->pdo->prepare("SELECT COUNT(*) FROM control_task_executions WHERE state='FAILED' AND updated_at>=:since"); $q->execute(['since'=>$since]); $failed=(int)$q->fetchColumn();
            if($failed>0)$signals[]=['source'=>'execution','state'=>'FAILED_EXECUTION','count'=>$failed];
            $q=$this->pdo->prepare("SELECT COUNT(*) FROM control_task_executions WHERE state IN ('LEASED','RUNNING') AND (lease_expires_at IS NULL OR lease_expires_at<=:at)"); $q->execute(['at'=>$at]); $stuck=(int)$q->fetchColumn();
            if($stuck>0)$signals[]=['source'=>'execution','state'=>'STUCK_LEASE','count'=>$stuck];
        } catch (Throwable) { $signals[]=['source'=>'canonical_queue','state'=>'UNKNOWN']; }
        return $signals;
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private static function work(array $row): array
    {
        return ['taskId'=>(string)($row['taskId']??$row['task_id']??''),'executionId'=>isset($row['executionId'])?(string)$row['executionId']:(isset($row['execution_id'])?(string)$row['execution_id']:null),'projectId'=>(string)($row['projectId']??$row['project_id']??''),'project'=>(string)($row['project']??$row['project_name']??''),'requiredCapability'=>(string)($row['requiredCapability']??$row['required_capability']??'artifact.object'),'state'=>(string)($row['state']??'QUEUED')];
    }

    /** @param list<array<string,mixed>> $signals @return array<string,mixed> */
    private function decision(string $decision, bool $created, ?array $work, array $signals, string $at, string $reason): array
    {
        return ['schemaVersion'=>1,'state'=>str_starts_with($decision,'WAIT_')?'IDLE':'READY','decision'=>$decision,'created'=>$created,'selectedWork'=>$work,'signals'=>array_slice($signals,0,20),'reason'=>$reason,'observedAt'=>$at,'queueAuthority'=>'control_tasks/control_task_executions','taskCreationAuthority'=>'HubControlPlaneService','riskClass'=>'LOW','mutationScope'=>'CANONICAL_TASK_ONLY','blockedWorkDoesNotStopLoop'=>true,'arbitraryShell'=>false];
    }

    private static function timestamp(string $value): string
    {
        $time=strtotime($value); if($time===false)throw new HubStaffGovernorException('Staff Governor time is invalid','STAFF_GOVERNOR_INVALID'); return gmdate('c',$time);
    }
}
