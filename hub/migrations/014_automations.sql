-- M15 Automation Registry
-- Durable automation definitions only. This migration intentionally does not
-- create an automation execution queue, run state machine, or competing task authority.

CREATE TABLE control_automations (
    automation_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    goal TEXT NOT NULL CHECK (length(goal) BETWEEN 1 AND 2000),
    timing_mode TEXT NOT NULL CHECK (timing_mode IN ('exact_schedule', 'flexible_schedule', 'condition_watch')),
    schedule_ical TEXT NOT NULL CHECK (length(schedule_ical) BETWEEN 1 AND 4096),
    condition_key TEXT,
    condition_description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    FOREIGN KEY (user_id) REFERENCES hub_users(user_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (conversation_id) REFERENCES control_conversations(conversation_id) ON DELETE SET NULL,
    CHECK (
        (timing_mode = 'condition_watch' AND condition_key IS NOT NULL AND condition_description IS NOT NULL)
        OR
        (timing_mode <> 'condition_watch' AND condition_key IS NULL AND condition_description IS NULL)
    )
);

CREATE INDEX idx_control_automations_user_active
    ON control_automations(user_id, archived_at, enabled, updated_at DESC);
CREATE INDEX idx_control_automations_project
    ON control_automations(project_id, archived_at, updated_at DESC);
CREATE INDEX idx_control_automations_conversation
    ON control_automations(conversation_id, archived_at)
    WHERE conversation_id IS NOT NULL;
