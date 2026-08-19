# AWH data directory migration

M1.3A/M1.3B add a local, fail-closed migration engine and active-directory
policy for the move from the legacy `~/.art-agent` directory to `~/.awh`.
`~/.awh` is canonical for clean/new AWH installations. `~/.art-agent` remains
legacy compatibility storage until an explicit migration has completed.

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

`resolveActiveDataDir()` selects exactly one active directory in this order:
explicit `AWH_DATA_DIR`, explicit `ART_AGENT_DATA_DIR`, a valid active
`~/.awh`, existing legacy `~/.art-agent`, or clean-install `~/.awh`. A legacy
installation is not auto-migrated; it remains active until a future explicit
user action. After successful migration, legacy storage is rollback-only.
AWH never dual-writes both directories. If both directories contain meaningful
data and AWH cannot be proven valid, resolution fails closed as a conflict; it
does not merge, compare timestamps, or overwrite either directory.

Resolution and migration are separate operations. Selecting `~/.awh` on a
clean installation does not create it; the directory is created only when the
application first persists data. No real-user migration is performed
automatically by this milestone.

Inspection and dry-run callers receive state, category counts, approximate
size, and generic blockers without file contents or secrets. Real user data is
only inspected read-only by an explicit operator action; the repository tests
use temporary fixtures.
