#!/bin/sh

# Fixed-argument remote owner-auth activation. It prints allowlisted stage/result lines
# only. Raw stderr and all secret-bearing diagnostics are intentionally hidden.
set -eu
exec 2>/dev/null
DB=$1; REMOTE_ROOT=$2; REMOTE_STAGE=$3; RELEASE=$4; RELEASE_ID=$5; NGINX_CONFIG=$6; HOSTNAME=$7; AWH_FPM_SOCKET=$8; AWH_FPM_SERVICE=$9; CLEANUP_TOPOLOGY=${10}; OWNER_USERNAME=${11}; OWNER_AUTH_ENABLED=${12}; REMOTE_SCRIPT=${13}; COMPAT_REFRESH=${14}
case "$DB" in /var/lib/awh-hub/*|/opt/awh-hub/*|/srv/awh/*) ;; *) exit 20 ;; esac
case "$REMOTE_ROOT" in /opt/awh-hub) ;; *) exit 20 ;; esac
case "$REMOTE_STAGE" in /tmp/awh-control-plane-*.tar.gz) ;; *) exit 20 ;; esac
case "$RELEASE" in /opt/awh-hub/control-releases/*) ;; *) exit 20 ;; esac
case "$RELEASE_ID" in m4-[0-9a-fA-F]*) ;; *) exit 20 ;; esac
case "$NGINX_CONFIG" in /etc/nginx/sites-enabled/*) ;; *) exit 20 ;; esac
case "$HOSTNAME" in ''|*[!A-Za-z0-9.-]*|.*|*.) exit 20 ;; esac
printf '%s' "$AWH_FPM_SOCKET" | grep -Eq '^/run/php/php[0-9]+\.[0-9]+-fpm-awh\.sock$' || exit 20
printf '%s' "$AWH_FPM_SERVICE" | grep -Eq '^php[0-9]+\.[0-9]+-fpm\.service$' || exit 20
case "$CLEANUP_TOPOLOGY" in 0|1) ;; *) exit 20 ;; esac
case "$OWNER_USERNAME" in [A-Za-z][A-Za-z0-9._-][A-Za-z0-9._-]* ) ;; *) exit 20 ;; esac
test "${#OWNER_USERNAME}" -ge 3 && test "${#OWNER_USERNAME}" -le 64 || exit 20
case "$OWNER_AUTH_ENABLED" in 1) ;; *) exit 20 ;; esac
case "$REMOTE_SCRIPT" in /tmp/awh-control-plane-*.sh) ;; *) exit 20 ;; esac
case "$COMPAT_REFRESH" in 0|1) ;; *) exit 20 ;; esac

IFS= read -r OWNER_PASSWORD || exit 20
case "$OWNER_PASSWORD" in ''|*[!A-Za-z0-9._~-]*) exit 20 ;; esac

BACKUP=/var/backups/awh-hub/awh.sqlite.pre-$RELEASE_ID
POINTER=$REMOTE_ROOT/control-plane-current
POINTER_TMP=$REMOTE_ROOT/.control-plane-current-$RELEASE_ID
CONFIG_BACKUP_ROOT=/var/backups/awh-hub/config
NGINX_BACKUP=$CONFIG_BACKUP_ROOT/nginx/awh-preview.conf.m4-$RELEASE_ID
NGINX_CANDIDATE=/tmp/awh-control-nginx-$RELEASE_ID.conf
WEB_RELEASE=/var/www/awh-web/releases/$RELEASE_ID
WEB_POINTER=/var/www/awh-web/current
WEB_POINTER_TMP=/var/www/awh-web/.current-$RELEASE_ID
RELEASE_CREATED=0; WEB_CREATED=0; DB_MUTATED=0; POINTER_CHANGED=0; WEB_POINTER_CHANGED=0; NGINX_CHANGED=0; NGINX_BACKUP_CREATED=0; TOPOLOGY_ARCHIVED=0; TOPOLOGY_CLEANED=0; SUCCESS=0; CURRENT_STAGE=PREPARE
TOPOLOGY_ARCHIVE=/var/backups/awh-hub/topology-cleanup-$RELEASE_ID
TOPOLOGY_HELPER=/opt/awh-hub/enrollment-current/deploy/awh-enrollment/insert-nginx-include.php
ENROLLMENT_INCLUDE=/opt/awh-hub/enrollment-current/deploy/nginx/awh-enrollment.conf
OWNER_AUTH_SETUP=
OWNER_AUTH_RUNTIME=
OWNER_AUTH_TRANSFORM=
OWNER_AUTH_COOKIE_JAR=
OWNER_AUTH_COOKIE_HEADERS=
OWNER_AUTH_SURFACE_HEADERS=
OWNER_AUTH_SURFACE_BODY=
CONTROL_ORIGIN_RENDER=
CONTROL_INCLUDE_TMP=

cleanup_owner_auth_cookie_files() {
  test -z "$OWNER_AUTH_COOKIE_JAR" || rm -f "$OWNER_AUTH_COOKIE_JAR"
  test -z "$OWNER_AUTH_COOKIE_HEADERS" || rm -f "$OWNER_AUTH_COOKIE_HEADERS"
  OWNER_AUTH_COOKIE_JAR=
  OWNER_AUTH_COOKIE_HEADERS=
  test -z "$OWNER_AUTH_SURFACE_HEADERS" || rm -f "$OWNER_AUTH_SURFACE_HEADERS"
  OWNER_AUTH_SURFACE_HEADERS=
  test -z "$OWNER_AUTH_SURFACE_BODY" || rm -f "$OWNER_AUTH_SURFACE_BODY"
  OWNER_AUTH_SURFACE_BODY=
}

stage() { printf '%s\n' "DEPLOY_STAGE=$1"; CURRENT_STAGE=$1; }
reload_awh_php_fpm() { sudo systemctl reload "$AWH_FPM_SERVICE"; sudo systemctl is-active --quiet "$AWH_FPM_SERVICE"; }
verify_nginx_topology_clean() {
  TOPOLOGY_CHECK=$(sudo nginx -T 2>&1 || true)
  test -n "$TOPOLOGY_CHECK"
  ! printf '%s\n' "$TOPOLOGY_CHECK" | grep -q 'conflicting server name'
  ! printf '%s\n' "$TOPOLOGY_CHECK" | grep -Eq '^# configuration file /etc/nginx/(sites-enabled|conf\.d)/.*\.(m4|pre-m3e2)-'
  TOPOLOGY_TMP=$(sudo mktemp /tmp/awh-topology-check.XXXXXX)
  if sudo test -f "$TOPOLOGY_HELPER"; then
    sudo /usr/bin/php "$TOPOLOGY_HELPER" "$NGINX_CONFIG" "$TOPOLOGY_TMP" "$ENROLLMENT_INCLUDE" >/dev/null
  fi
  sudo rm -f "$TOPOLOGY_TMP"
}
cleanup_loaded_topology() {
  test "$CLEANUP_TOPOLOGY" = 1 || return 0
  stage TOPOLOGY_CLEANUP_ARCHIVE
  TOPOLOGY_RESIDUES=$(sudo find /etc/nginx/sites-enabled -maxdepth 1 -type f \( -name 'awh-preview.conf.m4-*' -o -name 'awh-preview.conf.pre-m3e2-*' \) -print | sort)
  if test -n "$TOPOLOGY_RESIDUES"; then
    sudo install -d -m 0750 -o root -g root "$TOPOLOGY_ARCHIVE"
    TOPOLOGY_ARCHIVED=1
    while IFS= read -r RESIDUE; do
      test -n "$RESIDUE"
      sudo grep -q 'AWH_HUB_DB_PATH' "$RESIDUE"
      sudo grep -q 'web-gateway.php' "$RESIDUE"
      RESIDUE_NAME=$(basename "$RESIDUE")
      sudo cp -p "$RESIDUE" "$TOPOLOGY_ARCHIVE/$RESIDUE_NAME"
      sudo chown root:root "$TOPOLOGY_ARCHIVE/$RESIDUE_NAME"
      sudo chmod 0600 "$TOPOLOGY_ARCHIVE/$RESIDUE_NAME"
      sudo cmp -s "$RESIDUE" "$TOPOLOGY_ARCHIVE/$RESIDUE_NAME"
      sudo rm -f "$RESIDUE"
    done <<EOF_RESIDUES
$TOPOLOGY_RESIDUES
EOF_RESIDUES
  fi
  stage TOPOLOGY_CLEANUP_VERIFY
  verify_nginx_topology_clean
  TOPOLOGY_CLEANED=1
}
verify_m3d() { for path in /api/v1/health /api/v1/status /api/v1/projects; do code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME$path" 2>/dev/null || printf 000); test "$code" = 401 || return 1; done; }
verify_m3e_after_m4() { code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -H 'Content-Type: application/json' -H 'Authorization: Bearer invalid-regression-token' -d '{"schemaVersion":1,"projectIds":[],"ttlSeconds":600}' -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/enrollment/pairing-codes" 2>/dev/null || printf 000); test "$code" = 401; }
verify_owner_auth_effective_config() { if ! EFFECTIVE_NGINX=$(sudo nginx -T 2>&1); then return 1; fi; test -n "$EFFECTIVE_NGINX"; printf '%s\n' "$EFFECTIVE_NGINX" | grep -q 'location = /api/v1/auth/login {'; printf '%s\n' "$EFFECTIVE_NGINX" | grep -q 'location = /api/v1/auth/session {'; printf '%s\n' "$EFFECTIVE_NGINX" | grep -q "fastcgi_param AWH_CONTROL_ORIGIN https://${HOSTNAME};"; printf '%s\n' "$EFFECTIVE_NGINX" | grep -q "fastcgi_pass unix:${AWH_FPM_SOCKET};"; }
verify_owner_auth_surface() {
  OWNER_AUTH_SURFACE_HEADERS=$(mktemp /tmp/awh-owner-auth-surface-headers.XXXXXX)
  OWNER_AUTH_SURFACE_BODY=$(mktemp /tmp/awh-owner-auth-surface-body.XXXXXX)
  surface_attempt=1
  while test "$surface_attempt" -le 10; do
    surface_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -H "Origin: https://$HOSTNAME" -D "$OWNER_AUTH_SURFACE_HEADERS" -o "$OWNER_AUTH_SURFACE_BODY" -w '%{http_code}' "https://$HOSTNAME/api/v1/auth/login" 2>/dev/null || printf 000)
    if test "$surface_code" = 405 && ! grep -qi '^www-authenticate: Basic ' "$OWNER_AUTH_SURFACE_HEADERS" && grep -q '"code":"METHOD_NOT_ALLOWED"' "$OWNER_AUTH_SURFACE_BODY"; then
      printf '%s\n' "DEPLOY_DIAGNOSTIC=OWNER_AUTH_SURFACE_HTTP_${surface_code}"
      printf '%s\n' "DEPLOY_DIAGNOSTIC=OWNER_AUTH_SURFACE_ATTEMPTS_${surface_attempt}"
      rm -f "$OWNER_AUTH_SURFACE_HEADERS" "$OWNER_AUTH_SURFACE_BODY"
      OWNER_AUTH_SURFACE_HEADERS=
      OWNER_AUTH_SURFACE_BODY=
      return 0
    fi
    surface_attempt=$((surface_attempt + 1))
    test "$surface_attempt" -le 10 && sleep 1
  done
  printf '%s\n' "DEPLOY_DIAGNOSTIC=OWNER_AUTH_SURFACE_HTTP_${surface_code}"
  printf '%s\n' 'DEPLOY_DIAGNOSTIC=OWNER_AUTH_SURFACE_ATTEMPTS_10'
  if grep -qi '^www-authenticate: Basic ' "$OWNER_AUTH_SURFACE_HEADERS"; then printf '%s\n' 'DEPLOY_DIAGNOSTIC=OWNER_AUTH_SURFACE_BASIC_CHALLENGE'; return 1; fi
  return 1
}
verify_owner_auth_login() {
  OWNER_AUTH_COOKIE_JAR=$(mktemp /tmp/awh-owner-auth-cookie.XXXXXX)
  OWNER_AUTH_COOKIE_HEADERS=$(mktemp /tmp/awh-owner-auth-headers.XXXXXX)
  code=$(printf '{"schemaVersion":1,"username":"%s","password":"%s","remember":false}\n' "$OWNER_USERNAME" "$OWNER_PASSWORD" | curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -H 'Content-Type: application/json' -H "Origin: https://$HOSTNAME" -c "$OWNER_AUTH_COOKIE_JAR" -D "$OWNER_AUTH_COOKIE_HEADERS" --data-binary @- -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/auth/login" 2>/dev/null || printf 000)
  printf '%s\n' "DEPLOY_DIAGNOSTIC=OWNER_AUTH_LOGIN_HTTP_${code}"
  if grep -qi '^www-authenticate: Basic ' "$OWNER_AUTH_COOKIE_HEADERS"; then printf '%s\n' 'DEPLOY_DIAGNOSTIC=OWNER_AUTH_LOGIN_BASIC_CHALLENGE'; return 1; fi
  test "$code" = 200
  grep -qi '^set-cookie: __Host-awh_control_session=.*; Path=/; Secure; HttpOnly; SameSite=Strict;' "$OWNER_AUTH_COOKIE_HEADERS"
  grep -qi '^set-cookie: awh_csrf=.*; Path=/; Secure; SameSite=Strict;' "$OWNER_AUTH_COOKIE_HEADERS"
  grep -q '__Host-awh_control_session' "$OWNER_AUTH_COOKIE_JAR"
  grep -q 'awh_csrf' "$OWNER_AUTH_COOKIE_JAR"
  OWNER_PASSWORD=
}
verify_web_access() { sudo -n -u www-data test -x /var; sudo -n -u www-data test -x /var/www; sudo -n -u www-data test -x /var/www/awh-web; sudo -n -u www-data test -x /var/www/awh-web/releases; sudo -n -u www-data test -x "$WEB_RELEASE"; sudo -n -u www-data test -r "$WEB_RELEASE/index.html"; sudo grep -q '"mode": "CONTROL"' "$WEB_RELEASE/web-config.json"; sudo grep -q '"mode": "CONTROL"' "$WEB_RELEASE/data.json"; ! sudo grep -q 'Remote Preview\|Preview only\|static build' "$WEB_RELEASE/data.json"; sudo grep -q "awh-shell-$RELEASE_ID" "$WEB_RELEASE/sw.js"; }
pointer_capture() { PREVIOUS_POINTER=ABSENT; PREVIOUS_TARGET=; if test -L "$POINTER"; then PREVIOUS_TARGET=$(readlink "$POINTER"); case "$PREVIOUS_TARGET" in /opt/awh-hub/control-releases/*) test -d "$PREVIOUS_TARGET" || return 1 ;; *) return 1 ;; esac; PREVIOUS_POINTER=PRESENT; elif test -e "$POINTER"; then return 1; fi; }
pointer_restore() { if test "$PREVIOUS_POINTER" = ABSENT; then sudo rm -f "$POINTER"; test ! -e "$POINTER" && test ! -L "$POINTER"; else sudo rm -f "$POINTER"; sudo ln -s "$PREVIOUS_TARGET" "$POINTER"; test "$(readlink "$POINTER")" = "$PREVIOUS_TARGET"; fi; }
web_pointer_capture() { WEB_PREVIOUS=ABSENT; WEB_TARGET=; if test -L "$WEB_POINTER"; then WEB_TARGET=$(readlink "$WEB_POINTER"); case "$WEB_TARGET" in /var/www/awh-web/releases/*) test -d "$WEB_TARGET" || return 1 ;; *) return 1 ;; esac; WEB_PREVIOUS=PRESENT; elif test -e "$WEB_POINTER"; then return 1; fi; }
web_pointer_restore() { if test "$WEB_PREVIOUS" = ABSENT; then sudo rm -f "$WEB_POINTER"; test ! -e "$WEB_POINTER" && test ! -L "$WEB_POINTER"; else sudo rm -f "$WEB_POINTER"; sudo ln -s "$WEB_TARGET" "$WEB_POINTER"; test "$(readlink "$WEB_POINTER")" = "$WEB_TARGET"; fi; }
rollback() {
  status=$?
  if test "$SUCCESS" -eq 0; then
    ok=1
    if test "$DB_MUTATED" -eq 1; then
      sudo sqlite3 "$BACKUP" 'PRAGMA integrity_check;' >/dev/null || ok=0
      sudo sqlite3 "$BACKUP" 'PRAGMA foreign_key_check;' >/dev/null || ok=0
      sudo sqlite3 "$DB" ".restore '$BACKUP'" >/dev/null || ok=0
    fi
    if test "$POINTER_CHANGED" -eq 1; then pointer_restore || ok=0; fi
    if test "$WEB_POINTER_CHANGED" -eq 1; then web_pointer_restore || ok=0; fi
    if test "$NGINX_CHANGED" -eq 1; then sudo cp -p "$NGINX_BACKUP" "$NGINX_CONFIG" || ok=0; fi
    if test "$TOPOLOGY_ARCHIVED" -eq 1; then
      for archived in $(sudo find "$TOPOLOGY_ARCHIVE" -maxdepth 1 -type f -print 2>/dev/null | sort); do
        sudo cp -p "$archived" "/etc/nginx/sites-enabled/$(basename "$archived")" || ok=0
      done
    fi
    if test "$NGINX_CHANGED" -eq 1 || test "$POINTER_CHANGED" -eq 1 || test "$TOPOLOGY_ARCHIVED" -eq 1; then
      sudo nginx -t >/dev/null || ok=0
    fi
    if test "$ok" -eq 1 && test "$POINTER_CHANGED" -eq 1; then reload_awh_php_fpm || ok=0; fi
    if test "$ok" -eq 1 && { test "$NGINX_CHANGED" -eq 1 || test "$TOPOLOGY_ARCHIVED" -eq 1; }; then sudo systemctl reload nginx || ok=0; fi
    if test "$ok" -eq 1; then verify_m3d || ok=0; fi
    sudo rm -rf "$RELEASE" "$WEB_RELEASE" >/dev/null 2>&1 || true
    sudo rm -f "$REMOTE_STAGE" "$POINTER_TMP" "$WEB_POINTER_TMP" "$NGINX_CANDIDATE" "$REMOTE_SCRIPT" "$CONTROL_INCLUDE_TMP" >/dev/null 2>&1 || true
    if test "$NGINX_BACKUP_CREATED" -eq 1; then sudo rm -f "$NGINX_BACKUP" || ok=0; fi
    if test "$TOPOLOGY_ARCHIVED" -eq 1; then sudo rm -rf "$TOPOLOGY_ARCHIVE" || ok=0; fi
    cleanup_owner_auth_cookie_files
    printf '%s\n' "DEPLOY_FAILED_AT=$CURRENT_STAGE"
    printf '%s\n' "ROLLBACK=$([ "$ok" -eq 1 ] && echo PASS || echo FAIL)"
  fi
  if test "$status" -eq 0; then status=1; fi
  exit "$status"
}
trap rollback EXIT HUP INT TERM

sudo test -f "$DB"; sudo test -f "$REMOTE_STAGE"; pointer_capture; cleanup_loaded_topology; stage PREMUTATION_READY
sudo install -d -o root -g root -m 0750 /var/backups/awh-hub
sudo sqlite3 "$DB" ".backup '$BACKUP'"; sudo chown root:root "$BACKUP"; sudo chmod 0600 "$BACKUP"; test "$(sudo sqlite3 "$BACKUP" 'PRAGMA integrity_check;')" = ok; test -z "$(sudo sqlite3 "$BACKUP" 'PRAGMA foreign_key_check;')"; sudo install -d -m 0750 -o root -g root "$CONFIG_BACKUP_ROOT/nginx"; sudo test ! -e "$NGINX_BACKUP"; sudo cp -p "$NGINX_CONFIG" "$NGINX_BACKUP"; sudo chown root:root "$NGINX_BACKUP"; sudo chmod 0600 "$NGINX_BACKUP"; sudo cmp -s "$NGINX_CONFIG" "$NGINX_BACKUP"; NGINX_BACKUP_CREATED=1; stage BACKUP_VERIFIED
if sudo test -e "$RELEASE" || sudo test -L "$RELEASE"; then exit 20; fi
sudo install -d -o awh-hub -g awh-hub -m 0750 "$RELEASE"; RELEASE_CREATED=1; sudo tar -xzf "$REMOTE_STAGE" -C "$RELEASE"; sudo chown -R awh-hub:awh-hub "$RELEASE"; sudo test -f "$RELEASE/hub/public/control-plane.php"; sudo test -f "$RELEASE/hub/bin/migrate-m4.php"; sudo -u awh-hub test -r "$RELEASE/hub/src/HubControlPlaneService.php"; stage RELEASE_STAGED
OWNER_AUTH_SETUP=$RELEASE/hub/bin/setup-owner-auth.php; OWNER_AUTH_RUNTIME=$RELEASE/hub/bin/verify-owner-auth-runtime.php; OWNER_AUTH_TRANSFORM=$RELEASE/deploy/nginx/transform-owner-auth.php; CONTROL_ORIGIN_RENDER=$RELEASE/deploy/nginx/render-control-plane-include.php; CONTROL_INCLUDE=$RELEASE/deploy/nginx/awh-control-plane.conf; CONTROL_INCLUDE_TMP=/tmp/awh-control-include-$RELEASE_ID.conf
stage CONTROL_ORIGIN_RENDER; sudo /usr/bin/php "$CONTROL_ORIGIN_RENDER" "$CONTROL_INCLUDE" "$CONTROL_INCLUDE_TMP" "$HOSTNAME" "$AWH_FPM_SOCKET" >/dev/null; sudo test -s "$CONTROL_INCLUDE_TMP"; sudo install -o awh-hub -g awh-hub -m 0644 "$CONTROL_INCLUDE_TMP" "$CONTROL_INCLUDE"; sudo rm -f "$CONTROL_INCLUDE_TMP"; CONTROL_INCLUDE_TMP=
stage NGINX_CUTOVER_PREPARE; sudo /usr/bin/php "$OWNER_AUTH_TRANSFORM" "$NGINX_CONFIG" "$NGINX_CANDIDATE" "$HOSTNAME" "$AWH_FPM_SOCKET" >/dev/null; sudo test -s "$NGINX_CANDIDATE"; sudo chown root:root "$NGINX_CANDIDATE"; sudo chmod 0644 "$NGINX_CANDIDATE"
if test "$COMPAT_REFRESH" = 1; then
  # A v5 compatibility refresh is code/pointer-only. It proves the existing
  # M4/M5 capability records and owner binding without replaying migrations,
  # seeding projects, or replacing the owner's credential.
  stage OWNER_AUTH_COMPATIBILITY
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 5
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm4-control-plane' AND schema_version = 4;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm5-owner-auth' AND schema_version = 5;")" = 1
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
  test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  stage OWNER_AUTH_RUNTIME; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$OWNER_AUTH_RUNTIME" >/dev/null
  # The compatibility refresh validates the canonical existing owner binding,
  # rather than assuming that the owner still uses the installation default
  # username.  The supplied username is used only by the live golden-login
  # verifier and may be changed deliberately through Control Panel security.
  test "$(sudo sqlite3 "$DB" 'SELECT count(*) FROM owner_bootstrap b JOIN owner_passwords p ON p.user_id = b.owner_user_id WHERE b.singleton_id = 1 AND b.bootstrap_closed = 1 AND p.enabled = 1 AND length(p.password_hash) > 20;')" = 1
  test "$(sudo sqlite3 "$DB" 'SELECT count(*) FROM owner_passwords;')" = 1
  stage PROJECTS_READY
else
  DB_MUTATED=1; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$RELEASE/hub/bin/migrate-m4.php" "$DB" "$RELEASE/hub/migrations/003_m4_control_plane.sql" >/dev/null; stage MIGRATION_FIRST_PASS
  sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$RELEASE/hub/bin/migrate-m4.php" "$DB" "$RELEASE/hub/migrations/003_m4_control_plane.sql" >/dev/null; stage MIGRATION_IDEMPOTENT
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 4
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm4-control-plane';")" = 1
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
  test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  stage MIGRATION_VERIFIED
  sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$RELEASE/hub/bin/migrate-owner-auth.php" "$DB" "$RELEASE/hub/migrations/004_owner_auth.sql" >/dev/null; stage OWNER_AUTH_MIGRATION_FIRST
  sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$RELEASE/hub/bin/migrate-owner-auth.php" "$DB" "$RELEASE/hub/migrations/004_owner_auth.sql" >/dev/null; stage OWNER_AUTH_MIGRATION_IDEMPOTENT
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 5
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm5-owner-auth';")" = 1
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
  test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  stage OWNER_AUTH_VERIFIED
  stage OWNER_AUTH_RUNTIME; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$OWNER_AUTH_RUNTIME" >/dev/null
  stage OWNER_AUTH_PROVISION; printf '%s\n' "$OWNER_PASSWORD" | sudo -n -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$OWNER_AUTH_SETUP" "$OWNER_USERNAME" >/dev/null; test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM owner_passwords WHERE username = '$OWNER_USERNAME' AND enabled = 1 AND length(password_hash) > 20;")" = 1; test "$(sudo sqlite3 "$DB" 'SELECT count(*) FROM owner_passwords;')" = 1
  sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$RELEASE/hub/bin/register-m4-projects.php" >/dev/null; stage PROJECTS_READY
fi
sudo rm -f "$POINTER_TMP"; sudo ln -s "$RELEASE" "$POINTER_TMP"; sudo mv -Tf "$POINTER_TMP" "$POINTER"; POINTER_CHANGED=1; test "$(readlink "$POINTER")" = "$RELEASE"; stage CONTROL_POINTER
stage PHP_FPM_RELOAD; reload_awh_php_fpm
web_pointer_capture; sudo install -d -o awh-hub -g www-data -m 0750 /var/www/awh-web/releases; if sudo test -e "$WEB_RELEASE" || sudo test -L "$WEB_RELEASE"; then exit 20; fi; sudo install -d -o awh-hub -g www-data -m 0750 "$WEB_RELEASE"; WEB_CREATED=1; stage WEB_RELEASE_COPY; sudo cp -a "$RELEASE/dist-web/." "$WEB_RELEASE/"; sudo chown -R awh-hub:www-data "$WEB_RELEASE"; sudo find "$WEB_RELEASE" -type d -exec chmod 0750 {} +; sudo find "$WEB_RELEASE" -type f -exec chmod 0640 {} +; stage WEB_ACCESS_READY; verify_web_access; stage WEB_POINTER_SWITCH; sudo rm -f "$WEB_POINTER_TMP"; sudo ln -s "$WEB_RELEASE" "$WEB_POINTER_TMP"; sudo mv -Tf "$WEB_POINTER_TMP" "$WEB_POINTER"; WEB_POINTER_CHANGED=1; test "$(readlink "$WEB_POINTER")" = "$WEB_RELEASE"; stage WEB_RELEASE_STAGED
stage NGINX_CUTOVER_INSTALL; sudo install -o root -g root -m 0644 "$NGINX_CANDIDATE" "$NGINX_CONFIG"; NGINX_CHANGED=1; stage NGINX_CONFIGURED; sudo nginx -t >/dev/null
stage SERVICE_RELOAD; sudo systemctl reload nginx
stage OWNER_AUTH_EFFECTIVE_CONFIG; verify_owner_auth_effective_config
stage OWNER_AUTH_SURFACE; verify_owner_auth_surface
stage OWNER_AUTH_LOGIN; verify_owner_auth_login
stage OWNER_AUTH_SESSION; session_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -H 'Sec-Fetch-Site: same-origin' -b "$OWNER_AUTH_COOKIE_JAR" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/auth/session" 2>/dev/null || printf 000); test "$session_code" = 200
stage OWNER_AUTH_CONTROL; projects_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -H 'Sec-Fetch-Site: same-origin' -b "$OWNER_AUTH_COOKIE_JAR" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/projects" 2>/dev/null || printf 000); test "$projects_code" = 200; cleanup_owner_auth_cookie_files
stage OWNER_AUTH_WEB_SURFACE; root_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/" 2>/dev/null || printf 000); test "$root_code" = 200; control_config_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /tmp/awh-control-web-config-$RELEASE_ID.json -w '%{http_code}' "https://$HOSTNAME/web-config.json" 2>/dev/null || printf 000); test "$control_config_code" = 200; grep -q '"mode": "CONTROL"' /tmp/awh-control-web-config-$RELEASE_ID.json; sudo rm -f /tmp/awh-control-web-config-$RELEASE_ID.json; preview_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/preview/" 2>/dev/null || printf 000); test "$preview_code" = 401
stage M3D_REGRESSION; verify_m3d
stage M3E_POST_SCHEMA_REGRESSION; verify_m3e_after_m4
stage CONTROL_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/session" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
SUCCESS=1; printf '%s\n' 'DEPLOY_RESULT=PASS'; trap - EXIT HUP INT TERM; sudo rm -f "$REMOTE_STAGE" "$NGINX_BACKUP" "$NGINX_CANDIDATE" "$REMOTE_SCRIPT" "$CONTROL_INCLUDE_TMP"; exit 0
