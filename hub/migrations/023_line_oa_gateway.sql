-- M24 AWH LINE OA Gateway: canonical external-channel identity binding only.
CREATE TABLE control_external_channel_bindings (
 binding_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 channel TEXT NOT NULL CHECK (channel IN ('LINE_AWH')),
 external_user_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK (state IN ('ACTIVE','REVOKED')),
 paired_at TEXT NOT NULL,
 last_seen_at TEXT NOT NULL,
 revoked_at TEXT,
 FOREIGN KEY (user_id) REFERENCES hub_users(user_id) ON DELETE CASCADE,
 UNIQUE(channel,external_user_id),
 UNIQUE(user_id,channel)
);
CREATE INDEX idx_external_channel_binding_state
ON control_external_channel_bindings(channel,state,last_seen_at DESC);

CREATE TABLE control_external_channel_pairings (
 pairing_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 channel TEXT NOT NULL CHECK (channel IN ('LINE_AWH')),
 code_hash TEXT NOT NULL UNIQUE CHECK (length(code_hash)=64),
 expires_at TEXT NOT NULL,
 consumed_at TEXT,
 created_at TEXT NOT NULL,
 FOREIGN KEY (user_id) REFERENCES hub_users(user_id) ON DELETE CASCADE
);
CREATE INDEX idx_external_channel_pairing_lookup
ON control_external_channel_pairings(user_id,channel,expires_at DESC);