#!/bin/sh
set -eu

AGENT_VERSION=${AWH_RDC_VERSION:-0.2.50}
AGENT_USER=${AWH_RDC_USER:-awh-remote}
AGENT_HOME=${AWH_RDC_HOME:-/var/lib/awh-remote}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

if [ "$(id -u)" -ne 0 ]; then
  fail "AWH_VPS_DIRECT_BOOTSTRAP_REQUIRES_ROOT"
fi

node_major() {
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || true
}

ensure_node() {
  major="$(node_major)"
  if command -v npx >/dev/null 2>&1 && [ -n "$major" ] && [ "$major" -ge 18 ] 2>/dev/null; then
    return 0
  fi

  command -v apt-get >/dev/null 2>&1 || fail "AWH_VPS_DIRECT_NODE18_REQUIRED"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends nodejs npm ca-certificates

  major="$(node_major)"
  command -v npx >/dev/null 2>&1 || fail "AWH_VPS_DIRECT_NPX_REQUIRED"
  [ -n "$major" ] && [ "$major" -ge 18 ] 2>/dev/null || fail "AWH_VPS_DIRECT_NODE18_REQUIRED"
}

case "$AGENT_VERSION" in
  *[!0-9.]*|'') fail "AWH_VPS_DIRECT_AGENT_VERSION_INVALID" ;;
esac
case "$AGENT_USER" in
  [a-z_][a-z0-9_-]*) : ;;
  *) fail "AWH_VPS_DIRECT_AGENT_USER_INVALID" ;;
esac
case "$AGENT_HOME" in
  /var/lib/awh-remote|/srv/awh-remote) : ;;
  *) fail "AWH_VPS_DIRECT_AGENT_HOME_INVALID" ;;
esac

ensure_node

if ! id "$AGENT_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$AGENT_HOME" --shell /bin/bash "$AGENT_USER"
fi

install -d -m 0700 -o "$AGENT_USER" -g "$AGENT_USER" "$AGENT_HOME"
install -d -m 0700 -o "$AGENT_USER" -g "$AGENT_USER" "$AGENT_HOME/.npm"

printf '%s\n' "AWH_VPS_DIRECT_BOOTSTRAP=READY"
printf '%s\n' "AWH_VPS_DIRECT_AGENT_USER=$AGENT_USER"
printf '%s\n' "AWH_VPS_DIRECT_AGENT_VERSION=$AGENT_VERSION"
printf '%s\n' "AWH_VPS_DIRECT_SECURITY=UNPRIVILEGED_NO_SUDO"
printf '%s\n' "AWH_VPS_DIRECT_NEXT=VERIFY_DEVICE_CODE"

exec runuser -u "$AGENT_USER" -- env \
  HOME="$AGENT_HOME" \
  NPM_CONFIG_CACHE="$AGENT_HOME/.npm" \
  npx --yes "@wonderwhy-er/desktop-commander@$AGENT_VERSION" remote
