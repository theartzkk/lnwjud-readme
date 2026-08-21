#!/bin/sh

set -eu
LC_ALL=C
export LC_ALL

MODE=dry-run
case "${1:-}" in
  ""|--dry-run) MODE=dry-run ;;
  --deploy) MODE=deploy ;;
  *) echo "Usage: $0 [--dry-run|--deploy]" >&2; exit 2 ;;
esac

ROOT=${AWH_SOURCE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}
RELEASE_ID=${AWH_ENROLLMENT_RELEASE_ID:-m3e2-$(date -u +%Y%m%dT%H%M%SZ)}
DEPLOY_TARGET=${AWH_DEPLOY_TARGET:-awh-vps}
PREFLIGHT_SCRIPT=$ROOT/deploy/awh-enrollment/preflight-production.sh
REMOTE_ROOT=/opt/awh-hub
REMOTE_STAGE=/tmp/awh-enrollment-$RELEASE_ID.tar.gz
REMOTE_RELEASE=$REMOTE_ROOT/enrollment-releases/$RELEASE_ID
BUNDLE=$(mktemp "${TMPDIR:-/tmp}/awh-enrollment.XXXXXX.tar.gz")
cleanup() { rm -f "$BUNDLE"; }
trap cleanup EXIT HUP INT TERM

case "$RELEASE_ID" in
  ''|*[!A-Za-z0-9._-]*) echo "Release ID contains unsupported characters" >&2; exit 2 ;;
esac
case "$DEPLOY_TARGET" in
  ''|*[!A-Za-z0-9._-]*) echo "AWH_DEPLOY_TARGET must be an SSH config alias" >&2; exit 2 ;;
esac

for file in public/enrollment.php src/HubEnrollmentService.php src/HubEnrollmentRouter.php src/HubEnrollmentApiMigration.php migrations/002_m3e2_enrollment_api.sql bin/migrate-m3e2.php; do
  test -f "$ROOT/hub/$file" || { echo "Missing Hub enrollment file: $file" >&2; exit 1; }
done
test -f "$PREFLIGHT_SCRIPT" || { echo "Missing production preflight: $PREFLIGHT_SCRIPT" >&2; exit 1; }

tar -czf "$BUNDLE" -C "$ROOT" \
  hub/public/enrollment.php \
  hub/src/HubEnrollmentService.php \
  hub/src/HubEnrollmentRouter.php \
  hub/src/HubEnrollmentApiMigration.php \
  hub/migrations/002_m3e2_enrollment_api.sql \
  hub/bin/migrate-m3e2.php \
  deploy/nginx/awh-enrollment.conf \
  deploy/php-fpm/awh-enrollment.pool.conf

if [ "$MODE" = dry-run ]; then
  echo "DRY-RUN: target SSH alias=$DEPLOY_TARGET"
  echo "DRY-RUN: would require a clean committed release and run the read-only preflight"
  echo "DRY-RUN: would require DB_AUTHORITY_RESOLVED and BACKUP_READY or BACKUP_PROVISION_REQUIRED before mutation"
  echo "DRY-RUN: would create a SQLite-aware backup, verify it, stage the exact reviewed release, and run 002_m3e2_enrollment_api.php twice"
  echo "DRY-RUN: would verify integrity/FK/schema, install reviewed Nginx/PHP-FPM configuration, reload, and run M3D/enrollment regression"
  echo "DRY-RUN: critical gate failure would disable the new route/release and restore the verified DB backup"
  echo "PRODUCTION_DEPLOY_APPROVAL_REQUIRED: pass --deploy only after the final human review"
  exit 0
fi

SOURCE_COMMIT=$(git -C "$ROOT" rev-parse --verify HEAD 2>/dev/null || true)
EXPECTED_COMMIT=${AWH_RELEASE_COMMIT:-$SOURCE_COMMIT}
test -n "$SOURCE_COMMIT" || { echo "Unable to resolve the local Git HEAD" >&2; exit 1; }
test "$SOURCE_COMMIT" = "$EXPECTED_COMMIT" || { echo "AWH_RELEASE_COMMIT must match the local Git HEAD" >&2; exit 1; }
test -z "$(git -C "$ROOT" status --porcelain --untracked-files=all)" || {
  echo "Refusing deployment from a dirty or uncommitted working tree" >&2
  exit 1
}

