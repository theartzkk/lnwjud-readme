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
TARGET=${AWH_DEPLOY_TARGET:-awh-ready}
RELEASE=${AWH_RELEASE_COMMIT:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)}
HOSTNAME=${AWH_HUB_HOSTNAME:-}

case "$TARGET" in ''|*[!A-Za-z0-9._-]*) echo "AWH_DEPLOY_TARGET is invalid" >&2; exit 2 ;; esac
case "$RELEASE" in ''|*[!A-Za-z0-9a-f]*) echo "AWH_RELEASE_COMMIT is invalid" >&2; exit 2 ;; esac
case "$HOSTNAME" in ''|*[!A-Za-z0-9.-]*|.*|*.) echo "AWH_HUB_HOSTNAME is invalid" >&2; exit 2 ;; esac

FILES="hub/public/control-plane.php hub/src/HubEnrollmentService.php hub/src/HubControlPlaneService.php hub/src/HubControlPlaneRouter.php hub/src/HubControlPlaneProjectRegistration.php hub/migrations/003_m4_control_plane.sql hub/bin/migrate-m4.php hub/bin/register-m4-projects.php deploy/nginx/awh-control-plane.conf dist-web/index.html dist-web/styles.css dist-web/app.js dist-web/hub-read-adapter.js dist-web/control-plane-adapter.js dist-web/web-config.json dist-web/data.json"
for file in $FILES; do test -f "$ROOT/$file" || { echo "Missing M4 asset: $file" >&2; exit 1; }; done
grep -F '"mode": "CONTROL"' "$ROOT/dist-web/web-config.json" >/dev/null || { echo "M4 web release must be built in CONTROL mode" >&2; exit 1; }

if [ "$MODE" = dry-run ]; then
  echo "M4_DRY_RUN=PASS"
  echo "M4_TARGET=$TARGET"
  echo "M4_RELEASE=$RELEASE"
  echo "M4_PLAN=backup,verify,migrate-003,verify-idempotence,register-portable-project-metadata,stage-control-plane,install-https-location,nginx-test,reload,read-regression"
  echo "M4_ROLLBACK=restore-db-and-ledger,remove-control-plane-pointer,restore-nginx,nginx-test,reload,read-regression"
  echo "M4_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL"
  exit 0
fi

test -z "$(git -C "$ROOT" status --porcelain --untracked-files=all)" || { echo "M4 deployment requires a clean committed tree" >&2; exit 1; }
test "$(git -C "$ROOT" rev-parse HEAD)" = "$RELEASE" || { echo "M4 release lock does not match HEAD" >&2; exit 1; }
case "$HOSTNAME" in *[A-Za-z]*.*) : ;; *) echo "AWH_HUB_HOSTNAME is invalid" >&2; exit 2 ;; esac
echo "M4_DEPLOYMENT_APPROVAL_REQUIRED: this guarded path is prepared but must be reviewed before --deploy" >&2
exit 3
