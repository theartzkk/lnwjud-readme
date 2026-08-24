CREATE TABLE IF NOT EXISTS hub_users (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS owner_bootstrap (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    owner_user_id TEXT NOT NULL,
    initialized_at TEXT NOT NULL,
    bootstrap_closed INTEGER NOT NULL CHECK (bootstrap_closed = 1),
    FOREIGN KEY (owner_user_id) REFERENCES hub_users(user_id)
);

CREATE TABLE IF NOT EXISTS device_enrollments (
    device_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    enrolled_at TEXT NOT NULL,
    revoked_at TEXT,
    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id)
);

CREATE TABLE IF NOT EXISTS user_project_memberships (
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    PRIMARY KEY (user_id, project_id),
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pairing_codes (
    pairing_code_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    code_hash TEXT NOT NULL UNIQUE,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    revoked_at TEXT,
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id)
);

CREATE TABLE IF NOT EXISTS pairing_projects (
    pairing_code_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    PRIMARY KEY (pairing_code_id, project_id),
    FOREIGN KEY (pairing_code_id) REFERENCES pairing_codes(pairing_code_id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS device_tokens (
    token_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    last_used_at TEXT,
    rotated_from_token_id TEXT,
    replaced_by_token_id TEXT,
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id),
    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS device_project_memberships (
    device_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    PRIMARY KEY (device_id, project_id),
    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_device ON device_tokens(device_id);
CREATE INDEX IF NOT EXISTS idx_device_memberships_project ON device_project_memberships(project_id);
CREATE INDEX IF NOT EXISTS idx_user_memberships_project ON user_project_memberships(project_id);
