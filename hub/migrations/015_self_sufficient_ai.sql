-- M16: AI Self-Sufficient Foundation. Additive over M15.
-- Provider/model governance extends M13/M14 authorities. Canonical Projects,
-- conversations, tasks, executions, memory, artifacts, approvals and workers
-- remain unchanged and authoritative.

CREATE TABLE control_ai_provider_profiles (
    provider_id TEXT PRIMARY KEY,
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('DISCOVERED','REGISTERED','BENCHMARKING','SANDBOX','APPROVED','PRODUCTION','DEGRADED','DISABLED')),
    privacy_policy_uri TEXT,
    region TEXT,
    max_data_classification TEXT NOT NULL CHECK (max_data_classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','SECRET')),
    current_availability TEXT NOT NULL CHECK (current_availability IN ('AVAILABLE','DEGRADED','UNAVAILABLE','UNKNOWN')),
    free_quota_json TEXT NOT NULL DEFAULT '{}',
    paid_quota_json TEXT NOT NULL DEFAULT '{}',
    policy_version TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (provider_id) REFERENCES control_execution_providers(provider_id) ON DELETE CASCADE
);

CREATE TABLE control_ai_models (
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('DISCOVERED','REGISTERED','BENCHMARKING','SANDBOX','APPROVED','PRODUCTION','DEGRADED','DISABLED')),
    context_window_tokens INTEGER CHECK (context_window_tokens IS NULL OR context_window_tokens > 0),
    max_output_tokens INTEGER CHECK (max_output_tokens IS NULL OR max_output_tokens > 0),
    tool_calling INTEGER NOT NULL CHECK (tool_calling IN (0,1)),
    structured_output INTEGER NOT NULL CHECK (structured_output IN (0,1)),
    vision INTEGER NOT NULL CHECK (vision IN (0,1)),
    audio INTEGER NOT NULL CHECK (audio IN (0,1)),
    file_support INTEGER NOT NULL CHECK (file_support IN (0,1)),
    coding_rank INTEGER NOT NULL CHECK (coding_rank BETWEEN 0 AND 100),
    reasoning_rank INTEGER NOT NULL CHECK (reasoning_rank BETWEEN 0 AND 100),
    latency_rank INTEGER NOT NULL CHECK (latency_rank BETWEEN 0 AND 100),
    max_data_classification TEXT NOT NULL CHECK (max_data_classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','SECRET')),
    capabilities_json TEXT NOT NULL DEFAULT '[]',
    observed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (provider_id, model_id),
    FOREIGN KEY (provider_id) REFERENCES control_ai_provider_profiles(provider_id) ON DELETE CASCADE
);

CREATE TABLE control_ai_model_qualifications (
    qualification_id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    suite_id TEXT NOT NULL,
    suite_version TEXT NOT NULL,
    task_type TEXT NOT NULL,
    score_basis_points INTEGER NOT NULL CHECK (score_basis_points BETWEEN 0 AND 10000),
    pass INTEGER NOT NULL CHECK (pass IN (0,1)),
    latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
    estimated_microunits INTEGER NOT NULL CHECK (estimated_microunits >= 0),
    hallucination_basis_points INTEGER CHECK (hallucination_basis_points BETWEEN 0 AND 10000),
    tool_success_basis_points INTEGER CHECK (tool_success_basis_points BETWEEN 0 AND 10000),
    evidence_sha256 TEXT,
    observed_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (provider_id, model_id) REFERENCES control_ai_models(provider_id, model_id) ON DELETE CASCADE
);

