#!/bin/bash
set -euo pipefail
ROOT="${AWH_REMOTE_ROOT:-$HOME/Library/Application Support/AWH/RemoteWorker}"
RUNTIME="$ROOT/runtime"
DEVICE_ROOT="$HOME/Library/Application Support/AWH/DeviceRuntime"
AWH_BIN="$HOME/.awh/bin"
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
if(m.schemaVersion!==1||m.product!=='AWH Device Runtime'||m.channel!=='stable'||m.package!=='@wonderwhy-er/desktop-commander'||!/^\d+\.\d+\.\d+$/.test(m.version)||!/^sha512-/.test(m.npmIntegrity))process.exit(21);
const e=(r.files||[]).find(x=>x.path==='device-runtime-release.json');if(!e)process.exit(22);
if(c.createHash('sha256').update(fs.readFileSync(process.argv[3])).digest('hex')!==e.sha256)process.exit(23);
NODE
VERSION="$(node -p "require('$TMP/manifest.json').version")"
INTEGRITY="$(node -p "require('$TMP/manifest.json').npmIntegrity")"
CURRENT="$(node -e 'try{process.stdout.write(require(process.argv[1]).version)}catch{}' "$RUNTIME/node_modules/@wonderwhy-er/desktop-commander/package.json" 2>/dev/null || true)"
for asset in device-runtime/runtime-hardening.patch device-runtime/macos/awh-remote-worker.sh device-runtime/macos/awh-runtime-update.sh device-runtime/macos/awh-mcp-stdio.sh; do
  mkdir -p "$TMP/$(dirname "$asset")"
  curl -fsSL --proto '=https' --tlsv1.2 "$BASE/$asset" -o "$TMP/$asset"
  node - "$TMP/release.json" "$asset" "$TMP/$asset" <<'NODE'
const fs=require('fs'),c=require('crypto');const r=JSON.parse(fs.readFileSync(process.argv[2])),n=process.argv[3],p=process.argv[4],e=(r.files||[]).find(x=>x.path===n);if(!e)process.exit(31);if(c.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==e.sha256)process.exit(32);
NODE
done
install_device_bridge() {
  mkdir -p "$DEVICE_ROOT" "$AWH_BIN"
  install -m 0700 "$TMP/device-runtime/macos/awh-mcp-stdio.sh" "$DEVICE_ROOT/awh-mcp-stdio"
  install -m 0700 "$TMP/device-runtime/macos/awh-mcp-stdio.sh" "$AWH_BIN/awh-mcp-stdio"
}
if [ "$CURRENT" = "$VERSION" ]; then
  install -m 0700 "$TMP/device-runtime/macos/awh-remote-worker.sh" "$ROOT/awh-remote-worker.sh"
  install -m 0700 "$TMP/device-runtime/macos/awh-runtime-update.sh" "$ROOT/awh-runtime-update.sh"
  install_device_bridge
  ensure_compat_bin
  echo "AWH_DEVICE_RUNTIME=CURRENT version=$VERSION bridge=ready"
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
install_device_bridge
ensure_compat_bin
pkill -f "desktop-commander remote" 2>/dev/null || true
printf '%s\n' "$(date '+%Y-%m-%dT%H:%M:%S') AWH Device Runtime updated ${CURRENT:-none} -> $VERSION" >> "$LOG"
printf '%s\n' "AWH_DEVICE_RUNTIME=UPDATED from=${CURRENT:-none} to=$VERSION"
