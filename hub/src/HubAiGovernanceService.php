<?php

declare(strict_types=1);

require_once __DIR__ . '/HubSelfSufficientAiMigration.php';

final class HubAiGovernanceException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'AI_GOVERNANCE_FAILED') { parent::__construct($message); }
}

/**
 * Evidence/routing extension over canonical M12-M15 authorities.
 * It never creates tasks, executions, conversations, memory or approvals.
 */
final class HubAiGovernanceService
{
    private const DATA_RANK = ['PUBLIC'=>0,'INTERNAL'=>1,'CONFIDENTIAL'=>2,'SECRET'=>3];
    private const STRATEGIES = ['SAVER','BALANCED','QUALITY','OWNER_OVERRIDE'];

    public function __construct(private readonly PDO $pdo) { $this->assertReady(); }

    public static function schemaPresent(PDO $pdo): bool
    {
        try { return (int)$pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='control_ai_models'")->fetchColumn() === 1; }
        catch (Throwable) { return false; }
    }

    /** @return array<string,mixed> */
    public function catalog(): array
    {
        $rows=$this->pdo->query("SELECT m.provider_id,m.model_id,m.display_name,m.lifecycle,m.context_window_tokens,m.max_output_tokens,m.tool_calling,m.structured_output,m.vision,m.audio,m.file_support,m.coding_rank,m.reasoning_rank,m.latency_rank,m.max_data_classification,m.enabled,p.lifecycle AS provider_lifecycle,p.current_availability,p.region,h.attempts,h.successes,h.timeouts,h.rate_limits,h.malformed_responses,h.tool_failures,h.circuit_state,h.circuit_until FROM control_ai_models m JOIN control_ai_provider_profiles p ON p.provider_id=m.provider_id LEFT JOIN control_ai_model_health h ON h.provider_id=m.provider_id AND h.model_id=m.model_id ORDER BY m.provider_id,m.model_id")->fetchAll();
        return ['schemaVersion'=>1,'models'=>array_map([self::class,'modelRow'],$rows)];
    }

    /**
     * @param list<string> $preferredModels
     * @return array<string,mixed>
     */
    public function selectModel(string $userId,string $projectId,string $executionId,string $taskId,string $providerId,string $capability,string $dataClassification,string $strategy,array $preferredModels,int $estimatedInputTokens,int $estimatedOutputTokens,int $premiumBaselineMicrounits,array $versions,?string $now=null): array
    {
        $at=self::timestamp($now??gmdate('c')); $strategy=strtoupper(trim($strategy)); $dataClassification=strtoupper(trim($dataClassification));
        if (!isset(self::DATA_RANK[$dataClassification])) throw new HubAiGovernanceException('Data classification is invalid','AI_ROUTE_INVALID');
        if (!in_array($strategy,self::STRATEGIES,true)) throw new HubAiGovernanceException('Routing strategy is invalid','AI_ROUTE_INVALID');
        foreach ([$estimatedInputTokens,$estimatedOutputTokens,$premiumBaselineMicrounits] as $value) if ($value<0) throw new HubAiGovernanceException('Routing estimate is invalid','AI_ROUTE_INVALID');
        $context=$this->executionContext($userId,$projectId,$executionId,$taskId,$capability);
        $this->assertBudget($userId,$projectId,$providerId,$estimatedInputTokens,$estimatedOutputTokens,$at);
        $candidates=$this->candidates($providerId,$capability,$dataClassification,$preferredModels,$estimatedInputTokens,$estimatedOutputTokens,$at);
        if ($candidates===[]) throw new HubAiGovernanceException('No qualified AI model is currently eligible','AI_ROUTE_UNAVAILABLE');
        usort($candidates,fn(array $a,array $b):int=>$this->score($b,$strategy)<=>$this->score($a,$strategy) ?: strcmp((string)$a['model_id'],(string)$b['model_id']));
        $selected=$candidates[0]; $routeId=self::uuid(); $estimated=(int)$selected['estimated_microunits'];
        $reason=$this->reason($selected,$strategy,$preferredModels);
        $this->pdo->prepare("INSERT INTO control_ai_route_decisions(route_id,execution_id,task_id,project_id,user_id,route_kind,required_capability,data_classification,provider_id,model_id,routing_strategy,reason_code,estimated_microunits,premium_baseline_microunits,routing_policy_version,prompt_policy_version,tool_policy_version,decision_state,created_at,metadata_json) VALUES(:id,:execution,:task,:project,:user,'AI_PROVIDER',:capability,:class,:provider,:model,:strategy,:reason,:estimated,:baseline,:routing,:prompt,:tool,'SELECTED',:at,:meta)")->execute(['id'=>$routeId,'execution'=>$executionId,'task'=>$taskId,'project'=>$projectId,'user'=>$userId,'capability'=>$capability,'class'=>$dataClassification,'provider'=>$providerId,'model'=>$selected['model_id'],'strategy'=>$strategy,'reason'=>$reason,'estimated'=>$estimated,'baseline'=>$premiumBaselineMicrounits,'routing'=>$this->version($versions['routing']??'m16-v1'),'prompt'=>$this->version($versions['prompt']??'native-v1'),'tool'=>$this->version($versions['tool']??'bounded-v1'),'at'=>$at,'meta'=>json_encode(['vaultRevisionId'=>$context['vault_revision_id']],JSON_THROW_ON_ERROR)]);
        return ['schemaVersion'=>1,'routeId'=>$routeId,'providerId'=>$providerId,'modelId'=>(string)$selected['model_id'],'estimatedMicrounits'=>$estimated,'premiumBaselineMicrounits'=>$premiumBaselineMicrounits,'reasonCode'=>$reason,'strategy'=>strtolower($strategy)];
    }

    /**
     * Route across already-registered providers using the same M16 evidence,
     * budget, circuit and canonical execution authorities.
     * @param list<string> $providerIds @param list<string> $preferredModels
     * @return array<string,mixed>
     */
    public function selectAcrossProviders(string $userId,string $projectId,string $executionId,string $taskId,array $providerIds,string $capability,string $dataClassification,string $strategy,array $preferredModels,int $estimatedInputTokens,int $estimatedOutputTokens,int $premiumBaselineMicrounits,array $versions,?string $now=null): array
    {
        $at=self::timestamp($now??gmdate('c')); $strategy=strtoupper(trim($strategy)); $dataClassification=strtoupper(trim($dataClassification));
        if (!isset(self::DATA_RANK[$dataClassification]) || !in_array($strategy,self::STRATEGIES,true) || $providerIds===[] || count($providerIds)>16) throw new HubAiGovernanceException('Cross-provider route is invalid','AI_ROUTE_INVALID');
        foreach ([$estimatedInputTokens,$estimatedOutputTokens,$premiumBaselineMicrounits] as $value) if ($value<0) throw new HubAiGovernanceException('Routing estimate is invalid','AI_ROUTE_INVALID');
        $context=$this->executionContext($userId,$projectId,$executionId,$taskId,$capability); $providers=[]; $candidates=[];
        foreach ($providerIds as $provider) {
            if (!is_string($provider) || preg_match('/^[a-z0-9][a-z0-9._-]{1,63}$/i',$provider)!==1) throw new HubAiGovernanceException('Provider identity is invalid','AI_ROUTE_INVALID');
            $provider=strtolower($provider); if (isset($providers[$provider])) continue; $providers[$provider]=true;
            foreach ($this->candidates($provider,$capability,$dataClassification,$preferredModels,$estimatedInputTokens,$estimatedOutputTokens,$at) as $candidate) $candidates[]=$candidate;
        }
        if ($candidates===[]) throw new HubAiGovernanceException('No qualified AI provider is currently eligible','AI_ROUTE_UNAVAILABLE');
        usort($candidates,fn(array $a,array $b):int=>$this->score($b,$strategy)<=>$this->score($a,$strategy) ?: strcmp((string)$a['provider_id'].':'.(string)$a['model_id'],(string)$b['provider_id'].':'.(string)$b['model_id']));
        $selected=null; $budgetError=null;
        foreach ($candidates as $candidate) { try { $this->assertBudget($userId,$projectId,(string)$candidate['provider_id'],$estimatedInputTokens,$estimatedOutputTokens,$at); $selected=$candidate; break; } catch (HubAiGovernanceException $error) { if (!str_starts_with($error->codeName,'AI_BUDGET_')) throw $error; $budgetError=$error; } }
        if (!is_array($selected)) { if ($budgetError instanceof HubAiGovernanceException) throw $budgetError; throw new HubAiGovernanceException('No provider fits the configured budget','AI_BUDGET_TASK_LIMIT'); }
        $routeId=self::uuid(); $providerId=(string)$selected['provider_id']; $modelId=(string)$selected['model_id']; $estimated=(int)$selected['estimated_microunits']; $reason=$this->reason($selected,$strategy,$preferredModels);
        $this->pdo->prepare("INSERT INTO control_ai_route_decisions(route_id,execution_id,task_id,project_id,user_id,route_kind,required_capability,data_classification,provider_id,model_id,routing_strategy,reason_code,estimated_microunits,premium_baseline_microunits,routing_policy_version,prompt_policy_version,tool_policy_version,decision_state,created_at,metadata_json) VALUES(:id,:execution,:task,:project,:user,'AI_PROVIDER',:capability,:class,:provider,:model,:strategy,:reason,:estimated,:baseline,:routing,:prompt,:tool,'SELECTED',:at,:meta)")->execute(['id'=>$routeId,'execution'=>$executionId,'task'=>$taskId,'project'=>$projectId,'user'=>$userId,'capability'=>$capability,'class'=>$dataClassification,'provider'=>$providerId,'model'=>$modelId,'strategy'=>$strategy,'reason'=>$reason,'estimated'=>$estimated,'baseline'=>$premiumBaselineMicrounits,'routing'=>$this->version($versions['routing']??'m16-multiprovider-v1'),'prompt'=>$this->version($versions['prompt']??'native-v1'),'tool'=>$this->version($versions['tool']??'bounded-v1'),'at'=>$at,'meta'=>json_encode(['vaultRevisionId'=>$context['vault_revision_id'],'candidateProviders'=>array_keys($providers)],JSON_THROW_ON_ERROR)]);
        return ['schemaVersion'=>1,'routeId'=>$routeId,'providerId'=>$providerId,'modelId'=>$modelId,'estimatedMicrounits'=>$estimated,'premiumBaselineMicrounits'=>$premiumBaselineMicrounits,'reasonCode'=>$reason,'strategy'=>strtolower($strategy)];
    }

    /** @param array<string,mixed> $metadata */
    public function recordOutcome(string $routeId,string $status,string $qaStatus,int $retryCount,int $latencyMs,int $actualMicrounits,bool $humanCorrection,bool $rework,array $metadata=[],?string $now=null): array
    {
        $routeId=self::uuidValue($routeId); $status=strtoupper(trim($status)); $qaStatus=strtoupper(trim($qaStatus)); $at=self::timestamp($now??gmdate('c'));
        if (!in_array($status,['PASSED','FAILED','DEGRADED','CANCELLED'],true) || !in_array($qaStatus,['PASS','FAIL','NOT_APPLICABLE','NOT_RUN'],true) || min($retryCount,$latencyMs,$actualMicrounits)<0) throw new HubAiGovernanceException('AI outcome is invalid','AI_OUTCOME_INVALID');
        $q=$this->pdo->prepare('SELECT execution_id,provider_id,model_id FROM control_ai_route_decisions WHERE route_id=:id'); $q->execute(['id'=>$routeId]); $route=$q->fetch();
        if (!is_array($route)) throw new HubAiGovernanceException('AI route was not found','AI_ROUTE_NOT_FOUND');
        $id=self::uuid();
        try {
            $this->pdo->beginTransaction();
            $this->pdo->prepare('INSERT INTO control_ai_outcomes(outcome_id,route_id,execution_id,status,qa_status,retry_count,latency_ms,actual_microunits,human_correction,rework_required,completed_at,metadata_json) VALUES(:id,:route,:execution,:status,:qa,:retry,:latency,:cost,:human,:rework,:at,:meta)')->execute(['id'=>$id,'route'=>$routeId,'execution'=>$route['execution_id'],'status'=>$status,'qa'=>$qaStatus,'retry'=>$retryCount,'latency'=>$latencyMs,'cost'=>$actualMicrounits,'human'=>$humanCorrection?1:0,'rework'=>$rework?1:0,'at'=>$at,'meta'=>self::metadata($metadata)]);
            if (is_string($route['provider_id']) && is_string($route['model_id'])) $this->updateHealth($route['provider_id'],$route['model_id'],$status,$latencyMs,$actualMicrounits,$metadata,$at);
            $this->pdo->commit();
        } catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); if ($error instanceof HubAiGovernanceException) throw $error; throw new HubAiGovernanceException('AI outcome could not be recorded','AI_OUTCOME_PERSIST_FAILED'); }
        return ['schemaVersion'=>1,'outcomeId'=>$id,'routeId'=>$routeId,'status'=>strtolower($status),'qaStatus'=>strtolower($qaStatus),'savedMicrounits'=>$this->savedForRoute($routeId,$actualMicrounits)];
    }

    /** @return array<string,mixed> */
    public function savingsSummary(string $userId,?string $projectId=null): array
    {
        $sql="SELECT COUNT(*) AS tasks,COALESCE(SUM(CASE WHEN r.premium_baseline_microunits>o.actual_microunits THEN r.premium_baseline_microunits-o.actual_microunits ELSE 0 END),0) AS saved,COALESCE(SUM(o.actual_microunits),0) AS actual,COALESCE(SUM(r.premium_baseline_microunits),0) AS baseline FROM control_ai_outcomes o JOIN control_ai_route_decisions r ON r.route_id=o.route_id WHERE r.user_id=:user"; $params=['user'=>$userId];
        if ($projectId!==null) { $sql.=' AND r.project_id=:project'; $params['project']=$projectId; }
        $q=$this->pdo->prepare($sql); $q->execute($params); $row=$q->fetch()?:[];
        return ['schemaVersion'=>1,'successfulOrAttemptedTasks'=>(int)($row['tasks']??0),'actualMicrounits'=>(int)($row['actual']??0),'premiumBaselineMicrounits'=>(int)($row['baseline']??0),'savedMicrounits'=>(int)($row['saved']??0)];
    }

    /** @return list<array<string,mixed>> */
    private function candidates(string $provider,string $capability,string $dataClass,array $preferred,int $input,int $output,string $at): array
    {
        $q=$this->pdo->prepare("SELECT m.*,p.current_availability,p.max_data_classification AS provider_data_class,h.attempts,h.successes,h.timeouts,h.rate_limits,h.malformed_responses,h.tool_failures,h.circuit_state,h.circuit_until FROM control_ai_models m JOIN control_ai_provider_profiles p ON p.provider_id=m.provider_id LEFT JOIN control_ai_model_health h ON h.provider_id=m.provider_id AND h.model_id=m.model_id WHERE m.provider_id=:provider AND m.enabled=1 AND m.lifecycle='PRODUCTION' AND p.lifecycle='PRODUCTION' AND p.current_availability<>'UNAVAILABLE' AND EXISTS(SELECT 1 FROM control_execution_provider_capabilities pc WHERE pc.provider_id=m.provider_id AND pc.capability=:capability AND pc.enabled=1)"); $q->execute(['provider'=>$provider,'capability'=>$capability]); $rows=[];
        foreach ($q->fetchAll() as $row) {
            if (!$this->allowsData((string)$row['max_data_classification'],$dataClass) || !$this->allowsData((string)$row['provider_data_class'],$dataClass)) continue;
            if (($row['circuit_state']??'CLOSED')==='OPEN' && ($row['circuit_until']===null || strtotime((string)$row['circuit_until'])>strtotime($at))) continue;
            if (!$this->preferredCandidate((string)$row['provider_id'],(string)$row['model_id'],$preferred)) continue;
            $row['estimated_microunits']=$this->estimate((string)$row['provider_id'],(string)$row['model_id'],$input,$output,$at);
            $row['quality_evidence']=$this->qualityEvidence((string)$row['provider_id'],(string)$row['model_id']);
            $rows[]=$row;
        }
        return $rows;
    }

    private function score(array $row,string $strategy): int
    {
        $attempts=(int)($row['attempts']??0); $successes=(int)($row['successes']??0); $reliability=$attempts>0?(int)round($successes*100/$attempts):70;
        $quality=(int)($row['quality_evidence']??50); $reasoning=(int)$row['reasoning_rank']; $latency=100-(int)$row['latency_rank']; $cost=(int)$row['estimated_microunits']; $costScore=max(0,100-min(100,(int)floor($cost/1000)));
        return match($strategy) { 'SAVER'=>$costScore*5+$reliability*3+$quality*2, 'QUALITY'=>$quality*4+$reasoning*3+$reliability*2+$latency, 'OWNER_OVERRIDE'=>$quality*3+$reliability*3+$reasoning*2+$costScore*2, default=>$quality*3+$reliability*3+$costScore*2+$latency*2 };
    }

    private function reason(array $row,string $strategy,array $preferred): string
    {
        if (($row['attempts']??0)>0) return 'OUTCOME_EVIDENCE';
        if (($row['quality_evidence']??50)!==50) return 'QUALIFICATION_EVIDENCE';
        if ($preferred!==[]) return 'CURRENT_POLICY_COMPATIBILITY';
        return $strategy==='SAVER'?'LOWEST_SAFE_COST':'CAPABILITY_POLICY';
    }

    /** @param list<string> $preferred */
    private function preferredCandidate(string $provider,string $model,array $preferred): bool
    {
        if ($preferred===[]) return true;
        foreach ($preferred as $value) {
            if (!is_string($value)) continue;
            if ($value===$model || strtolower($value)===strtolower($provider.':'.$model)) return true;
        }
        return false;
    }

    private function estimate(string $provider,string $model,int $input,int $output,string $at): int
    {
        $q=$this->pdo->prepare("SELECT input_microunits_per_million,cached_input_microunits_per_million,output_microunits_per_million FROM control_provider_model_rates WHERE provider_id=:provider AND model=:model AND active=1 AND effective_at<=:at ORDER BY effective_at DESC LIMIT 1"); $q->execute(['provider'=>$provider,'model'=>$model,'at'=>$at]); $r=$q->fetch(); if (!is_array($r)) return PHP_INT_MAX>>10;
        return (int)ceil(($input*(int)$r['input_microunits_per_million']+$output*(int)$r['output_microunits_per_million'])/1_000_000);
    }

    private function qualityEvidence(string $provider,string $model): int
    {
        $q=$this->pdo->prepare('SELECT AVG(score_basis_points) FROM control_ai_model_qualifications WHERE provider_id=:provider AND model_id=:model AND pass=1'); $q->execute(['provider'=>$provider,'model'=>$model]); $value=$q->fetchColumn(); return $value===null||$value===false?50:(int)round((float)$value/100);
    }

    private function assertBudget(string $user,string $project,string $provider,int $input,int $output,string $at): void
    {
        $estimated=0; $policies=$this->pdo->prepare("SELECT * FROM control_ai_budget_policies WHERE enabled=1 AND ((scope_kind='GLOBAL' AND scope_ref='*') OR (scope_kind='USER' AND scope_ref=:user) OR (scope_kind='PROJECT' AND scope_ref=:project) OR (scope_kind='PROVIDER' AND scope_ref=:provider)) ORDER BY CASE scope_kind WHEN 'PROJECT' THEN 1 WHEN 'USER' THEN 2 WHEN 'PROVIDER' THEN 3 ELSE 4 END"); $policies->execute(['user'=>$user,'project'=>$project,'provider'=>$provider]);
        foreach ($policies->fetchAll() as $policy) {
            $max=(int)$policy['max_task_microunits']; if ($max<=0) continue; if ($estimated===0) $estimated=$this->cheapestEstimate($provider,$input,$output,$at);
            if ($estimated>$max && (int)$policy['hard_limit']===1) throw new HubAiGovernanceException('AI task cost exceeds the configured hard limit','AI_BUDGET_TASK_LIMIT');
        }
    }

    private function cheapestEstimate(string $provider,int $input,int $output,string $at): int
    {
        $q=$this->pdo->prepare("SELECT model_id FROM control_ai_models WHERE provider_id=:provider AND enabled=1 AND lifecycle='PRODUCTION'"); $q->execute(['provider'=>$provider]); $values=[]; foreach($q->fetchAll() as $row)$values[]=$this->estimate($provider,(string)$row['model_id'],$input,$output,$at); return $values===[]?PHP_INT_MAX>>10:min($values);
    }

    private function executionContext(string $user,string $project,string $execution,string $task,string $capability): array
    {
        foreach ([$user,$project,$execution,$task] as $id) self::uuidValue($id);
        if (preg_match('/^[a-z0-9][a-z0-9._:-]{2,120}$/i',$capability)!==1) throw new HubAiGovernanceException('Capability is invalid','AI_ROUTE_INVALID');
        $q=$this->pdo->prepare('SELECT e.vault_revision_id,e.required_capability FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id WHERE e.execution_id=:execution AND e.task_id=:task AND e.project_id=:project AND t.user_id=:user'); $q->execute(['execution'=>$execution,'task'=>$task,'project'=>$project,'user'=>$user]); $row=$q->fetch();
        if (!is_array($row) || !is_string($row['required_capability']??null) || !hash_equals((string)$row['required_capability'],$capability)) throw new HubAiGovernanceException('AI route does not match canonical execution capability','AI_ROUTE_CONTEXT_INVALID'); return $row;
    }

    private function updateHealth(string $provider,string $model,string $status,int $latency,int $cost,array $metadata,string $at): void
    {
        $timeout=($metadata['failureCategory']??null)==='timeout'?1:0; $rate=($metadata['failureCategory']??null)==='rate_limit'?1:0; $malformed=($metadata['failureCategory']??null)==='malformed'?1:0; $tool=($metadata['failureCategory']??null)==='tool'?1:0; $success=$status==='PASSED'?1:0;
        $this->pdo->prepare("INSERT INTO control_ai_model_health(provider_id,model_id,window_started_at,attempts,successes,timeouts,rate_limits,malformed_responses,tool_failures,total_latency_ms,total_cost_microunits,circuit_state,circuit_until,updated_at) VALUES(:provider,:model,:at,1,:success,:timeout,:rate,:malformed,:tool,:latency,:cost,'CLOSED',NULL,:at) ON CONFLICT(provider_id,model_id) DO UPDATE SET attempts=attempts+1,successes=successes+:success,timeouts=timeouts+:timeout,rate_limits=rate_limits+:rate,malformed_responses=malformed_responses+:malformed,tool_failures=tool_failures+:tool,total_latency_ms=total_latency_ms+:latency,total_cost_microunits=total_cost_microunits+:cost,updated_at=:at")->execute(['provider'=>$provider,'model'=>$model,'at'=>$at,'success'=>$success,'timeout'=>$timeout,'rate'=>$rate,'malformed'=>$malformed,'tool'=>$tool,'latency'=>$latency,'cost'=>$cost]);
        $q=$this->pdo->prepare('SELECT attempts,successes,timeouts,rate_limits FROM control_ai_model_health WHERE provider_id=:provider AND model_id=:model'); $q->execute(['provider'=>$provider,'model'=>$model]); $h=$q->fetch();
        if (is_array($h) && (int)$h['attempts']>=5 && ((int)$h['successes']*100/(int)$h['attempts'])<40 && ((int)$h['timeouts']+(int)$h['rate_limits'])>=2) $this->pdo->prepare("UPDATE control_ai_model_health SET circuit_state='OPEN',circuit_until=:until,updated_at=:at WHERE provider_id=:provider AND model_id=:model")->execute(['until'=>gmdate('c',strtotime($at)+900),'at'=>$at,'provider'=>$provider,'model'=>$model]);
    }

    private function savedForRoute(string $routeId,int $actual): int
    {
        $q=$this->pdo->prepare('SELECT premium_baseline_microunits FROM control_ai_route_decisions WHERE route_id=:id'); $q->execute(['id'=>$routeId]); return max(0,(int)$q->fetchColumn()-$actual);
    }
    private function allowsData(string $ceiling,string $data): bool { return (self::DATA_RANK[$ceiling]??-1)>=(self::DATA_RANK[$data]??99); }
    private static function modelRow(array $r): array { $attempts=(int)($r['attempts']??0); return ['providerId'=>(string)$r['provider_id'],'modelId'=>(string)$r['model_id'],'displayName'=>(string)$r['display_name'],'lifecycle'=>strtolower((string)$r['lifecycle']),'providerLifecycle'=>strtolower((string)$r['provider_lifecycle']),'availability'=>strtolower((string)$r['current_availability']),'contextWindowTokens'=>$r['context_window_tokens']===null?null:(int)$r['context_window_tokens'],'maxOutputTokens'=>$r['max_output_tokens']===null?null:(int)$r['max_output_tokens'],'toolCalling'=>(bool)$r['tool_calling'],'structuredOutput'=>(bool)$r['structured_output'],'vision'=>(bool)$r['vision'],'audio'=>(bool)$r['audio'],'fileSupport'=>(bool)$r['file_support'],'codingRank'=>(int)$r['coding_rank'],'reasoningRank'=>(int)$r['reasoning_rank'],'maxDataClassification'=>strtolower((string)$r['max_data_classification']),'reliabilityPercent'=>$attempts>0?(int)round((int)$r['successes']*100/$attempts):null,'circuitState'=>strtolower((string)($r['circuit_state']??'CLOSED')),'circuitUntil'=>$r['circuit_until']??null,'region'=>$r['region']??null]; }
    private function assertReady(): void { HubSelfSufficientAiMigration::assertCapabilityReady($this->pdo,dirname(__DIR__).'/migrations/015_self_sufficient_ai.sql'); }
    private static function version(mixed $v): string { if (!is_string($v) || preg_match('/^[A-Za-z0-9._:-]{2,80}$/',$v)!==1) throw new HubAiGovernanceException('Policy version is invalid','AI_ROUTE_INVALID'); return $v; }
    private static function metadata(array $v): string { $json=json_encode($v,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR); if (strlen($json)>8192) throw new HubAiGovernanceException('AI outcome metadata is too large','AI_OUTCOME_INVALID'); return $json; }
    private static function uuidValue(string $v): string { if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$v)!==1) throw new HubAiGovernanceException('Identity is invalid','AI_ROUTE_INVALID'); return strtolower($v); }
    private static function uuid(): string { $b=random_bytes(16);$b[6]=chr((ord($b[6])&15)|64);$b[8]=chr((ord($b[8])&63)|128);return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($b),4)); }
    private static function timestamp(string $v): string { if (strtotime($v)===false) throw new HubAiGovernanceException('Timestamp is invalid','AI_ROUTE_INVALID'); return gmdate('c',strtotime($v)); }
}
