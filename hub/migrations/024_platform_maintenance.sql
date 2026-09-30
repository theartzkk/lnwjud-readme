-- M25 Platform Maintenance Authority: one fail-closed platform-only maintenance state.
CREATE TABLE IF NOT EXISTS control_platform_maintenance (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    mode TEXT NOT NULL CHECK (mode IN ('NORMAL','PLATFORM_ONLY')),
    platform_project_id TEXT,
    reason TEXT NOT NULL,
    enabled_at TEXT,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    FOREIGN KEY (platform_project_id) REFERENCES projects(project_id)
);

INSERT OR IGNORE INTO control_platform_maintenance(
    singleton_id, mode, platform_project_id, reason, enabled_at, updated_at, updated_by
) VALUES (
    1, 'NORMAL', NULL, 'Normal operation', NULL, '1970-01-01T00:00:00Z', 'migration'
);
