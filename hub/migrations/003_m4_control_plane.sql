CREATE TABLE IF NOT EXISTS control_sessions (
    session_id TEXT PRIMARY KEY,
    session_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    device_id TEXT,
    csrf_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    revoked_at TEXT,
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id),
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
);

CREATE TABLE IF NOT EXISTS control_session_rate_limits (
    rate_key TEXT PRIMARY KEY,
    window_started_at TEXT NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts >= 0),
    blocked_until TEXT
);

CREATE TABLE IF NOT EXISTS control_tasks (
    task_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    goal TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('QUEUED', 'WAITING_FOR_WORKER', 'PREPARING', 'RUNNING', 'QA', 'WAITING_FOR_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED')),
    assigned_device_id TEXT,
    lease_expires_at TEXT,
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    result_summary TEXT,
    failure_code TEXT,
    idempotency_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    cancelled_at TEXT,
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (assigned_device_id) REFERENCES devices(device_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_control_tasks_user_idempotency ON control_tasks(user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_control_tasks_queue ON control_tasks(state, created_at);
CREATE INDEX IF NOT EXISTS idx_control_tasks_project ON control_tasks(project_id, updated_at);

CREATE TABLE IF NOT EXISTS control_task_events (
    event_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    state TEXT NOT NULL,
    progress INTEGER NOT NULL CHECK (progress >= 0 AND progress <= 100),
    message TEXT,
    occurred_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES control_tasks(task_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS control_workers (
    device_id TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('READY', 'WORKING', 'OFFLINE')),
    capabilities_json TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    busy_task_id TEXT,
    FOREIGN KEY (device_id) REFERENCES devices(device_id),
    FOREIGN KEY (busy_task_id) REFERENCES control_tasks(task_id)
);

CREATE TABLE IF NOT EXISTS control_artifacts (
    artifact_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    sha256 TEXT,
    size_bytes INTEGER,
    relative_ref TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES control_tasks(task_id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);

CREATE TABLE IF NOT EXISTS control_approvals (
    approval_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    action TEXT NOT NULL,
    scope_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
    expires_at TEXT NOT NULL,
    decided_at TEXT,
    FOREIGN KEY (task_id) REFERENCES control_tasks(task_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_control_sessions_user ON control_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_control_session_rate_limits_blocked ON control_session_rate_limits(blocked_until);
CREATE INDEX IF NOT EXISTS idx_control_events_task ON control_task_events(task_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_control_workers_seen ON control_workers(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_control_artifacts_task ON control_artifacts(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_control_approvals_task ON control_approvals(task_id, status);
