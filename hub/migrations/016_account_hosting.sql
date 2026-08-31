-- M17: human-first accounts + canonical Managed Hosting authority.
-- Existing auth/task/project/vault/release authorities remain canonical.

DROP INDEX IF EXISTS idx_control_user_profiles_status;
CREATE TABLE control_user_profiles_m17 (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    person_type TEXT NOT NULL DEFAULT 'STAFF' CHECK (person_type IN ('DIRECTOR','TEACHER','STAFF','PARENT','STUDENT','OTHER')),
    system_role TEXT NOT NULL CHECK (system_role IN ('OWNER','ADMIN','DIRECTOR','TEACHER','STAFF','VIEWER')),
    status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
    must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id) ON DELETE CASCADE
);
INSERT INTO control_user_profiles_m17(user_id,display_name,email,phone,person_type,system_role,status,must_change_password,created_at,updated_at)
SELECT user_id,display_name,email,NULL,
       CASE system_role WHEN 'OWNER' THEN 'STAFF' ELSE 'STAFF' END,
       CASE system_role WHEN 'OWNER' THEN 'OWNER' WHEN 'APPROVER' THEN 'DIRECTOR' WHEN 'VIEWER' THEN 'VIEWER' ELSE 'STAFF' END,
       CASE status WHEN 'ACTIVE' THEN 'ACTIVE' ELSE 'REVOKED' END,
       0,created_at,updated_at
FROM control_user_profiles;
DROP TABLE control_user_profiles;
ALTER TABLE control_user_profiles_m17 RENAME TO control_user_profiles;
CREATE INDEX idx_control_user_profiles_status ON control_user_profiles(status, display_name);
CREATE UNIQUE INDEX idx_control_user_profiles_email ON control_user_profiles(lower(email)) WHERE email IS NOT NULL AND email <> '';

CREATE TABLE control_account_requests (
    request_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    username TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    person_type TEXT NOT NULL CHECK (person_type IN ('DIRECTOR','TEACHER','STAFF','PARENT','STUDENT','OTHER')),
    requested_area TEXT,
    note TEXT,
    password_hash TEXT,
    state TEXT NOT NULL CHECK (state IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
    submitted_at TEXT NOT NULL,
    reviewed_at TEXT,
    reviewed_by_user_id TEXT,
    resolved_user_id TEXT,
    FOREIGN KEY (reviewed_by_user_id) REFERENCES hub_users(user_id) ON DELETE SET NULL,
    FOREIGN KEY (resolved_user_id) REFERENCES hub_users(user_id) ON DELETE SET NULL
);
CREATE INDEX idx_control_account_requests_state ON control_account_requests(state, submitted_at DESC);
CREATE UNIQUE INDEX idx_control_account_requests_pending_username ON control_account_requests(lower(username)) WHERE state='PENDING';

CREATE TABLE control_managed_sites (
    site_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    environment TEXT NOT NULL CHECK (environment IN ('PRODUCTION','STAGING','PREVIEW')),
    runtime_type TEXT NOT NULL CHECK (runtime_type IN ('AUTO','STATIC','PHP','NODE')),
    runtime_version TEXT,
    database_mode TEXT NOT NULL CHECK (database_mode IN ('AUTO','NONE','SQLITE','MARIADB')),
    state TEXT NOT NULL CHECK (state IN ('DRAFT','QUEUED','PROVISIONING','READY','DEGRADED','DISABLED','FAILED')),
    public_mode TEXT NOT NULL CHECK (public_mode IN ('IP_PORT','DOMAIN')),
    listen_port INTEGER CHECK (listen_port IS NULL OR (listen_port BETWEEN 8400 AND 8999)),
    primary_host TEXT,
    health_path TEXT NOT NULL DEFAULT '/',
    backup_enabled INTEGER NOT NULL DEFAULT 1 CHECK (backup_enabled IN (0,1)),
    current_release_id TEXT,
    rollback_release_id TEXT,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by_user_id) REFERENCES hub_users(user_id)
);
CREATE INDEX idx_control_managed_sites_project ON control_managed_sites(project_id, environment, state);
CREATE INDEX idx_control_managed_sites_state ON control_managed_sites(state, updated_at DESC);

CREATE TABLE control_site_bindings (
    binding_id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    binding_kind TEXT NOT NULL CHECK (binding_kind IN ('IP_PORT','DOMAIN')),
    host TEXT NOT NULL,
    port INTEGER CHECK (port IS NULL OR (port BETWEEN 1 AND 65535)),
    tls_mode TEXT NOT NULL CHECK (tls_mode IN ('REUSE_EXISTING','AUTO_DOMAIN','AUTO_IP','DISABLED')),
    state TEXT NOT NULL CHECK (state IN ('REQUESTED','ACTIVE','DEGRADED','DISABLED','FAILED')),
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (site_id) REFERENCES control_managed_sites(site_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_control_site_bindings_primary ON control_site_bindings(site_id) WHERE is_primary=1 AND state <> 'DISABLED';
CREATE INDEX idx_control_site_bindings_host ON control_site_bindings(host, port, state);

CREATE TABLE control_site_releases (
    release_id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    vault_revision_id TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('STAGED','ACTIVE','ROLLBACK','FAILED','RETIRED')),
    created_at TEXT NOT NULL,
    activated_at TEXT,
    retired_at TEXT,
    FOREIGN KEY (site_id) REFERENCES control_managed_sites(site_id) ON DELETE CASCADE,
    FOREIGN KEY (vault_revision_id) REFERENCES control_project_vault_revisions(revision_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX idx_control_site_releases_active ON control_site_releases(site_id) WHERE state='ACTIVE';
CREATE INDEX idx_control_site_releases_recent ON control_site_releases(site_id, created_at DESC);

CREATE TABLE control_site_database_bindings (
    site_id TEXT PRIMARY KEY,
    engine TEXT NOT NULL CHECK (engine IN ('NONE','SQLITE','MARIADB')),
    database_name TEXT,
    credential_ref TEXT,
    state TEXT NOT NULL CHECK (state IN ('NOT_REQUIRED','REQUESTED','READY','DEGRADED','DISABLED','FAILED')),
    updated_at TEXT NOT NULL,
    FOREIGN KEY (site_id) REFERENCES control_managed_sites(site_id) ON DELETE CASCADE
);

CREATE TABLE control_site_events (
    event_id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    task_id TEXT,
    event_name TEXT NOT NULL,
    state TEXT NOT NULL,
    message TEXT,
    occurred_at TEXT NOT NULL,
    FOREIGN KEY (site_id) REFERENCES control_managed_sites(site_id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES control_tasks(task_id) ON DELETE SET NULL
);
CREATE INDEX idx_control_site_events_recent ON control_site_events(site_id, occurred_at DESC);
