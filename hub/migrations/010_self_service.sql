-- M11 self-service layer.  This is deliberately metadata-only: provider
-- credentials remain in the protected server-side credential store and never
-- enter SQLite, exports, conversations, artifacts, or worker payloads.

CREATE TABLE IF NOT EXISTS control_provider_credentials (
    provider_id TEXT PRIMARY KEY,
    configured INTEGER NOT NULL CHECK (configured IN (0, 1)),
    storage_version INTEGER NOT NULL CHECK (storage_version = 1),
    updated_by_user_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_tested_at TEXT,
    last_test_status TEXT NOT NULL CHECK (last_test_status IN ('NOT_TESTED', 'PASS', 'FAILED')),
    FOREIGN KEY (updated_by_user_id) REFERENCES hub_users(user_id)
);

CREATE TABLE IF NOT EXISTS control_project_provider_overrides (
    project_id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    routing_mode TEXT NOT NULL CHECK (routing_mode IN ('AUTO', 'FAST', 'BALANCED', 'STRONG')),
    updated_by_user_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by_user_id) REFERENCES hub_users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_control_provider_credentials_updated
    ON control_provider_credentials(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_project_provider_overrides_provider
    ON control_project_provider_overrides(provider_id, routing_mode, updated_at DESC);
