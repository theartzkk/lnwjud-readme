#!/bin/sh

set -eu

CONFIG=${1:-}
if [ -z "$CONFIG" ]; then
  echo "Usage: $0 /path/to/rendered/awh-preview.Caddyfile" >&2
  exit 2
fi
test -f "$CONFIG" || { echo "Caddy config is missing" >&2; exit 1; }
if grep -Eq 'PREVIEW_HOSTNAME|PREVIEW_USER|AWH_CADDY_PASSWORD_HASH' "$CONFIG"; then
  echo "Unrendered Caddy placeholders are not deployable" >&2
  exit 1
fi
if command -v caddy >/dev/null 2>&1; then
  caddy validate --config "$CONFIG" --adapter caddyfile
  echo "Caddy configuration validation: PASS"
else
  echo "Caddy executable unavailable; placeholder and file validation: PASS (runtime validation pending)"
fi
