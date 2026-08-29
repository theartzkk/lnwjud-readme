#!/bin/sh

set -eu
LC_ALL=C
export LC_ALL

MODE=dry-run
COMPAT_REFRESH=0
while test "$#" -gt 0; do
  case "$1" in
    --dry-run) MODE=dry-run ;;
    --deploy) MODE=deploy ;;
    --compat-refresh) COMPAT_REFRESH=1 ;;
    *) echo "Usage: $0 [--dry-run] | --deploy [--compat-refresh]" >&2; exit 2 ;;
  esac
  shift
done

ROOT=${AWH_SOURCE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}
RELEASE_ID=${AWH_ENROLLMENT_RELEASE_ID:-m3e2-$(date -u +%Y%m%dT%H%M%SZ)}
DEPLOY_TARGET=${AWH_DEPLOY_TARGET:-awh-vps}
PREFLIGHT_SCRIPT=$ROOT/deploy/awh-enrollment/preflight-production.sh
REMOTE_ROOT=/opt/awh-hub
REMOTE_STAGE=/tmp/awh-enrollment-$RELEASE_ID.tar.gz
REMOTE_RELEASE=$REMOTE_ROOT/enrollment-releases/$RELEASE_ID
HUB_HOSTNAME=${AWH_HUB_HOSTNAME:-}
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
REMOTE_DEPLOY_SCRIPT=$ROOT/deploy/awh-enrollment/remote-deploy.sh
test -f "$REMOTE_DEPLOY_SCRIPT" || { echo "Missing remote deployment phase: $REMOTE_DEPLOY_SCRIPT" >&2; exit 1; }
NGINX_INSERT_HELPER=$ROOT/deploy/awh-enrollment/insert-nginx-include.php
test -f "$NGINX_INSERT_HELPER" || { echo "Missing Nginx insertion helper: $NGINX_INSERT_HELPER" >&2; exit 1; }

tar -czf "$BUNDLE" -C "$ROOT" \
  hub/public/enrollment.php \
  hub/src/HubEnrollmentService.php \
  hub/src/HubEnrollmentRouter.php \
  hub/src/HubEnrollmentApiMigration.php \
  hub/migrations/002_m3e2_enrollment_api.sql \
  hub/bin/migrate-m3e2.php \
  deploy/nginx/awh-enrollment.conf \
  deploy/php-fpm/awh-enrollment.pool.conf \
  deploy/awh-enrollment/pointer-state.sh \
  deploy/awh-enrollment/insert-nginx-include.php \
  deploy/awh-enrollment/remote-deploy.sh

if [ "$MODE" = dry-run ]; then
  echo "DRY-RUN: target SSH alias=$DEPLOY_TARGET"
  echo "DRY-RUN: would require a clean committed release and run the read-only preflight"
  echo "DRY-RUN: would require DB_AUTHORITY_RESOLVED, DB_WRITE_READY or DB_WRITE_PROVISION_REQUIRED, bootstrap hash READY, and BACKUP_READY or BACKUP_PROVISION_REQUIRED before mutation"
  if test "$COMPAT_REFRESH" -eq 1; then
    echo "DRY-RUN: compatibility refresh would verify the existing M3E.2 capability on the shared database without replaying or downgrading historical migrations"
  else
    echo "DRY-RUN: would create a SQLite-aware backup, verify it, stage the exact reviewed release, and run 002_m3e2_enrollment_api.php twice"
  fi
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

case "$HUB_HOSTNAME" in
  ''|*[!A-Za-z0-9.-]*|.*|*.) echo "AWH_HUB_HOSTNAME is invalid" >&2; exit 2 ;;
esac
case "$HUB_HOSTNAME" in
  *[A-Za-z]*.*) : ;;
  *) echo "AWH_HUB_HOSTNAME is invalid" >&2; exit 2 ;;
esac
printf '%s\n' "$HUB_HOSTNAME" | awk 'BEGIN { valid = 1 } { if (length($0) > 253 || split($0, labels, ".") < 2) valid = 0; for (i in labels) if (labels[i] == "" || length(labels[i]) > 63 || labels[i] ~ /^-/ || labels[i] ~ /-$/) valid = 0 } END { exit valid ? 0 : 1 }' || {
  echo "AWH_HUB_HOSTNAME is invalid" >&2
  exit 2
}

