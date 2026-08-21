#!/bin/sh

# Remote phase for deploy-enrollment.sh.
# Inputs are fixed, validated paths and versions from the read-only preflight.
# The script never prints credentials or the bootstrap hash.
set -eu

DB=$1
REMOTE_ROOT=$2
REMOTE_STAGE=$3
REMOTE_RELEASE=$4
RELEASE_ID=$5
NGINX_CONFIG=$6
PHP_VERSION=$7
BOOTSTRAP_HASH_FILE=$8

case "$DB" in /var/lib/awh-hub/*|/opt/awh-hub/*|/srv/awh/*) ;; *) exit 20 ;; esac
case "$REMOTE_ROOT" in /opt/awh-hub) ;; *) exit 20 ;; esac
case "$REMOTE_STAGE" in /tmp/awh-enrollment-*.tar.gz) ;; *) exit 20 ;; esac
case "$REMOTE_RELEASE" in /opt/awh-hub/enrollment-releases/*) ;; *) exit 20 ;; esac
case "$RELEASE_ID" in ''|*[!A-Za-z0-9._-]*) exit 20 ;; esac
case "$NGINX_CONFIG" in /etc/nginx/sites-enabled/*) ;; *) exit 20 ;; esac
case "$PHP_VERSION" in [0-9]*.[0-9]*) ;; *) exit 20 ;; esac
case "$BOOTSTRAP_HASH_FILE" in /etc/awh-hub/*) ;; *) exit 20 ;; esac

BACKUP=/var/backups/awh-hub/awh.sqlite.pre-m3e2
POOL_PATH=/etc/php/$PHP_VERSION/fpm/pool.d/awh-enrollment.conf
PHP_FPM_BIN=/usr/sbin/php-fpm$PHP_VERSION
INCLUDE_PATH=$REMOTE_ROOT/enrollment-current/deploy/nginx/awh-enrollment.conf
NGINX_BACKUP=$NGINX_CONFIG.pre-m3e2-$RELEASE_ID
POOL_BACKUP=$POOL_PATH.pre-m3e2-$RELEASE_ID
POOL_TMP=$(sudo mktemp /tmp/awh-enrollment-pool.XXXXXX)
NGINX_TMP=$(mktemp /tmp/awh-enrollment-nginx.XXXXXX)
PREVIOUS_TARGET=$(sudo readlink -f "$REMOTE_ROOT/enrollment-current" 2>/dev/null || true)
MIGRATION_STARTED=0
SWITCHED=0
NGINX_CHANGED=0
POOL_CHANGED=0
SERVICES_RELOADED=0
SUCCESS=0

cleanup() {
  sudo rm -f "$POOL_TMP" "$NGINX_TMP" >/dev/null 2>&1 || true
}
rollback() {
  status=$?
  if test "$SUCCESS" -eq 0; then
    if test "$SERVICES_RELOADED" -eq 1; then
      sudo "$PHP_FPM_BIN" -t >/dev/null 2>&1 || true
      sudo systemctl reload "php$PHP_VERSION-fpm" >/dev/null 2>&1 || true
      sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx >/dev/null 2>&1 || true
    fi
    if test "$SWITCHED" -eq 1; then
      if test -n "$PREVIOUS_TARGET"; then sudo ln -sfn "$PREVIOUS_TARGET" "$REMOTE_ROOT/enrollment-current"; else sudo rm -f "$REMOTE_ROOT/enrollment-current"; fi
    fi
    if test "$NGINX_CHANGED" -eq 1; then sudo cp -p "$NGINX_BACKUP" "$NGINX_CONFIG" >/dev/null 2>&1 || true; fi
    if test "$POOL_CHANGED" -eq 1; then
      if sudo test -f "$POOL_BACKUP"; then sudo cp -p "$POOL_BACKUP" "$POOL_PATH" >/dev/null 2>&1 || true; else sudo rm -f "$POOL_PATH" >/dev/null 2>&1 || true; fi
    fi
    if test "$MIGRATION_STARTED" -eq 1; then sudo -u awh-hub sqlite3 "$DB" ".restore '$BACKUP'" >/dev/null 2>&1 || true; fi
    rm -f "$REMOTE_STAGE"
  fi
  cleanup
  exit "$status"
}
trap rollback EXIT HUP INT TERM

sudo test -f "$BOOTSTRAP_HASH_FILE"
sudo awk 'BEGIN { if ((getline hash < ARGV[1]) != 1 || length(hash) != 64 || hash !~ /^[0-9a-fA-F]+$/) exit 30; }' "$BOOTSTRAP_HASH_FILE"
test -x "$PHP_FPM_BIN"

sudo install -d -m 0750 -o awh-hub -g awh-hub "$REMOTE_ROOT/enrollment-releases/$RELEASE_ID"
sudo tar -xzf "$REMOTE_STAGE" -C "$REMOTE_RELEASE"
sudo test -f "$REMOTE_RELEASE/hub/public/enrollment.php"
sudo test -f "$REMOTE_RELEASE/hub/bin/migrate-m3e2.php"
sudo test -f "$REMOTE_RELEASE/deploy/nginx/awh-enrollment.conf"
sudo test -f "$REMOTE_RELEASE/deploy/php-fpm/awh-enrollment.pool.conf"
sudo chown -R awh-hub:awh-hub "$REMOTE_RELEASE"
sudo chmod 0750 "$REMOTE_RELEASE" "$REMOTE_RELEASE/hub" "$REMOTE_RELEASE/hub/public" "$REMOTE_RELEASE/hub/src" "$REMOTE_RELEASE/hub/bin" "$REMOTE_RELEASE/hub/migrations"
sudo chmod 0640 "$REMOTE_RELEASE/hub/public/enrollment.php" "$REMOTE_RELEASE/hub/src/"*.php "$REMOTE_RELEASE/hub/bin/migrate-m3e2.php" "$REMOTE_RELEASE/hub/migrations/002_m3e2_enrollment_api.sql" "$REMOTE_RELEASE/deploy/nginx/awh-enrollment.conf" "$REMOTE_RELEASE/deploy/php-fpm/awh-enrollment.pool.conf"

sudo install -d -m 0700 -o awh-hub -g awh-hub /var/backups/awh-hub
sudo -u awh-hub sqlite3 "$DB" ".backup '$BACKUP'"
sudo test -s "$BACKUP"
test "$(sudo sqlite3 "$BACKUP" 'PRAGMA integrity_check;' | head -n 1)" = ok
test -z "$(sudo sqlite3 "$BACKUP" 'PRAGMA foreign_key_check;')"

MIGRATION_STARTED=1
FIRST=$(sudo -u awh-hub /usr/bin/php "$REMOTE_RELEASE/hub/bin/migrate-m3e2.php" "$DB")
SECOND=$(sudo -u awh-hub /usr/bin/php "$REMOTE_RELEASE/hub/bin/migrate-m3e2.php" "$DB")
printf '%s\n' "$FIRST" "$SECOND" | grep -q '"result":"applied"'
printf '%s\n' "$FIRST" "$SECOND" | grep -q '"result":"already-applied"'
test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;' | head -n 1)" = ok
test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;' | head -n 1)" = 3
test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='enrollment_rate_limits';")" = 1

sudo test ! -e "$NGINX_BACKUP"
sudo cp -p "$NGINX_CONFIG" "$NGINX_BACKUP"
NGINX_CHANGED=1
if sudo test -f "$POOL_PATH"; then sudo test ! -e "$POOL_BACKUP"; sudo cp -p "$POOL_PATH" "$POOL_BACKUP"; fi
POOL_CHANGED=1
sudo awk -v hash_file="$BOOTSTRAP_HASH_FILE" '
BEGIN {
  if ((getline hash < hash_file) != 1 || length(hash) != 64 || hash !~ /^[0-9a-fA-F]+$/) exit 30
}
{
  if ($0 ~ /REPLACE_WITH_SHA256_HASH_PROVISIONED_OUT_OF_BAND/) sub(/REPLACE_WITH_SHA256_HASH_PROVISIONED_OUT_OF_BAND/, hash)
  print
}
' "$REMOTE_RELEASE/deploy/php-fpm/awh-enrollment.pool.conf" | sudo tee "$POOL_TMP" >/dev/null
! sudo grep -q 'REPLACE_WITH_SHA256_HASH_PROVISIONED_OUT_OF_BAND' "$POOL_TMP"
sudo test -s "$POOL_TMP"
sudo grep -q '^\[awh-hub\]$' "$POOL_TMP"
sudo grep -Eq 'env\[AWH_ENROLLMENT_BOOTSTRAP_NONCE_HASH\][[:space:]]*=[[:space:]]*[0-9a-fA-F]{64}$' "$POOL_TMP"
sudo install -o root -g root -m 0640 "$POOL_TMP" "$POOL_PATH"

INCLUDE_LINE="    include $INCLUDE_PATH;"
if sudo grep -Fq "$INCLUDE_LINE" "$NGINX_CONFIG"; then
  :
elif sudo grep -q 'enrollment-current' "$NGINX_CONFIG"; then
  exit 31
else
  sudo awk -v include_line="$INCLUDE_LINE" '
  { line[NR] = $0 }
  END {
    if (line[NR] !~ /^[[:space:]]*}[[:space:]]*$/) exit 32
    for (i = 1; i < NR; i++) print line[i]
    print include_line
    print line[NR]
  }
  ' "$NGINX_CONFIG" > "$NGINX_TMP"
  sudo install -o root -g root -m 0644 "$NGINX_TMP" "$NGINX_CONFIG"
fi

sudo ln -sfn "$REMOTE_RELEASE" "$REMOTE_ROOT/enrollment-current"
SWITCHED=1
sudo "$PHP_FPM_BIN" -t >/dev/null
sudo nginx -t >/dev/null
sudo systemctl reload "php$PHP_VERSION-fpm"
sudo systemctl reload nginx
SERVICES_RELOADED=1

for path in /api/v1/health /api/v1/status /api/v1/projects /api/v1/projects/113b45c0-23e1-408d-ae0f-ac5eca7f6900/memory; do
  code=$(curl -k -sS --max-time 10 -o /dev/null -w '%{http_code}' "https://127.0.0.1$path" 2>/dev/null || printf 000)
  test "$code" = 401
done
code=$(curl -k -sS --max-time 10 -o /dev/null -w '%{http_code}' -X GET https://127.0.0.1/api/v1/enrollment/devices 2>/dev/null || printf 000)
test "$code" = 405

SUCCESS=1
rm -f "$REMOTE_STAGE"
cleanup
trap - EXIT HUP INT TERM
printf '%s\n' 'AWH enrollment deployment: PASS'
