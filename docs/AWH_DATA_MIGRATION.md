# AWH data directory migration

M1.3A adds a local, fail-closed migration engine for the future move from the
legacy `~/.art-agent` directory to `~/.awh`. The legacy directory remains the
compatibility source of truth until a migration has completed successfully.

The engine recognizes these existing owners:

- `settings.json`: only the known workspace and boolean permission fields are
  normalized into the destination. Unknown secret-looking fields block the
  migration and are never copied.
- `audit.jsonl`: validated JSONL audit metadata, with no environment or prompt
  contents added by the migration.
- `checkpoints/`: checkpoint manifests and embedded file data are copied only
  after bytes, base64 data, and SHA-256 integrity validate.
- `tasks/`: only the existing persisted task metadata schema is accepted;
  stdout, stderr, executable, arguments, cwd, environment, and prompts are not
  migration data.

Migration is staged in an engine-owned sibling directory named
`.awh-migration-<id>`. The staging marker is validated, supported files are
copied with restrictive user-only permissions where available, and the
directory is atomically promoted to `~/.awh`. The source is never moved,
deleted, or renamed. A nonempty destination without a valid migration marker
is a conflict and is never overwritten. Interrupted staging can be inspected
and cleaned only when its own marker proves ownership.

`resolveActiveDataDir()` selects exactly one active directory: explicit
`AWH_DATA_DIR`, explicit `ART_AGENT_DATA_DIR`, a destination with a valid
completed migration marker, or the legacy `~/.art-agent` compatibility
default. It does not enable dual writes. No real-user migration is performed
automatically by this milestone.

Inspection and dry-run callers receive state, category counts, approximate
size, and generic blockers without file contents or secrets. Real user data is
only inspected read-only by an explicit operator action; the repository tests
use temporary fixtures.
