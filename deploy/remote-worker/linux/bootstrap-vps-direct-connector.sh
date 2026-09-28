#!/bin/sh
set -eu

AGENT_USER=${AWH_RDC_USER:-awh-remote}
AGENT_HOME=${AWH_RDC_HOME:-/var/lib/awh-remote}
RUNTIME_ROOT=${AWH_RDC_RUNTIME_ROOT:-/opt/awh-tools/remote-desktop}
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MANIFEST=${AWH_DEVICE_RUNTIME_MANIFEST:-$HERE/../../../config/device-runtime-release.json}
command -v python3 >/dev/null 2>&1 || { printf '%s\n' AWH_VPS_DIRECT_PYTHON3_REQUIRED >&2; exit 1; }
[ -f "$MANIFEST" ] || { printf '%s\n' AWH_VPS_DIRECT_MANIFEST_MISSING >&2; exit 1; }
manifest_value(){ python3 - "$MANIFEST" "$1" <<'PYJSON'
import json,sys
value=json.load(open(sys.argv[1],encoding='utf-8'))
for part in sys.argv[2].split('.'): value=value[part]
print(value)
PYJSON
}
AGENT_VERSION=${AWH_RDC_VERSION:-$(manifest_value version)}
NODE_VERSION=$(manifest_value linuxConnector.nodeRuntime.version)
NODE_MINIMUM=$(manifest_value linuxConnector.nodeRuntime.minimumVersion)
NODE_ROOT=${AWH_RDC_NODE_ROOT:-$RUNTIME_ROOT/node-v${NODE_VERSION}-linux-x64}
NODE_BIN=$NODE_ROOT/bin/node
NPX_BIN=$NODE_ROOT/bin/npx

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

if [ "$(id -u)" -ne 0 ]; then
  fail "AWH_VPS_DIRECT_BOOTSTRAP_REQUIRES_ROOT"
fi

ensure_node() {
  if [ -x "$NODE_BIN" ] && "$NODE_BIN" -e 'const min=process.argv[1].split(".").map(Number),cur=process.versions.node.split(".").map(Number);for(let i=0;i<3;i++){if((cur[i]||0)>(min[i]||0))process.exit(0);if((cur[i]||0)<(min[i]||0))process.exit(1)}process.exit(0)' "$NODE_MINIMUM" 2>/dev/null; then
    return 0
  fi
  [ -x "$HERE/install-node-runtime.sh" ] || fail AWH_VPS_DIRECT_NODE_INSTALLER_MISSING
  AWH_NODE_RUNTIME_ROOT="$RUNTIME_ROOT" sh "$HERE/install-node-runtime.sh"
  [ -x "$NODE_BIN" ] && [ -x "$NPX_BIN" ] || fail AWH_VPS_DIRECT_NODE_RUNTIME_REQUIRED
}

ensure_node

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
  PATH="$NODE_ROOT/bin:/usr/bin:/bin" \
  "$NPX_BIN" --yes "@wonderwhy-er/desktop-commander@$AGENT_VERSION" remote
