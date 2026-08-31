# M20 — Automatic verified backup scheduler

Status: active production capability. Canonical backup authority is `HubBackupService`.

## Goal
Run the existing `HubBackupService` automatically once per day without creating a second backup authority or changing the active SQLite database, while keeping manual and scheduled creation paths consistent.

## Authority and safety
- Source database remains `/var/lib/awh-hub/awh.sqlite`.
- Backup root remains `/var/backups/awh-hub`.
- Both the scheduled wrapper and canonical `hub/bin/backup.php create` reuse `HubBackupService::create`; no parallel snapshot format or metadata authority exists.
- A backup is verified for SHA-256, SQLite integrity, foreign keys and `PRAGMA user_version` before its manifest is authoritative.
- Production backup payloads and manifests are published as `0640` to the bounded `awh-hub` read group. The manifest is published only after its temporary file has the required group/mode, preventing an unreadable manifest from becoming the newest visible backup.
- The production CLI defaults to the same `awh-hub` read group when writing the canonical `/var/backups/awh-hub` root. Non-production/custom roots retain private defaults unless a read group is explicitly supplied.
- The timer runs at 03:30 Asia/Bangkok server time with a bounded randomized delay and `Persistent=true`.
- The service has no network access, cannot write the database or `/opt`, and can write only the backup root and its bounded runtime path.
- Invalid/unreadable newest snapshots remain visible as `REVIEW`; AWH does not silently claim an older snapshot is the newest. Missing schema metadata is reported as unknown/null, never fabricated as schema `0`.
- This capability does not destructively clean snapshots. Retention follows the separate bounded Storage Governance lifecycle and reference checks.

## Verification gate
For an activated release, verify the exact deployed unit and wrapper, timer state, newest manifest, SHA-256, SQLite integrity/FK state, schema version matching the active database, and a bounded restore drill whose scratch copy is removed after verification.

## Rollback
Preserve existing snapshots. Roll back only the exact release/unit change through the typed production authority and keep the pre-deploy database snapshot available; never delete backup evidence as part of rollback.
