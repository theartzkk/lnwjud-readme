#!/bin/sh

# AWH M4 activation orchestrator. Dry-run is the default. Real mutation is
# reachable only with --deploy --approve, a clean exact release lock, and the
# existing read-only production preflight.
set -eu
LC_ALL=C
export LC_ALL

MODE=dry-run
APPROVED=0
CLEANUP_TOPOLOGY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE=dry-run ;;
    --deploy) MODE=deploy ;;
    --approve) APPROVED=1 ;;
    --cleanup-topology) CLEANUP_TOPOLOGY=1 ;;
    *) echo "Usage: $0 [--dry-run] | --deploy --approve [--cleanup-topology]" >&2; exit 2 ;;
  esac
done
if test "$MODE" = dry-run && test "$APPROVED" -eq 1; then echo "--approve requires --deploy" >&2; exit 2; fi

ROOT=${AWH_SOURCE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}
TARGET=${AWH_DEPLOY_TARGET:-awh-ready}
RELEASE=${AWH_RELEASE_COMMIT:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)}
HOSTNAME=${AWH_HUB_HOSTNAME:-157-85-108-142.sslip.io}
REMOTE_ROOT=/opt/awh-hub
RELEASE_ID=m4-$(printf '%s' "$RELEASE" | cut -c1-12)
REMOTE_STAGE=/tmp/awh-control-plane-$RELEASE_ID.tar.gz
PREFLIGHT=$ROOT/deploy/awh-enrollment/preflight-production.sh
REMOTE_DEPLOY=$ROOT/deploy/awh-control-plane/remote-deploy-control-plane.sh
BUNDLE=$(mktemp "${TMPDIR:-/tmp}/awh-control-plane.XXXXXX.tar.gz")
cleanup() { rm -f "$BUNDLE"; }
trap cleanup EXIT HUP INT TERM

case "$TARGET" in ''|*[!A-Za-z0-9._-]*) echo "AWH_DEPLOY_TARGET is invalid" >&2; exit 2 ;; esac
case "$RELEASE" in ''|*[!0-9a-fA-F]*) echo "AWH_RELEASE_COMMIT is invalid" >&2; exit 2 ;; esac
case "$HOSTNAME" in ''|*[!A-Za-z0-9.-]*|.*|*.) echo "AWH_HUB_HOSTNAME is invalid" >&2; exit 2 ;; esac
case "$HOSTNAME" in *[A-Za-z]*.*) : ;; *) echo "AWH_HUB_HOSTNAME is invalid" >&2; exit 2 ;; esac

FILES="hub/public/control-plane.php hub/src/HubEnrollmentService.php hub/src/HubControlPlaneService.php hub/src/HubControlPlaneRouter.php hub/src/HubControlPlaneMigration.php hub/src/HubControlPlaneProjectRegistration.php hub/migrations/003_m4_control_plane.sql hub/bin/migrate-m4.php hub/bin/register-m4-projects.php deploy/nginx/awh-control-plane.conf deploy/awh-enrollment/insert-nginx-include.php deploy/awh-control-plane/remote-deploy-control-plane.sh dist-web/index.html dist-web/styles.css dist-web/app.js dist-web/hub-read-adapter.js dist-web/control-plane-adapter.js dist-web/manifest.webmanifest dist-web/sw.js dist-web/logo-256x256.png dist-web/web-config.json dist-web/data.json dist-web/release.json"
for file in $FILES; do test -f "$ROOT/$file" || { echo "Missing reviewed M4 asset: $file" >&2; exit 1; }; done
test -f "$PREFLIGHT" || { echo "Missing read-only production preflight" >&2; exit 1; }
test -f "$ROOT/dist-web/web-config.json" || { echo "Missing CONTROL web release" >&2; exit 1; }
grep -q '"mode": "CONTROL"' "$ROOT/dist-web/web-config.json" || { echo "CONTROL web release is required" >&2; exit 1; }

