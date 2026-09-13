-- M21 makes AWH Project Vault a first-class canonical source authority.
-- Existing GitHub binding remains mirror/upstream provenance and is backfilled
-- as the authority for already-configured projects. No shadow project table is created.
ALTER TABLE projects ADD COLUMN canonical_source_authority TEXT
  CHECK (canonical_source_authority IS NULL OR canonical_source_authority IN ('GITHUB','AWH_VAULT'));
ALTER TABLE projects ADD COLUMN canonical_source_content_sha256 TEXT
  CHECK (canonical_source_content_sha256 IS NULL OR (
    length(canonical_source_content_sha256) = 64
    AND canonical_source_content_sha256 NOT GLOB '*[^0-9a-f]*'
  ));

UPDATE projects
SET canonical_source_authority = 'GITHUB'
WHERE canonical_source_authority IS NULL
  AND canonical_source_provider = 'GITHUB';

UPDATE projects
SET canonical_source_content_sha256 = (
  SELECT lower(r.content_sha256)
  FROM control_project_vault_revisions r
  WHERE r.project_id = projects.project_id
    AND r.revision_id = projects.canonical_source_vault_revision_id
)
WHERE canonical_source_vault_revision_id IS NOT NULL
  AND canonical_source_content_sha256 IS NULL;
