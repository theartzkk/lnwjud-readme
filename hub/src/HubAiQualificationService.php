<?php

declare(strict_types=1);

final class HubAiQualificationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'AI_QUALIFICATION_FAILED') { parent::__construct($message); }
}

/**
 * Lifecycle/benchmark authority for M16 provider/model records.
 * It extends the existing provider registry and never owns tasks or executions.
 */
final class HubAiQualificationService
{
    private const LIFECYCLES = ['DISCOVERED','REGISTERED','BENCHMARKING','SANDBOX','APPROVED','PRODUCTION','DEGRADED','DISABLED'];
    private const DATA_CLASSES = ['PUBLIC','INTERNAL','CONFIDENTIAL','SECRET'];
    private const PROVIDER_KINDS = ['VPS','DEVICE','CODEX','MCP','API','BURST'];
    private const COST_CLASSES = ['INCLUDED','PREPAID','LOCAL_FREE','METERED'];

    public function __construct(private readonly PDO $pdo)
    {
        if (!self::schemaPresent($pdo)) throw new HubAiQualificationException('AI qualification schema is not ready','AI_QUALIFICATION_NOT_READY');
    }

    public static function schemaPresent(PDO $pdo): bool
    {
        try { return (int)$pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('control_execution_providers','control_ai_provider_profiles','control_ai_models','control_ai_model_qualifications')")->fetchColumn() === 4; }
        catch (Throwable) { return false; }
    }
    /** @param array<string,mixed> $metadata */
    public function registerProvider(string $providerId,string $displayName,string $providerKind='API',string $costClass='METERED',string $maxDataClassification='INTERNAL',array $metadata=[],?string $now=null): array
    {
        $providerId=self::provider($providerId); $displayName=self::label($displayName); $providerKind=strtoupper($providerKind); $costClass=strtoupper($costClass); $maxDataClassification=strtoupper($maxDataClassification); $at=self::timestamp($now??gmdate('c'));
        if (!in_array($providerKind,self::PROVIDER_KINDS,true) || !in_array($costClass,self::COST_CLASSES,true) || !in_array($maxDataClassification,self::DATA_CLASSES,true)) throw new HubAiQualificationException('Provider registration is invalid','AI_PROVIDER_INVALID');
        $meta=self::metadata($metadata);
        try {
            $this->pdo->beginTransaction();
            $this->pdo->prepare("INSERT INTO control_execution_providers(provider_id,provider_kind,display_name,availability_mode,cost_class,priority,enabled,observed_at,expires_at,metadata_json) VALUES(:id,:kind,:name,'ON_DEMAND',:cost,50,1,:at,NULL,:meta) ON CONFLICT(provider_id) DO UPDATE SET display_name=excluded.display_name,provider_kind=excluded.provider_kind,cost_class=excluded.cost_class,enabled=1,observed_at=excluded.observed_at,metadata_json=excluded.metadata_json")->execute(['id'=>$providerId,'kind'=>$providerKind,'name'=>$displayName,'cost'=>$costClass,'at'=>$at,'meta'=>$meta]);
            $this->pdo->prepare("INSERT INTO control_ai_provider_profiles(provider_id,lifecycle,privacy_policy_uri,region,max_data_classification,current_availability,free_quota_json,paid_quota_json,policy_version,observed_at,updated_at,metadata_json) VALUES(:id,'REGISTERED',NULL,NULL,:class,'UNKNOWN','{}','{}','qualification-v1',:at,:at,:meta) ON CONFLICT(provider_id) DO UPDATE SET max_data_classification=excluded.max_data_classification,updated_at=excluded.updated_at,metadata_json=excluded.metadata_json")->execute(['id'=>$providerId,'class'=>$maxDataClassification,'at'=>$at,'meta'=>$meta]);
            $this->pdo->commit();
        } catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); throw new HubAiQualificationException('Provider registration could not be persisted','AI_PROVIDER_PERSIST_FAILED'); }
        return $this->providerStatus($providerId);
    }

    /** @param list<string> $capabilities @param array<string,mixed> $metadata */
    public function registerModel(string $providerId,string $modelId,string $displayName,array $capabilities,int $codingRank=50,int $reasoningRank=50,int $latencyRank=50,string $maxDataClassification='INTERNAL',array $metadata=[],?string $now=null): array
    {
        $providerId=self::provider($providerId); $modelId=self::model($modelId); $displayName=self::label($displayName); $maxDataClassification=strtoupper($maxDataClassification); $at=self::timestamp($now??gmdate('c'));
        if (!in_array($maxDataClassification,self::DATA_CLASSES,true) || min($codingRank,$reasoningRank,$latencyRank)<0 || max($codingRank,$reasoningRank,$latencyRank)>100) throw new HubAiQualificationException('Model registration is invalid','AI_MODEL_INVALID');
        $provider=$this->providerStatus($providerId); if (($provider['lifecycle']??null)==='disabled') throw new HubAiQualificationException('Provider is disabled','AI_PROVIDER_DISABLED');
        $caps=self::capabilities($capabilities); $meta=self::metadata($metadata);
        $this->pdo->prepare("INSERT INTO control_ai_models(provider_id,model_id,display_name,lifecycle,context_window_tokens,max_output_tokens,tool_calling,structured_output,vision,audio,file_support,coding_rank,reasoning_rank,latency_rank,max_data_classification,capabilities_json,observed_at,updated_at,enabled,metadata_json) VALUES(:provider,:model,:name,'REGISTERED',NULL,NULL,0,0,0,0,0,:coding,:reasoning,:latency,:class,:caps,:at,:at,1,:meta) ON CONFLICT(provider_id,model_id) DO UPDATE SET display_name=excluded.display_name,coding_rank=excluded.coding_rank,reasoning_rank=excluded.reasoning_rank,latency_rank=excluded.latency_rank,max_data_classification=excluded.max_data_classification,capabilities_json=excluded.capabilities_json,updated_at=excluded.updated_at,metadata_json=excluded.metadata_json")->execute(['provider'=>$providerId,'model'=>$modelId,'name'=>$displayName,'coding'=>$codingRank,'reasoning'=>$reasoningRank,'latency'=>$latencyRank,'class'=>$maxDataClassification,'caps'=>json_encode($caps,JSON_THROW_ON_ERROR),'at'=>$at,'meta'=>$meta]);
        return $this->modelStatus($providerId,$modelId);
    }
    /** @param array<string,mixed> $metadata */
    public function recordQualification(string $providerId,string $modelId,string $suiteId,string $suiteVersion,string $taskType,int $scoreBasisPoints,bool $pass,int $latencyMs,int $estimatedMicrounits,?int $hallucinationBasisPoints=null,?int $toolSuccessBasisPoints=null,?string $evidenceSha256=null,array $metadata=[],?string $now=null): array
    {
        $providerId=self::provider($providerId); $modelId=self::model($modelId); $suiteId=self::token($suiteId,80); $suiteVersion=self::token($suiteVersion,80); $taskType=self::token($taskType,100); $at=self::timestamp($now??gmdate('c'));
        $this->modelStatus($providerId,$modelId);
        foreach ([$scoreBasisPoints,$latencyMs,$estimatedMicrounits] as $value) if ($value<0) throw new HubAiQualificationException('Qualification evidence is invalid','AI_QUALIFICATION_INVALID');
        if ($scoreBasisPoints>10000 || ($hallucinationBasisPoints!==null && ($hallucinationBasisPoints<0 || $hallucinationBasisPoints>10000)) || ($toolSuccessBasisPoints!==null && ($toolSuccessBasisPoints<0 || $toolSuccessBasisPoints>10000))) throw new HubAiQualificationException('Qualification evidence is invalid','AI_QUALIFICATION_INVALID');
        if ($evidenceSha256!==null && preg_match('/^[0-9a-f]{64}$/i',$evidenceSha256)!==1) throw new HubAiQualificationException('Qualification evidence hash is invalid','AI_QUALIFICATION_INVALID');
        $id=self::uuid();
        $this->pdo->prepare('INSERT INTO control_ai_model_qualifications(qualification_id,provider_id,model_id,suite_id,suite_version,task_type,score_basis_points,pass,latency_ms,estimated_microunits,hallucination_basis_points,tool_success_basis_points,evidence_sha256,observed_at,metadata_json) VALUES(:id,:provider,:model,:suite,:version,:task,:score,:pass,:latency,:cost,:hallucination,:tool,:evidence,:at,:meta)')->execute(['id'=>$id,'provider'=>$providerId,'model'=>$modelId,'suite'=>$suiteId,'version'=>$suiteVersion,'task'=>$taskType,'score'=>$scoreBasisPoints,'pass'=>$pass?1:0,'latency'=>$latencyMs,'cost'=>$estimatedMicrounits,'hallucination'=>$hallucinationBasisPoints,'tool'=>$toolSuccessBasisPoints,'evidence'=>$evidenceSha256===null?null:strtolower($evidenceSha256),'at'=>$at,'meta'=>self::metadata($metadata)]);
        $this->pdo->prepare("UPDATE control_ai_models SET lifecycle=CASE WHEN lifecycle IN ('REGISTERED','DISCOVERED') THEN 'BENCHMARKING' ELSE lifecycle END,updated_at=:at WHERE provider_id=:provider AND model_id=:model")->execute(['at'=>$at,'provider'=>$providerId,'model'=>$modelId]);
        $this->pdo->prepare("UPDATE control_ai_provider_profiles SET lifecycle=CASE WHEN lifecycle IN ('REGISTERED','DISCOVERED') THEN 'BENCHMARKING' ELSE lifecycle END,updated_at=:at WHERE provider_id=:provider")->execute(['at'=>$at,'provider'=>$providerId]);
        return ['schemaVersion'=>1,'qualificationId'=>$id,'providerId'=>$providerId,'modelId'=>$modelId,'pass'=>$pass,'scoreBasisPoints'=>$scoreBasisPoints,'observedAt'=>$at];
    }

    public function promoteModel(string $providerId,string $modelId,string $targetLifecycle='PRODUCTION',?string $now=null): array
    {
        $providerId=self::provider($providerId); $modelId=self::model($modelId); $targetLifecycle=strtoupper($targetLifecycle); $at=self::timestamp($now??gmdate('c'));
        if (!in_array($targetLifecycle,['SANDBOX','APPROVED','PRODUCTION'],true)) throw new HubAiQualificationException('Promotion target is invalid','AI_PROMOTION_INVALID');
        $this->modelStatus($providerId,$modelId); $summary=$this->promotionEvidence($providerId,$modelId);
        if ($targetLifecycle==='APPROVED' && ((int)$summary['passingEvidence']<1 || (int)$summary['averageScoreBasisPoints']<7000)) throw new HubAiQualificationException('Model does not have enough passing qualification evidence','AI_PROMOTION_EVIDENCE_REQUIRED');
        if ($targetLifecycle==='PRODUCTION' && ((int)$summary['passingTaskTypes']<3 || (int)$summary['averageScoreBasisPoints']<7000 || (int)$summary['failingEvidence']>0)) throw new HubAiQualificationException('Production promotion requires three passing task types, a 70% average, and no failing evidence in the latest suite version','AI_PROMOTION_EVIDENCE_REQUIRED');
        $this->pdo->beginTransaction();
        try {
            $this->pdo->prepare('UPDATE control_ai_models SET lifecycle=:lifecycle,enabled=1,updated_at=:at WHERE provider_id=:provider AND model_id=:model')->execute(['lifecycle'=>$targetLifecycle,'at'=>$at,'provider'=>$providerId,'model'=>$modelId]);
            $providerLifecycle=$targetLifecycle==='PRODUCTION'?'PRODUCTION':($targetLifecycle==='APPROVED'?'APPROVED':'SANDBOX');
            $this->pdo->prepare("UPDATE control_ai_provider_profiles SET lifecycle=CASE WHEN lifecycle IN ('DISABLED','DEGRADED','PRODUCTION') THEN lifecycle ELSE :lifecycle END,updated_at=:at WHERE provider_id=:provider")->execute(['lifecycle'=>$providerLifecycle,'at'=>$at,'provider'=>$providerId]);
            $this->pdo->commit();
        } catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); throw new HubAiQualificationException('Model promotion could not be persisted','AI_PROMOTION_PERSIST_FAILED'); }
        return $this->modelStatus($providerId,$modelId);
    }
    /** @return array{passingEvidence:int,failingEvidence:int,passingTaskTypes:int,averageScoreBasisPoints:int,suiteId:?string,suiteVersion:?string} */
    private function promotionEvidence(string $providerId,string $modelId): array
    {
        $latest=$this->pdo->prepare('SELECT suite_id,suite_version FROM control_ai_model_qualifications WHERE provider_id=:provider AND model_id=:model ORDER BY observed_at DESC,qualification_id DESC LIMIT 1');
        $latest->execute(['provider'=>$providerId,'model'=>$modelId]); $suite=$latest->fetch();
        if (!is_array($suite)) return ['passingEvidence'=>0,'failingEvidence'=>0,'passingTaskTypes'=>0,'averageScoreBasisPoints'=>0,'suiteId'=>null,'suiteVersion'=>null];
        $q=$this->pdo->prepare('SELECT SUM(CASE WHEN pass=1 THEN 1 ELSE 0 END) AS passing,SUM(CASE WHEN pass=0 THEN 1 ELSE 0 END) AS failing,COUNT(DISTINCT CASE WHEN pass=1 THEN task_type END) AS passing_types,COALESCE(ROUND(AVG(CASE WHEN pass=1 THEN score_basis_points END)),0) AS average_score FROM control_ai_model_qualifications WHERE provider_id=:provider AND model_id=:model AND suite_id=:suite AND suite_version=:version');
        $q->execute(['provider'=>$providerId,'model'=>$modelId,'suite'=>$suite['suite_id'],'version'=>$suite['suite_version']]); $row=$q->fetch()?:[];
        return ['passingEvidence'=>(int)($row['passing']??0),'failingEvidence'=>(int)($row['failing']??0),'passingTaskTypes'=>(int)($row['passing_types']??0),'averageScoreBasisPoints'=>(int)($row['average_score']??0),'suiteId'=>(string)$suite['suite_id'],'suiteVersion'=>(string)$suite['suite_version']];
    }

    /** @return array<string,mixed> */
    public function providerStatus(string $providerId): array
    {
        $providerId=self::provider($providerId); $q=$this->pdo->prepare('SELECT e.display_name,e.provider_kind,e.cost_class,e.enabled,p.lifecycle,p.max_data_classification,p.current_availability,p.policy_version,p.updated_at FROM control_execution_providers e JOIN control_ai_provider_profiles p ON p.provider_id=e.provider_id WHERE e.provider_id=:provider'); $q->execute(['provider'=>$providerId]); $row=$q->fetch();
        if (!is_array($row)) throw new HubAiQualificationException('Provider was not found','AI_PROVIDER_NOT_FOUND');
        $models=$this->pdo->prepare('SELECT COUNT(*) AS total,SUM(CASE WHEN lifecycle=\'PRODUCTION\' AND enabled=1 THEN 1 ELSE 0 END) AS production FROM control_ai_models WHERE provider_id=:provider'); $models->execute(['provider'=>$providerId]); $counts=$models->fetch()?:[];
        return ['schemaVersion'=>1,'providerId'=>$providerId,'displayName'=>(string)$row['display_name'],'providerKind'=>strtolower((string)$row['provider_kind']),'costClass'=>strtolower((string)$row['cost_class']),'enabled'=>(bool)$row['enabled'],'lifecycle'=>strtolower((string)$row['lifecycle']),'availability'=>strtolower((string)$row['current_availability']),'maxDataClassification'=>strtolower((string)$row['max_data_classification']),'policyVersion'=>(string)$row['policy_version'],'models'=>['total'=>(int)($counts['total']??0),'production'=>(int)($counts['production']??0)],'updatedAt'=>(string)$row['updated_at']];
    }

    /** @return array<string,mixed> */
    public function modelStatus(string $providerId,string $modelId): array
    {
        $providerId=self::provider($providerId); $modelId=self::model($modelId); $q=$this->pdo->prepare('SELECT display_name,lifecycle,enabled,coding_rank,reasoning_rank,latency_rank,max_data_classification,capabilities_json,updated_at FROM control_ai_models WHERE provider_id=:provider AND model_id=:model'); $q->execute(['provider'=>$providerId,'model'=>$modelId]); $row=$q->fetch();
        if (!is_array($row)) throw new HubAiQualificationException('Model was not found','AI_MODEL_NOT_FOUND');
        $e=$this->pdo->prepare('SELECT COUNT(*) AS total,SUM(CASE WHEN pass=1 THEN 1 ELSE 0 END) AS passing,SUM(CASE WHEN pass=0 THEN 1 ELSE 0 END) AS failing,COUNT(DISTINCT CASE WHEN pass=1 THEN task_type END) AS passing_types,COALESCE(ROUND(AVG(CASE WHEN pass=1 THEN score_basis_points END)),0) AS average_score,MAX(observed_at) AS last_observed FROM control_ai_model_qualifications WHERE provider_id=:provider AND model_id=:model'); $e->execute(['provider'=>$providerId,'model'=>$modelId]); $summary=$e->fetch()?:[];
        $caps=json_decode((string)$row['capabilities_json'],true); if (!is_array($caps)) $caps=[];
        return ['schemaVersion'=>1,'providerId'=>$providerId,'modelId'=>$modelId,'displayName'=>(string)$row['display_name'],'lifecycle'=>strtolower((string)$row['lifecycle']),'enabled'=>(bool)$row['enabled'],'ranks'=>['coding'=>(int)$row['coding_rank'],'reasoning'=>(int)$row['reasoning_rank'],'latency'=>(int)$row['latency_rank']],'maxDataClassification'=>strtolower((string)$row['max_data_classification']),'capabilities'=>array_values(array_filter($caps,'is_string')),'qualification'=>['totalEvidence'=>(int)($summary['total']??0),'passingEvidence'=>(int)($summary['passing']??0),'failingEvidence'=>(int)($summary['failing']??0),'passingTaskTypes'=>(int)($summary['passing_types']??0),'averageScoreBasisPoints'=>(int)($summary['average_score']??0),'lastObservedAt'=>$summary['last_observed']??null],'updatedAt'=>(string)$row['updated_at']];
    }

    /** @param array<string,mixed> $metadata */
    public function setAvailability(string $providerId,string $availability,array $metadata=[],?string $now=null): array
    {
        $providerId=self::provider($providerId); $availability=strtoupper($availability); $at=self::timestamp($now??gmdate('c'));
        if (!in_array($availability,['AVAILABLE','DEGRADED','UNAVAILABLE','UNKNOWN'],true)) throw new HubAiQualificationException('Provider availability is invalid','AI_PROVIDER_INVALID');
        $this->providerStatus($providerId); $lifecycle=$availability==='UNAVAILABLE'?'DEGRADED':null;
        $this->pdo->prepare('UPDATE control_ai_provider_profiles SET current_availability=:availability,lifecycle=CASE WHEN :lifecycle IS NULL THEN lifecycle WHEN lifecycle=\'DISABLED\' THEN lifecycle ELSE :lifecycle END,updated_at=:at,metadata_json=:meta WHERE provider_id=:provider')->execute(['availability'=>$availability,'lifecycle'=>$lifecycle,'at'=>$at,'meta'=>self::metadata($metadata),'provider'=>$providerId]);
        return $this->providerStatus($providerId);
    }
    /** @param list<string> $values @return list<string> */
    private static function capabilities(array $values): array
    {
        $out=[]; foreach ($values as $value) { if (!is_string($value)) throw new HubAiQualificationException('Model capability is invalid','AI_MODEL_INVALID'); $value=self::token($value,100); $out[$value]=true; }
        $keys=array_keys($out); sort($keys,SORT_STRING); if (count($keys)>64) throw new HubAiQualificationException('Too many model capabilities','AI_MODEL_INVALID'); return $keys;
    }
    private static function provider(string $value): string
    {
        $value=strtolower(trim($value)); if (preg_match('/^[a-z0-9][a-z0-9._-]{1,63}$/',$value)!==1) throw new HubAiQualificationException('Provider identity is invalid','AI_PROVIDER_INVALID'); return $value;
    }
    private static function model(string $value): string
    {
        $value=trim($value); if (preg_match('/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/',$value)!==1) throw new HubAiQualificationException('Model identity is invalid','AI_MODEL_INVALID'); return $value;
    }
    private static function label(string $value): string
    {
        $value=trim($value); if ($value==='' || mb_strlen($value)>120 || preg_match('/[\x00-\x1f\x7f]/u',$value)) throw new HubAiQualificationException('Display label is invalid','AI_PROVIDER_INVALID'); return $value;
    }
    private static function token(string $value,int $max): string
    {
        $value=trim($value); if ($value==='' || strlen($value)>$max || preg_match('/^[A-Za-z0-9][A-Za-z0-9._:-]*$/',$value)!==1) throw new HubAiQualificationException('Qualification token is invalid','AI_QUALIFICATION_INVALID'); return $value;
    }
    /** @param array<string,mixed> $value */
    private static function metadata(array $value): string
    {
        $json=json_encode($value,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR); if (strlen($json)>8192) throw new HubAiQualificationException('Qualification metadata is too large','AI_QUALIFICATION_INVALID'); return $json;
    }
    private static function timestamp(string $value): string { if (strtotime($value)===false) throw new HubAiQualificationException('Qualification timestamp is invalid','AI_QUALIFICATION_INVALID'); return gmdate('c',strtotime($value)); }
    private static function uuid(): string { $b=random_bytes(16);$b[6]=chr((ord($b[6])&15)|64);$b[8]=chr((ord($b[8])&63)|128);return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($b),4)); }
}
