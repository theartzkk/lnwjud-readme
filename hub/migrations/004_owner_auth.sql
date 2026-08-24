ALTER TABLE control_sessions ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'control';
ALTER TABLE control_sessions ADD COLUMN remembered_until TEXT;
ALTER TABLE control_sessions ADD COLUMN step_up_at TEXT;

CREATE TABLE IF NOT EXISTS owner_passwords (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_changed_at TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled = 1),
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_login_rate_limits (
    rate_key TEXT PRIMARY KEY,
    window_started_at TEXT NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts >= 0),
    blocked_until TEXT
);

CREATE TABLE IF NOT EXISTS auth_recovery_codes (
    recovery_code_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    code_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    used_at TEXT,
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_audit_events (
    event_id TEXT PRIMARY KEY,
    user_id TEXT,
    event_name TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    metadata_hash TEXT,
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_control_sessions_user_kind ON control_sessions(user_id, session_kind, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_recovery_user ON auth_recovery_codes(user_id, used_at);
CREATE INDEX IF NOT EXISTS idx_auth_audit_user ON auth_audit_events(user_id, occurred_at);
