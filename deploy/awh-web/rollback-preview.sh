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

DEPLOY_TARGET=${AWH_DEPLOY_TARGET:-awh-ready}
REMOTE_ROOT=/var/www/awh-web

case "$RELEASE_ID" in
  ''|*[!A-Za-z0-9._-]*) echo "Release ID contains unsupported characters" >&2; exit 2 ;;
esac
case "$DEPLOY_TARGET" in
  ''|*[!A-Za-z0-9._-]*) echo "AWH_DEPLOY_TARGET must be an SSH config alias" >&2; exit 2 ;;
esac

if [ "$MODE" = dry-run ]; then
  echo "DRY-RUN: target SSH alias=$DEPLOY_TARGET"
  echo "DRY-RUN: would verify $REMOTE_ROOT/releases/$RELEASE_ID, switch current, validate Nginx, and reload"
  exit 0
fi

ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$DEPLOY_TARGET" "sudo test -d $REMOTE_ROOT/releases/$RELEASE_ID && sudo ln -sfnT $REMOTE_ROOT/releases/$RELEASE_ID $REMOTE_ROOT/current && sudo nginx -t && sudo systemctl reload nginx"
echo "AWH web release rolled back: $RELEASE_ID"
