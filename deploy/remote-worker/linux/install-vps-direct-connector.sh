#!/bin/sh
set -eu
MODE=${1:---prepare}
REUSE_ONLY=${AWH_VPS_DIRECT_REUSE_ONLY:-0}
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
NPM_BIN=$NODE_ROOT/bin/npm
NODE_INSTALLER=$HERE/install-node-runtime.sh
UNIT=/etc/systemd/system/desktop-commander-vps.service
SESSION=$AGENT_HOME/.desktop-commander-device/device.json
CONFIG=$AGENT_HOME/.claude-server-commander/config.json
CANDIDATE_ROOT=$AGENT_HOME/worktrees
CONNECTOR_TMP=$AGENT_HOME/tmp
fail(){ printf '%s\n' "$1" >&2; exit 1; }
case "$MODE" in --prepare|--activate) :;; *) fail 'usage: install-vps-direct-connector.sh [--prepare|--activate]' ;; esac
case "$REUSE_ONLY" in 0|1) :;; *) fail AWH_VPS_DIRECT_REUSE_POLICY_INVALID;; esac
[ "$(id -u)" -eq 0 ] || fail AWH_VPS_DIRECT_INSTALL_REQUIRES_ROOT
[ "$AGENT_USER" = awh-remote ] || fail AWH_VPS_DIRECT_AGENT_USER_UNSUPPORTED
[ "$AGENT_HOME" = /var/lib/awh-remote ] || fail AWH_VPS_DIRECT_AGENT_HOME_UNSUPPORTED
if ! { [ -x "$NODE_BIN" ] && [ -x "$NPM_BIN" ] && "$NODE_BIN" -e 'const min=process.argv[1].split(".").map(Number),cur=process.versions.node.split(".").map(Number);for(let i=0;i<3;i++){if((cur[i]||0)>(min[i]||0))process.exit(0);if((cur[i]||0)<(min[i]||0))process.exit(1)}process.exit(0)' "$NODE_MINIMUM" 2>/dev/null; }; then
  [ -x "$NODE_INSTALLER" ] || fail AWH_VPS_DIRECT_NODE_INSTALLER_MISSING
  AWH_NODE_RUNTIME_ROOT="$RUNTIME_ROOT" sh "$NODE_INSTALLER"
fi
[ -x "$NODE_BIN" ] && [ -x "$NPM_BIN" ] || fail AWH_VPS_DIRECT_NODE_RUNTIME_REQUIRED
id "$AGENT_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$AGENT_HOME" --shell /bin/bash "$AGENT_USER"
case " $(id -nG "$AGENT_USER") " in *' sudo '*|*' adm '*) fail AWH_VPS_DIRECT_PRIVILEGED_GROUP_FORBIDDEN;; esac
install -d -m 0700 -o "$AGENT_USER" -g "$AGENT_USER" "$AGENT_HOME" "$AGENT_HOME/.npm" "$CANDIDATE_ROOT" "$AGENT_HOME/.desktop-commander-device" "$AGENT_HOME/.claude-server-commander"
install -d -m 2770 -o "$AGENT_USER" -g awh-operator "$CONNECTOR_TMP"
install -d -m 0755 -o root -g root "$RUNTIME_ROOT" "$RUNTIME_ROOT/agent"
INSTALLED_AGENT_VERSION=$("$NODE_BIN" -e 'try{process.stdout.write(require(process.argv[1]).version)}catch{process.exit(1)}' "$RUNTIME_ROOT/agent/node_modules/@wonderwhy-er/desktop-commander/package.json" 2>/dev/null || true)
if [ "$INSTALLED_AGENT_VERSION" = "$AGENT_VERSION" ]; then
  printf '%s\n' "AWH_VPS_DIRECT_PACKAGE=REUSED version=$AGENT_VERSION"
else
  [ "$REUSE_ONLY" -eq 0 ] || fail AWH_VPS_DIRECT_PACKAGE_REUSE_REQUIRED
  printf '{"name":"awh-vps-direct-connector","private":true,"version":"1.0.0","dependencies":{"%s":"%s"}}\n' "$(manifest_value package)" "$AGENT_VERSION" > "$RUNTIME_ROOT/agent/package.json"
  (cd "$RUNTIME_ROOT/agent" && PATH="$NODE_ROOT/bin:$PATH" "$NPM_BIN" install --ignore-scripts --omit=dev --no-audit --no-fund --save-exact "@wonderwhy-er/desktop-commander@$AGENT_VERSION" >/dev/null)
  printf '%s\n' "AWH_VPS_DIRECT_PACKAGE=INSTALLED version=$AGENT_VERSION"
fi
chown -R root:root "$RUNTIME_ROOT/agent"; chmod -R go-w "$RUNTIME_ROOT/agent"
# Production activation must not race Desktop Commander's config watcher. Stop the
# old process before the atomic config cutover; the outer deploy transaction owns
# rollback/restart if anything below fails.
if [ "$MODE" = --activate ] && systemctl is-active --quiet desktop-commander-vps.service; then
  systemctl stop desktop-commander-vps.service
