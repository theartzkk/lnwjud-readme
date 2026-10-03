<?php
declare(strict_types=1);

require_once __DIR__ . '/HubGroqProviderAdapter.php';
require_once __DIR__ . '/HubAiQualificationService.php';
require_once __DIR__ . '/HubCapabilityRegistryService.php';

final class HubGroqProviderBootstrapException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'GROQ_PROVIDER_SETUP_FAILED')
    {
        parent::__construct($message);
    }
}

final class HubGroqProviderBootstrap
{
    public const PROVIDER_ID = 'groq';
    public const FAST_MODEL = 'openai/gpt-oss-20b';
    public const STRONG_MODEL = 'openai/gpt-oss-120b';
    private const POLICY_VERSION = 'groq-free-only-v1';
    private const QUALIFICATION_SUITE = 'awh-groq-live';
    private const QUALIFICATION_VERSION = 'responses-v1';

    public static function schemaPresent(PDO $pdo): bool
    {
        return HubAiQualificationService::schemaPresent($pdo)
            && HubCapabilityRegistryService::schemaPresent($pdo)
            && self::tablePresent($pdo, 'control_provider_model_rates')
            && self::tablePresent($pdo, 'control_provider_policies');
    }
    public static function reconcile(PDO $pdo, ?string $now = null): void
    {
        if (!self::schemaPresent($pdo)) return;
        $at = self::timestamp($now ?? gmdate('c'));
        $qualification = new HubAiQualificationService($pdo);
        $qualification->registerProvider(self::PROVIDER_ID, 'Groq', 'API', 'INCLUDED', 'INTERNAL', [
            'authority' => self::POLICY_VERSION,
            'transport' => 'remote-inference',
            'paidFallbackDefault' => false,
            'localInference' => false,
        ], $at);

        $capabilities = new HubCapabilityRegistryService($pdo);
        $capabilities->advertiseProvider(
            self::PROVIDER_ID,
            'API',
            'Groq Free',
            'ON_DEMAND',
            'INCLUDED',
            20,
            ['agent.conversation'],
            $at,
            null,
            ['authority' => self::POLICY_VERSION, 'billingMode' => 'FREE_ENTITLEMENT']
        );

        $qualification->registerModel(self::PROVIDER_ID, self::FAST_MODEL, 'GPT-OSS 20B via Groq', ['text','tool-calling'], 78, 76, 92, 'INTERNAL', ['tier'=>'free'], $at);
        $qualification->registerModel(self::PROVIDER_ID, self::STRONG_MODEL, 'GPT-OSS 120B via Groq', ['text','tool-calling'], 88, 90, 78, 'INTERNAL', ['tier'=>'free'], $at);
        $modelUpdate = $pdo->prepare("UPDATE control_ai_models SET context_window_tokens=131072,max_output_tokens=65536,tool_calling=1,structured_output=1,updated_at=:at,metadata_json=:meta WHERE provider_id=:provider AND model_id=:model");
        foreach ([self::FAST_MODEL, self::STRONG_MODEL] as $model) {
            $modelUpdate->execute([
                'at'=>$at,
                'provider'=>self::PROVIDER_ID,
                'model'=>$model,
                'meta'=>json_encode(['authority'=>self::POLICY_VERSION,'modelsApiVerifiedOnActivation'=>true,'localInference'=>false], JSON_THROW_ON_ERROR),
            ]);
        }

        $pdo->prepare("UPDATE control_ai_provider_profiles SET privacy_policy_uri=:privacy,free_quota_json=:free,paid_quota_json=:paid,policy_version=:policy,updated_at=:at,metadata_json=:meta WHERE provider_id=:provider")
            ->execute([
                'privacy'=>'https://console.groq.com/docs/your-data',
                'free'=>json_encode(['mode'=>'provider-enforced','source'=>'https://console.groq.com/docs/rate-limits'], JSON_THROW_ON_ERROR),
                'paid'=>json_encode(['allowedByDefault'=>false], JSON_THROW_ON_ERROR),
                'policy'=>self::POLICY_VERSION,
                'at'=>$at,
                'meta'=>json_encode(['zdrEligibleInference'=>true,'ownerMustEnableZdrInGroqConsole'=>true,'localInference'=>false], JSON_THROW_ON_ERROR),
                'provider'=>self::PROVIDER_ID,
            ]);

        self::ensureFreeRate($pdo, self::FAST_MODEL, 'groq-free-gpt-oss-20b-v1', $at);
        self::ensureFreeRate($pdo, self::STRONG_MODEL, 'groq-free-gpt-oss-120b-v1', $at);
        self::ensureOwnerPolicy($pdo, $at);
    }
    public static function qualifyProduction(PDO $pdo, HubGroqProviderAdapter $adapter, string $credential, ?string $now = null): array
    {
        self::reconcile($pdo, $now);
        $at = self::timestamp($now ?? gmdate('c'));
        $active = $adapter->activeModels($credential);
        foreach ([self::FAST_MODEL, self::STRONG_MODEL] as $required) {
            if (!in_array($required, $active, true)) {
                throw new HubGroqProviderBootstrapException('Configured Groq model is not active', 'PROVIDER_MODEL_UNAVAILABLE');
            }
        }

        $qualification = new HubAiQualificationService($pdo);
        $results = [];
        foreach ([self::FAST_MODEL, self::STRONG_MODEL] as $model) {
            $status = $qualification->modelStatus(self::PROVIDER_ID, $model);
            if (($status['lifecycle'] ?? null) !== 'production') {
                self::runQualificationSuite($qualification, $adapter, $credential, $model, $at);
                $status = $qualification->promoteModel(self::PROVIDER_ID, $model, 'PRODUCTION', $at);
            }
            $results[] = $status;
        }
        $qualification->setAvailability(self::PROVIDER_ID, 'AVAILABLE', ['authority'=>self::POLICY_VERSION,'modelsApiVerified'=>true], $at);
        return ['provider'=>self::PROVIDER_ID,'status'=>'PASS','models'=>$results,'policyVersion'=>self::POLICY_VERSION];
    }

