CREATE TABLE IF NOT EXISTS enrollment_rate_limits (
    rate_key TEXT PRIMARY KEY,
    window_started_at TEXT NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts >= 0),
    blocked_until TEXT
);