if test "$MODE" = dry-run; then
  echo "M4_DRY_RUN=PASS"
  echo "M4_TARGET=$TARGET"
  echo "M4_RELEASE=$RELEASE"
  echo "M4_PLAN=preflight,backup,stage,migrate-003,idempotence,project-onboarding-ready,control-pointer,nginx-test,reload,read-regression"
  test "$CLEANUP_TOPOLOGY" -eq 1 && echo "M4_TOPOLOGY_CLEANUP=approval-gated-archive-and-verify" || echo "M4_TOPOLOGY_CLEANUP=not-requested"
  echo "M4_ROLLBACK=restore-db,pointer,nginx,service-health,m3d-regression"
  echo "M4_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL"
  exit 0
fi

test "$APPROVED" -eq 1 || { echo "M4 deployment requires explicit --approve" >&2; exit 3; }
test -z "$(git -C "$ROOT" status --porcelain --untracked-files=all)" || { echo "M4 deployment requires a clean committed tree" >&2; exit 1; }
test "$(git -C "$ROOT" rev-parse HEAD)" = "$RELEASE" || { echo "M4 release lock does not match local HEAD" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "tar is required" >&2; exit 1; }
command -v scp >/dev/null 2>&1 || { echo "scp is required" >&2; exit 1; }
command -v ssh >/dev/null 2>&1 || { echo "ssh is required" >&2; exit 1; }

PREFLIGHT_OUTPUT=$(AWH_DEPLOY_TARGET="$TARGET" AWH_HUB_HOSTNAME="$HOSTNAME" sh "$PREFLIGHT") || { echo "M4 preflight failed" >&2; exit 1; }
printf '%s\n' "$PREFLIGHT_OUTPUT" | grep -q '^db_classification=DB_AUTHORITY_RESOLVED$' || { echo "M4 preflight did not resolve the Hub database" >&2; exit 1; }
printf '%s\n' "$PREFLIGHT_OUTPUT" | grep -Eq '^backup_classification=(BACKUP_READY|BACKUP_PROVISION_REQUIRED)$' || { echo "M4 backup is not provisionable" >&2; exit 1; }
NGINX_TOPOLOGY=$(printf '%s\n' "$PREFLIGHT_OUTPUT" | sed -n 's/^nginx_topology=//p' | tail -n 1)
case "$NGINX_TOPOLOGY:$CLEANUP_TOPOLOGY" in
  PASS:0|PASS:1|BLOCKED_HISTORICAL_BACKUP_RESIDUE:1) ;;
  BLOCKED_HISTORICAL_BACKUP_RESIDUE:0) echo "M4 Nginx topology cleanup requires --cleanup-topology" >&2; exit 1 ;;
  *) echo "M4 Nginx topology is unsafe: $NGINX_TOPOLOGY" >&2; exit 1 ;;