    private static function runQualificationSuite(HubAiQualificationService $qualification, HubGroqProviderAdapter $adapter, string $credential, string $model, string $at): void
    {
        $probes = [
            ['conversation.basic', 'Reply with exactly OK.', 'OK'],
            ['reasoning.arithmetic', 'Reply with only the number 5. What is 2+3?', '5'],
            ['thai.instruction', 'ตอบเพียงคำว่า พร้อม เท่านั้น', 'พร้อม'],
        ];
        foreach ($probes as [$taskType, $prompt, $expected]) {
            $started = microtime(true);
            $response = $adapter->call([
                'model'=>$model,
                'input'=>$prompt,
                'instructions'=>'Follow the user instruction exactly. Return no explanation.',
                'max_output_tokens'=>64,
            ], $credential);
            $latency = max(0, (int)round((microtime(true) - $started) * 1000));
            $text = self::outputText($response);
            $pass = trim($text) === $expected;
            $evidence = hash('sha256', $model . "\n" . $taskType . "\n" . $expected . "\n" . trim($text));
            $qualification->recordQualification(
                self::PROVIDER_ID,
                $model,
                self::QUALIFICATION_SUITE,
                self::QUALIFICATION_VERSION,
                $taskType,
                $pass ? 10000 : 0,
                $pass,
                $latency,
                0,
                $pass ? 0 : 10000,
                null,
                $evidence,
                ['mode'=>'live-deterministic-probe','rawOutputStored'=>false],
                $at
            );
            if (!$pass) {
                $qualification->setAvailability(self::PROVIDER_ID, 'DEGRADED', ['reason'=>'qualification-output-mismatch'], $at);
                throw new HubGroqProviderBootstrapException('Groq qualification output did not match the deterministic probe', 'PROVIDER_FAILED');
            }
        }
    }
    private static function ensureOwnerPolicy(PDO $pdo, string $at): void
    {
        $owner = $pdo->query("SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id=1 AND bootstrap_closed=1")->fetchColumn();
        if (!is_string($owner) || $owner === '') return;
        $pdo->prepare("INSERT OR IGNORE INTO control_provider_policies(provider_id,enabled,model_fast,model_balanced,model_strong,monthly_budget_microunits,warning_microunits,input_microunits_per_million,output_microunits_per_million,routing_strategy,pricing_mode,service_tier,updated_by_user_id,updated_at) VALUES(:provider,1,:fast,:balanced,:strong,1000000,1000000,0,0,'SAVER','CATALOG','DEFAULT',:owner,:at)")
            ->execute(['provider'=>self::PROVIDER_ID,'fast'=>self::FAST_MODEL,'balanced'=>self::FAST_MODEL,'strong'=>self::STRONG_MODEL,'owner'=>$owner,'at'=>$at]);
    }

    private static function ensureFreeRate(PDO $pdo, string $model, string $rateId, string $at): void
    {
        $sql = "INSERT OR IGNORE INTO control_provider_model_rates(rate_id,provider_id,model,service_tier,accounting_currency,input_microunits_per_million,cached_input_microunits_per_million,cache_write_microunits_per_million,output_microunits_per_million,provider_currency,provider_input_microunits_per_million,provider_cached_input_microunits_per_million,provider_cache_write_microunits_per_million,provider_output_microunits_per_million,fx_microunits_thb_per_usd,effective_at,observed_at,source_uri,source_label,active,metadata_json) VALUES(:id,:provider,:model,'DEFAULT','THB',0,0,0,0,'USD',0,0,0,0,1,'2026-10-03T00:00:00Z',:at,'https://console.groq.com/docs/rate-limits','Groq Free Plan',1,:meta)";
        $pdo->prepare($sql)->execute([
            'id'=>$rateId,
            'provider'=>self::PROVIDER_ID,
            'model'=>$model,
            'at'=>$at,
            'meta'=>json_encode(['billingMode'=>'FREE_ENTITLEMENT','providerEnforcesQuota'=>true,'paidFallbackDefault'=>false], JSON_THROW_ON_ERROR),
        ]);
    }
    private static function outputText(array $response): string
    {
        if (is_string($response['output_text'] ?? null) && trim($response['output_text']) !== '') return trim($response['output_text']);
        $text = '';
        foreach (($response['output'] ?? []) as $item) {
            if (!is_array($item)) continue;
            foreach (($item['content'] ?? []) as $content) {
                if (is_array($content) && ($content['type'] ?? null) === 'output_text' && is_string($content['text'] ?? null)) $text .= $content['text'];
            }
        }
        return trim($text);
    }

    private static function tablePresent(PDO $pdo, string $table): bool
    {
        $q = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:table");
        $q->execute(['table'=>$table]);
        return $q->fetchColumn() !== false;
    }

    private static function timestamp(string $value): string
    {
        if (strtotime($value) === false) throw new HubGroqProviderBootstrapException('Groq provider timestamp is invalid');
        return gmdate('c', strtotime($value));
    }
}
