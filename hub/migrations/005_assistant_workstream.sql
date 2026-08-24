-- M6: The conversation is a durable view over the existing control task,
-- artifact, approval and checkpoint authorities.  It intentionally does not
-- create another project or task registry.
ALTER TABLE control_tasks ADD COLUMN conversation_id TEXT;

CREATE TABLE IF NOT EXISTS control_conversations (
    conversation_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_task_id TEXT,
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (last_task_id) REFERENCES control_tasks(task_id)
);

CREATE TABLE IF NOT EXISTS control_conversation_messages (
    message_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    task_id TEXT,
    message_kind TEXT NOT NULL CHECK (message_kind IN ('USER', 'ASSISTANT', 'PROGRESS', 'APPROVAL', 'RESULT', 'FAILURE')),
    sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
    body TEXT NOT NULL,
    idempotency_key TEXT,
    source_event_id TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES control_conversations(conversation_id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES control_tasks(task_id) ON DELETE SET NULL,
    FOREIGN KEY (source_event_id) REFERENCES control_task_events(event_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_control_conversations_user_project
    ON control_conversations(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_control_conversations_recent
    ON control_conversations(user_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_control_conversation_messages_order
    ON control_conversation_messages(conversation_id, sequence_no);
CREATE UNIQUE INDEX IF NOT EXISTS idx_control_conversation_messages_idempotency
    ON control_conversation_messages(conversation_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_control_conversation_messages_event
    ON control_conversation_messages(source_event_id)
    WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_control_conversation_messages_task
    ON control_conversation_messages(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_control_tasks_conversation
    ON control_tasks(conversation_id, updated_at);
