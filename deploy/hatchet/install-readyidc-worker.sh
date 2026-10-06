#!/bin/sh
set -eu
MODE=${1:---prepare}
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=${AWH_HATCHET_ROOT:-/opt/awh-tools/hatchet-worker}
APP=$ROOT/app
NODE_ROOT=${AWH_HATCHET_NODE_ROOT:-/opt/awh-tools/remote-desktop/node-v22.22.1-linux-x64}
NODE=$NODE_ROOT/bin/node
NPM=$NODE_ROOT/bin/npm
UNIT=/etc/systemd/system/awh-hatchet-worker.service
DATA_ROOT=${AWH_HATCHET_DATA_ROOT:-/var/lib/awh-hub/hatchet-embedded}
fail(){ printf '%s\n' "$1" >&2; exit 1; }
case "$MODE" in --prepare|--activate) :;; *) fail 'usage: install-readyidc-worker.sh [--prepare|--activate]' ;; esac
[ "$(id -u)" -eq 0 ] || fail AWH_HATCHET_INSTALL_REQUIRES_ROOT
[ "$(uname -s)" = Linux ] || fail AWH_HATCHET_UNSUPPORTED_OS
[ -x "$NODE" ] && [ -x "$NPM" ] || fail AWH_HATCHET_NODE_RUNTIME_REQUIRED
id awh-hub >/dev/null 2>&1 || fail AWH_HATCHET_AWH_IDENTITY_REQUIRED
install -d -o root -g root -m 0755 "$ROOT" "$APP"
install -d -o awh-hub -g awh-hub -m 0700 "$DATA_ROOT" "$DATA_ROOT/postgres"
install -o root -g root -m 0644 "$HERE/worker/package.json" "$APP/package.json"
install -o root -g root -m 0644 "$HERE/worker/worker.cjs" "$APP/worker.cjs"
(cd "$APP" && PATH="$NODE_ROOT/bin:$PATH" "$NPM" install --ignore-scripts --omit=dev --no-audit --no-fund --save-exact >/dev/null)
chown -R root:root "$ROOT"; chmod -R go-w "$ROOT"
sed "s|/opt/awh-tools/hatchet-worker/node/bin/node|$NODE|g" "$HERE/../systemd/awh-hatchet-worker.service" > "$UNIT.tmp"
install -o root -g root -m 0644 "$UNIT.tmp" "$UNIT"; rm -f "$UNIT.tmp"
systemctl daemon-reload
systemctl enable awh-hatchet-worker.service >/dev/null
if [ "$MODE" = --activate ]; then
  systemctl restart awh-hatchet-worker.service
  i=0; while [ "$i" -lt 40 ]; do
    if systemctl is-active --quiet awh-hatchet-worker.service && grep -q '"state":"READY"\|"state":"IDLE"\|"state":"DISPATCHED"' /var/lib/awh-hub/hatchet-worker-heartbeat.json 2>/dev/null; then break; fi
    i=$((i+1)); sleep 1
  done
  systemctl is-active --quiet awh-hatchet-worker.service || fail AWH_HATCHET_WORKER_NOT_ACTIVE
  grep -q '"providerMode":"embedded"' /var/lib/awh-hub/hatchet-worker-heartbeat.json 2>/dev/null || fail AWH_HATCHET_EMBEDDED_NOT_READY
fi
printf '%s\n' "AWH_HATCHET_INSTALL=PASS mode=$MODE provider=embedded"
