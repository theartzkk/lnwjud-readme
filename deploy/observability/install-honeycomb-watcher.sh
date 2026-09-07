#!/bin/sh
set -eu
test "$(id -u)" -eq 0 || { echo "root required" >&2; exit 20; }
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
install -o root -g otelcol-contrib -m 0640 "$ROOT/deploy/observability/otelcol-awh-preflight.yaml" /etc/otelcol-contrib/awh-preflight.yaml
install -o root -g otelcol-contrib -m 0640 "$ROOT/deploy/observability/otelcol-awh-honeycomb.yaml" /etc/otelcol-contrib/awh-honeycomb.yaml
install -o root -g root -m 0644 "$ROOT/deploy/systemd/awh-observability-sync.service" /etc/systemd/system/awh-observability-sync.service
install -o root -g root -m 0644 "$ROOT/deploy/systemd/awh-observability-sync.path" /etc/systemd/system/awh-observability-sync.path
mkdir -p /etc/systemd/system/otelcol-contrib.service.d
cat > /etc/systemd/system/otelcol-contrib.service.d/awh-honeycomb.conf <<'DROPIN'
[Service]
EnvironmentFile=-/etc/otelcol-contrib/awh-honeycomb.env
DROPIN
systemctl daemon-reload
systemctl enable --now awh-observability-sync.path
systemctl start awh-observability-sync.service
systemctl is-active --quiet awh-observability-sync.path
printf 'AWH_HONEYCOMB_WATCHER=PASS\n'
