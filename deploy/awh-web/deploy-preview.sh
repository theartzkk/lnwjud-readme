#!/bin/sh

set -eu

MODE=dry-run
case "${1:-}" in
  ""|--dry-run) MODE=dry-run ;;
  --deploy) MODE=deploy ;;
  *) echo "Usage: $0 [--dry-run|--deploy]" >&2; exit 2 ;;
esac

LOCAL_DIR=${AWH_BUILD_DIR:-dist-web}
DEPLOY_HOST=${AWH_DEPLOY_HOST:-awh-hub-01}
DEPLOY_USER=${AWH_DEPLOY_USER:-DEPLOY_USER}
RELEASE_ID=${AWH_RELEASE_ID:-m3c1-$(date -u +%Y%m%dT%H%M%SZ)}
REMOTE_ROOT=/var/www/awh-web
REMOTE_STAGE="/tmp/awh-web-$RELEASE_ID"

test -d "$LOCAL_DIR" || { echo "Build directory is missing: $LOCAL_DIR" >&2; exit 1; }
sh ./deploy/awh-web/validate-release.sh "$LOCAL_DIR"

if [ "$MODE" = dry-run ]; then
  echo "DRY-RUN: would upload $LOCAL_DIR to $DEPLOY_USER@$DEPLOY_HOST:$REMOTE_STAGE"
  echo "DRY-RUN: would validate Nginx, switch $REMOTE_ROOT/current atomically, and reload the remote service"
  exit 0
fi

test "$DEPLOY_USER" != DEPLOY_USER || { echo "Set AWH_DEPLOY_USER explicitly before --deploy" >&2; exit 1; }
command -v scp >/dev/null 2>&1 || { echo "scp is required" >&2; exit 1; }
command -v ssh >/dev/null 2>&1 || { echo "ssh is required" >&2; exit 1; }
scp -o BatchMode=yes -o StrictHostKeyChecking=yes -r "$LOCAL_DIR" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_STAGE"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$DEPLOY_USER@$DEPLOY_HOST" "sudo install -d -m 0755 $REMOTE_ROOT/releases/$RELEASE_ID && sudo cp -a $REMOTE_STAGE/. $REMOTE_ROOT/releases/$RELEASE_ID/ && sudo test -f $REMOTE_ROOT/releases/$RELEASE_ID/release.json && sudo ln -sfnT $REMOTE_ROOT/releases/$RELEASE_ID $REMOTE_ROOT/current && sudo nginx -t && sudo systemctl reload nginx"
echo "AWH web release deployed: $RELEASE_ID"
