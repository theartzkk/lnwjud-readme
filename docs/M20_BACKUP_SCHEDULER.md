# M20 — Automatic verified backup scheduler

Status: implementation branch `awh/m20-backup-scheduler`.

## Goal
Run the existing `HubBackupService` automatically once per day without creating a second backup authority or changing the active SQLite database.

## Authority and safety
- Source database remains `/var/lib/awh-hub/awh.sqlite`.
- Backup root remains `/var/backups/awh-hub`.
- The service calls the deployed canonical `hub/bin/backup.php create` command, which validates integrity and foreign keys before activating the manifest.
- The timer runs at 03:30 Asia/Bangkok server time with a bounded randomized delay and `Persistent=true`.
- The service has no network access, cannot write the database or `/opt`, and can write only the backup root.
- Backup files and manifests inherit `UMask=0077`; the backup service itself also enforces mode `0600`.
- This milestone does not delete backups. Retention must be added only through a separate bounded policy with its own tests.

## Activation gate
Install the exact reviewed unit files as root, run `systemd-analyze verify`, daemon-reload, enable the timer, run the service once, and verify that the newest backup manifest reports schema 15 / integrity PASS / foreignKeys PASS before calling M20 active.

## Rollback
Disable the timer, remove only `awh-backup.service` and `awh-backup.timer`, daemon-reload, and leave all existing backup snapshots untouched.
