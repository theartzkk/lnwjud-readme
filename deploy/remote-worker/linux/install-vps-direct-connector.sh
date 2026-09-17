#!/bin/sh
set -eu
MODE=${1:---prepare}
AGENT_VERSION=${AWH_RDC_VERSION:-0.2.50}
AGENT_USER=${AWH_RDC_USER:-awh-remote}
AGENT_HOME=${AWH_RDC_HOME:-/var/lib/awh-remote}
RUNTIME_ROOT=${AWH_RDC_RUNTIME_ROOT:-/opt/awh-tools/remote-desktop}
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
UNIT=/etc/systemd/system/desktop-commander-vps.service
SESSION=$AGENT_HOME/.desktop-commander-device/device.json
CONFIG=$AGENT_HOME/.claude-server-commander/config.json
fail(){ printf '%s\n' "$1" >&2; exit 1; }
case "$MODE" in --prepare|--activate) :;; *) fail 'usage: install-vps-direct-connector.sh [--prepare|--activate]' ;; esac
[ "$(id -u)" -eq 0 ] || fail AWH_VPS_DIRECT_INSTALL_REQUIRES_ROOT
[ "$AGENT_VERSION" = 0.2.50 ] || fail AWH_VPS_DIRECT_AGENT_VERSION_UNSUPPORTED
[ "$AGENT_USER" = awh-remote ] || fail AWH_VPS_DIRECT_AGENT_USER_UNSUPPORTED
[ "$AGENT_HOME" = /var/lib/awh-remote ] || fail AWH_VPS_DIRECT_AGENT_HOME_UNSUPPORTED
/usr/bin/node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' || fail AWH_VPS_DIRECT_NODE18_REQUIRED
command -v npm >/dev/null 2>&1 || fail AWH_VPS_DIRECT_NPM_REQUIRED
id "$AGENT_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$AGENT_HOME" --shell /bin/bash "$AGENT_USER"
case " $(id -nG "$AGENT_USER") " in *' sudo '*|*' adm '*) fail AWH_VPS_DIRECT_PRIVILEGED_GROUP_FORBIDDEN;; esac
install -d -m 0700 -o "$AGENT_USER" -g "$AGENT_USER" "$AGENT_HOME" "$AGENT_HOME/.npm" "$AGENT_HOME/.desktop-commander-device" "$AGENT_HOME/.claude-server-commander"
install -d -m 0755 -o root -g root "$RUNTIME_ROOT" "$RUNTIME_ROOT/agent"
printf '%s\n' '{"name":"awh-vps-direct-connector","private":true,"version":"1.0.0","dependencies":{"@wonderwhy-er/desktop-commander":"0.2.50"}}' > "$RUNTIME_ROOT/agent/package.json"
(cd "$RUNTIME_ROOT/agent" && npm install --ignore-scripts --omit=dev --no-audit --no-fund --save-exact "@wonderwhy-er/desktop-commander@$AGENT_VERSION" >/dev/null)
chown -R root:root "$RUNTIME_ROOT/agent"; chmod -R go-w "$RUNTIME_ROOT/agent"
cat > "$CONFIG.tmp" <<'JSON'
{
  "allowedDirectories": ["/srv/awh-git", "/tmp"],
  "blockedCommands": ["mkfs","format","mount","umount","fdisk","dd","parted","diskpart","sudo","su","passwd","adduser","useradd","usermod","groupadd","chsh","visudo","shutdown","reboot","halt","poweroff","init","iptables","firewall","netsh","sfc","bcdedit","reg","net","sc","runas","cipher","takeown"],
  "fileReadLineLimit": 300,
  "fileWriteLineLimit": 50,
  "telemetryEnabled": true
}
JSON
chown "$AGENT_USER:$AGENT_USER" "$CONFIG.tmp"; chmod 0600 "$CONFIG.tmp"; mv "$CONFIG.tmp" "$CONFIG"
if [ -n "${AWH_RDC_SESSION_SOURCE:-}" ]; then
  case "$AWH_RDC_SESSION_SOURCE" in /*) :;; *) fail AWH_VPS_DIRECT_SESSION_SOURCE_INVALID;; esac
  [ -f "$AWH_RDC_SESSION_SOURCE" ] || fail AWH_VPS_DIRECT_SESSION_SOURCE_MISSING
  install -m 0600 -o "$AGENT_USER" -g "$AGENT_USER" "$AWH_RDC_SESSION_SOURCE" "$SESSION"
fi
if [ -f "$SESSION" ]; then
  /usr/bin/node -e 'const j=require(process.argv[1]); if(!j.deviceId||!j.session) process.exit(1)' "$SESSION" || fail AWH_VPS_DIRECT_SESSION_INVALID
  chown "$AGENT_USER:$AGENT_USER" "$SESSION"; chmod 0600 "$SESSION"
fi
if ! command -v setfacl >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update >/dev/null
  apt-get install -y --no-install-recommends acl >/dev/null
fi
[ -d /srv/awh-git ] || fail AWH_VPS_DIRECT_SOURCE_ROOT_MISSING
setfacl -R -m "u:$AGENT_USER:rX" /srv/awh-git
find /srv/awh-git -type d -exec setfacl -m "d:u:$AGENT_USER:r-x" {} +
sed -e "s|__AGENT_USER__|$AGENT_USER|g" -e "s|__AGENT_HOME__|$AGENT_HOME|g" -e "s|__RUNTIME_ROOT__|$RUNTIME_ROOT|g" "$HERE/desktop-commander-vps.service.template" > "$UNIT.tmp"
install -o root -g root -m 0644 "$UNIT.tmp" "$UNIT"; rm -f "$UNIT.tmp"
systemctl daemon-reload
if [ "$MODE" = --activate ]; then
  [ -f "$SESSION" ] || fail AWH_VPS_DIRECT_PAIRING_REQUIRED
  systemctl enable desktop-commander-vps.service >/dev/null
  systemctl restart desktop-commander-vps.service
  systemctl is-active --quiet desktop-commander-vps.service || fail AWH_VPS_DIRECT_SERVICE_NOT_ACTIVE
fi
printf '%s\n' "AWH_VPS_DIRECT_INSTALL=PASS mode=$MODE version=$AGENT_VERSION user=$AGENT_USER"
