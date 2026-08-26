<?php

declare(strict_types=1);

require_once __DIR__ . '/HubAnywhereExecutionMigration.php';

final class HubCostAwareAiMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

/** M14 adds versioned provider pricing and strategy without replacing M13 authority. */
final class HubCostAwareAiMigration
{
    public const TARGET_USER_VERSION = 14;
    public const MIGRATION_ID = 'm14-cost-aware-ai';
    private const RATE_TABLE = 'control_provider_model_rates';
    private const RATE_INDEX = 'idx_control_provider_model_rates_lookup';
    private const USAGE_INDEX = 'idx_control_provider_usage_pricing_rate';
    private const FX_MICROTHB_PER_USD = 32648000; // BOT reference rate: 1 USD = 32.648 THB, 2026-08-24.
    private const OBSERVED_AT = '2026-08-24T11:00:00+00:00';
    private const FX_SOURCE_URI = 'https://app.bot.or.th/BTWS_STAT/statistics/ReportPage.aspx?language=eng&reportID=123';

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath); $sql = @file_get_contents($sqlPath);
        if (!is_string($sql) || $sql === '') throw new HubCostAwareAiMigrationException('Cost-aware AI migration is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash('sha256', $sql); $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 13) throw new HubCostAwareAiMigrationException('M13 Anywhere Execution is unavailable', 'BASE_SCHEMA_INVALID');
        try { HubAnywhereExecutionMigration::assertCapabilityReady($pdo, dirname(__DIR__) . '/migrations/012_anywhere_execution_fabric.sql'); }
        catch (Throwable) { throw new HubCostAwareAiMigrationException('M13 Anywhere Execution is unavailable', 'BASE_SCHEMA_INVALID'); }
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id=:id');
        $q->execute(['id'=>self::MIGRATION_ID]); $ledger = $q->fetch();
        if (is_array($ledger)) {
            if ((int)$ledger['schema_version'] !== 14 || !hash_equals((string)$ledger['checksum'],$checksum) || $version < 14) throw new HubCostAwareAiMigrationException('Cost-aware AI migration record is invalid', 'MIGRATION_RECORD_INVALID');
            self::assertReady($pdo,$checksum); return 'already-applied';
        }
        if ($version > 13 || self::tablePresent($pdo,self::RATE_TABLE)) throw new HubCostAwareAiMigrationException('Cost-aware AI migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        $at = self::timestamp($now ?? gmdate('c'));
        try {
            $pdo->beginTransaction(); $pdo->exec($sql); self::seedRates($pdo);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id,schema_version,checksum,applied_at) VALUES(:id,14,:checksum,:at)')->execute(['id'=>self::MIGRATION_ID,'checksum'=>$checksum,'at'=>$at]);
            $pdo->exec('PRAGMA user_version = 14'); self::assertReady($pdo,$checksum); $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubCostAwareAiMigrationException) throw $error;
            throw new HubCostAwareAiMigrationException('Cost-aware AI migration rolled back', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function assertCapabilityReady(PDO $pdo, string $sqlPath): void
    {
        if (!is_file($sqlPath)) throw new HubCostAwareAiMigrationException('Cost-aware AI migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        self::assertReady($pdo,hash_file('sha256',$sqlPath));
    }

    private static function seedRates(PDO $pdo): void
    {
        $rows = [
            ['gpt-5.6-luna',200000,20000,1200000,'https://developers.openai.com/api/docs/models/gpt-5.6-luna'],
            ['gpt-5.6-terra',2000000,200000,12000000,'https://developers.openai.com/api/docs/models/gpt-5.6-terra'],
            ['gpt-5.6-sol',4000000,400000,20000000,'https://developers.openai.com/api/docs/models/gpt-5.6-sol'],
        ];
        $insert = $pdo->prepare('INSERT INTO control_provider_model_rates(rate_id,provider_id,model,service_tier,accounting_currency,input_microunits_per_million,cached_input_microunits_per_million,cache_write_microunits_per_million,output_microunits_per_million,provider_currency,provider_input_microunits_per_million,provider_cached_input_microunits_per_million,provider_cache_write_microunits_per_million,provider_output_microunits_per_million,fx_microunits_thb_per_usd,effective_at,observed_at,source_uri,source_label,active,metadata_json) VALUES(:id,\'openai\',:model,\'DEFAULT\',\'THB\',:inputThb,:cachedThb,:cacheWriteThb,:outputThb,\'USD\',:inputUsd,:cachedUsd,:cacheWriteUsd,:outputUsd,:fx,:effective,:observed,:source,:label,1,:meta)');
        foreach ($rows as [$model,$input,$cached,$output,$source]) {
            $cacheWrite = intdiv($input * 5, 4);
            $insert->execute([
                'id'=>'openai:'.$model.':default:2026-08-26','model'=>$model,
                'inputThb'=>self::toThb($input),'cachedThb'=>self::toThb($cached),'cacheWriteThb'=>self::toThb($cacheWrite),'outputThb'=>self::toThb($output),
                'inputUsd'=>$input,'cachedUsd'=>$cached,'cacheWriteUsd'=>$cacheWrite,'outputUsd'=>$output,'fx'=>self::FX_MICROTHB_PER_USD,
                'effective'=>self::OBSERVED_AT,'observed'=>self::OBSERVED_AT,'source'=>$source,
                'label'=>'OpenAI model-card pricing snapshot · 2026-08-26',
                'meta'=>json_encode(['fxSource'=>'Bank of Thailand USD reference rate','fxSourceUri'=>self::FX_SOURCE_URI,'fxObservedAt'=>self::OBSERVED_AT,'cacheWriteMultiplier'=>1.25,'longContextThresholdTokens'=>272000,'longContextInputMultiplier'=>2,'longContextOutputMultiplier'=>1.5],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),
            ]);
        }
    }

    private static function assertReady(PDO $pdo, string $checksum): void
    {
        $q=$pdo->prepare('SELECT schema_version,checksum FROM awh_schema_migrations WHERE migration_id=:id'); $q->execute(['id'=>self::MIGRATION_ID]); $ledger=$q->fetch();
        $policy=array_column($pdo->query("PRAGMA table_info('control_provider_policies')")->fetchAll(),'name');
        $usage=array_column($pdo->query("PRAGMA table_info('control_provider_usage')")->fetchAll(),'name');
        $indexes=(int)$pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name IN ('".self::RATE_INDEX."','".self::USAGE_INDEX."')")->fetchColumn();
        $seeded=(int)$pdo->query("SELECT COUNT(*) FROM control_provider_model_rates WHERE provider_id='openai' AND service_tier='DEFAULT' AND model IN ('gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol') AND active=1")->fetchColumn()===3;
        if ((int)$pdo->query('PRAGMA user_version')->fetchColumn()<14 || !is_array($ledger) || (int)$ledger['schema_version']!==14 || !hash_equals(strtolower($checksum),strtolower((string)$ledger['checksum'])) || !self::tablePresent($pdo,self::RATE_TABLE) || $indexes!==2 || !$seeded || !in_array('routing_strategy',$policy,true) || !in_array('pricing_mode',$policy,true) || !in_array('service_tier',$policy,true) || !in_array('cache_write_tokens',$usage,true) || !in_array('pricing_rate_id',$usage,true) || !in_array('cached_input_rate_microunits_per_million',$usage,true) || !in_array('cache_write_rate_microunits_per_million',$usage,true) || !in_array('long_context_multiplier_applied',$usage,true) || $pdo->query('PRAGMA foreign_key_check')->fetchAll()!==[]) throw new HubCostAwareAiMigrationException('Cost-aware AI capability is not ready','COST_AWARE_AI_SCHEMA_NOT_READY');
    }

    private static function toThb(int $microUsdPerMillion): int { return intdiv($microUsdPerMillion * self::FX_MICROTHB_PER_USD,1000000); }
    private static function tablePresent(PDO $pdo,string $table): bool { $q=$pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name"); $q->execute(['name'=>$table]); return $q->fetchColumn()!==false; }
    private static function open(string $path): PDO { if ($path==='' || str_contains($path,"\0")) throw new HubCostAwareAiMigrationException('Database path is invalid','DATABASE_CONFIG_INVALID'); try { $pdo=new PDO('sqlite:'.$path,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]); $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 2500'); return $pdo; } catch (Throwable) { throw new HubCostAwareAiMigrationException('Database is unavailable','DATABASE_UNAVAILABLE'); } }
    private static function timestamp(string $value): string { if (strtotime($value)===false) throw new HubCostAwareAiMigrationException('Cost-aware AI migration time is invalid','MIGRATION_FAILED'); return gmdate('c',strtotime($value)); }
}
