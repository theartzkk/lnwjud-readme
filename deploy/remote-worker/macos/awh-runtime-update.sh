#!/bin/bash
set -euo pipefail
ROOT="${AWH_REMOTE_ROOT:-$HOME/Library/Application Support/AWH/RemoteWorker}"
RUNTIME="$ROOT/runtime"
COMPAT_BIN="$HOME/.local/share/bay-remote/node_modules/.bin/desktop-commander"
BASE="${AWH_RUNTIME_BASE_URL:-https://kruart.online}"
LOCK="$ROOT/.update.lock"
TMP="$ROOT/.update.$$"
LOG="$HOME/Library/Logs/AWH-Remote-Worker.log"

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
mkdir -p "$ROOT" "$HOME/Library/Logs"
cleanup(){ rm -rf "$TMP" 2>/dev/null || true; rmdir "$LOCK" 2>/dev/null || true; }
if ! mkdir "$LOCK" 2>/dev/null; then
  [ -f "$LOCK/pid" ] && read -r oldpid < "$LOCK/pid" || oldpid=
  if [ -n "${oldpid:-}" ] && kill -0 "$oldpid" 2>/dev/null; then exit 0; fi
  rm -rf "$LOCK"; mkdir "$LOCK"
fi
printf '%s\n' "$$" > "$LOCK/pid"
trap cleanup EXIT INT TERM
mkdir -p "$TMP/device-runtime/macos"
curl -fsSL --proto '=https' --tlsv1.2 "$BASE/release.json" -o "$TMP/release.json"
curl -fsSL --proto '=https' --tlsv1.2 "$BASE/device-runtime-release.json" -o "$TMP/manifest.json"
node - "$TMP/release.json" "$TMP/manifest.json" <<'NODE'
const fs=require('fs'),c=require('crypto');const r=JSON.parse(fs.readFileSync(process.argv[2])),m=JSON.parse(fs.readFileSync(process.argv[3]));
if(m.schemaVersion!==1||m.product!=='AWH Device Runtime'||m.channel!=='stable'||m.package!=='@wonderwhy-er/desktop-commander'||!/^\d+\.\d+\.\d+$/.test(m.version)||!/^sha512-/.test(m.npmIntegrity)||m.toolDiscoveryMode!=='runtime-native'||m.workerInventoryLimit!==64||m.extensionRegistry!=='config/external-capabilities.json'||m.unknownRuntimeToolPolicy!=='DISCOVER_ONLY_NO_AUTO_EXECUTION_AUTHORITY')process.exit(21);
const e=(r.files||[]).find(x=>x.path==='device-runtime-release.json');if(!e)process.exit(22);
if(c.createHash('sha256').update(fs.readFileSync(process.argv[3])).digest('hex')!==e.sha256)process.exit(23);
NODE
VERSION="$(node -p "require('$TMP/manifest.json').version")"
INTEGRITY="$(node -p "require('$TMP/manifest.json').npmIntegrity")"
CURRENT="$(node -e 'try{process.stdout.write(require(process.argv[1]).version)}catch{}' "$RUNTIME/node_modules/@wonderwhy-er/desktop-commander/package.json" 2>/dev/null || true)"
for asset in device-runtime/runtime-hardening.patch device-runtime/macos/awh-remote-worker.sh device-runtime/macos/awh-runtime-update.sh; do
  mkdir -p "$TMP/$(dirname "$asset")"
  curl -fsSL --proto '=https' --tlsv1.2 "$BASE/$asset" -o "$TMP/$asset"
  node - "$TMP/release.json" "$asset" "$TMP/$asset" <<'NODE'
const fs=require('fs'),c=require('crypto');const r=JSON.parse(fs.readFileSync(process.argv[2])),n=process.argv[3],p=process.argv[4],e=(r.files||[]).find(x=>x.path===n);if(!e)process.exit(31);if(c.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==e.sha256)process.exit(32);
NODE
done
if [ "$CURRENT" = "$VERSION" ]; then
  install -m 0700 "$TMP/device-runtime/macos/awh-remote-worker.sh" "$ROOT/awh-remote-worker.sh"
  install -m 0700 "$TMP/device-runtime/macos/awh-runtime-update.sh" "$ROOT/awh-runtime-update.sh"
  ensure_compat_bin
  ensure_awh_mcp_child
  echo "AWH_DEVICE_RUNTIME=CURRENT version=$VERSION scripts=refreshed mcp_child=awh-device-system"
  exit 0
fi
STAGE="$TMP/runtime"
mkdir -p "$STAGE"
printf '%s\n' "{\"name\":\"awh-device-runtime\",\"private\":true,\"version\":\"1.0.0\",\"dependencies\":{\"@wonderwhy-er/desktop-commander\":\"$VERSION\"}}" > "$STAGE/package.json"
(cd "$STAGE" && npm install --ignore-scripts --no-audit --no-fund --save-exact "@wonderwhy-er/desktop-commander@$VERSION" >/dev/null)
node - "$STAGE" "$VERSION" "$INTEGRITY" <<'NODE'
const fs=require('fs'),p=require('path');const root=process.argv[2],v=process.argv[3],i=process.argv[4],pkg=JSON.parse(fs.readFileSync(p.join(root,'node_modules/@wonderwhy-er/desktop-commander/package.json'))),lock=JSON.parse(fs.readFileSync(p.join(root,'package-lock.json'))),row=lock.packages?.['node_modules/@wonderwhy-er/desktop-commander'];if(pkg.version!==v||row?.version!==v||row?.integrity!==i)process.exit(41);
NODE
PKG="$STAGE/node_modules/@wonderwhy-er/desktop-commander"
PATCH="$TMP/device-runtime/runtime-hardening.patch"
if patch --dry-run -s -p1 -d "$PKG" < "$PATCH" >/dev/null 2>&1; then patch -s -p1 -d "$PKG" < "$PATCH"
elif patch --dry-run -s -R -p1 -d "$PKG" < "$PATCH" >/dev/null 2>&1; then :
else echo AWH_DEVICE_RUNTIME_PATCH_MISMATCH >&2; exit 42; fi
PREV="$ROOT/runtime.previous"
rm -rf "$PREV"
[ ! -d "$RUNTIME" ] || mv "$RUNTIME" "$PREV"
if ! mv "$STAGE" "$RUNTIME"; then [ ! -d "$PREV" ] || mv "$PREV" "$RUNTIME"; exit 43; fi
install -m 0700 "$TMP/device-runtime/macos/awh-remote-worker.sh" "$ROOT/awh-remote-worker.sh"
install -m 0700 "$TMP/device-runtime/macos/awh-runtime-update.sh" "$ROOT/awh-runtime-update.sh"
ensure_compat_bin
ensure_awh_mcp_child
pkill -f "desktop-commander remote" 2>/dev/null || true
printf '%s\n' "$(date '+%Y-%m-%dT%H:%M:%S') AWH Device Runtime updated ${CURRENT:-none} -> $VERSION" >> "$LOG"
printf '%s\n' "AWH_DEVICE_RUNTIME=UPDATED from=${CURRENT:-none} to=$VERSION"
