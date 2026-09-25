#!/bin/sh
set -eu
MODE=${1:---check}
PLAYWRIGHT_VERSION=${AWH_PLAYWRIGHT_VERSION:-1.63.0}
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=${AWH_BROWSER_QA_ROOT:-/opt/awh-tools/browser-qa}
NODE_INSTALLER=$HERE/../remote-worker/linux/install-node-runtime.sh
NODE_ROOT=${AWH_BROWSER_QA_NODE_ROOT:-/opt/awh-tools/remote-desktop/node-v22.22.1-linux-x64}
NODE_BIN=$NODE_ROOT/bin/node
NPM_BIN=$NODE_ROOT/bin/npm
CHROME=${AWH_CHROME_PATH:-}
fail(){ printf '%s\n' "$1" >&2; exit 1; }
case "$MODE" in --check|--install) :;; *) fail 'usage: install-browser-qa-runtime.sh [--check|--install]' ;; esac
[ -n "$CHROME" ] && [ -x "$CHROME" ] || fail AWH_BROWSER_QA_CHROME_REQUIRED
if ! { [ -x "$NODE_BIN" ] && [ -x "$NPM_BIN" ] && "$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22 || (a===22&&b>=12) ? 0 : 1)' 2>/dev/null; }; then
  [ "$MODE" = --install ] || fail AWH_BROWSER_QA_NODE22_REQUIRED
  [ "$(id -u)" -eq 0 ] || fail AWH_BROWSER_QA_INSTALL_REQUIRES_ROOT
  [ -x "$NODE_INSTALLER" ] || fail AWH_BROWSER_QA_NODE_INSTALLER_MISSING
  AWH_NODE_RUNTIME_ROOT=$(dirname "$NODE_ROOT") sh "$NODE_INSTALLER"
fi
[ -x "$NODE_BIN" ] && [ -x "$NPM_BIN" ] || fail AWH_BROWSER_QA_NODE22_REQUIRED
missing(){ ldd "$CHROME" 2>/dev/null | awk '/not found/{print $1}' | sort -u; }
MISSING=$(missing)
if [ "$MODE" = --check ]; then
  [ -z "$MISSING" ] || { printf '%s\n' "$MISSING"; fail AWH_BROWSER_QA_SHARED_LIBS_MISSING; }
  [ -f "$ROOT/runtime/node_modules/playwright/package.json" ] || fail AWH_BROWSER_QA_PLAYWRIGHT_MISSING
  printf '%s\n' AWH_BROWSER_QA_RUNTIME=READY; exit 0
fi
[ "$(id -u)" -eq 0 ] || fail AWH_BROWSER_QA_INSTALL_REQUIRES_ROOT
. /etc/os-release
[ "${ID:-}" = ubuntu ] && [ "${VERSION_ID:-}" = 24.04 ] || fail AWH_BROWSER_QA_UNSUPPORTED_OS
export DEBIAN_FRONTEND=noninteractive
apt-get update >/dev/null
apt-get install -y --no-install-recommends libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libasound2t64 libcairo2 libpango-1.0-0 libxdamage1 libatspi2.0-0t64 libxcomposite1 libxfixes3 libxrandr2 libgbm1 libnss3 libxkbcommon0 libx11-xcb1 libdrm2 libxcb1 libxext6 libx11-6 fonts-noto-core fonts-noto-color-emoji >/dev/null
install -d -o root -g root -m 0755 "$ROOT/runtime"
CHROME_DIR=$(dirname "$CHROME")
rm -rf "$ROOT/chrome-staged"
mkdir -p "$ROOT/chrome-staged"
cp -al "$CHROME_DIR/." "$ROOT/chrome-staged/" || fail AWH_BROWSER_QA_CHROME_HARDLINK_ADOPTION_FAILED
rm -rf "$ROOT/chrome"; mv "$ROOT/chrome-staged" "$ROOT/chrome"
CHROME="$ROOT/chrome/$(basename "$CHROME")"
[ -x "$CHROME" ] || fail AWH_BROWSER_QA_ADOPTED_CHROME_INVALID
printf '%s\n' '{"name":"awh-browser-qa-runtime","private":true,"version":"1.0.0"}' > "$ROOT/runtime/package.json"
(cd "$ROOT/runtime" && PATH="$NODE_ROOT/bin:$PATH" PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 "$NPM_BIN" install --ignore-scripts --no-audit --no-fund --save-exact "playwright@$PLAYWRIGHT_VERSION" >/dev/null)
ln -sfn "$CHROME" "$ROOT/chrome-current"
install -d -o root -g root -m 0755 /etc/awh
printf 'AWH_CHROME_PATH=%s\nAWH_PLAYWRIGHT_MODULE=%s\nAWH_BROWSER_QA_NODE_BIN=%s\n' "$ROOT/chrome-current" "$ROOT/runtime/node_modules/playwright/index.mjs" "$NODE_BIN" > /etc/awh/browser-qa.env
chmod 0644 /etc/awh/browser-qa.env
MISSING=$(missing); [ -z "$MISSING" ] || { printf '%s\n' "$MISSING"; fail AWH_BROWSER_QA_SHARED_LIBS_STILL_MISSING; }
printf '%s\n' "AWH_BROWSER_QA_INSTALL=PASS playwright=$PLAYWRIGHT_VERSION"