PREFLIGHT_OUTPUT=$(AWH_DEPLOY_TARGET="$DEPLOY_TARGET" AWH_HUB_HOSTNAME="$HUB_HOSTNAME" sh "$PREFLIGHT_SCRIPT") || {
  echo "Production preflight command failed" >&2
  exit 1
}
printf '%s\n' "$PREFLIGHT_OUTPUT" | grep -q '^db_classification=DB_AUTHORITY_RESOLVED$' || {
  echo "Production deployment blocked: DB authority is not resolved" >&2
  exit 1
}
printf '%s\n' "$PREFLIGHT_OUTPUT" | grep -Eq '^backup_classification=(BACKUP_READY|BACKUP_PROVISION_REQUIRED)$' || {
  echo "Production deployment blocked: backup destination is not ready" >&2
  exit 1
}
printf '%s\n' "$PREFLIGHT_OUTPUT" | grep -Eq '^db_write_classification=(DB_WRITE_READY|DB_WRITE_PROVISION_REQUIRED)$' || {
  echo "Production deployment blocked: bounded SQLite write provisioning is unavailable" >&2
  exit 1
}
printf '%s\n' "$PREFLIGHT_OUTPUT" | grep -q '^enrollment_bootstrap_hash=READY$' || {
  echo "Production deployment blocked: bootstrap hash is not provisioned out-of-band" >&2
  exit 1
}
printf '%s\n' "$PREFLIGHT_OUTPUT" | grep -Eq '^enrollment_classification=(FIRST_DEPLOY_EXPECTED|ENROLLMENT_RELEASE_READY)$' || {
  echo "Production deployment blocked: enrollment release state is unsafe" >&2
  exit 1
}
printf '%s\n' "$PREFLIGHT_OUTPUT" | grep -q '^nginx_topology=PASS$' || {
  echo "Production deployment blocked: Nginx topology is not clean" >&2
  exit 1
}
DB_PATH=$(printf '%s\n' "$PREFLIGHT_OUTPUT" | sed -n 's/^db_resolution_path=//p' | tail -n 1)
NGINX_CONFIG_PATH=$(printf '%s\n' "$PREFLIGHT_OUTPUT" | sed -n 's/^effective_nginx_server_config=//p' | tail -n 1)
PHP_SOCKET=$(printf '%s\n' "$PREFLIGHT_OUTPUT" | sed -n 's/^effective_enrollment_fastcgi=fastcgi_pass unix:\([^;]*\);$/\1/p' | tail -n 1)
PHP_VERSION=$(basename "$PHP_SOCKET" | sed -n 's/^php\([0-9][0-9.]*\)-fpm\(-awh\)\{0,1\}\.sock$/\1/p')
BOOTSTRAP_HASH_FILE=${AWH_ENROLLMENT_BOOTSTRAP_HASH_FILE:-/etc/awh-hub/enrollment-bootstrap.sha256}
case "$DB_PATH" in
  /var/lib/awh-hub/*|/opt/awh-hub/*|/srv/awh/*) ;;
  *) echo "Production deployment blocked: resolved DB path is outside bounded AWH roots" >&2; exit 1 ;;
esac
case "$NGINX_CONFIG_PATH" in /etc/nginx/sites-enabled/*) ;; *) echo "Production deployment blocked: effective Nginx server config is unresolved" >&2; exit 1 ;; esac
case "$PHP_SOCKET" in /run/php/php*-fpm.sock|/run/php/php*-fpm-awh.sock) ;; *) echo "Production deployment blocked: effective PHP-FPM socket is unresolved" >&2; exit 1 ;; esac
case "$PHP_VERSION" in [0-9]*.[0-9]*) ;; *) echo "Production deployment blocked: PHP-FPM version is unresolved" >&2; exit 1 ;; esac
case "$BOOTSTRAP_HASH_FILE" in /etc/awh-hub/*) ;; *) echo "AWH_ENROLLMENT_BOOTSTRAP_HASH_FILE must stay under /etc/awh-hub" >&2; exit 2 ;; esac

command -v scp >/dev/null 2>&1 || { echo "scp is required" >&2; exit 1; }
command -v ssh >/dev/null 2>&1 || { echo "ssh is required" >&2; exit 1; }
scp -o BatchMode=yes -o StrictHostKeyChecking=yes "$BUNDLE" "$DEPLOY_TARGET:$REMOTE_STAGE"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$DEPLOY_TARGET" sh -s -- "$DB_PATH" "$REMOTE_ROOT" "$REMOTE_STAGE" "$REMOTE_RELEASE" "$RELEASE_ID" "$NGINX_CONFIG_PATH" "$PHP_VERSION" "$BOOTSTRAP_HASH_FILE" "$HUB_HOSTNAME" "$COMPAT_REFRESH" < "$REMOTE_DEPLOY_SCRIPT"
