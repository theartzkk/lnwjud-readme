# M21 — Owner System Health and Backup Observability

Status: implementation branch `awh/m21-system-health`.

## Goal
Make AWH operational health truthful from the Owner UI while keeping ReadyIDC, SQLite, the existing worker registry, provider budget tables, and HubBackupService as the only authorities.

## Owner health contract
The existing `/api/v1/control/owner/status` surface adds bounded summaries for:
- database integrity/schema state;
- latest verified backup metadata;
- disk storage pressure without exposing a filesystem path;
- active task and waiting-capability counts;
- AI budget state without exposing a provider credential;
- total/ready optional workers.

The UI renders those summaries inside Owner → System and continues to use Database Studio for deeper read-only inspection.

## Backup visibility fix
Scheduled backups remain root-created. After HubBackupService creates and verifies a snapshot, `scheduled-backup.php` changes only that exact snapshot and manifest to `root:awh-hub 0640`. The AWH PHP-FPM user can verify/read metadata, but cannot modify or delete backup files. `www-data` remains outside the `awh-hub` group.
## Activation
1. Deploy the exact merged M21 revision through the existing M15 refresh path; no new database migration is introduced.
2. Run `deploy/awh-backup/activate-backup.sh --dry-run` from the clean merged revision.
3. Activate only with `--deploy --approve` and exact `AWH_RELEASE_COMMIT`.
4. The guarded remote phase verifies current release identity, unit hashes, SQLite health, and systemd syntax; it backs up existing units before mutation.
5. Activation enables the daily timer, executes one backup immediately, verifies schema 15 from the resulting manifest as `awh-hub`, and rechecks the live database.

## Rollback
If any activation gate fails, restore the exact previous unit files and enabled/active timer state. Never delete snapshots created during a failed activation; a valid backup is retained as recovery evidence.

## QA
- PHP lint for control-plane and scheduled backup entrypoints.
- M11 backward-compatibility fixture.
- sustainability/backup foundation fixture.
- web/Owner settings regression.
- POSIX shell syntax for both activation scripts.
- `systemd-analyze verify` against exact reviewed units on ReadyIDC before activation.
- full repository CI and packaged Desktop gates before merge.
