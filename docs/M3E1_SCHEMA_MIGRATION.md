# M3E.1 Enrollment Production Migration Safety

This is a local-only, human-reviewed migration plan. It has not been run on
the VPS. It does not add HTTP enrollment routes and does not change the M3D
read-only browser perimeter.

## Exact M3D → M3E delta

The M3D schema contains `projects`, `project_memory`, `devices`, `builds`, and
`releases`, plus the three M3D indexes. M3E.1 does not alter, drop, truncate,
recreate, or overwrite any of those objects or rows.

The dedicated migration adds only:

- eight tables: `hub_users`, `owner_bootstrap`, `device_enrollments`,
  `user_project_memberships`, `pairing_codes`, `pairing_projects`,
  `device_tokens`, and `device_project_memberships`
- three indexes: `idx_device_tokens_device`,
  `idx_device_memberships_project`, and `idx_user_memberships_project`
- the additive `awh_schema_migrations` ledger
- SQLite `PRAGMA user_version` transition from the M3D baseline `0` to M3E.1
  target `2`

Pairing codes and device tokens have hash columns only. Expiry, consumed,
revoked, rotation, owner-bootstrap, foreign-key and uniqueness constraints are
part of the new tables. No secret rows are inserted by the migration.

## Local migration test

```sh
/opt/local/bin/php hub/tests/m3e-migration.php
```

The fixture covers an M3D database with one project and memory row, an empty
database bootstrap path, idempotent rerun, interrupted transaction recovery,
schema-version mismatch, metadata preservation, foreign keys, uniqueness,
and empty secret tables.

## Human-reviewed VPS runbook

Use a maintenance window. Do not run this against an unknown database path.
The operator must first verify that the database is the AWH Hub SQLite file
and that no indexer/write process is running.

### 1. Backup

```sh
DB=/var/lib/awh-hub/awh.sqlite
BACKUP=/var/backups/awh-hub/awh.sqlite.pre-m3e1
sudo install -d -m 0700 /var/backups/awh-hub
sudo -u awh-hub sqlite3 "$DB" ".backup '$BACKUP'"
```

### 2. Verify backup

```sh
sudo test -s "$BACKUP"
sudo sqlite3 "$BACKUP" 'PRAGMA integrity_check;'
sudo sha256sum "$BACKUP" | sudo tee "$BACKUP.sha256"
sudo sha256sum --check "$BACKUP.sha256"
```

The integrity result must be exactly `ok`. Keep the backup immutable until the
post-migration verification is complete.

### 3. Apply the additive migration

```sh
sudo -u awh-hub /usr/bin/php /opt/awh-hub/bin/migrate-m3e.php "$DB"
```

Expected result is JSON with `"result":"applied"`. A rerun must report
`"result":"already-applied"`. Any failure is fail-closed; do not manually
create missing tables.

### 4. Verify SQLite integrity and schema

```sh
sudo sqlite3 "$DB" 'PRAGMA integrity_check; PRAGMA foreign_key_check; PRAGMA user_version;'
sudo sqlite3 "$DB" "SELECT migration_id, schema_version, checksum, applied_at FROM awh_schema_migrations WHERE migration_id='m3e.1-enrollment';"
sudo sqlite3 "$DB" "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name IN ('hub_users','owner_bootstrap','device_enrollments','user_project_memberships','pairing_codes','pairing_projects','device_tokens','device_project_memberships','idx_device_tokens_device','idx_device_memberships_project','idx_user_memberships_project') ORDER BY name;"
```

Require `integrity_check=ok`, no rows from `foreign_key_check`, user version
`2`, one matching migration ledger row, and all eleven named objects. Verify
that `pairing_codes` and `device_tokens` contain no unexpected plaintext
columns or rows before enabling any future enrollment transport.

### 5. Existing Hub Read regression

Use the existing approved HTTPS perimeter authentication interactively; do not
place a password or token in shell history, source, or Project Memory. Verify
that these existing reads still return sanitized data and HTTP 200:

```sh
curl --fail --silent --show-error --user PREVIEW_USER https://PREVIEW_HOST/api/v1/health
curl --fail --silent --show-error --user PREVIEW_USER https://PREVIEW_HOST/api/v1/status
curl --fail --silent --show-error --user PREVIEW_USER https://PREVIEW_HOST/api/v1/projects
curl --fail --silent --show-error --user PREVIEW_USER https://PREVIEW_HOST/api/v1/projects/PROJECT_ID/memory
```

Do not enable enrollment or write routes as part of this migration.

### 6. Rollback/recovery

If post-migration verification fails, keep the service in maintenance mode and
restore only the verified backup, after confirming the target path twice:

```sh
sudo -u awh-hub sqlite3 "$DB" 'PRAGMA integrity_check;'
sudo install -o awh-hub -g awh-hub -m 0600 "$BACKUP" "$DB"
sudo -u awh-hub sqlite3 "$DB" 'PRAGMA integrity_check; PRAGMA foreign_key_check;'
```

Then rerun the M3D read regression. If the backup cannot be verified, stop and
escalate; never delete the original database or manually reverse individual
tables. The migration itself is transactional, so an interrupted run should
be recoverable by rerunning the dedicated migration after preflight.
