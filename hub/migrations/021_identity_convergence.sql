-- M22: KRUART owns platform identity; BAY owns school identity and permissions.
-- AWH stores only bindings/policy metadata. It must not copy BAY school roles as authority.
CREATE TABLE control_identity_authority_policy (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    platform_authority TEXT NOT NULL CHECK (platform_authority = 'KRUART'),
    school_authority TEXT NOT NULL CHECK (school_authority = 'BAY_EXCUSE_X'),
    local_school_roles_enabled INTEGER NOT NULL DEFAULT 0 CHECK (local_school_roles_enabled IN (0,1)),
    break_glass_owner_auth_enabled INTEGER NOT NULL DEFAULT 1 CHECK (break_glass_owner_auth_enabled IN (0,1)),
    updated_at TEXT NOT NULL
);
INSERT INTO control_identity_authority_policy(singleton_id,platform_authority,school_authority,local_school_roles_enabled,break_glass_owner_auth_enabled,updated_at)
VALUES(1,'KRUART','BAY_EXCUSE_X',0,1,CURRENT_TIMESTAMP);

-- Normalize legacy AWH-only school labels into generic platform identity.
-- School role/position/capability now resolves from BAY EXCUSE X.
UPDATE control_user_profiles SET person_type='OTHER' WHERE person_type IN ('TEACHER','DIRECTOR');
UPDATE control_user_profiles SET system_role='STAFF' WHERE system_role IN ('TEACHER','DIRECTOR');
UPDATE control_account_requests SET person_type='OTHER' WHERE state='PENDING' AND person_type IN ('TEACHER','DIRECTOR');

CREATE TABLE control_school_identity_bindings (
    binding_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'BAY_EXCUSE_X' CHECK (provider = 'BAY_EXCUSE_X'),
    school_key TEXT NOT NULL DEFAULT 'primary',
    external_user_id TEXT NOT NULL,
    external_personnel_id TEXT,
    state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','REVOKED')),
    linked_by_user_id TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    last_verified_at TEXT,
    revoked_at TEXT,
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (linked_by_user_id) REFERENCES hub_users(user_id) ON DELETE RESTRICT
);CREATE UNIQUE INDEX idx_school_identity_user
ON control_school_identity_bindings(user_id,provider,school_key);
CREATE UNIQUE INDEX idx_school_identity_external
ON control_school_identity_bindings(provider,school_key,external_user_id);
CREATE INDEX idx_school_identity_state
ON control_school_identity_bindings(state,last_verified_at);

-- Existing AWH/KRUART password material remains for platform login and owner recovery only.
-- School roles/permissions must be resolved live from BAY and fail closed when unavailable.