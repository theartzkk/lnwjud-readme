#!/bin/sh

set -eu

MODE=dry-run
RELEASE_ID=
if [ "${1:-}" = --release ] && [ -n "${2:-}" ]; then RELEASE_ID=$2; shift 2; fi
case "${1:-}" in
  ""|--dry-run) MODE=dry-run ;;
  --deploy) MODE=deploy ;;
  *) echo "Usage: $0 --release RELEASE_ID [--dry-run|--deploy]" >&2; exit 2 ;;
esac
test -n "$RELEASE_ID" || { echo "A release ID is required" >&2; exit 2; }

DEPLOY_HOST=${AWH_DEPLOY_HOST:-awh-hub-01}
DEPLOY_USER=${AWH_DEPLOY_USER:-DEPLOY_USER}
REMOTE_ROOT=/var/www/awh-web

if [ "$MODE" = dry-run ]; then
  echo "DRY-RUN: would verify $REMOTE_ROOT/releases/$RELEASE_ID, switch current, validate Nginx, and reload"
  exit 0
fi

test "$DEPLOY_USER" != DEPLOY_USER || { echo "Set AWH_DEPLOY_USER explicitly before --deploy" >&2; exit 1; }
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$DEPLOY_USER@$DEPLOY_HOST" "sudo test -d $REMOTE_ROOT/releases/$RELEASE_ID && sudo ln -sfnT $REMOTE_ROOT/releases/$RELEASE_ID $REMOTE_ROOT/current && sudo nginx -t && sudo systemctl reload nginx"
echo "AWH web release rolled back: $RELEASE_ID"