PREFLIGHT_OUTPUT=$(AWH_DEPLOY_TARGET="$DEPLOY_TARGET" sh "$PREFLIGHT_SCRIPT") || {
  echo "Production preflight command failed" >&2
  exit 1
}
printf '%s\n' "$PREFLIGHT_OUTPUT"
printf '%s\n' "$PREFLIGHT_OUTPUT" | grep -q '^db_classification=DB_AUTHORITY_RESOLVED$' || {
  echo "Production deployment blocked: DB authority is not resolved" >&2
  exit 1
}
printf '%s\n' "$PREFLIGHT_OUTPUT" | grep -Eq '^backup_classification=(BACKUP_READY|BACKUP_PROVISION_REQUIRED)$' || {
  echo "Production deployment blocked: backup destination is not ready" >&2
  exit 1
}
printf '%s\n' "$PREFLIGHT_OUTPUT" | grep -q '^db_enrollment_write=PASS$' || {
  echo "Production deployment blocked: enrollment service cannot write the resolved Hub database" >&2
  exit 1
}
printf '%s\n' "$PREFLIGHT_OUTPUT" | grep -Eq '^enrollment_classification=(FIRST_DEPLOY_EXPECTED|ENROLLMENT_RELEASE_READY)$' || {
  echo "Production deployment blocked: enrollment release state is unsafe" >&2
  exit 1
}
DB_PATH=$(printf '%s\n' "$PREFLIGHT_OUTPUT" | sed -n 's/^db_resolution_path=//p' | tail -n 1)
case "$DB_PATH" in
  /var/lib/awh-hub/*|/opt/awh-hub/*|/srv/awh/*) ;;
  *) echo "Production deployment blocked: resolved DB path is outside bounded AWH roots" >&2; exit 1 ;;
esac

command -v scp >/dev/null 2>&1 || { echo "scp is required" >&2; exit 1; }
command -v ssh >/dev/null 2>&1 || { echo "ssh is required" >&2; exit 1; }
scp -o BatchMode=yes -o StrictHostKeyChecking=yes "$BUNDLE" "$DEPLOY_TARGET:$REMOTE_STAGE"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$DEPLOY_TARGET" sh -s -- "$DB_PATH" "$REMOTE_ROOT" "$REMOTE_STAGE" "$REMOTE_RELEASE" "$RELEASE_ID" <<'REMOTE_DEPLOY'
set -eu
DB=$1
REMOTE_ROOT=$2
REMOTE_STAGE=$3
REMOTE_RELEASE=$4
RELEASE_ID=$5
BACKUP=/var/backups/awh-hub/awh.sqlite.pre-m3e2
PREVIOUS_TARGET=$(sudo readlink -f "$REMOTE_ROOT/enrollment-current" 2>/dev/null || true)
MIGRATION_STARTED=0
SWITCHED=0
SUCCESS=0

rollback() {
  status=$?
  if test "$SUCCESS" -eq 0; then
    if test "$MIGRATION_STARTED" -eq 1; then
      sudo -u awh-hub sqlite3 "$DB" ".restore '$BACKUP'" >/dev/null 2>&1 || true
    fi
    if test "$SWITCHED" -eq 1; then
      if test -n "$PREVIOUS_TARGET"; then sudo ln -sfn "$PREVIOUS_TARGET" "$REMOTE_ROOT/enrollment-current"; else sudo rm -f "$REMOTE_ROOT/enrollment-current"; fi
    fi
    rm -f "$REMOTE_STAGE"
  fi
  exit "$status"
}
trap rollback EXIT

sudo install -d -m 0750 -o awh-hub -g awh-hub "$REMOTE_ROOT/enrollment-releases/$RELEASE_ID"
sudo tar -xzf "$REMOTE_STAGE" -C "$REMOTE_RELEASE"
sudo test -f "$REMOTE_RELEASE/hub/public/enrollment.php"
sudo test -f "$REMOTE_RELEASE/hub/bin/migrate-m3e2.php"
sudo test -f "$REMOTE_RELEASE/deploy/nginx/awh-enrollment.conf"
sudo test -f "$REMOTE_RELEASE/deploy/php-fpm/awh-enrollment.pool.conf"
sudo chown -R awh-hub:awh-hub "$REMOTE_RELEASE"
sudo chmod 0750 "$REMOTE_RELEASE" "$REMOTE_RELEASE/hub" "$REMOTE_RELEASE/hub/public" "$REMOTE_RELEASE/hub/src" "$REMOTE_RELEASE/hub/bin" "$REMOTE_RELEASE/hub/migrations"
sudo chmod 0640 "$REMOTE_RELEASE/hub/public/enrollment.php" "$REMOTE_RELEASE/hub/src/"*.php "$REMOTE_RELEASE/hub/bin/migrate-m3e2.php" "$REMOTE_RELEASE/hub/migrations/002_m3e2_enrollment_api.sql" "$REMOTE_RELEASE/deploy/nginx/awh-enrollment.conf" "$REMOTE_RELEASE/deploy/php-fpm/awh-enrollment.pool.conf"
sudo install -d -m 0700 -o awh-hub -g awh-hub /var/backups/awh-hub
sudo -u awh-hub sqlite3 "$DB" ".backup '$BACKUP'"
sudo test -s "$BACKUP"
test "$(sudo sqlite3 "$BACKUP" 'PRAGMA integrity_check;' | head -n 1)" = ok
test -z "$(sudo sqlite3 "$BACKUP" 'PRAGMA foreign_key_check;')"
MIGRATION_STARTED=1
FIRST=$(sudo -u awh-hub /usr/bin/php "$REMOTE_RELEASE/hub/bin/migrate-m3e2.php" "$DB")
SECOND=$(sudo -u awh-hub /usr/bin/php "$REMOTE_RELEASE/hub/bin/migrate-m3e2.php" "$DB")
printf '%s\n' "$FIRST" "$SECOND"
printf '%s\n' "$FIRST" | grep -q '"result":"applied"'
printf '%s\n' "$SECOND" | grep -q '"result":"already-applied"'
test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;' | head -n 1)" = ok
test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;' | head -n 1)" = 3
sudo ln -sfn "$REMOTE_RELEASE" "$REMOTE_ROOT/enrollment-current"
SWITCHED=1
SUCCESS=1
rm -f "$REMOTE_STAGE"
REMOTE_DEPLOY
echo "AWH enrollment release staged: $RELEASE_ID"
