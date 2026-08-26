-- M14: Cost-Aware AI. Additive over M13 Anywhere Execution.
-- Existing provider policy/usage rows remain valid and legacy-priced until the
-- owner explicitly switches the policy to catalog pricing.

ALTER TABLE control_provider_policies
    ADD COLUMN routing_strategy TEXT NOT NULL DEFAULT 'BALANCED'
    CHECK (routing_strategy IN ('SAVER','BALANCED','QUALITY'));
ALTER TABLE control_provider_policies
    ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'LEGACY'
    CHECK (pricing_mode IN ('LEGACY','CATALOG'));
ALTER TABLE control_provider_policies
    ADD COLUMN service_tier TEXT NOT NULL DEFAULT 'DEFAULT'
    CHECK (service_tier IN ('DEFAULT','BATCH','FLEX','PRIORITY','CUSTOM'));

CREATE TABLE control_provider_model_rates (
    rate_id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    model TEXT NOT NULL,
    service_tier TEXT NOT NULL CHECK (service_tier IN ('DEFAULT','BATCH','FLEX','PRIORITY','CUSTOM')),
    accounting_currency TEXT NOT NULL DEFAULT 'THB',
    input_microunits_per_million INTEGER NOT NULL CHECK (input_microunits_per_million >= 0),
    cached_input_microunits_per_million INTEGER NOT NULL CHECK (cached_input_microunits_per_million >= 0),
    cache_write_microunits_per_million INTEGER NOT NULL CHECK (cache_write_microunits_per_million >= 0),
    output_microunits_per_million INTEGER NOT NULL CHECK (output_microunits_per_million >= 0),
    provider_currency TEXT NOT NULL DEFAULT 'USD',
    provider_input_microunits_per_million INTEGER NOT NULL CHECK (provider_input_microunits_per_million >= 0),
    provider_cached_input_microunits_per_million INTEGER NOT NULL CHECK (provider_cached_input_microunits_per_million >= 0),
    provider_cache_write_microunits_per_million INTEGER NOT NULL CHECK (provider_cache_write_microunits_per_million >= 0),
    provider_output_microunits_per_million INTEGER NOT NULL CHECK (provider_output_microunits_per_million >= 0),
    fx_microunits_thb_per_usd INTEGER NOT NULL CHECK (fx_microunits_thb_per_usd > 0),
    effective_at TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    source_uri TEXT NOT NULL,
    source_label TEXT NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0,1)),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(provider_id, model, service_tier, effective_at)
);

CREATE INDEX idx_control_provider_model_rates_lookup
    ON control_provider_model_rates(provider_id, model, service_tier, active, effective_at DESC);

ALTER TABLE control_provider_usage ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0);
ALTER TABLE control_provider_usage ADD COLUMN pricing_rate_id TEXT;
ALTER TABLE control_provider_usage
    ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'LEGACY'
    CHECK (pricing_mode IN ('LEGACY','CATALOG'));
ALTER TABLE control_provider_usage ADD COLUMN pricing_currency TEXT NOT NULL DEFAULT 'THB';
ALTER TABLE control_provider_usage ADD COLUMN input_rate_microunits_per_million INTEGER NOT NULL DEFAULT 0;
ALTER TABLE control_provider_usage ADD COLUMN cached_input_rate_microunits_per_million INTEGER NOT NULL DEFAULT 0;
ALTER TABLE control_provider_usage ADD COLUMN cache_write_rate_microunits_per_million INTEGER NOT NULL DEFAULT 0;
ALTER TABLE control_provider_usage ADD COLUMN output_rate_microunits_per_million INTEGER NOT NULL DEFAULT 0;
ALTER TABLE control_provider_usage ADD COLUMN pricing_effective_at TEXT;
ALTER TABLE control_provider_usage ADD COLUMN pricing_source_uri TEXT;
ALTER TABLE control_provider_usage ADD COLUMN long_context_multiplier_applied INTEGER NOT NULL DEFAULT 0 CHECK (long_context_multiplier_applied IN (0,1));

CREATE INDEX idx_control_provider_usage_pricing_rate
    ON control_provider_usage(pricing_rate_id, created_at DESC);
