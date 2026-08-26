-- M13: Anywhere Execution & Capability Fabric.
-- Existing Project, conversation, task, memory, Vault, approval and worker
-- authorities remain canonical. This migration adds only capability/provider
-- discovery plus one execution-envelope projection over M12 executions.

CREATE TABLE IF NOT EXISTS control_capability_sources (
    source_id TEXT PRIMARY KEY,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('BUILTIN','UPSTREAM','PLUGIN')),
    display_name TEXT NOT NULL,
    source_uri TEXT,
    version TEXT,
    license_id TEXT,
    enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
    observed_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS control_capability_catalog (
    capability TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    category TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL,
    mutation_kind TEXT NOT NULL CHECK (mutation_kind IN ('READ','CREATE','REPLACE','DELETE','EXECUTE','OPAQUE')),
    risk_class TEXT NOT NULL CHECK (risk_class IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    maturity TEXT NOT NULL CHECK (maturity IN ('AVAILABLE','OPTIONAL','PLANNED')),
    user_visible INTEGER NOT NULL CHECK (user_visible IN (0,1)),
    enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (source_id) REFERENCES control_capability_sources(source_id)
);
CREATE TABLE IF NOT EXISTS control_execution_providers (
    provider_id TEXT PRIMARY KEY,
    provider_kind TEXT NOT NULL CHECK (provider_kind IN ('VPS','DEVICE','CODEX','MCP','API','BURST')),
    display_name TEXT NOT NULL,
    availability_mode TEXT NOT NULL CHECK (availability_mode IN ('ALWAYS_ON','ON_DEMAND','OPTIONAL_DEVICE')),
    cost_class TEXT NOT NULL CHECK (cost_class IN ('INCLUDED','PREPAID','LOCAL_FREE','METERED')),
    priority INTEGER NOT NULL CHECK (priority >= 0 AND priority <= 999),
    enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
    observed_at TEXT NOT NULL,
    expires_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS control_execution_provider_capabilities (
    provider_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    version TEXT,
    cost_rank INTEGER NOT NULL CHECK (cost_rank >= 0 AND cost_rank <= 100),
    quality_rank INTEGER NOT NULL CHECK (quality_rank >= 0 AND quality_rank <= 100),
    latency_rank INTEGER NOT NULL CHECK (latency_rank >= 0 AND latency_rank <= 100),
    enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
    observed_at TEXT NOT NULL,
    expires_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (provider_id, capability),
    FOREIGN KEY (provider_id) REFERENCES control_execution_providers(provider_id) ON DELETE CASCADE,
    FOREIGN KEY (capability) REFERENCES control_capability_catalog(capability) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS control_execution_envelopes (
    envelope_id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL UNIQUE,
    task_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT,
    base_revision_id TEXT,
    session_key TEXT NOT NULL,
    mutation_scope TEXT NOT NULL CHECK (mutation_scope IN ('READ','PROJECT_CANDIDATE','DEVICE_WORKSPACE','EXTERNAL')),
    state TEXT NOT NULL CHECK (state IN ('OPEN','ACTIVE','WAITING','RELEASED','CONFLICT','CANCELLED')),
    provider_id TEXT,
    lease_expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (execution_id) REFERENCES control_task_executions(execution_id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES control_tasks(task_id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES control_conversations(conversation_id) ON DELETE SET NULL,
    FOREIGN KEY (base_revision_id) REFERENCES control_project_vault_revisions(revision_id) ON DELETE SET NULL,
    FOREIGN KEY (provider_id) REFERENCES control_execution_providers(provider_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_control_capability_catalog_category
    ON control_capability_catalog(category, maturity, enabled);
CREATE INDEX IF NOT EXISTS idx_control_execution_providers_availability
    ON control_execution_providers(enabled, availability_mode, expires_at);
CREATE INDEX IF NOT EXISTS idx_control_execution_provider_capabilities_route
    ON control_execution_provider_capabilities(capability, enabled, cost_rank, latency_rank);
CREATE INDEX IF NOT EXISTS idx_control_execution_envelopes_project
    ON control_execution_envelopes(project_id, state, updated_at DESC);