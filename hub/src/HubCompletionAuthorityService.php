<?php
declare(strict_types=1);

/**
 * Publish-time authority for user-facing task completion.
 *
 * Internal workers may complete their own transactional step, but public
 * COMPLETED is only exposed when canonical task/execution/approval/envelope
 * state and bounded continuation evidence agree.
 */
final class HubCompletionAuthorityService
{
    private const TERMINAL_EXECUTIONS = ['COMPLETED','FAILED','CANCELLED'];
    private const ACTIVE_TASK_STATES = ['QUEUED','WAITING_FOR_WORKER','PREPARING','RUNNING','QA','WAITING_FOR_APPROVAL'];

    public function __construct(private readonly PDO $pdo)
    {
        $this->pdo->exec('PRAGMA foreign_keys=ON');
        $this->pdo->exec('PRAGMA busy_timeout=5000');
    }

    /** @return array<string,mixed> */
    public function assessTask(string $taskId, ?string $now = null): array
    {
        if (!self::uuid($taskId)) throw new RuntimeException('Completion task id is invalid');
        $at = self::timestamp($now ?? gmdate('c'));

        $q = $this->pdo->prepare('SELECT task_id,project_id,state,progress,result_summary,failure_code,updated_at FROM control_tasks WHERE task_id=:task');
        $q->execute(['task'=>$taskId]);
        $task = $q->fetch(PDO::FETCH_ASSOC);
        if (!is_array($task)) throw new RuntimeException('Completion task was not found');

        $executions = [];
        if (self::tablePresent($this->pdo,'control_task_executions')) {
            $e = $this->pdo->prepare('SELECT execution_id,task_id,project_id,state,required_capability,lease_owner,lease_expires_at,checkpoint_json,last_error_code,updated_at FROM control_task_executions WHERE task_id=:task ORDER BY updated_at DESC,execution_id DESC');
            $e->execute(['task'=>$taskId]);
            $executions = $e->fetchAll(PDO::FETCH_ASSOC);
        }

        $pendingApprovals = 0;
        if (self::tablePresent($this->pdo,'control_approvals')) {
            $a = $this->pdo->prepare("SELECT COUNT(*) FROM control_approvals WHERE task_id=:task AND status='PENDING' AND expires_at>:at");
            $a->execute(['task'=>$taskId,'at'=>$at]);
            $pendingApprovals = (int)$a->fetchColumn();
        }

        $activeEnvelopes = 0;
        if (self::tablePresent($this->pdo,'control_execution_envelopes')) {
            $x = $this->pdo->prepare("SELECT COUNT(*) FROM control_execution_envelopes WHERE task_id=:task AND mutation_scope<>'READ' AND state NOT IN ('RELEASED','CANCELLED') AND (lease_expires_at IS NULL OR lease_expires_at>:at)");
            $x->execute(['task'=>$taskId,'at'=>$at]);
            $activeEnvelopes = (int)$x->fetchColumn();
        }

        $internalState = (string)$task['state'];
        $publicState = $internalState;
        $verified = false;
        $reason = 'TASK_NOT_TERMINAL';
        $resume = $this->resumeCursor($executions, $at);
        $continuation = $this->continuationState((string)$task['project_id'], $taskId, $executions, $at);

        if ($internalState === 'COMPLETED') {
            if ((int)$task['progress'] !== 100) {
                $publicState = 'VERIFYING'; $reason = 'TASK_PROGRESS_INCOMPLETE';
            } elseif ($pendingApprovals > 0) {
                $publicState = 'VERIFYING'; $reason = 'APPROVAL_STILL_PENDING';
            } elseif ($activeEnvelopes > 0) {
                $publicState = 'VERIFYING'; $reason = 'MUTATION_AUTHORITY_NOT_RELEASED';
            } elseif (($mismatch=$this->executionMismatch($executions, $at)) !== null) {
                $publicState = 'VERIFYING'; $reason = $mismatch;
            } elseif (($continuation['recovering'] ?? false) === true) {
                $publicState = 'RECOVERING'; $reason = 'CONTINUATION_RECOVERY_PENDING';
                $resume = is_array($continuation['resume'] ?? null) ? $continuation['resume'] : $resume;
            } elseif (($continuation['pending'] ?? false) === true) {
                $publicState = 'VERIFYING'; $reason = 'CONTINUATION_PENDING';
            } elseif (($continuation['active'] ?? false) === true) {
                $publicState = 'VERIFYING'; $reason = 'CONTINUATION_ACTIVE';
                $resume = is_array($continuation['resume'] ?? null) ? $continuation['resume'] : $resume;
            } elseif ($executions === [] && !$this->legacyTerminalEvidence($taskId, $task)) {
                $publicState = 'VERIFYING'; $reason = 'TERMINAL_EVIDENCE_MISSING';
            } else {
                $publicState = 'COMPLETED'; $verified = true; $reason = 'VERIFIED_TERMINAL';
            }
        } elseif (in_array($internalState, self::ACTIVE_TASK_STATES, true) && is_array($resume) && ($resume['heartbeatFresh'] ?? true) === false) {
            $publicState = 'RECOVERING'; $reason = 'HEARTBEAT_STALE';
        } elseif ($internalState === 'FAILED') {
            $reason = 'FAILED_TERMINAL';
        } elseif ($internalState === 'CANCELLED') {
            $reason = 'CANCELLED_TERMINAL';
        }

        return [
            'schemaVersion'=>1,
            'verified'=>$verified,
            'internalState'=>$internalState,
            'publicState'=>$publicState,
            'reasonCode'=>$reason,
            'pendingApprovalCount'=>$pendingApprovals,
            'activeMutationAuthorityCount'=>$activeEnvelopes,
            'executionCount'=>count($executions),
            'continuation'=>$continuation,
            'resume'=>$resume,
            'observedAt'=>$at,
        ];
    }