esac
DB_PATH=$(printf '%s\n' "$PREFLIGHT_OUTPUT" | sed -n 's/^db_resolution_path=//p' | tail -n 1)
NGINX_CONFIG=$(printf '%s\n' "$PREFLIGHT_OUTPUT" | sed -n 's/^effective_nginx_server_config=//p' | tail -n 1)
PHP_SOCKET=$(printf '%s\n' "$PREFLIGHT_OUTPUT" | sed -n 's/^effective_fastcgi=fastcgi_pass unix:\([^;]*\);$/\1/p' | tail -n 1)
PHP_VERSION=$(basename "$PHP_SOCKET" | sed -n 's/^php\([0-9][0-9.]*\)-fpm\.sock$/\1/p')
case "$DB_PATH" in /var/lib/awh-hub/*|/opt/awh-hub/*|/srv/awh/*) ;; *) echo "M4 DB path is outside the bounded Hub roots" >&2; exit 1 ;; esac
case "$NGINX_CONFIG" in /etc/nginx/sites-enabled/*) ;; *) echo "M4 Nginx authority is unresolved" >&2; exit 1 ;; esac
case "$PHP_VERSION" in [0-9]*.[0-9]*) ;; *) echo "M4 PHP-FPM authority is unresolved" >&2; exit 1 ;; esac

tar -czf "$BUNDLE" -C "$ROOT" $FILES
scp -o BatchMode=yes -o StrictHostKeyChecking=yes "$BUNDLE" "$TARGET:$REMOTE_STAGE"
set +e
REMOTE_OUTPUT=$(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" sh -s -- "$DB_PATH" "$REMOTE_ROOT" "$REMOTE_STAGE" "/opt/awh-hub/control-releases/$RELEASE_ID" "$RELEASE_ID" "$NGINX_CONFIG" "$PHP_VERSION" "$HOSTNAME" "$CLEANUP_TOPOLOGY" < "$REMOTE_DEPLOY")
REMOTE_STATUS=$?
set -e
if test "${#REMOTE_OUTPUT}" -gt 16384; then echo "M4 remote deployment output exceeded the bound" >&2; exit 1; fi
printf '%s\n' "$REMOTE_OUTPUT" | while IFS= read -r line; do
  case "$line" in
    DEPLOY_STAGE=PREMUTATION_READY|DEPLOY_STAGE=TOPOLOGY_CLEANUP_ARCHIVE|DEPLOY_STAGE=TOPOLOGY_CLEANUP_VERIFY|DEPLOY_STAGE=BACKUP_VERIFIED|DEPLOY_STAGE=RELEASE_STAGED|DEPLOY_STAGE=MIGRATION_FIRST_PASS|DEPLOY_STAGE=MIGRATION_IDEMPOTENT|DEPLOY_STAGE=MIGRATION_VERIFIED|DEPLOY_STAGE=PROJECTS_READY|DEPLOY_STAGE=CONTROL_POINTER|DEPLOY_STAGE=WEB_RELEASE_COPY|DEPLOY_STAGE=WEB_POINTER_SWITCH|DEPLOY_STAGE=WEB_RELEASE_STAGED|DEPLOY_STAGE=NGINX_INCLUDE_PREPARE|DEPLOY_STAGE=NGINX_INCLUDE_INSERT|DEPLOY_STAGE=NGINX_CONFIGURED|DEPLOY_STAGE=SERVICE_RELOAD|DEPLOY_STAGE=M3D_REGRESSION|DEPLOY_STAGE=CONTROL_ROUTE) printf '%s\n' "$line" ;;
    DEPLOY_FAILED_AT=PREMUTATION_READY|DEPLOY_FAILED_AT=TOPOLOGY_CLEANUP_ARCHIVE|DEPLOY_FAILED_AT=TOPOLOGY_CLEANUP_VERIFY|DEPLOY_FAILED_AT=BACKUP_VERIFIED|DEPLOY_FAILED_AT=RELEASE_STAGED|DEPLOY_FAILED_AT=MIGRATION_FIRST_PASS|DEPLOY_FAILED_AT=MIGRATION_IDEMPOTENT|DEPLOY_FAILED_AT=MIGRATION_VERIFIED|DEPLOY_FAILED_AT=PROJECTS_READY|DEPLOY_FAILED_AT=CONTROL_POINTER|DEPLOY_FAILED_AT=WEB_RELEASE_COPY|DEPLOY_FAILED_AT=WEB_POINTER_SWITCH|DEPLOY_FAILED_AT=WEB_RELEASE_STAGED|DEPLOY_FAILED_AT=NGINX_INCLUDE_PREPARE|DEPLOY_FAILED_AT=NGINX_INCLUDE_INSERT|DEPLOY_FAILED_AT=NGINX_CONFIGURED|DEPLOY_FAILED_AT=SERVICE_RELOAD|DEPLOY_FAILED_AT=M3D_REGRESSION|DEPLOY_FAILED_AT=CONTROL_ROUTE|DEPLOY_FAILED_AT=REMOTE_TRANSPORT|DEPLOY_FAILED_AT=REMOTE_RESULT_MISSING) printf '%s\n' "$line" ;;
    DEPLOY_RESULT=PASS|ROLLBACK=PASS|ROLLBACK=FAIL) printf '%s\n' "$line" ;;
    '') : ;;
    *) echo "M4 remote output contract rejected" >&2; exit 1 ;;
  esac
done
if test "$REMOTE_STATUS" -ne 0; then test -n "$REMOTE_OUTPUT" || echo 'DEPLOY_FAILED_AT=REMOTE_TRANSPORT'; exit "$REMOTE_STATUS"; fi
printf '%s\n' "$REMOTE_OUTPUT" | grep -q '^DEPLOY_RESULT=PASS$' || { echo 'DEPLOY_FAILED_AT=REMOTE_RESULT_MISSING' >&2; exit 1; }
