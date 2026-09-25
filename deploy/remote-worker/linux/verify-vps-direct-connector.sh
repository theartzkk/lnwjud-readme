#!/bin/sh
set -eu
AGENT_USER=${AWH_RDC_USER:-awh-remote}
AGENT_HOME=${AWH_RDC_HOME:-/var/lib/awh-remote}
RUNTIME_ROOT=${AWH_RDC_RUNTIME_ROOT:-/opt/awh-tools/remote-desktop}
NODE_ROOT=${AWH_RDC_NODE_ROOT:-/opt/awh-tools/remote-desktop/node-v22.22.1-linux-x64}
NODE_BIN=$NODE_ROOT/bin/node
SESSION=$AGENT_HOME/.desktop-commander-device/device.json
CONFIG=$AGENT_HOME/.claude-server-commander/config.json
fail(){ printf '%s\n' "$1" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail AWH_VPS_DIRECT_VERIFY_REQUIRES_ROOT
[ "$(systemctl show desktop-commander-vps.service -p User --value)" = "$AGENT_USER" ] || fail AWH_VPS_DIRECT_SERVICE_USER_MISMATCH
[ "$(systemctl show desktop-commander-vps.service -p Group --value)" = "$AGENT_USER" ] || fail AWH_VPS_DIRECT_SERVICE_GROUP_MISMATCH
systemctl is-enabled --quiet desktop-commander-vps.service || fail AWH_VPS_DIRECT_SERVICE_NOT_ENABLED
systemctl is-active --quiet desktop-commander-vps.service || fail AWH_VPS_DIRECT_SERVICE_NOT_ACTIVE
case " $(id -nG "$AGENT_USER") " in *' sudo '*|*' adm '*) fail AWH_VPS_DIRECT_PRIVILEGED_GROUP_FORBIDDEN;; esac
[ "$(stat -c '%U:%G:%a' "$SESSION")" = "$AGENT_USER:$AGENT_USER:600" ] || fail AWH_VPS_DIRECT_SESSION_PERMISSIONS_INVALID
[ -x "$NODE_BIN" ] || fail AWH_VPS_DIRECT_NODE22_REQUIRED
"$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22 || (a===22&&b>=12) ? 0 : 1)' || fail AWH_VPS_DIRECT_NODE22_REQUIRED
VERSION=$("$NODE_BIN" -e 'process.stdout.write(require(process.argv[1]).version)' "$RUNTIME_ROOT/agent/node_modules/@wonderwhy-er/desktop-commander/package.json")
[ "$VERSION" = 0.2.51 ] || fail AWH_VPS_DIRECT_AGENT_VERSION_MISMATCH
"$NODE_BIN" - "$CONFIG" <<'NODE'
const fs=require('fs'); const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const dirs=JSON.stringify(c.allowedDirectories||[]); if(dirs!==JSON.stringify(['/srv/awh-git','/tmp'])) process.exit(2);
for(const cmd of ['sudo','su','useradd','usermod','reboot','shutdown']) if(!(c.blockedCommands||[]).includes(cmd)) process.exit(3);
if(c.fileReadLineLimit!==300 || c.fileWriteLineLimit!==50) process.exit(4);
NODE
runuser -u "$AGENT_USER" -- git --git-dir=/srv/awh-git/awh.git rev-parse --verify refs/heads/main >/dev/null || fail AWH_VPS_DIRECT_SOURCE_READ_FAILED
printf '%s\n' "AWH_VPS_DIRECT_VERIFY=PASS version=$VERSION user=$AGENT_USER"
