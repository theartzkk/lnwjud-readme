#!/bin/sh

set -eu

MODE=dry-run
case "${1:-}" in
  ""|--dry-run) MODE=dry-run ;;
  --deploy) MODE=deploy ;;
  *) echo "Usage: $0 [--dry-run|--deploy]" >&2; exit 2 ;;
esac

LOCAL_DIR=${AWH_BUILD_DIR:-dist-web}
DEPLOY_TARGET=${AWH_DEPLOY_TARGET:-awh-vps}
RELEASE_ID=${AWH_RELEASE_ID:-m3c1-$(date -u +%Y%m%dT%H%M%SZ)}
REMOTE_ROOT=/var/www/awh-web
REMOTE_STAGE="/tmp/awh-web-$RELEASE_ID"

case "$RELEASE_ID" in
  ''|*[!A-Za-z0-9._-]*) echo "Release ID contains unsupported characters" >&2; exit 2 ;;
esac
case "$DEPLOY_TARGET" in
  ''|*[!A-Za-z0-9._-]*) echo "AWH_DEPLOY_TARGET must be an SSH config alias" >&2; exit 2 ;;
esac

test -d "$LOCAL_DIR" || { echo "Build directory is missing: $LOCAL_DIR" >&2; exit 1; }
sh ./deploy/awh-web/validate-release.sh "$LOCAL_DIR"

if [ "$MODE" = dry-run ]; then
  echo "DRY-RUN: target SSH alias=$DEPLOY_TARGET"
  echo "DRY-RUN: would upload $LOCAL_DIR to $DEPLOY_TARGET:$REMOTE_STAGE"
  echo "DRY-RUN: would validate Nginx, switch $REMOTE_ROOT/current atomically, and reload the remote service"
  exit 0
fi

command -v scp >/dev/null 2>&1 || { echo "scp is required" >&2; exit 1; }
command -v ssh >/dev/null 2>&1 || { echo "ssh is required" >&2; exit 1; }
scp -o BatchMode=yes -o StrictHostKeyChecking=yes -r "$LOCAL_DIR" "$DEPLOY_TARGET:$REMOTE_STAGE"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$DEPLOY_TARGET" "sudo install -d -m 0755 $REMOTE_ROOT/releases/$RELEASE_ID && sudo cp -a $REMOTE_STAGE/. $REMOTE_ROOT/releases/$RELEASE_ID/ && sudo test -f $REMOTE_ROOT/releases/$RELEASE_ID/release.json && sudo ln -sfnT $REMOTE_ROOT/releases/$RELEASE_ID $REMOTE_ROOT/current && sudo nginx -t && sudo systemctl reload nginx"
echo "AWH web release deployed: $RELEASE_ID"
