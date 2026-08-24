-- M10: Founding Memory is one additive, bounded projection over the M8
-- Project/Conversation authority and M9 user/capability authority.  It never
-- stores source trees, credentials, raw chat transcripts or provider secrets.

CREATE TABLE IF NOT EXISTS control_memory_import_batches (
    batch_id TEXT PRIMARY KEY,
    imported_by_user_id TEXT NOT NULL,
    seed_version TEXT NOT NULL,
    seed_checksum TEXT NOT NULL,
    provenance TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('COMMITTED', 'ROLLED_BACK', 'PARTIAL_ROLLBACK')),
    created_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    rolled_back_at TEXT,
    FOREIGN KEY (imported_by_user_id) REFERENCES hub_users(user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_control_memory_import_batch_active
    ON control_memory_import_batches(imported_by_user_id, seed_version, seed_checksum)
    WHERE rolled_back_at IS NULL;

CREATE TABLE IF NOT EXISTS control_memory_records (
    memory_id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('OWNER', 'CONSTITUTION', 'PROJECT', 'CONVERSATION', 'ARCHIVE')),
    scope_subject TEXT NOT NULL,
    stable_key TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    project_id TEXT,
    project_key TEXT,
    conversation_id TEXT,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    authority_level TEXT NOT NULL CHECK (authority_level IN ('FOUNDING', 'OWNER_EDITED', 'VERIFIED')),
    provenance TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_verified_at TEXT,
    freshness TEXT NOT NULL CHECK (freshness IN ('FOUNDING', 'CURRENT', 'STALE', 'SUPERSEDED', 'FORGOTTEN')),
    superseded_by_memory_id TEXT,
    superseded_by_source_revision TEXT,
    sensitivity TEXT NOT NULL CHECK (sensitivity IN ('NORMAL')),
    sharing_policy TEXT NOT NULL CHECK (sharing_policy IN ('OWNER_PRIVATE', 'PROJECT_SHARED')),
    tags_json TEXT NOT NULL,
    source_revision TEXT,
    pinned_at TEXT,
    deleted_at TEXT,
    import_batch_id TEXT,
    revision_no INTEGER NOT NULL CHECK (revision_no > 0),
    FOREIGN KEY (owner_user_id) REFERENCES hub_users(user_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL,
    FOREIGN KEY (conversation_id) REFERENCES control_conversations(conversation_id) ON DELETE SET NULL,
    FOREIGN KEY (superseded_by_memory_id) REFERENCES control_memory_records(memory_id) ON DELETE SET NULL,
    FOREIGN KEY (import_batch_id) REFERENCES control_memory_import_batches(batch_id) ON DELETE SET NULL,
    UNIQUE(scope, scope_subject, stable_key)
);

CREATE INDEX IF NOT EXISTS idx_control_memory_records_owner
    ON control_memory_records(owner_user_id, scope, deleted_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_memory_records_project
    ON control_memory_records(project_id, sharing_policy, deleted_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_memory_records_search
    ON control_memory_records(scope, stable_key, category, freshness, deleted_at);

CREATE TABLE IF NOT EXISTS control_memory_revisions (
    revision_id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    revision_no INTEGER NOT NULL CHECK (revision_no > 0),
    content TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    authority_level TEXT NOT NULL,
    provenance TEXT NOT NULL,
    freshness TEXT NOT NULL,
    sharing_policy TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    source_revision TEXT,
    change_kind TEXT NOT NULL CHECK (change_kind IN ('FOUNDING_IMPORT', 'FOUNDING_REFRESH', 'OWNER_EDIT', 'PIN', 'SHARING', 'STALE_MARK', 'FORGET')),
    changed_by_user_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (memory_id) REFERENCES control_memory_records(memory_id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by_user_id) REFERENCES hub_users(user_id) ON DELETE SET NULL,
    UNIQUE(memory_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_control_memory_revisions_recent
    ON control_memory_revisions(memory_id, revision_no DESC);

CREATE TABLE IF NOT EXISTS control_memory_import_items (
    batch_id TEXT NOT NULL,
    stable_key TEXT NOT NULL,
    memory_id TEXT,
    action TEXT NOT NULL CHECK (action IN ('INSERTED', 'UPDATED', 'UNCHANGED', 'SKIPPED_NEWER', 'EXCLUDED_SENSITIVE')),
    previous_json TEXT,
    PRIMARY KEY (batch_id, stable_key),
    FOREIGN KEY (batch_id) REFERENCES control_memory_import_batches(batch_id) ON DELETE CASCADE,
    FOREIGN KEY (memory_id) REFERENCES control_memory_records(memory_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_control_memory_import_items_memory
    ON control_memory_import_items(memory_id, action);
