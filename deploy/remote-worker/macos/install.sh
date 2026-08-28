#!/bin/bash
set -euo pipefail
MODE="${1:---prepare}"
case "$MODE" in --prepare|--activate) ;; *) echo 'usage: install.sh [--prepare|--activate]' >&2; exit 2;; esac
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT="$HOME/Library/Application Support/AWH/RemoteWorker"
RUNTIME="$ROOT/runtime"
PKG="$RUNTIME/node_modules/@wonderwhy-er/desktop-commander"
PLIST="$HOME/Library/LaunchAgents/com.awh.remote-worker.plist"
EXPECTED=0.2.47
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