fi
rm -f "$CONFIG.tmp"
python3 - "$CONFIG" "$CONFIG.tmp" <<'PYCONFIG'
import json, os, sys
path, tmp = sys.argv[1], sys.argv[2]
config = {}
if os.path.exists(path):
    with open(path, encoding='utf-8') as handle:
        loaded = json.load(handle)
    if not isinstance(loaded, dict):
        raise SystemExit('AWH_VPS_DIRECT_CONFIG_INVALID')
    config.update(loaded)
config.update({
    'allowedDirectories': ['/srv/awh-git', '/var/lib/awh-remote/worktrees', '/tmp'],
    'blockedCommands': ['mkfs','format','mount','umount','fdisk','dd','parted','diskpart','sudo','su','passwd','adduser','useradd','usermod','groupadd','chsh','visudo','shutdown','reboot','halt','poweroff','init','iptables','firewall','netsh','sfc','bcdedit','reg','net','sc','runas','cipher','takeown'],
    'fileReadLineLimit': 300,
    'fileWriteLineLimit': 50,
    'telemetryEnabled': True,
})
with open(tmp, 'w', encoding='utf-8') as handle:
    json.dump(config, handle, ensure_ascii=False, indent=2)
    handle.write('\n')
PYCONFIG
chown "$AGENT_USER:$AGENT_USER" "$CONFIG.tmp"; chmod 0600 "$CONFIG.tmp"; mv "$CONFIG.tmp" "$CONFIG"
if [ -n "${AWH_RDC_SESSION_SOURCE:-}" ]; then
  case "$AWH_RDC_SESSION_SOURCE" in /*) :;; *) fail AWH_VPS_DIRECT_SESSION_SOURCE_INVALID;; esac
  [ -f "$AWH_RDC_SESSION_SOURCE" ] || fail AWH_VPS_DIRECT_SESSION_SOURCE_MISSING
  install -m 0600 -o "$AGENT_USER" -g "$AGENT_USER" "$AWH_RDC_SESSION_SOURCE" "$SESSION"
fi
if [ -f "$SESSION" ]; then
  "$NODE_BIN" -e 'const j=require(process.argv[1]); if(!j.deviceId||!j.session) process.exit(1)' "$SESSION" || fail AWH_VPS_DIRECT_SESSION_INVALID
  chown "$AGENT_USER:$AGENT_USER" "$SESSION"; chmod 0600 "$SESSION"
fi
if ! command -v setfacl >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update >/dev/null
  apt-get install -y --no-install-recommends acl >/dev/null
fi
[ -d /srv/awh-git ] || fail AWH_VPS_DIRECT_SOURCE_ROOT_MISSING
[ "$(stat -c '%U:%G:%a' "$CANDIDATE_ROOT")" = "$AGENT_USER:$AGENT_USER:700" ] || fail AWH_VPS_DIRECT_CANDIDATE_ROOT_PERMISSIONS_INVALID
setfacl -R -m "u:$AGENT_USER:rX" /srv/awh-git
find /srv/awh-git -type d -exec setfacl -m "d:u:$AGENT_USER:r-x" {} +
sed -e "s|__AGENT_USER__|$AGENT_USER|g" -e "s|__AGENT_HOME__|$AGENT_HOME|g" -e "s|__RUNTIME_ROOT__|$RUNTIME_ROOT|g" -e "s|__NODE_ROOT__|$NODE_ROOT|g" "$HERE/desktop-commander-vps.service.template" > "$UNIT.tmp"
install -o root -g root -m 0644 "$UNIT.tmp" "$UNIT"; rm -f "$UNIT.tmp"
systemctl daemon-reload
if [ "$MODE" = --activate ]; then
  [ -f "$SESSION" ] || fail AWH_VPS_DIRECT_PAIRING_REQUIRED
  systemctl enable desktop-commander-vps.service >/dev/null
  systemctl restart desktop-commander-vps.service
  CONNECTOR_SERVICE_READY=0
  CONNECTOR_SERVICE_ATTEMPTS=0
  while test "$CONNECTOR_SERVICE_ATTEMPTS" -lt 30; do
    CONNECTOR_SERVICE_ATTEMPTS=$((CONNECTOR_SERVICE_ATTEMPTS + 1))
    if systemctl is-active --quiet desktop-commander-vps.service; then
      CONNECTOR_SERVICE_READY=1
      break
    fi
    sleep 1
  done
  [ "$CONNECTOR_SERVICE_READY" -eq 1 ] || fail AWH_VPS_DIRECT_SERVICE_NOT_ACTIVE
fi
printf '%s\n' "AWH_VPS_DIRECT_INSTALL=PASS mode=$MODE version=$AGENT_VERSION user=$AGENT_USER"
