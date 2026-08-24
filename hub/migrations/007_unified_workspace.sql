-- M8: Unified Workspace extends the M6 work stream and M7 continuity
-- authorities. It deliberately stores references and bounded metadata only:
-- workspace paths, source contents and credentials remain device-local.

DROP INDEX IF EXISTS idx_control_conversations_user_project;

ALTER TABLE control_conversations ADD COLUMN title TEXT NOT NULL DEFAULT 'Work';
ALTER TABLE control_conversations ADD COLUMN archived_at TEXT;
ALTER TABLE control_conversations ADD COLUMN origin TEXT NOT NULL DEFAULT 'native';

CREATE INDEX IF NOT EXISTS idx_control_conversations_project_recent
    ON control_conversations(user_id, project_id, archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_conversations_title
    ON control_conversations(user_id, project_id, title);

CREATE TABLE IF NOT EXISTS control_project_device_bindings (
    binding_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    workspace_label TEXT NOT NULL,
    source_fingerprint TEXT,
    capabilities_json TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    revoked_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (device_id) REFERENCES devices(device_id),
    UNIQUE(project_id, device_id)
);

CREATE TABLE IF NOT EXISTS control_project_contexts (
    context_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT,
    device_id TEXT,
    scope_key TEXT NOT NULL,
    view_kind TEXT NOT NULL,
    selected_ref TEXT,
    preview_ref TEXT,
    source_revision TEXT,
    observed_at TEXT NOT NULL,
    expires_at TEXT,
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (conversation_id) REFERENCES control_conversations(conversation_id) ON DELETE SET NULL,
    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_control_project_contexts_active
    ON control_project_contexts(user_id, project_id, scope_key, view_kind);
CREATE INDEX IF NOT EXISTS idx_control_project_contexts_recent
    ON control_project_contexts(user_id, project_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS control_conversation_attachments (
    attachment_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    message_id TEXT,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('artifact', 'image', 'document', 'snapshot', 'view')),
    display_name TEXT NOT NULL,
    artifact_id TEXT,
    sha256 TEXT,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES control_conversations(conversation_id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES control_conversation_messages(message_id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (artifact_id) REFERENCES control_artifacts(artifact_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_control_conversation_attachments_recent
    ON control_conversation_attachments(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS control_product_settings (
    setting_key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    revision_no INTEGER NOT NULL CHECK (revision_no > 0),
    updated_by_user_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (updated_by_user_id) REFERENCES hub_users(user_id)
);

CREATE TABLE IF NOT EXISTS control_product_setting_revisions (
    revision_id TEXT PRIMARY KEY,
    setting_key TEXT NOT NULL,
    revision_no INTEGER NOT NULL CHECK (revision_no > 0),
    value_json TEXT NOT NULL,
    updated_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (updated_by_user_id) REFERENCES hub_users(user_id),
    UNIQUE(setting_key, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_control_product_setting_revisions_recent
    ON control_product_setting_revisions(setting_key, revision_no DESC);
