-- M7: durable workspace handoff metadata.  Git remains the authority for
-- versioned/WIP source; this Hub stores only bounded metadata and leases.
CREATE TABLE IF NOT EXISTS control_workspace_checkpoints (
    checkpoint_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT,
    source_device_id TEXT NOT NULL,
    base_revision TEXT NOT NULL,
    wip_revision TEXT,
    wip_ref TEXT,
    tree_revision TEXT NOT NULL,
    files_json TEXT NOT NULL,
    artifact_refs_json TEXT NOT NULL,
    sync_state TEXT NOT NULL CHECK (sync_state IN ('CLEAN', 'SYNCED', 'UNSYNCED')),
    created_at TEXT NOT NULL,
    durable_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (task_id) REFERENCES control_tasks(task_id) ON DELETE SET NULL,
    FOREIGN KEY (source_device_id) REFERENCES devices(device_id)
);

CREATE TABLE IF NOT EXISTS control_workspace_leases (
    project_id TEXT PRIMARY KEY,
    owner_device_id TEXT NOT NULL,
    checkpoint_id TEXT,
    state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'RELEASED')),
    lease_expires_at TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (owner_device_id) REFERENCES devices(device_id),
    FOREIGN KEY (checkpoint_id) REFERENCES control_workspace_checkpoints(checkpoint_id)
);

CREATE TABLE IF NOT EXISTS control_workspace_events (
    event_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    checkpoint_id TEXT,
    device_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('CHECKPOINT_PUBLISHED', 'LEASE_ACQUIRED', 'LEASE_RELEASED', 'LEASE_EXPIRED')),
    occurred_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (checkpoint_id) REFERENCES control_workspace_checkpoints(checkpoint_id) ON DELETE SET NULL,
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
);

CREATE INDEX IF NOT EXISTS idx_control_workspace_checkpoints_project
    ON control_workspace_checkpoints(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_workspace_checkpoints_device
    ON control_workspace_checkpoints(source_device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_workspace_leases_expiry
    ON control_workspace_leases(lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_control_workspace_events_project
    ON control_workspace_events(project_id, occurred_at DESC);
