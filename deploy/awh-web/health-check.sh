#!/bin/sh

set -eu

MODE=dry-run
case "${1:-}" in
  ""|--dry-run) MODE=dry-run ;;
  --check) MODE=check ;;
  *) echo "Usage: $0 [--dry-run|--check]" >&2; exit 2 ;;
esac

URL=${AWH_HEALTH_URL:-https://PREVIEW_HOSTNAME/api/v1/health}
case "$URL" in
  https://*) : ;;
  *) echo "Health check requires HTTPS" >&2; exit 1 ;;
esac

if [ "$MODE" = dry-run ]; then
  echo "DRY-RUN: would GET $URL without credentials and require a 2xx response"
  exit 0
fi

command -v curl >/dev/null 2>&1 || { echo "curl is required for an explicit health check" >&2; exit 1; }
curl --fail --silent --show-error --max-time 10 --proto '=https' --tlsv1.2 "$URL" >/dev/null
echo "AWH HTTPS health check: PASS"
