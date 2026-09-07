#!/bin/sh
set -eu

OTELCOL_VERSION=0.160.0
OTELCOL_SHA256=44c03585187c19476f1d2fe65cbdc1c80a3f6d5bc9dadf457bec9e677c655934
PHP_OTEL_VERSION=0.6.1
PHP_OTEL_SHA256=c4677d7dc351c49de1a2dc38ff1c833498ae08161e10a8583ee4ff97c80cb2dd
OTELCOL_URL="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}/otelcol-contrib_${OTELCOL_VERSION}_linux_amd64.deb"
PHP_OTEL_URL="https://github.com/open-telemetry/opentelemetry-php-distro/releases/download/v${PHP_OTEL_VERSION}/opentelemetry-php-distro_${PHP_OTEL_VERSION}_amd64.deb"

test "$(id -u)" -eq 0 || { echo "root required" >&2; exit 20; }
test "$(uname -m)" = x86_64 || { echo "unsupported architecture" >&2; exit 20; }
command -v php-fpm8.3 >/dev/null
command -v curl >/dev/null
command -v sha256sum >/dev/null

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
POOL=/etc/php/8.3/fpm/pool.d/awh-enrollment.conf
COLLECTOR_CONFIG=/etc/otelcol-contrib/config.yaml
test -f "$POOL"
WORK=$(mktemp -d /var/tmp/awh-otel-install.XXXXXX)
trap 'rm -rf "$WORK"' EXIT HUP INT TERM

curl -fL --retry 2 --connect-timeout 10 -o "$WORK/otelcol.deb" "$OTELCOL_URL"
echo "$OTELCOL_SHA256  $WORK/otelcol.deb" | sha256sum -c -
curl -fL --retry 2 --connect-timeout 10 -o "$WORK/php-otel.deb" "$PHP_OTEL_URL"
echo "$PHP_OTEL_SHA256  $WORK/php-otel.deb" | sha256sum -c -

STAMP=$(date +%Y%m%d-%H%M%S)
BACK=/var/backups/awh-observability/$STAMP
mkdir -p "$BACK"
cp -a "$POOL" "$BACK/awh-enrollment.conf"
test ! -e "$COLLECTOR_CONFIG" || cp -a "$COLLECTOR_CONFIG" "$BACK/otelcol-config.yaml"

if ! dpkg-query -W otelcol-contrib >/dev/null 2>&1; then
  dpkg --unpack "$WORK/otelcol.deb"
  dpkg --configure otelcol-contrib >/dev/null 2>&1
fi
if ! dpkg-query -W opentelemetry-php-distro >/dev/null 2>&1; then
  dpkg -i "$WORK/php-otel.deb"
fi

RELEASE=$(basename "$(readlink /opt/awh-hub/control-plane-current)")
TMP=$(mktemp)
awk '
  $0=="; BEGIN AWH OTEL" {drop=1; next}
  $0=="; END AWH OTEL" {drop=0; next}
  !drop {print}
' "$POOL" > "$TMP"
cat >> "$TMP" <<EOF2

; BEGIN AWH OTEL
; Traces only. Collector privacy policy is fail-closed.
env[OTEL_SERVICE_NAME] = "awh-control-plane"
env[OTEL_SERVICE_VERSION] = "$RELEASE"
env[OTEL_RESOURCE_ATTRIBUTES] = "service.namespace=awh,deployment.environment.name=test"
env[OTEL_TRACES_EXPORTER] = "otlp"
env[OTEL_METRICS_EXPORTER] = "none"
env[OTEL_LOGS_EXPORTER] = "none"
env[OTEL_EXPORTER_OTLP_PROTOCOL] = "http/protobuf"
env[OTEL_EXPORTER_OTLP_ENDPOINT] = "http://127.0.0.1:4318"
env[OTEL_PROPAGATORS] = "tracecontext"
env[OTEL_PHP_AUTOLOAD_ENABLED] = "true"
env[OTEL_PHP_DISABLED_INSTRUMENTATIONS] = "curl,pdo"
; END AWH OTEL
EOF2
install -o root -g root -m 0640 "$TMP" "$POOL"
rm -f "$TMP"

install -o root -g otelcol-contrib -m 0640 "$ROOT/deploy/observability/otelcol-awh-preflight.yaml" "$COLLECTOR_CONFIG"
install -o root -g root -m 0644 "$ROOT/deploy/systemd/awh-observability-sync.service" /etc/systemd/system/awh-observability-sync.service
install -o root -g root -m 0644 "$ROOT/deploy/systemd/awh-observability-sync.path" /etc/systemd/system/awh-observability-sync.path
mkdir -p /etc/systemd/system/otelcol-contrib.service.d
cat > /etc/systemd/system/otelcol-contrib.service.d/awh-honeycomb.conf <<EOF2
[Service]
EnvironmentFile=-/etc/otelcol-contrib/awh-honeycomb.env
EOF2

/usr/bin/otelcol-contrib validate --config="$COLLECTOR_CONFIG"
php-fpm8.3 -t
systemctl daemon-reload
systemctl enable --now otelcol-contrib.service
systemctl enable --now awh-observability-sync.path
systemctl reload php8.3-fpm.service
systemctl start awh-observability-sync.service
sleep 1
systemctl is-active --quiet otelcol-contrib.service
systemctl is-active --quiet php8.3-fpm.service
systemctl is-active --quiet awh-observability-sync.path
ss -ltn | grep -q '127.0.0.1:4318'
! ss -ltn | grep -Eq '(0\.0\.0\.0|\[::\]):4318'
curl -fsS -o /dev/null https://kruart.online/
printf 'AWH_OBSERVABILITY_PREFLIGHT=PASS backup=%s\n' "$BACK"
