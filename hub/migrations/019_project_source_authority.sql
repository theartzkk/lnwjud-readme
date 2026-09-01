-- M20 Project Source Authority extends the existing canonical projects table.
-- Device-local source_revision stays observational. Canonical remote source
-- provenance is stored separately so stale local checkouts cannot impersonate
-- the project's Source of Truth.
ALTER TABLE projects ADD COLUMN canonical_source_provider TEXT CHECK (canonical_source_provider IS NULL OR canonical_source_provider = 'GITHUB');
ALTER TABLE projects ADD COLUMN canonical_source_repository TEXT;
ALTER TABLE projects ADD COLUMN canonical_source_ref TEXT;
ALTER TABLE projects ADD COLUMN canonical_source_revision TEXT;
ALTER TABLE projects ADD COLUMN canonical_source_observed_at TEXT;
ALTER TABLE projects ADD COLUMN canonical_source_vault_revision_id TEXT;
