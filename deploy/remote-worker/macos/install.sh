#!/bin/bash
set -euo pipefail
MODE="${1:---prepare}"
case "$MODE" in --prepare|--activate) ;; *) echo 'usage: install.sh [--prepare|--activate]' >&2; exit 2;; esac
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT="$HOME/Library/Application Support/AWH/RemoteWorker"
RUNTIME="$ROOT/runtime"
COMPAT_BIN="$HOME/.local/share/bay-remote/node_modules/.bin/desktop-commander"
PKG="$RUNTIME/node_modules/@wonderwhy-er/desktop-commander"
PLIST="$HOME/Library/LaunchAgents/com.awh.remote-worker.plist"
EXPECTED=0.2.51

ensure_compat_bin() {
  local target="$RUNTIME/node_modules/.bin/desktop-commander"
  local parent
  parent="$(dirname "$COMPAT_BIN")"
  mkdir -p "$parent"
  if [ -L "$COMPAT_BIN" ]; then
    rm -f "$COMPAT_BIN"
    ln -s "$target" "$COMPAT_BIN"
  elif [ ! -e "$COMPAT_BIN" ]; then
    ln -s "$target" "$COMPAT_BIN"
  fi
}
ensure_awh_mcp_child() {
  local db="$HOME/Library/Application Support/AWH/DeviceRuntime/lnwjud/lnwjud.sqlite"
  local command="$RUNTIME/node_modules/.bin/desktop-commander"
  [ -f "$db" ] || return 0
  [ -x "$command" ] || return 0
  command -v python3 >/dev/null 2>&1 || { echo 'AWH MCP child registration skipped: python3 unavailable' >&2; return 0; }
  AWH_LNWJUD_DB="$db" AWH_DEVICE_SYSTEM_COMMAND="$command" python3 <<'PYCFG'
import json, os, sqlite3
db=os.environ['AWH_LNWJUD_DB']; command=os.environ['AWH_DEVICE_SYSTEM_COMMAND']
con=sqlite3.connect(db, timeout=10)
try:
    row=con.execute("SELECT value FROM settings WHERE key='extensions'").fetchone()
    try: cfg=json.loads(row[0]) if row else {}
    except Exception: cfg={}
    cfg.setdefault('mode','enable_all')
    for key in ('disabledServers','enabledServers','disabledSkillRoots','extraSkillRoots'): cfg.setdefault(key,[])
    servers=cfg.setdefault('extraMcpServers',{})
    servers['awh-device-system']={'command':command}
    con.execute('BEGIN IMMEDIATE')
    con.execute("INSERT INTO settings(key,value) VALUES('extensions',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(json.dumps(cfg,separators=(',',':')),))
    con.commit()
finally:
    con.close()
PYCFG
}
mkdir -p "$RUNTIME" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
if [ ! -f "$RUNTIME/package.json" ]; then
  cat > "$RUNTIME/package.json" <<EOF
{"name":"awh-desktop-commander-runtime","private":true,"version":"1.0.0","dependencies":{"@wonderwhy-er/desktop-commander":"$EXPECTED"}}
EOF
fi
if [ ! -f "$PKG/package.json" ]; then
  (cd "$RUNTIME" && npm install --ignore-scripts --no-audit --no-fund --save-exact "@wonderwhy-er/desktop-commander@$EXPECTED")
fi
VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$PKG/package.json")"
[ "$VERSION" = "$EXPECTED" ] || { echo "unsupported Desktop Commander version: $VERSION" >&2; exit 3; }
if patch --dry-run -s -p1 -d "$PKG" < "$HERE/runtime-hardening.patch" >/dev/null 2>&1; then
  patch -s -p1 -d "$PKG" < "$HERE/runtime-hardening.patch"
elif patch --dry-run -s -R -p1 -d "$PKG" < "$HERE/runtime-hardening.patch" >/dev/null 2>&1; then
  : # already hardened
else
  echo 'runtime hardening patch does not match pinned package; refusing partial install' >&2; exit 4
fi
install -m 0700 "$HERE/awh-remote-worker.sh" "$ROOT/awh-remote-worker.sh"
install -m 0700 "$HERE/awh-runtime-update.sh" "$ROOT/awh-runtime-update.sh"
ensure_compat_bin
ensure_awh_mcp_child
sed "s|__HOME__|$HOME|g" "$HERE/com.awh.remote-worker.plist.template" > "$PLIST.tmp"
plutil -lint "$PLIST.tmp" >/dev/null
mv "$PLIST.tmp" "$PLIST"
chmod 0600 "$PLIST"
CONFIG="$HOME/.claude-server-commander/config.json"
if [ -f "$CONFIG" ]; then
  CONFIG_PATH="$CONFIG" node <<'NODE'
const fs = require('fs'); const p = process.env.CONFIG_PATH;
const value = JSON.parse(fs.readFileSync(p, 'utf8')); value.fileReadLineLimit = 300;
fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
NODE
fi
SESSION="$HOME/.desktop-commander-device/device.json"
[ ! -f "$SESSION" ] || chmod 0600 "$SESSION"
if [ "$MODE" = '--activate' ]; then
  UIDN="$(id -u)"
  launchctl bootout "gui/$UIDN" "$PLIST" 2>/dev/null || true
  launchctl bootstrap "gui/$UIDN" "$PLIST"
  launchctl kickstart -k "gui/$UIDN/com.awh.remote-worker"
fi
echo "AWH_REMOTE_WORKER_PREPARED version=$EXPECTED mode=$MODE"
