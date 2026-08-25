-- M13: AWH human workspace roles and user-management foundation.
-- Existing system_role remains a compatibility classification only;
-- workspace_role is the human-facing product role authority.
ALTER TABLE control_user_profiles ADD COLUMN workspace_role TEXT NOT NULL DEFAULT 'STAFF'
    CHECK (workspace_role IN ('OWNER','ADMIN','DIRECTOR','TEACHER','STAFF','VIEWER'));
ALTER TABLE control_user_profiles ADD COLUMN disabled_at TEXT;
ALTER TABLE control_user_profiles ADD COLUMN last_login_at TEXT;
ALTER TABLE owner_passwords ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0
    CHECK (must_change_password IN (0,1));
ALTER TABLE control_user_invitations ADD COLUMN workspace_role TEXT NOT NULL DEFAULT 'STAFF'
    CHECK (workspace_role IN ('ADMIN','DIRECTOR','TEACHER','STAFF','VIEWER'));

UPDATE control_user_profiles SET workspace_role = CASE system_role
    WHEN 'OWNER' THEN 'OWNER'
    WHEN 'APPROVER' THEN 'DIRECTOR'
    WHEN 'VIEWER' THEN 'VIEWER'
    ELSE 'STAFF' END;
UPDATE control_user_invitations SET workspace_role = CASE system_role
    WHEN 'APPROVER' THEN 'DIRECTOR'
    WHEN 'VIEWER' THEN 'VIEWER'
    ELSE 'STAFF' END;
CREATE UNIQUE INDEX idx_control_user_profiles_email_unique
    ON control_user_profiles(lower(email)) WHERE email IS NOT NULL;
CREATE INDEX idx_control_user_profiles_workspace_role
    ON control_user_profiles(workspace_role, status, display_name);

CREATE TABLE control_user_feature_permissions (
    user_id TEXT NOT NULL,
    feature_key TEXT NOT NULL,
    allowed INTEGER NOT NULL CHECK (allowed IN (0,1)),
    updated_by_user_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, feature_key),
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by_user_id) REFERENCES hub_users(user_id)
);
CREATE INDEX idx_control_user_feature_permissions_user
    ON control_user_feature_permissions(user_id, allowed, feature_key);
CREATE TABLE control_user_quotas (
    user_id TEXT PRIMARY KEY,
    ai_daily_requests INTEGER CHECK (ai_daily_requests IS NULL OR ai_daily_requests >= 0),
    ai_monthly_microunits INTEGER CHECK (ai_monthly_microunits IS NULL OR ai_monthly_microunits >= 0),
    updated_by_user_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by_user_id) REFERENCES hub_users(user_id)
);
CREATE INDEX idx_control_user_quotas_updated
    ON control_user_quotas(updated_at DESC);
