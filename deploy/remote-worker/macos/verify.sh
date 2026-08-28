#!/bin/bash
set -euo pipefail
ROOT="$HOME/Library/Application Support/AWH/RemoteWorker"
PKG="$ROOT/runtime/node_modules/@wonderwhy-er/desktop-commander"
SCRIPT="$ROOT/awh-remote-worker.sh"
PLIST="$HOME/Library/LaunchAgents/com.awh.remote-worker.plist"
SESSION="$HOME/.desktop-commander-device/device.json"
EXPECTED=0.2.47
VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$PKG/package.json")"
[ "$VERSION" = "$EXPECTED" ] || { echo "version=FAIL:$VERSION"; exit 1; }
grep -q -- 'remote --persist-session' "$SCRIPT"
grep -q 'sleep 5' "$SCRIPT"
grep -q '5242880' "$SCRIPT"
grep -q 'REMOTE_LOG_PREVIEW_CHARS' "$PKG/dist/remote-device/device.js"
grep -q '5000' "$PKG/dist/remote-device/remote-channel.js"
grep -q 'ensureReady' "$PKG/dist/remote-device/desktop-commander-integration.js"
grep -q 'pendingProcessError' "$PKG/dist/terminal-manager.js"
grep -q 'DC_REMOTE_DEVICE' "$PKG/dist/index.js"
plutil -lint "$PLIST" >/dev/null
MODE=absent
if [ -f "$SESSION" ]; then MODE="$(stat -f '%Lp' "$SESSION")"; [ "$MODE" = 600 ] || { echo "session_mode=FAIL:$MODE"; exit 1; }; fi
SESSION_STATE=none
if [ -f "$SESSION" ]; then
  SESSION_PATH="$SESSION" node <<'NODE'
const fs=require('fs'); const value=JSON.parse(fs.readFileSync(process.env.SESSION_PATH,'utf8'));
const session=value.session || {}; const stored=Boolean(session.access_token && session.refresh_token);
if (!stored) process.exit(5); console.log('session_stored=yes');
NODE
  SESSION_STATE=stored
fi
COUNT="$(pgrep -f 'node .*desktop-commander remote' | awk 'NF{n++} END{print n+0}')"
[ "$COUNT" -le 1 ] || { echo "remote_parents=FAIL:$COUNT"; exit 1; }
launchctl print "gui/$(id -u)/com.awh.remote-worker" >/dev/null 2>&1 || { echo 'launchagent=FAIL'; exit 1; }
echo "AWH_REMOTE_WORKER_VERIFY=PASS version=$VERSION session=$SESSION_STATE remote_parents=$COUNT"
