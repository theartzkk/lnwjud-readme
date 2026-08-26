<?php

declare(strict_types=1);

final class HubProviderPricingException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'PROVIDER_PRICING_UNAVAILABLE') { parent::__construct($message); }
}

/**
 * M14 pricing authority. Billing rates are versioned data, never constants in
 * provider business logic. Every catalog-priced usage keeps a rate snapshot.
 */
final class HubProviderPricingService
{
    private const TIERS = ['DEFAULT','BATCH','FLEX','PRIORITY','CUSTOM'];

    public function __construct(private readonly PDO $pdo) {}

    public static function schemaPresent(PDO $pdo): bool
    {
        $table = (int) $pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='control_provider_model_rates'")->fetchColumn() === 1;        if (!$table) return false;
        $columns = array_column($pdo->query("PRAGMA table_info('control_provider_usage')")->fetchAll(), 'name');
        return in_array('pricing_rate_id', $columns, true) && in_array('cached_input_rate_microunits_per_million', $columns, true);
    }

    /** @return array<string,mixed> */
    public function quoteForPolicy(array $policy, string $provider, string $model, int $input, int $cached, int $cacheWrite, int $output, ?string $now = null): array
    {
        self::tokens($input, $cached, $cacheWrite, $output);
        if (($policy['pricingMode'] ?? 'LEGACY') !== 'CATALOG') {
            $inputRate = self::rate($policy['inputMicrounitsPerMillion'] ?? null);
            $outputRate = self::rate($policy['outputMicrounitsPerMillion'] ?? null);
            $cost = self::cost($input, 0, 0, $output, $inputRate, $inputRate, $inputRate, $outputRate);
            return ['estimatedMicrounits'=>$cost,'snapshot'=>[
                'rateId'=>null,'mode'=>'LEGACY','currency'=>'THB',
                'inputRateMicrounitsPerMillion'=>$inputRate,
                'cachedInputRateMicrounitsPerMillion'=>$inputRate,
                'cacheWriteRateMicrounitsPerMillion'=>$inputRate,
                'outputRateMicrounitsPerMillion'=>$outputRate,
                'longContextMultiplierApplied'=>false,
                'effectiveAt'=>null,'sourceUri'=>null,
            ]];
        }
        $tier = strtoupper((string) ($policy['serviceTier'] ?? 'DEFAULT'));
        $rate = $this->rateRow($provider, $model, $tier, $now);        $inputRate = (int) $rate['input_microunits_per_million'];
        $cachedRate = (int) $rate['cached_input_microunits_per_million'];
        $cacheWriteRate = (int) $rate['cache_write_microunits_per_million'];
        $outputRate = (int) $rate['output_microunits_per_million'];
        $longContext = $input > 272000;
        $cost = self::cost($input, $cached, $cacheWrite, $output, $inputRate, $cachedRate, $cacheWriteRate, $outputRate, $longContext);
        return ['estimatedMicrounits'=>$cost,'snapshot'=>[
            'rateId'=>(string)$rate['rate_id'],'mode'=>'CATALOG',
            'currency'=>(string)$rate['accounting_currency'],
            'inputRateMicrounitsPerMillion'=>$inputRate,
            'cachedInputRateMicrounitsPerMillion'=>$cachedRate,
            'cacheWriteRateMicrounitsPerMillion'=>$cacheWriteRate,
            'outputRateMicrounitsPerMillion'=>$outputRate,
            'longContextMultiplierApplied'=>$longContext,
            'effectiveAt'=>(string)$rate['effective_at'],
            'sourceUri'=>(string)$rate['source_uri'],
        ]];
    }

    /** @return array<string,mixed> */
    public function reserveForPolicy(array $policy, string $provider, string $model, int $estimatedInput, int $maximumOutput, ?string $now = null): array
    {
        return $this->quoteForPolicy($policy, $provider, $model, max(1,$estimatedInput), 0, 0, max(1,$maximumOutput), $now);
    }

    /** @param list<string> $models @return list<array<string,mixed>> */
    public function catalog(array $models, string $provider = 'openai', string $tier = 'DEFAULT', ?string $now = null): array
    {
        $out = []; foreach (array_values(array_unique($models)) as $model) {
            try { $row = $this->rateRow($provider, $model, strtoupper($tier), $now); }
            catch (HubProviderPricingException) { continue; }
            $out[] = [
                'model'=>(string)$row['model'],'serviceTier'=>(string)$row['service_tier'],
                'currency'=>(string)$row['accounting_currency'],
                'inputMicrounitsPerMillion'=>(int)$row['input_microunits_per_million'],
                'cachedInputMicrounitsPerMillion'=>(int)$row['cached_input_microunits_per_million'],
                'cacheWriteMicrounitsPerMillion'=>(int)$row['cache_write_microunits_per_million'],
                'outputMicrounitsPerMillion'=>(int)$row['output_microunits_per_million'],
                'effectiveAt'=>(string)$row['effective_at'],'observedAt'=>(string)$row['observed_at'],
                'sourceUri'=>(string)$row['source_uri'],'sourceLabel'=>(string)$row['source_label'],
            ];
        }
        return $out;
    }

    /** @return array<string,mixed> */
    private function rateRow(string $provider, string $model, string $tier, ?string $now): array
    {
        if (!in_array($tier, self::TIERS, true)) throw new HubProviderPricingException('Provider service tier is invalid', 'PROVIDER_PRICING_INVALID');
        $at = self::timestamp($now ?? gmdate('c'));
        $q = $this->pdo->prepare('SELECT * FROM control_provider_model_rates WHERE provider_id=:provider AND model=:model AND service_tier=:tier AND active=1 AND effective_at<=:at ORDER BY effective_at DESC, observed_at DESC LIMIT 1');
        $q->execute(['provider'=>$provider,'model'=>$model,'tier'=>$tier,'at'=>$at]);
        $row = $q->fetch();
        if (!is_array($row)) throw new HubProviderPricingException('No active provider price is available for this model', 'PROVIDER_PRICING_UNAVAILABLE');
        return $row;
    }

    private static function cost(int $input, int $cached, int $cacheWrite, int $output, int $inputRate, int $cachedRate, int $cacheWriteRate, int $outputRate, bool $longContext = false): int
    {
        $normal = $input - $cached - $cacheWrite;
        $inputNumerator = $normal * $inputRate + $cached * $cachedRate + $cacheWrite * $cacheWriteRate;
        $outputNumerator = $output * $outputRate;
        if ($longContext) { $inputNumerator *= 2; $outputNumerator = intdiv($outputNumerator * 3, 2); }
        return intdiv($inputNumerator + $outputNumerator, 1000000);
    }

    private static function tokens(int $input, int $cached, int $cacheWrite, int $output): void
    {
        if ($input < 0 || $cached < 0 || $cacheWrite < 0 || $output < 0 || $cached + $cacheWrite > $input) throw new HubProviderPricingException('Provider token usage is invalid', 'PROVIDER_PRICING_INVALID');
    }

    private static function rate(mixed $value): int
    {
        if (!is_int($value) || $value < 0 || $value > 5000000000) throw new HubProviderPricingException('Provider price is invalid', 'PROVIDER_PRICING_INVALID');
        return $value;
    }

    private static function timestamp(string $value): string
    {
        if (strtotime($value) === false) throw new HubProviderPricingException('Provider pricing time is invalid', 'PROVIDER_PRICING_INVALID');
        return gmdate('c', strtotime($value));
    }
}
