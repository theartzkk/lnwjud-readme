#!/bin/sh
set -eu

LOCK=/run/awh-observability-sync.lock
exec 9>"$LOCK"
flock -n 9 || exit 0

ROOT=/opt/awh-hub/control-plane-current
KEY_FILE=/var/lib/awh-hub/provider-credentials/honeycomb.key
CONFIG=/etc/otelcol-contrib/config.yaml
ENV_FILE=/etc/otelcol-contrib/awh-honeycomb.env
STATE_DIR=/var/lib/awh-hub/observability
ACTIVE_MARKER=$STATE_DIR/honeycomb-active
PREFLIGHT=$ROOT/deploy/observability/otelcol-awh-preflight.yaml
HONEYCOMB=$ROOT/deploy/observability/otelcol-awh-honeycomb.yaml

test -r "$PREFLIGHT"
test -r "$HONEYCOMB"
install -d -o awh-hub -g awh-hub -m 0755 "$STATE_DIR"
rm -f "$ACTIVE_MARKER"

activate_preflight() {
  rm -f "$ENV_FILE" "$ACTIVE_MARKER"
  install -o root -g otelcol-contrib -m 0640 "$PREFLIGHT" "$CONFIG"
  /usr/bin/otelcol-contrib validate --config="$CONFIG"
  systemctl restart otelcol-contrib.service
  systemctl is-active --quiet otelcol-contrib.service
}

if test ! -e "$KEY_FILE"; then
  activate_preflight
  exit 0
fi

test -f "$KEY_FILE" && test ! -L "$KEY_FILE"
MODE=$(stat -c '%a' "$KEY_FILE")
OWNER=$(stat -c '%U:%G' "$KEY_FILE")
test "$MODE" = 600
test "$OWNER" = awh-hub:awh-hub
KEY=$(cat "$KEY_FILE")
KEY_LEN=$(printf %s "$KEY" | wc -c | tr -d ' ')
test "$KEY_LEN" -ge 16 && test "$KEY_LEN" -le 4096
case "$KEY" in *[!A-Za-z0-9_.-]* ) exit 21 ;; esac

umask 0077
printf 'HONEYCOMB_API_KEY=%s\n' "$KEY" > "$ENV_FILE"
chown root:otelcol-contrib "$ENV_FILE"
chmod 0640 "$ENV_FILE"
HONEYCOMB_API_KEY=validation-only /usr/bin/otelcol-contrib validate --config="$HONEYCOMB"
unset KEY
install -o root -g otelcol-contrib -m 0640 "$HONEYCOMB" "$CONFIG"
systemctl restart otelcol-contrib.service
sleep 1
systemctl is-active --quiet otelcol-contrib.service
ss -ltn | grep -q '127.0.0.1:4318'
! ss -ltn | grep -Eq '(0\.0\.0\.0|\[::\]):4318'
printf 'ACTIVE\n' > "$ACTIVE_MARKER"
chown awh-hub:awh-hub "$ACTIVE_MARKER"
chmod 0644 "$ACTIVE_MARKER"
