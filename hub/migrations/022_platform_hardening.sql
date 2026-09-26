-- M23 Platform Hardening: durable cross-product events plus execution capabilities.
CREATE TABLE IF NOT EXISTS control_domain_events (
 event_id TEXT PRIMARY KEY, project_id TEXT, topic TEXT NOT NULL, aggregate_type TEXT, aggregate_id TEXT,
 payload_json TEXT NOT NULL, payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256)=64),
 state TEXT NOT NULL CHECK (state IN ('PENDING','PROCESSING','DELIVERED','DEAD')),
 attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 1000),
 lease_owner TEXT, lease_expires_at TEXT, next_attempt_at TEXT, last_error_code TEXT,
 idempotency_key TEXT NOT NULL UNIQUE, occurred_at TEXT NOT NULL, created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL, delivered_at TEXT,
 FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_control_domain_events_delivery ON control_domain_events(state,next_attempt_at,occurred_at);
CREATE INDEX IF NOT EXISTS idx_control_domain_events_topic ON control_domain_events(topic,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_domain_events_project ON control_domain_events(project_id,occurred_at DESC);
INSERT OR IGNORE INTO control_capability_catalog(capability,source_id,category,display_name,description,mutation_kind,risk_class,maturity,user_visible,enabled,created_at,updated_at)
VALUES('qa.runner','awh-core','development','Release QA Runner','Bounded build and QA execution lane outside production mutation authority','EXECUTE','LOW','AVAILABLE',0,1,'2026-09-26T00:00:00Z','2026-09-26T00:00:00Z');
INSERT OR IGNORE INTO control_capability_catalog(capability,source_id,category,display_name,description,mutation_kind,risk_class,maturity,user_visible,enabled,created_at,updated_at)
VALUES('event.outbox','awh-core','integration','Durable Event Outbox','At-least-once cross-product event delivery without direct product database writes','CREATE','LOW','AVAILABLE',0,1,'2026-09-26T00:00:00Z','2026-09-26T00:00:00Z');
