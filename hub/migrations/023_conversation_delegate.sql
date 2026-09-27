-- M24 Conversation Delegates: bounded AI delegation without OWNER role escalation.
CREATE TABLE IF NOT EXISTS control_ai_delegates (
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    delegate_mode TEXT NOT NULL CHECK (delegate_mode IN ('OWNER_CHANNEL','SCHOOL_SUPPORT')),
    granted_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    PRIMARY KEY (user_id, project_id, delegate_mode),
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
    FOREIGN KEY (granted_by_user_id) REFERENCES hub_users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_control_ai_delegates_lookup
ON control_ai_delegates(user_id,project_id,delegate_mode,revoked_at);
