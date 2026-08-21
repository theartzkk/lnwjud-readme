#!/bin/sh

# Remote phase for deploy-enrollment.sh. It is reached only after the local
# release guard and read-only preflight, and it receives fixed validated paths.
# It never prints credentials, bootstrap hashes, token hashes, or SQL rows.
set -eu
exec 2>/dev/null

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
NGINX_TMP=$(sudo mktemp /tmp/awh-enrollment-nginx.XXXXXX)
PREVIOUS_TARGET=$(sudo readlink -f "$REMOTE_ROOT/enrollment-current" 2>/dev/null || true)

BACKUP_CREATED=0
PERMISSIONS_CHANGED=0
MIGRATION_STARTED=0
SWITCHED=0
NGINX_CHANGED=0
POOL_CHANGED=0
POOL_EXISTED=0
SERVICE_USER_CREATED=0
SUCCESS=0
CURRENT_STAGE=BOOTSTRAP_HASH_VALIDATED

stage() {
  printf '%s\n' "DEPLOY_STAGE=$1"
}

cleanup() {
  sudo rm -f "$POOL_TMP" "$NGINX_TMP" >/dev/null 2>&1 || true
}

run_m3d_health() {
  for path in /api/v1/health /api/v1/status /api/v1/projects /api/v1/projects/113b45c0-23e1-408d-ae0f-ac5eca7f6900/memory; do
    code=$(curl -k -sS --max-time 10 -o /dev/null -w '%{http_code}' "https://127.0.0.1$path" -H 'Host: awh.invalid' 2>/dev/null || printf 000)
    test "$code" = 401 || return 1
  done
}

rollback() {
  status=$?
  if test "$SUCCESS" -eq 0; then
    rollback_ok=1

    # Restore the verified SQLite backup before restoring its metadata.
    if test "$MIGRATION_STARTED" -eq 1; then
      if ! sudo sqlite3 "$BACKUP" 'PRAGMA integrity_check;' >/dev/null 2>&1; then rollback_ok=0; fi
      if ! sudo sqlite3 "$BACKUP" 'PRAGMA foreign_key_check;' >/dev/null 2>&1; then rollback_ok=0; fi
      if ! sudo sqlite3 "$DB" ".restore '$BACKUP'" >/dev/null 2>&1; then rollback_ok=0; fi
    fi

    # Restore exact numeric owner/group/mode captured before provisioning.
    if test "$PERMISSIONS_CHANGED" -eq 1; then
      if ! sudo chown "$DB_UID:$DB_GID" "$DB" >/dev/null 2>&1; then rollback_ok=0; fi
      if ! sudo chmod "$DB_MODE" "$DB" >/dev/null 2>&1; then rollback_ok=0; fi
      if ! sudo chown "$PARENT_UID:$PARENT_GID" "$DB_PARENT" >/dev/null 2>&1; then rollback_ok=0; fi
      if ! sudo chmod "$PARENT_MODE" "$DB_PARENT" >/dev/null 2>&1; then rollback_ok=0; fi
    fi

    # Restore release pointer, Nginx, then PHP-FPM configuration.
    if test "$SWITCHED" -eq 1; then
      if test -n "$PREVIOUS_TARGET"; then
        if ! sudo ln -sfn "$PREVIOUS_TARGET" "$REMOTE_ROOT/enrollment-current"; then rollback_ok=0; fi
      elif ! sudo rm -f "$REMOTE_ROOT/enrollment-current"; then
        rollback_ok=0
      fi
    fi
    if test "$NGINX_CHANGED" -eq 1; then
      if ! sudo cp -p "$NGINX_BACKUP" "$NGINX_CONFIG"; then rollback_ok=0; fi
    fi
    if test "$POOL_CHANGED" -eq 1; then
      if test "$POOL_EXISTED" -eq 1; then
        if ! sudo cp -p "$POOL_BACKUP" "$POOL_PATH"; then rollback_ok=0; fi
      elif ! sudo rm -f "$POOL_PATH"; then
        rollback_ok=0
      fi
    fi

    # Validate restored files before any service reload. If no service/config
    # mutation happened, no reload is needed.
    if test "$POOL_CHANGED" -eq 1 || test "$NGINX_CHANGED" -eq 1 || test "$SWITCHED" -eq 1; then
      if ! sudo "$PHP_FPM_BIN" -t >/dev/null 2>&1; then rollback_ok=0; fi
      if ! sudo nginx -t >/dev/null 2>&1; then rollback_ok=0; fi
      if test "$rollback_ok" -eq 1; then
        if ! sudo systemctl reload "php$PHP_VERSION-fpm"; then rollback_ok=0; fi
        if test "$rollback_ok" -eq 1 && ! sudo systemctl reload nginx; then rollback_ok=0; fi
        if test "$rollback_ok" -eq 1 && ! run_m3d_health; then rollback_ok=0; fi
      fi
    fi
    if test "$SERVICE_USER_CREATED" -eq 1; then
      if ! sudo rm -rf "$REMOTE_RELEASE"; then rollback_ok=0; fi
      # userdel does not accept useradd's --system flag on Debian/Ubuntu.
      if ! sudo /usr/sbin/userdel awh-hub; then rollback_ok=0; fi
      if id -u awh-hub >/dev/null 2>&1; then rollback_ok=0; fi
    fi
    if test "$rollback_ok" -eq 1; then
      printf '%s\n' "DEPLOY_FAILED_AT=$CURRENT_STAGE"
      printf '%s\n' 'ROLLBACK=PASS'
    else
      printf '%s\n' "DEPLOY_FAILED_AT=$CURRENT_STAGE"
      printf '%s\n' 'ROLLBACK=FAIL'
      status=1
    fi
    sudo rm -f "$REMOTE_STAGE" >/dev/null 2>&1 || true
  fi
  cleanup
  trap - EXIT HUP INT TERM
  if test "$status" -eq 0; then status=1; fi
  exit "$status"
}
trap rollback EXIT HUP INT TERM

