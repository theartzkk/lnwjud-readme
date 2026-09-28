-- M25: optional OpenRouter free-model provider catalog.
-- Additive over M24. This migration does not enable an owner policy, store a
-- credential, qualify a model for Production, or create a second AI router.

INSERT OR IGNORE INTO control_execution_providers(
    provider_id,provider_kind,display_name,availability_mode,cost_class,priority,
    enabled,observed_at,expires_at,metadata_json
) VALUES(
    'openrouter','API','OpenRouter','ON_DEMAND','METERED',40,1,
    '2026-09-28T00:00:00Z',NULL,
    '{"authority":"m25-openrouter-free","freeOnly":true,"optional":true}'
);

INSERT OR IGNORE INTO control_ai_provider_profiles(
    provider_id,lifecycle,privacy_policy_uri,region,max_data_classification,
    current_availability,free_quota_json,paid_quota_json,policy_version,
    observed_at,updated_at,metadata_json
) VALUES(
    'openrouter','SANDBOX',NULL,NULL,'PUBLIC','UNKNOWN',
    '{"mode":"provider-managed-free-tier"}','{}','m25-free-only',
    '2026-09-28T00:00:00Z','2026-09-28T00:00:00Z',
    '{"route":"openrouter/free","paidModelsAllowed":false,"productionEligible":false,"privacyBoundary":"PUBLIC_ONLY"}'
);

INSERT OR IGNORE INTO control_ai_models(
    provider_id,model_id,display_name,lifecycle,context_window_tokens,max_output_tokens,
    tool_calling,structured_output,vision,audio,file_support,coding_rank,reasoning_rank,
    latency_rank,max_data_classification,capabilities_json,observed_at,updated_at,enabled,metadata_json
) VALUES(
    'openrouter','openrouter-free','OpenRouter Free Router','SANDBOX',NULL,NULL,
    1,0,1,0,0,50,50,50,'PUBLIC','["text","vision","tool-calling"]',
    '2026-09-28T00:00:00Z','2026-09-28T00:00:00Z',1,
    '{"upstreamModel":"openrouter/free","dynamicFreeRouter":true,"qualificationClaim":false,"paidModelsAllowed":false}'
);

INSERT OR IGNORE INTO control_execution_provider_capabilities(
    provider_id,capability,version,cost_rank,quality_rank,latency_rank,
    enabled,observed_at,expires_at,metadata_json
) VALUES(
    'openrouter','agent.conversation','m25-free',0,50,50,1,
    '2026-09-28T00:00:00Z',NULL,
    '{"role":"optional-free-intelligence-backend","privacyBoundary":"PUBLIC_ONLY"}'
);

INSERT OR IGNORE INTO control_provider_model_rates(
    rate_id,provider_id,model,service_tier,accounting_currency,
    input_microunits_per_million,cached_input_microunits_per_million,
    cache_write_microunits_per_million,output_microunits_per_million,
    provider_currency,provider_input_microunits_per_million,
    provider_cached_input_microunits_per_million,
    provider_cache_write_microunits_per_million,
    provider_output_microunits_per_million,fx_microunits_thb_per_usd,
    effective_at,observed_at,source_uri,source_label,active,metadata_json
) VALUES(
    'openrouter:openrouter-free:default:2026-09-28','openrouter','openrouter-free',
    'DEFAULT','THB',0,0,0,0,'USD',0,0,0,0,1,
    '2026-09-28T00:00:00Z','2026-09-28T00:00:00Z',
    'https://openrouter.ai/openrouter/free',
    'OpenRouter free router · zero-token-price snapshot · 2026-09-28',1,
    '{"zeroCost":true,"freeOnly":true,"upstreamModel":"openrouter/free"}'
);