CREATE TABLE control_ai_model_health (
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    window_started_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    successes INTEGER NOT NULL DEFAULT 0 CHECK (successes >= 0),
    timeouts INTEGER NOT NULL DEFAULT 0 CHECK (timeouts >= 0),
    rate_limits INTEGER NOT NULL DEFAULT 0 CHECK (rate_limits >= 0),
    malformed_responses INTEGER NOT NULL DEFAULT 0 CHECK (malformed_responses >= 0),
    tool_failures INTEGER NOT NULL DEFAULT 0 CHECK (tool_failures >= 0),
    total_latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (total_latency_ms >= 0),
    total_cost_microunits INTEGER NOT NULL DEFAULT 0 CHECK (total_cost_microunits >= 0),
    circuit_state TEXT NOT NULL DEFAULT 'CLOSED' CHECK (circuit_state IN ('CLOSED','OPEN','HALF_OPEN')),
    circuit_until TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (provider_id, model_id),
    FOREIGN KEY (provider_id, model_id) REFERENCES control_ai_models(provider_id, model_id) ON DELETE CASCADE
);
CREATE TABLE control_ai_route_decisions (
    route_id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    route_kind TEXT NOT NULL CHECK (route_kind IN ('ZERO_TOKEN','VPS_LOCAL','DEVICE','AI_PROVIDER','SPECIALIST')),
    required_capability TEXT NOT NULL,
    data_classification TEXT NOT NULL CHECK (data_classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','SECRET')),
    provider_id TEXT,
    model_id TEXT,
    routing_strategy TEXT NOT NULL CHECK (routing_strategy IN ('SAVER','BALANCED','QUALITY','OWNER_OVERRIDE')),
    reason_code TEXT NOT NULL,
    estimated_microunits INTEGER NOT NULL CHECK (estimated_microunits >= 0),
    premium_baseline_microunits INTEGER NOT NULL CHECK (premium_baseline_microunits >= 0),
    routing_policy_version TEXT NOT NULL,
    prompt_policy_version TEXT NOT NULL,
    tool_policy_version TEXT NOT NULL,
    decision_state TEXT NOT NULL CHECK (decision_state IN ('SELECTED','FALLBACK','BLOCKED')),
    created_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (execution_id) REFERENCES control_task_executions(execution_id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES control_tasks(task_id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id, model_id) REFERENCES control_ai_models(provider_id, model_id) ON DELETE SET NULL
);

CREATE TABLE control_ai_outcomes (
    outcome_id TEXT PRIMARY KEY,
    route_id TEXT NOT NULL UNIQUE,
    execution_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PASSED','FAILED','DEGRADED','CANCELLED')),
    qa_status TEXT NOT NULL CHECK (qa_status IN ('PASS','FAIL','NOT_APPLICABLE','NOT_RUN')),
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
    actual_microunits INTEGER NOT NULL DEFAULT 0 CHECK (actual_microunits >= 0),
    human_correction INTEGER NOT NULL DEFAULT 0 CHECK (human_correction IN (0,1)),
    rework_required INTEGER NOT NULL DEFAULT 0 CHECK (rework_required IN (0,1)),
    completed_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (route_id) REFERENCES control_ai_route_decisions(route_id) ON DELETE CASCADE,
    FOREIGN KEY (execution_id) REFERENCES control_task_executions(execution_id) ON DELETE CASCADE
);

CREATE TABLE control_ai_budget_policies (
    policy_id TEXT PRIMARY KEY,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('GLOBAL','USER','PROJECT','PROVIDER','MODEL')),
    scope_ref TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('SAVER','BALANCED','QUALITY','OWNER_OVERRIDE')),
    daily_microunits INTEGER NOT NULL DEFAULT 0 CHECK (daily_microunits >= 0),
    monthly_microunits INTEGER NOT NULL DEFAULT 0 CHECK (monthly_microunits >= 0),
    max_task_microunits INTEGER NOT NULL DEFAULT 0 CHECK (max_task_microunits >= 0),
    max_retry_microunits INTEGER NOT NULL DEFAULT 0 CHECK (max_retry_microunits >= 0),
    max_retries INTEGER NOT NULL DEFAULT 2 CHECK (max_retries BETWEEN 0 AND 10),
    hard_limit INTEGER NOT NULL DEFAULT 1 CHECK (hard_limit IN (0,1)),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    updated_by_user_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (scope_kind, scope_ref),
    FOREIGN KEY (updated_by_user_id) REFERENCES hub_users(user_id)
);

CREATE INDEX idx_control_ai_models_route
    ON control_ai_models(lifecycle, enabled, provider_id, latency_rank, reasoning_rank DESC);
CREATE INDEX idx_control_ai_qualifications_lookup
    ON control_ai_model_qualifications(provider_id, model_id, task_type, pass, observed_at DESC);
CREATE INDEX idx_control_ai_routes_execution
    ON control_ai_route_decisions(execution_id, created_at DESC);
CREATE INDEX idx_control_ai_routes_cost
    ON control_ai_route_decisions(project_id, created_at DESC, estimated_microunits);
CREATE INDEX idx_control_ai_outcomes_execution
    ON control_ai_outcomes(execution_id, completed_at DESC);
CREATE INDEX idx_control_ai_budget_scope
    ON control_ai_budget_policies(scope_kind, scope_ref, enabled);

-- Existing OpenAI usage is grandfathered as a production backend. This is a
-- local AWH policy statement, not a benchmark claim. New providers/models do
-- not receive PRODUCTION lifecycle without qualification/promotion evidence.
INSERT OR IGNORE INTO control_execution_providers(
    provider_id,provider_kind,display_name,availability_mode,cost_class,priority,
    enabled,observed_at,expires_at,metadata_json
) VALUES('openai','API','OpenAI','ON_DEMAND','METERED',80,1,
    '2026-08-29T00:00:00Z',NULL,'{"authority":"m16-ai-provider-profile"}');
INSERT OR IGNORE INTO control_ai_provider_profiles(
    provider_id,lifecycle,privacy_policy_uri,region,max_data_classification,
    current_availability,free_quota_json,paid_quota_json,policy_version,
    observed_at,updated_at,metadata_json
) VALUES('openai','PRODUCTION',NULL,NULL,'INTERNAL','UNKNOWN','{}','{}',
    'm16-grandfathered','2026-08-29T00:00:00Z','2026-08-29T00:00:00Z',
    '{"grandfatheredFrom":"m14-current-production"}');

INSERT OR IGNORE INTO control_ai_models(
    provider_id,model_id,display_name,lifecycle,context_window_tokens,max_output_tokens,
    tool_calling,structured_output,vision,audio,file_support,coding_rank,reasoning_rank,
    latency_rank,max_data_classification,capabilities_json,observed_at,updated_at,enabled,metadata_json
)
SELECT 'openai', r.model, r.model, 'PRODUCTION', NULL, NULL,
       1,0,0,0,0,50,50,50,'INTERNAL','["text","tool-calling"]',
       MAX(r.observed_at),MAX(r.observed_at),1,
       '{"grandfatheredFrom":"m14-pricing-catalog","qualificationClaim":false}'
FROM control_provider_model_rates r
WHERE r.provider_id='openai' AND r.active=1
GROUP BY r.model;

INSERT OR IGNORE INTO control_execution_provider_capabilities(
    provider_id,capability,version,cost_rank,quality_rank,latency_rank,enabled,observed_at,expires_at,metadata_json
) VALUES('openai','agent.conversation','m16',60,80,50,1,
    '2026-08-29T00:00:00Z',NULL,'{"role":"replaceable-intelligence-backend"}');