sudo test -f "$BOOTSTRAP_HASH_FILE"
sudo awk 'BEGIN { if ((getline hash < ARGV[1]) != 1 || length(hash) != 64 || hash !~ /^[0-9a-fA-F]+$/) exit 30; }' "$BOOTSTRAP_HASH_FILE"
CURRENT_STAGE=BOOTSTRAP_HASH_VALIDATED
stage "$CURRENT_STAGE"
test -x "$PHP_FPM_BIN"
sudo test -f "$DB"

# The live M3D host may not have the future enrollment service account yet.
# Create it only inside this approval-gated deployment phase; preflight never
# performs this mutation.
if ! id -u awh-hub >/dev/null 2>&1; then
  sudo /usr/sbin/useradd --system --user-group --home-dir "$REMOTE_ROOT" --no-create-home --shell /usr/sbin/nologin awh-hub
  SERVICE_USER_CREATED=1
fi
CURRENT_STAGE=SERVICE_USER_READY
stage "$CURRENT_STAGE"

# Capture the exact metadata before the first permission mutation.
DB_UID=$(sudo stat -c '%u' "$DB")
DB_GID=$(sudo stat -c '%g' "$DB")
DB_MODE=$(sudo stat -c '%a' "$DB")
DB_OWNER=$(sudo stat -c '%U' "$DB")
DB_GROUP=$(sudo stat -c '%G' "$DB")
DB_PARENT=$(dirname "$DB")
PARENT_UID=$(sudo stat -c '%u' "$DB_PARENT")
PARENT_GID=$(sudo stat -c '%g' "$DB_PARENT")
PARENT_MODE=$(sudo stat -c '%a' "$DB_PARENT")
PARENT_OWNER=$(sudo stat -c '%U' "$DB_PARENT")
PARENT_GROUP=$(sudo stat -c '%G' "$DB_PARENT")

# Preserve www-data read access and reject any existing broad group-write mode.
test "$DB_GROUP" = www-data
test "$PARENT_GROUP" = www-data
test $((0$DB_MODE & 0020)) -eq 0
test $((0$PARENT_MODE & 0020)) -eq 0
test $((0$DB_MODE & 0600)) -eq $((0600))
test $((0$PARENT_MODE & 0700)) -eq $((0700))

sudo install -d -m 0750 -o root -g awh-hub /var/backups/awh-hub
sudo sqlite3 "$DB" ".backup '$BACKUP'"
sudo test -s "$BACKUP"
sudo chown root:root "$BACKUP"
sudo chmod 0600 "$BACKUP"
BACKUP_CREATED=1
test "$(sudo sqlite3 "$BACKUP" 'PRAGMA integrity_check;' | head -n 1)" = ok
test -z "$(sudo sqlite3 "$BACKUP" 'PRAGMA foreign_key_check;')"
CURRENT_STAGE=BACKUP_VERIFIED
stage "$CURRENT_STAGE"

# Minimum bounded write provision: the service owns the DB and its directory,
# while the existing www-data group keeps read/traverse access only.
if test "$DB_OWNER" != awh-hub || test "$PARENT_OWNER" != awh-hub; then
  sudo chown awh-hub:"$DB_GROUP" "$DB"
  sudo chmod "$DB_MODE" "$DB"
  sudo chown awh-hub:"$PARENT_GROUP" "$DB_PARENT"
  sudo chmod "$PARENT_MODE" "$DB_PARENT"
  PERMISSIONS_CHANGED=1
fi
sudo -n -u awh-hub test -w "$DB"
sudo -n -u awh-hub test -w "$DB_PARENT"
CURRENT_STAGE=DB_WRITE_READY
stage "$CURRENT_STAGE"

