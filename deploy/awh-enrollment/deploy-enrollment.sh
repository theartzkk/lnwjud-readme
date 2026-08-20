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

ROOT=${AWH_SOURCE_ROOT:-$(pwd)}
RELEASE_ID=${AWH_ENROLLMENT_RELEASE_ID:-m3e2-$(date -u +%Y%m%dT%H%M%SZ)}
DEPLOY_HOST=${AWH_DEPLOY_HOST:-awh-hub-01}
DEPLOY_USER=${AWH_DEPLOY_USER:-DEPLOY_USER}
REMOTE_ROOT=/opt/awh-hub
REMOTE_STAGE=/tmp/awh-enrollment-$RELEASE_ID.tar.gz
REMOTE_RELEASE=$REMOTE_ROOT/enrollment-releases/$RELEASE_ID
BUNDLE=$(mktemp "${TMPDIR:-/tmp}/awh-enrollment.XXXXXX.tar.gz")
cleanup() { rm -f "$BUNDLE"; }
trap cleanup EXIT HUP INT TERM

case "$RELEASE_ID" in
  ''|*[!A-Za-z0-9._-]*) echo "Release ID contains unsupported characters" >&2; exit 2 ;;
esac

for file in public/enrollment.php src/HubEnrollmentService.php src/HubEnrollmentRouter.php src/HubEnrollmentApiMigration.php migrations/002_m3e2_enrollment_api.sql bin/migrate-m3e2.php; do
  test -f "$ROOT/hub/$file" || { echo "Missing Hub enrollment file: $file" >&2; exit 1; }
done

tar -czf "$BUNDLE" -C "$ROOT/hub" public/enrollment.php src/HubEnrollmentService.php src/HubEnrollmentRouter.php src/HubEnrollmentApiMigration.php migrations/002_m3e2_enrollment_api.sql bin/migrate-m3e2.php

if [ "$MODE" = dry-run ]; then
  echo "DRY-RUN: would upload the fixed enrollment package to $DEPLOY_USER@$DEPLOY_HOST:$REMOTE_STAGE"
  echo "DRY-RUN: would stage $REMOTE_RELEASE and atomically switch $REMOTE_ROOT/enrollment-current"
  echo "DRY-RUN: migration backup, Nginx/PHP-FPM config, nginx -t, reload, and health regression remain human-reviewed"
  exit 0
fi

test "$DEPLOY_USER" != DEPLOY_USER || { echo "Set AWH_DEPLOY_USER explicitly before --deploy" >&2; exit 1; }
command -v scp >/dev/null 2>&1 || { echo "scp is required" >&2; exit 1; }
command -v ssh >/dev/null 2>&1 || { echo "ssh is required" >&2; exit 1; }
scp -o BatchMode=yes -o StrictHostKeyChecking=yes "$BUNDLE" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_STAGE"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$DEPLOY_USER@$DEPLOY_HOST" "set -eu; sudo install -d -m 0750 -o awh-hub -g awh-hub '$REMOTE_ROOT/enrollment-releases/$RELEASE_ID'; sudo tar -xzf '$REMOTE_STAGE' -C '$REMOTE_RELEASE'; sudo chown -R awh-hub:awh-hub '$REMOTE_RELEASE'; sudo chmod 0750 '$REMOTE_RELEASE' '$REMOTE_RELEASE/public' '$REMOTE_RELEASE/src' '$REMOTE_RELEASE/bin' '$REMOTE_RELEASE/migrations'; sudo chmod 0640 '$REMOTE_RELEASE/public/enrollment.php' '$REMOTE_RELEASE/src/'*.php '$REMOTE_RELEASE/bin/migrate-m3e2.php' '$REMOTE_RELEASE/migrations/002_m3e2_enrollment_api.sql'; sudo ln -sfn '$REMOTE_RELEASE' '$REMOTE_ROOT/enrollment-current'; rm -f '$REMOTE_STAGE'"
echo "AWH enrollment release staged: $RELEASE_ID"
