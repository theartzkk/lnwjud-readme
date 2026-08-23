-- M12: Central Project Authority.  Existing Project, task, conversation,
-- memory, worker, artifact and approval records remain the only canonical
-- authorities for their domains.  This layer adds an optional private Vault
-- for project content and a durable execution projection over control_tasks.
-- Source files are stored on the private filesystem, never as SQLite BLOBs.

CREATE TABLE IF NOT EXISTS control_project_vaults (
    project_id TEXT PRIMARY KEY,
    storage_mode TEXT NOT NULL CHECK (storage_mode IN ('EXTERNAL', 'VAULT')),
    active_revision_id TEXT,
    sync_state TEXT NOT NULL CHECK (sync_state IN ('EMPTY', 'SYNCED', 'STALE', 'CONFLICT')),
    content_bytes INTEGER NOT NULL DEFAULT 0 CHECK (content_bytes >= 0),
    file_count INTEGER NOT NULL DEFAULT 0 CHECK (file_count >= 0),
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS control_project_vault_revisions (
    revision_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    parent_revision_id TEXT,
    content_sha256 TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    content_bytes INTEGER NOT NULL CHECK (content_bytes >= 0),
    file_count INTEGER NOT NULL CHECK (file_count >= 0),
    origin_kind TEXT NOT NULL CHECK (origin_kind IN ('ARCHIVE', 'DEVICE', 'TASK', 'RESTORE')),
    created_by_user_id TEXT NOT NULL,
    created_by_device_id TEXT,
    task_id TEXT,
    state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'SUPERSEDED', 'CANDIDATE', 'REJECTED')),
    created_at TEXT NOT NULL,
    promoted_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_revision_id) REFERENCES control_project_vault_revisions(revision_id) ON DELETE SET NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES hub_users(user_id),
    FOREIGN KEY (created_by_device_id) REFERENCES devices(device_id) ON DELETE SET NULL,
    FOREIGN KEY (task_id) REFERENCES control_tasks(task_id) ON DELETE SET NULL,
    UNIQUE(project_id, content_sha256)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_control_project_vault_revisions_active
    ON control_project_vault_revisions(project_id)
    WHERE state = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_control_project_vault_revisions_recent
    ON control_project_vault_revisions(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS control_task_executions (
    execution_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL,
    vault_revision_id TEXT,
    executor_kind TEXT NOT NULL CHECK (executor_kind IN ('VPS', 'DEVICE', 'CODEX')),
    required_capability TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('QUEUED', 'LEASED', 'RUNNING', 'WAITING_FOR_CAPABILITY', 'COMPLETED', 'FAILED', 'CANCELLED')),
    lease_owner TEXT,
    lease_expires_at TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 3),
    cancellation_requested_at TEXT,
    checkpoint_json TEXT NOT NULL DEFAULT '{}',
    last_error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES control_tasks(task_id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
    FOREIGN KEY (vault_revision_id) REFERENCES control_project_vault_revisions(revision_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_control_task_executions_ready
    ON control_task_executions(state, executor_kind, updated_at);
CREATE INDEX IF NOT EXISTS idx_control_task_executions_project
    ON control_task_executions(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS control_executor_capabilities (
    executor_id TEXT NOT NULL,
    executor_kind TEXT NOT NULL CHECK (executor_kind IN ('VPS', 'DEVICE', 'CODEX')),
    capability TEXT NOT NULL,
    version TEXT,
    observed_at TEXT NOT NULL,
    expires_at TEXT,
    PRIMARY KEY (executor_id, capability)
);

CREATE TABLE IF NOT EXISTS control_artifact_objects (
    artifact_id TEXT PRIMARY KEY,
    storage_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    retained_until TEXT,
    deleted_at TEXT,
    FOREIGN KEY (artifact_id) REFERENCES control_artifacts(artifact_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS control_desktop_releases (
    release_id TEXT PRIMARY KEY,
    platform TEXT NOT NULL CHECK (platform IN ('darwin', 'win32')),
    architecture TEXT NOT NULL CHECK (architecture IN ('arm64', 'x64')),
    product_version TEXT NOT NULL,
    source_sha TEXT NOT NULL,
    package_sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    download_key TEXT NOT NULL UNIQUE,
    compatibility_json TEXT NOT NULL,
    verification_state TEXT NOT NULL CHECK (verification_state IN ('VERIFIED', 'RETIRED')),
    created_at TEXT NOT NULL,
    retired_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_control_desktop_releases_current
    ON control_desktop_releases(platform, architecture, verification_state, created_at DESC);
