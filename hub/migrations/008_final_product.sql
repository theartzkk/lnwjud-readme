-- Final product layer: attachments, provider accounting and collaborator
-- capabilities extend the existing M3E/M4/M6/M7/M8 authorities.  This
-- migration deliberately stores only opaque storage keys and hashes; source
-- paths, provider secrets and browser credentials stay outside SQLite.

ALTER TABLE control_conversation_attachments ADD COLUMN storage_key TEXT;
ALTER TABLE control_conversation_attachments ADD COLUMN mime_type TEXT;
ALTER TABLE control_conversation_attachments ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0);
ALTER TABLE control_conversation_attachments ADD COLUMN uploaded_by_user_id TEXT;
ALTER TABLE control_conversation_attachments ADD COLUMN uploaded_at TEXT;
ALTER TABLE control_conversation_attachments ADD COLUMN deleted_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_control_conversation_attachments_storage
    ON control_conversation_attachments(storage_key)
    WHERE storage_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_control_conversation_attachments_message
    ON control_conversation_attachments(message_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_conversation_attachments_access
    ON control_conversation_attachments(project_id, uploaded_by_user_id, deleted_at);

CREATE TABLE IF NOT EXISTS control_provider_policies (
    provider_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    model_fast TEXT NOT NULL,
    model_balanced TEXT NOT NULL,
    model_strong TEXT NOT NULL,
    monthly_budget_microunits INTEGER NOT NULL CHECK (monthly_budget_microunits >= 0),
    warning_microunits INTEGER NOT NULL CHECK (warning_microunits >= 0),
    input_microunits_per_million INTEGER NOT NULL CHECK (input_microunits_per_million >= 0),
    output_microunits_per_million INTEGER NOT NULL CHECK (output_microunits_per_million >= 0),
    updated_by_user_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (updated_by_user_id) REFERENCES hub_users(user_id)
);

CREATE TABLE IF NOT EXISTS control_provider_usage (
    usage_id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT,
    message_id TEXT,
    model TEXT NOT NULL,
    route TEXT NOT NULL CHECK (route IN ('FAST', 'BALANCED', 'STRONG')),
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    cached_input_tokens INTEGER NOT NULL CHECK (cached_input_tokens >= 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    estimated_microunits INTEGER NOT NULL CHECK (estimated_microunits >= 0),
    status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'UNAVAILABLE', 'BUDGET_EXHAUSTED', 'FAILED')),
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (conversation_id) REFERENCES control_conversations(conversation_id) ON DELETE SET NULL,
    FOREIGN KEY (message_id) REFERENCES control_conversation_messages(message_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_control_provider_usage_month
    ON control_provider_usage(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_provider_usage_project
    ON control_provider_usage(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS control_user_profiles (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT,
    system_role TEXT NOT NULL CHECK (system_role IN ('OWNER', 'COLLABORATOR', 'VIEWER', 'APPROVER')),
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS control_project_capabilities (
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    capability TEXT NOT NULL CHECK (capability IN ('project.read', 'conversation.write', 'attachment.upload', 'approval.decide', 'deployment.approve')),
    granted_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    PRIMARY KEY (user_id, project_id, capability),
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
    FOREIGN KEY (granted_by_user_id) REFERENCES hub_users(user_id)
);

CREATE TABLE IF NOT EXISTS control_user_invitations (
    invitation_id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    username TEXT NOT NULL,
    email TEXT,
    system_role TEXT NOT NULL CHECK (system_role IN ('COLLABORATOR', 'VIEWER', 'APPROVER')),
    project_ids_json TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    accepted_at TEXT,
    accepted_user_id TEXT,
    revoked_at TEXT,
    FOREIGN KEY (created_by_user_id) REFERENCES hub_users(user_id),
    FOREIGN KEY (accepted_user_id) REFERENCES hub_users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_control_user_profiles_status
    ON control_user_profiles(status, display_name);
CREATE INDEX IF NOT EXISTS idx_control_project_capabilities_lookup
    ON control_project_capabilities(user_id, project_id, capability, revoked_at);
CREATE INDEX IF NOT EXISTS idx_control_user_invitations_active
    ON control_user_invitations(username, expires_at, accepted_at, revoked_at);

INSERT OR IGNORE INTO control_user_profiles(user_id, display_name, email, system_role, status, created_at, updated_at)
SELECT u.user_id, u.display_name, NULL,
       CASE WHEN u.user_id = (SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1) THEN 'OWNER' ELSE 'COLLABORATOR' END,
       CASE WHEN u.revoked_at IS NULL THEN 'ACTIVE' ELSE 'REVOKED' END,
       u.created_at, u.created_at
FROM hub_users u;

INSERT OR IGNORE INTO control_project_capabilities(user_id, project_id, capability, granted_by_user_id, created_at, revoked_at)
SELECT m.user_id, m.project_id, 'project.read',
       (SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1), m.created_at, m.revoked_at
FROM user_project_memberships m;
INSERT OR IGNORE INTO control_project_capabilities(user_id, project_id, capability, granted_by_user_id, created_at, revoked_at)
SELECT m.user_id, m.project_id, 'conversation.write',
       (SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1), m.created_at, m.revoked_at
FROM user_project_memberships m
WHERE m.role IN ('owner', 'member');
INSERT OR IGNORE INTO control_project_capabilities(user_id, project_id, capability, granted_by_user_id, created_at, revoked_at)
SELECT m.user_id, m.project_id, 'attachment.upload',
       (SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1), m.created_at, m.revoked_at
FROM user_project_memberships m
WHERE m.role IN ('owner', 'member');
INSERT OR IGNORE INTO control_project_capabilities(user_id, project_id, capability, granted_by_user_id, created_at, revoked_at)
SELECT m.user_id, m.project_id, 'approval.decide',
       (SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1), m.created_at, m.revoked_at
FROM user_project_memberships m
WHERE m.role = 'owner';
INSERT OR IGNORE INTO control_project_capabilities(user_id, project_id, capability, granted_by_user_id, created_at, revoked_at)
SELECT m.user_id, m.project_id, 'deployment.approve',
       (SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1), m.created_at, m.revoked_at
FROM user_project_memberships m
WHERE m.role = 'owner';
