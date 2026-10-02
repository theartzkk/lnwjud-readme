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
EXPECTED_AGENT_VERSION=$(manifest_value version)
NODE_VERSION=$(manifest_value linuxConnector.nodeRuntime.version)
NODE_MINIMUM=$(manifest_value linuxConnector.nodeRuntime.minimumVersion)
NODE_ROOT=${AWH_RDC_NODE_ROOT:-$RUNTIME_ROOT/node-v${NODE_VERSION}-linux-x64}
NODE_BIN=$NODE_ROOT/bin/node
SESSION=$AGENT_HOME/.desktop-commander-device/device.json
CONFIG=$AGENT_HOME/.claude-server-commander/config.json
CANDIDATE_ROOT=$AGENT_HOME/worktrees
CONNECTOR_TMP=$AGENT_HOME/tmp
VERIFY_EVIDENCE=${AWH_VPS_DIRECT_VERIFY_EVIDENCE:-$AGENT_HOME/checkpoints/vps-direct-connector-verify.last}
record_verify(){
  verify_code=$1
  evidence_dir=$(dirname -- "$VERIFY_EVIDENCE")
  if [ -d "$evidence_dir" ]; then
    evidence_tmp="$VERIFY_EVIDENCE.tmp.$$"
    {
      printf '%s %s\n' "$(date --iso-8601=seconds)" "$verify_code" > "$evidence_tmp"
      chown "$AGENT_USER:awh-operator" "$evidence_tmp"
      chmod 0640 "$evidence_tmp"
      mv -f "$evidence_tmp" "$VERIFY_EVIDENCE"
    } 2>/dev/null || { rm -f "$evidence_tmp" 2>/dev/null || true; true; }
  fi
}
fail(){ record_verify "$1"; printf '%s\n' "$1" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail AWH_VPS_DIRECT_VERIFY_REQUIRES_ROOT
[ "$(systemctl show desktop-commander-vps.service -p User --value)" = "$AGENT_USER" ] || fail AWH_VPS_DIRECT_SERVICE_USER_MISMATCH
[ "$(systemctl show desktop-commander-vps.service -p Group --value)" = "$AGENT_USER" ] || fail AWH_VPS_DIRECT_SERVICE_GROUP_MISMATCH
systemctl is-enabled --quiet desktop-commander-vps.service || fail AWH_VPS_DIRECT_SERVICE_NOT_ENABLED
systemctl is-active --quiet desktop-commander-vps.service || fail AWH_VPS_DIRECT_SERVICE_NOT_ACTIVE
MAIN_PID=$(systemctl show desktop-commander-vps.service -p MainPID --value)
case "$MAIN_PID" in ''|0|*[!0-9]*) fail AWH_VPS_DIRECT_SERVICE_PID_INVALID;; esac
tr '\0' '\n' < "/proc/$MAIN_PID/environ" | grep -Fxq "TMPDIR=$CONNECTOR_TMP" || fail AWH_VPS_DIRECT_RUNTIME_TMPDIR_MISMATCH
systemctl show desktop-commander-vps.service -p Environment --value | grep -Fq "TMPDIR=$CONNECTOR_TMP" || fail AWH_VPS_DIRECT_TMPDIR_MISMATCH
[ "$(stat -c '%U:%G:%a' "$CONNECTOR_TMP")" = "$AGENT_USER:awh-operator:2770" ] || fail AWH_VPS_DIRECT_TMPDIR_PERMISSIONS_INVALID
[ "$(stat -c '%U:%G:%a' "$CANDIDATE_ROOT")" = "$AGENT_USER:$AGENT_USER:700" ] || fail AWH_VPS_DIRECT_CANDIDATE_ROOT_PERMISSIONS_INVALID
runuser -u "$AGENT_USER" -- test -w "$CANDIDATE_ROOT" || fail AWH_VPS_DIRECT_CANDIDATE_ROOT_NOT_WRITABLE
case " $(id -nG "$AGENT_USER") " in *' sudo '*|*' adm '*) fail AWH_VPS_DIRECT_PRIVILEGED_GROUP_FORBIDDEN;; esac
[ "$(stat -c '%U:%G:%a' "$SESSION")" = "$AGENT_USER:$AGENT_USER:600" ] || fail AWH_VPS_DIRECT_SESSION_PERMISSIONS_INVALID
[ -x "$NODE_BIN" ] || fail AWH_VPS_DIRECT_NODE_RUNTIME_REQUIRED
"$NODE_BIN" -e 'const min=process.argv[1].split(".").map(Number),cur=process.versions.node.split(".").map(Number);for(let i=0;i<3;i++){if((cur[i]||0)>(min[i]||0))process.exit(0);if((cur[i]||0)<(min[i]||0))process.exit(1)}process.exit(0)' "$NODE_MINIMUM" || fail AWH_VPS_DIRECT_NODE_RUNTIME_REQUIRED
VERSION=$("$NODE_BIN" -e 'process.stdout.write(require(process.argv[1]).version)' "$RUNTIME_ROOT/agent/node_modules/@wonderwhy-er/desktop-commander/package.json")
[ "$VERSION" = "$EXPECTED_AGENT_VERSION" ] || fail AWH_VPS_DIRECT_AGENT_VERSION_MISMATCH
if ! "$NODE_BIN" - "$CONFIG" <<'NODE'
const fs=require('fs'); const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const dirs=JSON.stringify(c.allowedDirectories||[]); if(dirs!==JSON.stringify(['/srv/awh-git','/var/lib/awh-remote/worktrees','/tmp'])) process.exit(2);
for(const cmd of ['sudo','su','useradd','usermod','reboot','shutdown']) if(!(c.blockedCommands||[]).includes(cmd)) process.exit(3);
if(c.fileReadLineLimit!==300 || c.fileWriteLineLimit!==50) process.exit(4);
NODE
then
  fail AWH_VPS_DIRECT_CONFIG_POLICY_MISMATCH
fi
runuser -u "$AGENT_USER" -- git --git-dir=/srv/awh-git/awh.git rev-parse --verify refs/heads/main >/dev/null || fail AWH_VPS_DIRECT_SOURCE_READ_FAILED
runuser -u "$AGENT_USER" -- test ! -w /srv/awh-git || fail AWH_VPS_DIRECT_CANONICAL_SOURCE_WRITABLE
record_verify AWH_VPS_DIRECT_VERIFY_PASS
printf '%s\n' "AWH_VPS_DIRECT_VERIFY=PASS version=$VERSION user=$AGENT_USER"