sudo install -d -m 0750 -o awh-hub -g awh-hub "$REMOTE_ROOT/enrollment-releases/$RELEASE_ID"
sudo tar -xzf "$REMOTE_STAGE" -C "$REMOTE_RELEASE"
sudo test -f "$REMOTE_RELEASE/hub/public/enrollment.php"
sudo test -f "$REMOTE_RELEASE/hub/bin/migrate-m3e2.php"
sudo test -f "$REMOTE_RELEASE/deploy/nginx/awh-enrollment.conf"
sudo test -f "$REMOTE_RELEASE/deploy/awh-enrollment/insert-nginx-include.php"
sudo test -f "$REMOTE_RELEASE/deploy/php-fpm/awh-enrollment.pool.conf"
sudo chown -R awh-hub:awh-hub "$REMOTE_RELEASE"
sudo chmod 0750 "$REMOTE_RELEASE" "$REMOTE_RELEASE/hub" "$REMOTE_RELEASE/hub/public" "$REMOTE_RELEASE/hub/src" "$REMOTE_RELEASE/hub/bin" "$REMOTE_RELEASE/hub/migrations" "$REMOTE_RELEASE/deploy" "$REMOTE_RELEASE/deploy/awh-enrollment"
sudo chmod 0640 "$REMOTE_RELEASE/hub/public/enrollment.php" "$REMOTE_RELEASE/hub/src/"*.php "$REMOTE_RELEASE/hub/bin/migrate-m3e2.php" "$REMOTE_RELEASE/hub/migrations/002_m3e2_enrollment_api.sql" "$REMOTE_RELEASE/deploy/nginx/awh-enrollment.conf" "$REMOTE_RELEASE/deploy/awh-enrollment/insert-nginx-include.php" "$REMOTE_RELEASE/deploy/php-fpm/awh-enrollment.pool.conf"
CURRENT_STAGE=RELEASE_STAGED
stage "$CURRENT_STAGE"

MIGRATION_STARTED=1
FIRST=$(sudo -u awh-hub /usr/bin/php "$REMOTE_RELEASE/hub/bin/migrate-m3e2.php" "$DB")
SECOND=$(sudo -u awh-hub /usr/bin/php "$REMOTE_RELEASE/hub/bin/migrate-m3e2.php" "$DB")
printf '%s\n' "$FIRST" "$SECOND" | grep -q '"result":"applied"'
CURRENT_STAGE=MIGRATION_FIRST_PASS
stage "$CURRENT_STAGE"
printf '%s\n' "$FIRST" "$SECOND" | grep -q '"result":"already-applied"'
CURRENT_STAGE=MIGRATION_IDEMPOTENT
stage "$CURRENT_STAGE"
test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;' | head -n 1)" = ok
test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;' | head -n 1)" = 3
test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='enrollment_rate_limits';")" = 1

sudo test ! -e "$NGINX_BACKUP"
sudo cp -p "$NGINX_CONFIG" "$NGINX_BACKUP"
NGINX_CHANGED=1
if sudo test -f "$POOL_PATH"; then
  sudo test ! -e "$POOL_BACKUP"
  sudo cp -p "$POOL_PATH" "$POOL_BACKUP"
  POOL_EXISTED=1
fi
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
CURRENT_STAGE=FPM_CONFIGURED
stage "$CURRENT_STAGE"

# The release pointer exists before Nginx sees the reviewed include target.
sudo ln -sfn "$REMOTE_RELEASE" "$REMOTE_ROOT/enrollment-current"
SWITCHED=1
sudo /usr/bin/php "$REMOTE_RELEASE/deploy/awh-enrollment/insert-nginx-include.php" "$NGINX_CONFIG" "$NGINX_TMP" "$INCLUDE_PATH"
sudo install -o root -g root -m 0644 "$NGINX_TMP" "$NGINX_CONFIG"
CURRENT_STAGE=NGINX_CONFIGURED
stage "$CURRENT_STAGE"

sudo "$PHP_FPM_BIN" -t >/dev/null
sudo nginx -t >/dev/null
sudo systemctl reload "php$PHP_VERSION-fpm"
sudo systemctl reload nginx
CURRENT_STAGE=SERVICE_RELOAD
stage "$CURRENT_STAGE"

run_m3d_health
CURRENT_STAGE=M3D_REGRESSION
stage "$CURRENT_STAGE"
code=$(curl -k -sS --max-time 10 -o /dev/null -w '%{http_code}' -X GET https://127.0.0.1/api/v1/enrollment/devices -H 'Host: awh.invalid' 2>/dev/null || printf 000)
test "$code" = 405
CURRENT_STAGE=ENROLLMENT_ROUTE
stage "$CURRENT_STAGE"

SUCCESS=1
sudo rm -f "$REMOTE_STAGE"
cleanup
trap - EXIT HUP INT TERM
printf '%s\n' 'DEPLOY_RESULT=PASS'
