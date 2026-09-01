-- M19: reversible conversation deletion over the existing conversation authority.
-- Tasks, messages, artifacts and audit history stay canonical; this only marks
-- whether a conversation is visible in the normal Work index.
ALTER TABLE control_conversations ADD COLUMN deleted_at TEXT;
ALTER TABLE control_conversations ADD COLUMN deleted_by_user_id TEXT REFERENCES hub_users(user_id) ON DELETE SET NULL;

CREATE INDEX idx_control_conversations_deleted
    ON control_conversations(user_id, project_id, deleted_at, archived_at, updated_at DESC);