    /** @param list<array<string,mixed>> $executions */
    private function executionMismatch(array $executions, string $at): ?string
    {
        foreach ($executions as $row) {
            $state = (string)($row['state'] ?? '');
            if (!in_array($state, self::TERMINAL_EXECUTIONS, true)) return 'EXECUTION_STILL_ACTIVE';
            if ($state !== 'COMPLETED') return 'EXECUTION_TERMINAL_MISMATCH';
            if (is_string($row['lease_owner'] ?? null) && trim((string)$row['lease_owner']) !== '') return 'EXECUTION_LEASE_NOT_RELEASED';
            $expires = is_string($row['lease_expires_at'] ?? null) ? strtotime((string)$row['lease_expires_at']) : false;
            if ($expires !== false && $expires > strtotime($at)) return 'EXECUTION_LEASE_NOT_RELEASED';
        }
        return null;
    }

    /** @param list<array<string,mixed>> $executions @return array<string,mixed>|null */
    private function resumeCursor(array $executions, string $at): ?array
    {
        foreach ($executions as $row) {
            $state = (string)($row['state'] ?? '');
            if (in_array($state, self::TERMINAL_EXECUTIONS, true)) continue;
            return $this->resumeRow($row,$at,$state);
        }
        return null;
    }

    /** @param list<array<string,mixed>> $executions @return array<string,mixed> */
    private function continuationState(string $projectId, string $taskId, array $executions, string $at): array
    {
        $roots=[]; $pending=false; $recovering=false; $ownOutcome=null; $resume=null;
        foreach ($executions as $row) {
            $checkpoint=self::decodedCheckpoint((string)($row['checkpoint_json']??'{}'));
            $c=is_array($checkpoint['continuation']??null)?$checkpoint['continuation']:null;
            if(!is_array($c)||($c['enabled']??false)!==true) continue;
            $root=is_string($c['rootTaskId']??null)?strtolower((string)$c['rootTaskId']):'';
            if(!self::uuid($root)) continue;
            $roots[$root]=true;
            $step=is_int($c['step']??null)?(int)$c['step']:-1;
            $max=is_int($c['maxSteps']??null)?(int)$c['maxSteps']:0;
            if($step<0||$max<1||$step+1>=$max) continue;
            $outcome=is_array($checkpoint['_continuationOutcome']??null)?$checkpoint['_continuationOutcome']:null;
            $state=is_array($outcome)&&is_string($outcome['state']??null)?(string)$outcome['state']:null;
            if($state===null) $pending=true;
            elseif($state==='FAILED') { $recovering=true; $ownOutcome=$outcome; $resume=$this->resumeRow($row,$at,'RECOVERING'); }
            elseif($state==='CONTINUED') $ownOutcome=$outcome;
        }

        if($roots===[]||!self::tablePresent($this->pdo,'control_task_executions')) {
            return ['active'=>$pending||$recovering,'pending'=>$pending,'recovering'=>$recovering,'rootTaskIds'=>array_keys($roots),'resume'=>$resume,'outcome'=>$ownOutcome];
        }

        $q=$this->pdo->prepare('SELECT e.execution_id,e.task_id,e.state,e.required_capability,e.lease_expires_at,e.lease_owner,e.updated_at,e.checkpoint_json,t.state AS task_state FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id WHERE e.project_id=:project AND e.task_id<>:task ORDER BY e.updated_at DESC LIMIT 80');
        $q->execute(['project'=>$projectId,'task'=>$taskId]);
        $successorFound=false;
        foreach($q->fetchAll(PDO::FETCH_ASSOC) as $row){
            $checkpoint=self::decodedCheckpoint((string)($row['checkpoint_json']??'{}'));
            $c=is_array($checkpoint['continuation']??null)?$checkpoint['continuation']:null;
            $root=is_array($c)&&is_string($c['rootTaskId']??null)?strtolower((string)$c['rootTaskId']):'';
            if($root===''||!isset($roots[$root])) continue;
            $successorFound=true;
            $taskState=(string)($row['task_state']??'');
            $executionState=(string)($row['state']??'');
            if(in_array($taskState,['FAILED','CANCELLED'],true)||in_array($executionState,['FAILED','CANCELLED'],true)) {
                $recovering=true; $resume=$this->resumeRow($row,$at,'RECOVERING'); continue;
            }
            if($taskState==='COMPLETED'&&$executionState==='COMPLETED') {
                $childContinuation=is_array($checkpoint['continuation']??null)?$checkpoint['continuation']:null;
                $childStep=is_array($childContinuation)&&is_int($childContinuation['step']??null)?(int)$childContinuation['step']:-1;
                $childMax=is_array($childContinuation)&&is_int($childContinuation['maxSteps']??null)?(int)$childContinuation['maxSteps']:0;
                if($childStep>=0&&$childMax>0&&$childStep+1<$childMax){
                    $childOutcome=is_array($checkpoint['_continuationOutcome']??null)?$checkpoint['_continuationOutcome']:null;
                    $childState=is_array($childOutcome)&&is_string($childOutcome['state']??null)?(string)$childOutcome['state']:null;
                    if($childState===null) $pending=true;
                    elseif($childState==='FAILED') { $recovering=true; $resume=$this->resumeRow($row,$at,'RECOVERING'); }
                }
                continue;
            }
            return ['active'=>true,'pending'=>$pending,'recovering'=>false,'rootTaskIds'=>array_keys($roots),'resume'=>$this->resumeRow($row,$at,$executionState),'outcome'=>$ownOutcome];
        }

        if($recovering) return ['active'=>true,'pending'=>$pending,'recovering'=>true,'rootTaskIds'=>array_keys($roots),'resume'=>$resume,'outcome'=>$ownOutcome];
        if($pending) return ['active'=>true,'pending'=>true,'recovering'=>false,'rootTaskIds'=>array_keys($roots),'resume'=>$resume,'outcome'=>$ownOutcome];
        if(is_array($ownOutcome)&&($ownOutcome['state']??null)==='CONTINUED'&&!$successorFound) {
            return ['active'=>true,'pending'=>false,'recovering'=>true,'rootTaskIds'=>array_keys($roots),'resume'=>$resume,'outcome'=>$ownOutcome];
        }
        return ['active'=>false,'pending'=>false,'recovering'=>false,'rootTaskIds'=>array_keys($roots),'resume'=>null,'outcome'=>$ownOutcome];
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function resumeRow(array $row,string $at,string $state): array
    {
        $updated=(string)($row['updated_at']??'');
        $updatedEpoch=strtotime($updated);
        $leaseEpoch=is_string($row['lease_expires_at']??null)?strtotime((string)$row['lease_expires_at']):false;
        $fresh=$updatedEpoch!==false&&(strtotime($at)-$updatedEpoch)<=900;
        if($leaseEpoch!==false&&$leaseEpoch>strtotime($at)) $fresh=true;
        return [
            'executionId'=>(string)($row['execution_id']??''),
            'state'=>$state,
            'requiredCapability'=>(string)($row['required_capability']??''),
            'heartbeatAt'=>$updated!==''?$updated:null,
            'heartbeatFresh'=>$fresh,
            'leaseExpiresAt'=>$row['lease_expires_at']===null?null:(string)$row['lease_expires_at'],
            'checkpoint'=>self::safeCheckpoint((string)($row['checkpoint_json']??'{}')),
        ];
    }

    /** @param array<string,mixed> $task */
    private function legacyTerminalEvidence(string $taskId, array $task): bool
    {
        $summary=is_string($task['result_summary']??null)&&trim((string)$task['result_summary'])!=='';
        $artifact=false;
        if(self::tablePresent($this->pdo,'control_artifacts')){
            $q=$this->pdo->prepare('SELECT 1 FROM control_artifacts WHERE task_id=:task LIMIT 1');$q->execute(['task'=>$taskId]);$artifact=$q->fetchColumn()!==false;
        }
        $event=false;
        if(self::tablePresent($this->pdo,'control_task_events')){
            $q=$this->pdo->prepare("SELECT 1 FROM control_task_events WHERE task_id=:task AND state='COMPLETED' AND progress=100 LIMIT 1");$q->execute(['task'=>$taskId]);$event=$q->fetchColumn()!==false;
        }
        return $event&&($summary||$artifact);
    }

    /** @return array<string,mixed> */
    private static function safeCheckpoint(string $json): array
    {
        $checkpoint=self::decodedCheckpoint($json);$out=[];
        foreach(['mode','releaseMode','releaseTrack','repository','siteId'] as $key) if(is_string($checkpoint[$key]??null))$out[$key]=(string)$checkpoint[$key];
        if(is_array($checkpoint['continuation']??null)){
            $c=$checkpoint['continuation'];
            $out['continuation']=[
                'enabled'=>($c['enabled']??false)===true,
                'rootTaskId'=>is_string($c['rootTaskId']??null)?(string)$c['rootTaskId']:null,
                'step'=>is_int($c['step']??null)?$c['step']:null,
                'maxSteps'=>is_int($c['maxSteps']??null)?$c['maxSteps']:null,
            ];
        }
        if(is_array($checkpoint['_continuationOutcome']??null)){
            $o=$checkpoint['_continuationOutcome'];
            $out['continuationOutcome']=[
                'state'=>is_string($o['state']??null)?(string)$o['state']:null,
                'at'=>is_string($o['at']??null)?(string)$o['at']:null,
                'attempts'=>is_int($o['attempts']??null)?$o['attempts']:(int)($o['attempts']??0),
                'nextEligibleAt'=>is_string($o['nextEligibleAt']??null)?(string)$o['nextEligibleAt']:null,
                'nextTaskId'=>is_string($o['nextTaskId']??null)?(string)$o['nextTaskId']:null,
            ];
        }
        return $out;
    }

    /** @return array<string,mixed> */
    private static function decodedCheckpoint(string $json): array
    {
        try{$v=json_decode($json,true,32,JSON_THROW_ON_ERROR);return is_array($v)?$v:[];}catch(Throwable){return [];}
    }

    private static function tablePresent(PDO $pdo,string $table): bool
    {
        $q=$pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name");$q->execute(['name'=>$table]);return $q->fetchColumn()!==false;
    }
    private static function timestamp(string $value): string
    {
        $stamp=strtotime($value);if($stamp===false)throw new RuntimeException('Completion timestamp is invalid');return gmdate('c',$stamp);
    }
    private static function uuid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$value)===1;
    }
}
