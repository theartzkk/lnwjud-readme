#!/bin/sh

# Fixed-argument remote owner-auth activation. It prints allowlisted stage/result lines
# only. Raw stderr and all secret-bearing diagnostics are intentionally hidden.
set -eu
exec 2>/dev/null
DB=$1; REMOTE_ROOT=$2; REMOTE_STAGE=$3; RELEASE=$4; RELEASE_ID=$5; NGINX_CONFIG=$6; HOSTNAME=$7; AWH_FPM_SOCKET=$8; AWH_FPM_SERVICE=$9; CLEANUP_TOPOLOGY=${10}; OWNER_USERNAME=${11}; OWNER_AUTH_ENABLED=${12}; REMOTE_SCRIPT=${13}; COMPAT_REFRESH=${14}; ASSISTANT_WORKSTREAM=${15}; WORKSPACE_CONTINUITY=${16}; UNIFIED_WORKSPACE=${17}; FINAL_PRODUCT=${18}; FOUNDING_MEMORY=${19}; SELF_SERVICE=${20}; CENTRAL_PROJECT_AUTHORITY=${21}; RELEASE_COMMIT=${22}; ANYWHERE_EXECUTION=${23}; COST_AWARE_AI=${24}; AUTOMATIONS=${25}; SELF_SUFFICIENT_AI=${26}
case "$DB" in /var/lib/awh-hub/*|/opt/awh-hub/*|/srv/awh/*) ;; *) exit 20 ;; esac
case "$REMOTE_ROOT" in /opt/awh-hub) ;; *) exit 20 ;; esac
case "$REMOTE_STAGE" in /tmp/awh-control-plane-*.tar.gz) ;; *) exit 20 ;; esac
case "$RELEASE" in /opt/awh-hub/control-releases/*) ;; *) exit 20 ;; esac
case "$ASSISTANT_WORKSTREAM" in 0|1) ;; *) exit 20 ;; esac
case "$WORKSPACE_CONTINUITY" in 0|1) ;; *) exit 20 ;; esac
case "$UNIFIED_WORKSPACE" in 0|1) ;; *) exit 20 ;; esac
case "$FINAL_PRODUCT" in 0|1) ;; *) exit 20 ;; esac
case "$FOUNDING_MEMORY" in 0|1) ;; *) exit 20 ;; esac
case "$SELF_SERVICE" in 0|1) ;; *) exit 20 ;; esac
case "$CENTRAL_PROJECT_AUTHORITY" in 0|1) ;; *) exit 20 ;; esac
case "$ANYWHERE_EXECUTION" in 0|1) ;; *) exit 20 ;; esac
case "$COST_AWARE_AI" in 0|1) ;; *) exit 20 ;; esac
case "$AUTOMATIONS" in 0|1) ;; *) exit 20 ;; esac
case "$SELF_SUFFICIENT_AI" in 0|1) ;; *) exit 20 ;; esac
case "$RELEASE_COMMIT" in ''|*[!0-9a-fA-F]*) exit 20 ;; esac
test "${#RELEASE_COMMIT}" -ge 40 && test "${#RELEASE_COMMIT}" -le 64 || exit 20
if test $((COMPAT_REFRESH + ASSISTANT_WORKSTREAM + WORKSPACE_CONTINUITY + UNIFIED_WORKSPACE + FINAL_PRODUCT + FOUNDING_MEMORY + SELF_SERVICE + CENTRAL_PROJECT_AUTHORITY + ANYWHERE_EXECUTION + COST_AWARE_AI + AUTOMATIONS + SELF_SUFFICIENT_AI)) -gt 1; then exit 20; fi
if test "$SELF_SUFFICIENT_AI" = 1; then case "$RELEASE_ID" in m16-[0-9a-fA-F]*) ;; *) exit 20 ;; esac; elif test "$AUTOMATIONS" = 1; then case "$RELEASE_ID" in m15-[0-9a-fA-F]*) ;; *) exit 20 ;; esac; elif test "$COST_AWARE_AI" = 1; then case "$RELEASE_ID" in m14-[0-9a-fA-F]*) ;; *) exit 20 ;; esac; elif test "$ANYWHERE_EXECUTION" = 1; then case "$RELEASE_ID" in m13-[0-9a-fA-F]*) ;; *) exit 20 ;; esac; elif test "$CENTRAL_PROJECT_AUTHORITY" = 1; then case "$RELEASE_ID" in m12-[0-9a-fA-F]*) ;; *) exit 20 ;; esac; elif test "$SELF_SERVICE" = 1; then case "$RELEASE_ID" in m11-[0-9a-fA-F]*) ;; *) exit 20 ;; esac; elif test "$FOUNDING_MEMORY" = 1; then case "$RELEASE_ID" in m10-[0-9a-fA-F]*) ;; *) exit 20 ;; esac; elif test "$FINAL_PRODUCT" = 1; then case "$RELEASE_ID" in m9-[0-9a-fA-F]*) ;; *) exit 20 ;; esac; elif test "$UNIFIED_WORKSPACE" = 1; then case "$RELEASE_ID" in m8-[0-9a-fA-F]*) ;; *) exit 20 ;; esac; elif test "$WORKSPACE_CONTINUITY" = 1; then case "$RELEASE_ID" in m7-[0-9a-fA-F]*) ;; *) exit 20 ;; esac; elif test "$ASSISTANT_WORKSTREAM" = 1; then case "$RELEASE_ID" in m6-[0-9a-fA-F]*) ;; *) exit 20 ;; esac; else case "$RELEASE_ID" in m4-[0-9a-fA-F]*) ;; *) exit 20 ;; esac; fi
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
if test "$COMPAT_REFRESH" = 1 && test "$ASSISTANT_WORKSTREAM" = 1; then exit 20; fi
OWNER_PASSWORD=
if test "$ASSISTANT_WORKSTREAM" = 0 && test "$WORKSPACE_CONTINUITY" = 0 && test "$UNIFIED_WORKSPACE" = 0 && test "$FINAL_PRODUCT" = 0 && test "$FOUNDING_MEMORY" = 0 && test "$SELF_SERVICE" = 0 && test "$CENTRAL_PROJECT_AUTHORITY" = 0 && test "$ANYWHERE_EXECUTION" = 0 && test "$COST_AWARE_AI" = 0 && test "$AUTOMATIONS" = 0 && test "$SELF_SUFFICIENT_AI" = 0; then IFS= read -r OWNER_PASSWORD || exit 20; case "$OWNER_PASSWORD" in ''|*[!A-Za-z0-9._~-]*) exit 20 ;; esac; fi

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
EXECUTOR_UNITS_INSTALLED=0
EXECUTOR_UNITS_PREEXISTING=0
EXECUTOR_TIMER_STOPPED=0
M12_REFRESH=0
M13_REFRESH=0
M14_REFRESH=0
M15_REFRESH=0
M16_REFRESH=0
DEPLOY_BASE_VERSION=
EXECUTOR_SERVICE_UNIT=/etc/systemd/system/awh-native-executor.service
EXECUTOR_TIMER_UNIT=/etc/systemd/system/awh-native-executor.timer
EXECUTOR_BACKUP_ROOT=$CONFIG_BACKUP_ROOT/systemd
EXECUTOR_SERVICE_BACKUP=$EXECUTOR_BACKUP_ROOT/awh-native-executor.service.$RELEASE_ID
EXECUTOR_TIMER_BACKUP=$EXECUTOR_BACKUP_ROOT/awh-native-executor.timer.$RELEASE_ID
TOPOLOGY_ARCHIVE=/var/backups/awh-hub/topology-cleanup-$RELEASE_ID
TOPOLOGY_HELPER=/opt/awh-hub/enrollment-current/deploy/awh-enrollment/insert-nginx-include.php
ENROLLMENT_INCLUDE=/opt/awh-hub/enrollment-current/deploy/nginx/awh-enrollment.conf
OWNER_AUTH_SETUP=
OWNER_AUTH_RUNTIME=
OWNER_AUTH_TRANSFORM=
ASSISTANT_MIGRATION=
WORKSPACE_MIGRATION=
UNIFIED_MIGRATION=
FINAL_MIGRATION=
FOUNDING_MIGRATION=
SELF_SERVICE_MIGRATION=
CENTRAL_PROJECT_MIGRATION=
ANYWHERE_MIGRATION=
COST_AWARE_MIGRATION=
AUTOMATION_MIGRATION=
SELF_SUFFICIENT_MIGRATION=
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
verify_owner_auth_effective_config() { if ! EFFECTIVE_NGINX=$(sudo nginx -T 2>&1); then return 1; fi; test -n "$EFFECTIVE_NGINX"; printf '%s\n' "$EFFECTIVE_NGINX" | grep -q 'location = /api/v1/auth/login {'; printf '%s\n' "$EFFECTIVE_NGINX" | grep -q 'location = /api/v1/auth/session {'; printf '%s\n' "$EFFECTIVE_NGINX" | grep -q 'location = /database-studio.php {'; printf '%s\n' "$EFFECTIVE_NGINX" | grep -q "fastcgi_param AWH_CONTROL_ORIGIN https://${HOSTNAME};"; printf '%s\n' "$EFFECTIVE_NGINX" | grep -q "fastcgi_pass unix:${AWH_FPM_SOCKET};"; }
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
rehydrate_desktop_artifacts() {
  store=/var/www/awh-web/desktop-artifacts
  sudo install -d -o awh-hub -g www-data -m 0750 "$WEB_RELEASE/downloads"
  for name in AWH-macOS-x64.zip AWH-Windows-x64.zip SHA256SUMS.txt; do
    file="$WEB_RELEASE/downloads/$name"
    test -f "$file" && continue
    expected=$(/usr/bin/php -r '$j=json_decode(file_get_contents($argv[1]),true,32,JSON_THROW_ON_ERROR); foreach(($j["files"]??[]) as $f){ if(($f["path"]??null)===$argv[2]){ $h=strtolower((string)($f["sha256"]??"")); if(!preg_match("/^[0-9a-f]{64}$/",$h)) exit(2); echo $h; exit(0); }} exit(3);' "$WEB_RELEASE/release.json" "downloads/$name")
    case "$expected" in *[!0-9a-f]*|'') return 1 ;; esac
    test "${#expected}" -eq 64 || return 1
    object="$store/$expected-$name"
    sudo test -f "$object"
    actual=$(sudo sha256sum "$object" | cut -d' ' -f1)
    test "$actual" = "$expected"
    sudo ln "$object" "$file"
  done
}
deduplicate_desktop_artifacts() {
  store=/var/www/awh-web/desktop-artifacts
  sudo install -d -o awh-hub -g www-data -m 0750 "$store"
  for name in AWH-macOS-x64.zip AWH-Windows-x64.zip SHA256SUMS.txt; do
    file="$WEB_RELEASE/downloads/$name"
    sudo test -f "$file" || continue
    digest=$(sudo sha256sum "$file" | cut -d' ' -f1)
    case "$digest" in [0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]*) ;; *) return 1 ;; esac
    object="$store/$digest-$name"
    if sudo test -e "$object" || sudo test -L "$object"; then
      sudo test -f "$object"
      sudo cmp -s "$file" "$object"
    else
      sudo ln "$file" "$object"
    fi
    if test "$(sudo stat -c %i "$file")" != "$(sudo stat -c %i "$object")"; then
      temp="$file.awh-artifact-link"
      sudo rm -f "$temp"
      sudo ln "$object" "$temp"
      sudo cmp -s "$file" "$temp"
      sudo mv -Tf "$temp" "$file"
    fi
    sudo chown awh-hub:www-data "$object"
    sudo chmod 0640 "$object"
    sudo test "$(sudo stat -c %i "$file")" = "$(sudo stat -c %i "$object")"
  done
}
verify_web_access() { sudo -n -u www-data test -x /var; sudo -n -u www-data test -x /var/www; sudo -n -u www-data test -x /var/www/awh-web; sudo -n -u www-data test -x /var/www/awh-web/releases; sudo -n -u www-data test -x "$WEB_RELEASE"; sudo -n -u www-data test -r "$WEB_RELEASE/index.html"; sudo -n -u www-data test -r "$WEB_RELEASE/awh-design-system.css"; sudo -n -u www-data test -r "$WEB_RELEASE/responsive-layout.css"; sudo -n -u www-data test -r "$WEB_RELEASE/navigation.js"; sudo grep -q -- '--awh-font-sans' "$WEB_RELEASE/awh-design-system.css"; sudo grep -q -- 'Shared responsive-width contract' "$WEB_RELEASE/responsive-layout.css"; sudo -n -u www-data test -r "$WEB_RELEASE/database.html"; sudo -n -u www-data test -r "$WEB_RELEASE/database.css"; sudo -n -u www-data test -r "$WEB_RELEASE/database.js"; sudo grep -q '"mode": "CONTROL"' "$WEB_RELEASE/web-config.json"; sudo grep -q '"mode": "CONTROL"' "$WEB_RELEASE/data.json"; ! sudo grep -q 'Remote Preview\|Preview only\|static build' "$WEB_RELEASE/data.json"; sudo grep -q "awh-shell-$RELEASE_ID" "$WEB_RELEASE/sw.js"; }
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
    if test "$EXECUTOR_UNITS_INSTALLED" -eq 1; then
      sudo systemctl disable --now awh-native-executor.timer >/dev/null 2>&1 || ok=0
      if test "$EXECUTOR_UNITS_PREEXISTING" -eq 1; then
        sudo cp -p "$EXECUTOR_SERVICE_BACKUP" "$EXECUTOR_SERVICE_UNIT" || ok=0
        sudo cp -p "$EXECUTOR_TIMER_BACKUP" "$EXECUTOR_TIMER_UNIT" || ok=0
      else
        sudo rm -f "$EXECUTOR_SERVICE_UNIT" "$EXECUTOR_TIMER_UNIT" || ok=0
      fi
      sudo systemctl daemon-reload || ok=0
    fi
    if test "$EXECUTOR_UNITS_PREEXISTING" -eq 1; then
      sudo systemctl enable --now awh-native-executor.timer >/dev/null 2>&1 || ok=0
      sudo systemctl is-active --quiet awh-native-executor.timer || ok=0
    fi
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
    # M9/M10 are all-or-nothing v7 extensions. A successful rollback
    # must prove the original M7 authority, not merely that SQLite restored a
    # readable file.  The attachment root is intentionally durable and may be
    # empty after a failed activation; it is not user data until an authorized
    # post-release upload has committed a record in the database.
    if test "$ok" -eq 1 && { test "$FINAL_PRODUCT" = 1 || test "$FOUNDING_MEMORY" = 1 || test "$SELF_SERVICE" = 1; } && test "$DB_MUTATED" -eq 1; then
      test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 7 || ok=0
      test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm7-workspace-continuity' AND schema_version = 7;")" = 1 || ok=0
      test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok || ok=0
      test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')" || ok=0
      verify_m3e_after_m4 || ok=0
    fi
    if test "$ok" -eq 1 && { test "$CENTRAL_PROJECT_AUTHORITY" = 1 || test "$ANYWHERE_EXECUTION" = 1 || test "$COST_AWARE_AI" = 1 || test "$AUTOMATIONS" = 1 || test "$SELF_SUFFICIENT_AI" = 1; } && test "$DB_MUTATED" -eq 1; then
      test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = "$DEPLOY_BASE_VERSION" || ok=0
      case "$DEPLOY_BASE_VERSION" in
        11) test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm11-self-service' AND schema_version = 11;")" = 1 || ok=0 ;;
        12) test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm12-central-project-authority' AND schema_version = 12;")" = 1 || ok=0 ;;
        13) test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm13-anywhere-execution-fabric' AND schema_version = 13;")" = 1 || ok=0 ;;
        14) test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm14-cost-aware-ai' AND schema_version = 14;")" = 1 || ok=0 ;;
        15) test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm15-automation-registry' AND schema_version = 15;")" = 1 || ok=0 ;;
        16) test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm16-self-sufficient-ai' AND schema_version = 16;")" = 1 || ok=0 ;;
        *) ok=0 ;;
      esac
      test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok || ok=0
      test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')" || ok=0
      verify_m3e_after_m4 || ok=0
    fi
    sudo rm -rf "$RELEASE" "$WEB_RELEASE" >/dev/null 2>&1 || true
    sudo rm -f "$REMOTE_STAGE" "$POINTER_TMP" "$WEB_POINTER_TMP" "$NGINX_CANDIDATE" "$REMOTE_SCRIPT" "$CONTROL_INCLUDE_TMP" "$EXECUTOR_SERVICE_BACKUP" "$EXECUTOR_TIMER_BACKUP" >/dev/null 2>&1 || true
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

sudo test -f "$DB"; sudo test -f "$REMOTE_STAGE"; pointer_capture; cleanup_loaded_topology; DEPLOY_BASE_VERSION=$(sudo sqlite3 "$DB" 'PRAGMA user_version;'); case "$DEPLOY_BASE_VERSION" in 4|5|6|7|8|9|10|11|12|13|14|15|16) ;; *) exit 20 ;; esac; stage PREMUTATION_READY
sudo install -d -o root -g awh-hub -m 0750 /var/backups/awh-hub
sudo sqlite3 "$DB" ".backup '$BACKUP'"; sudo chown root:root "$BACKUP"; sudo chmod 0600 "$BACKUP"; test "$(sudo sqlite3 "$BACKUP" 'PRAGMA integrity_check;')" = ok; test -z "$(sudo sqlite3 "$BACKUP" 'PRAGMA foreign_key_check;')"; sudo install -d -m 0750 -o root -g root "$CONFIG_BACKUP_ROOT/nginx"; sudo test ! -e "$NGINX_BACKUP"; sudo cp -p "$NGINX_CONFIG" "$NGINX_BACKUP"; sudo chown root:root "$NGINX_BACKUP"; sudo chmod 0600 "$NGINX_BACKUP"; sudo cmp -s "$NGINX_CONFIG" "$NGINX_BACKUP"; NGINX_BACKUP_CREATED=1; stage BACKUP_VERIFIED
if sudo test -e "$RELEASE" || sudo test -L "$RELEASE"; then exit 20; fi
sudo install -d -o awh-hub -g awh-hub -m 0750 "$RELEASE"; RELEASE_CREATED=1; sudo tar -xzf "$REMOTE_STAGE" -C "$RELEASE"; sudo chown -R awh-hub:awh-hub "$RELEASE"; sudo test -f "$RELEASE/hub/public/control-plane.php"; sudo test -f "$RELEASE/hub/bin/migrate-m4.php"; sudo test -f "$RELEASE/hub/src/HubThaiGovernmentDocumentService.php"; sudo test -f "$RELEASE/hub/assets/thai-government-garuda-v7.png"; sudo test -f "$RELEASE/hub/src/HubInfrastructureService.php"; sudo test -f "$RELEASE/hub/bin/system-telemetry.php"; if test "$ASSISTANT_WORKSTREAM" = 1 || test "$WORKSPACE_CONTINUITY" = 1 || test "$UNIFIED_WORKSPACE" = 1 || test "$FINAL_PRODUCT" = 1 || test "$FOUNDING_MEMORY" = 1 || test "$SELF_SERVICE" = 1 || test "$CENTRAL_PROJECT_AUTHORITY" = 1 || test "$ANYWHERE_EXECUTION" = 1 || test "$COST_AWARE_AI" = 1 || test "$AUTOMATIONS" = 1; then sudo test -f "$RELEASE/hub/bin/migrate-assistant-workstream.php"; sudo test -f "$RELEASE/hub/migrations/005_assistant_workstream.sql"; fi; if test "$WORKSPACE_CONTINUITY" = 1 || test "$UNIFIED_WORKSPACE" = 1 || test "$FINAL_PRODUCT" = 1 || test "$FOUNDING_MEMORY" = 1 || test "$SELF_SERVICE" = 1 || test "$CENTRAL_PROJECT_AUTHORITY" = 1 || test "$ANYWHERE_EXECUTION" = 1 || test "$COST_AWARE_AI" = 1 || test "$AUTOMATIONS" = 1; then sudo test -f "$RELEASE/hub/bin/migrate-workspace-continuity.php"; sudo test -f "$RELEASE/hub/migrations/006_workspace_continuity.sql"; fi; if test "$UNIFIED_WORKSPACE" = 1 || test "$FINAL_PRODUCT" = 1 || test "$FOUNDING_MEMORY" = 1 || test "$SELF_SERVICE" = 1 || test "$CENTRAL_PROJECT_AUTHORITY" = 1 || test "$ANYWHERE_EXECUTION" = 1 || test "$COST_AWARE_AI" = 1 || test "$AUTOMATIONS" = 1; then sudo test -f "$RELEASE/hub/bin/migrate-unified-workspace.php"; sudo test -f "$RELEASE/hub/migrations/007_unified_workspace.sql"; fi; if test "$FINAL_PRODUCT" = 1 || test "$FOUNDING_MEMORY" = 1 || test "$SELF_SERVICE" = 1 || test "$CENTRAL_PROJECT_AUTHORITY" = 1 || test "$ANYWHERE_EXECUTION" = 1 || test "$COST_AWARE_AI" = 1 || test "$AUTOMATIONS" = 1; then sudo test -f "$RELEASE/hub/bin/migrate-final-product.php"; sudo test -f "$RELEASE/hub/migrations/008_final_product.sql"; sudo test -f "$RELEASE/hub/src/HubAttachmentStore.php"; sudo test -f "$RELEASE/hub/src/HubNativeAgentService.php"; fi; if test "$FOUNDING_MEMORY" = 1 || test "$SELF_SERVICE" = 1 || test "$CENTRAL_PROJECT_AUTHORITY" = 1 || test "$ANYWHERE_EXECUTION" = 1 || test "$COST_AWARE_AI" = 1 || test "$AUTOMATIONS" = 1; then sudo test -f "$RELEASE/hub/bin/migrate-founding-memory.php"; sudo test -f "$RELEASE/hub/migrations/009_founding_memory.sql"; sudo test -f "$RELEASE/hub/src/HubFoundingMemorySeed.php"; sudo test -f "$RELEASE/hub/src/HubFoundingMemoryMigration.php"; sudo test -f "$RELEASE/hub/src/HubFoundingMemoryService.php"; fi; if test "$SELF_SERVICE" = 1 || test "$CENTRAL_PROJECT_AUTHORITY" = 1 || test "$ANYWHERE_EXECUTION" = 1 || test "$COST_AWARE_AI" = 1 || test "$AUTOMATIONS" = 1; then sudo test -f "$RELEASE/hub/bin/migrate-self-service.php"; sudo test -f "$RELEASE/hub/migrations/010_self_service.sql"; sudo test -f "$RELEASE/hub/src/HubSelfServiceMigration.php"; sudo test -f "$RELEASE/hub/src/HubProviderCredentialStore.php"; fi; if test "$CENTRAL_PROJECT_AUTHORITY" = 1 || test "$ANYWHERE_EXECUTION" = 1 || test "$COST_AWARE_AI" = 1 || test "$AUTOMATIONS" = 1; then sudo test -f "$RELEASE/hub/bin/migrate-central-project-authority.php"; sudo test -f "$RELEASE/hub/bin/awh-native-executor.php"; sudo test -f "$RELEASE/hub/bin/sync-deployed-source-vault.php"; sudo test -s "$RELEASE/.awh-build/awh-source.zip"; sudo test -f "$RELEASE/hub/migrations/011_central_project_authority.sql"; sudo test -f "$RELEASE/hub/src/HubCentralProjectAuthorityMigration.php"; sudo test -f "$RELEASE/hub/src/HubProjectVault.php"; sudo test -f "$RELEASE/hub/src/HubProjectVaultService.php"; sudo test -f "$RELEASE/hub/src/HubDurableExecutionService.php"; sudo test -f "$RELEASE/deploy/systemd/awh-native-executor.service"; sudo test -f "$RELEASE/deploy/systemd/awh-native-executor.timer"; fi; sudo -u awh-hub test -r "$RELEASE/hub/src/HubControlPlaneService.php"; stage RELEASE_STAGED
if test "$CENTRAL_PROJECT_AUTHORITY" = 1 || test "$ANYWHERE_EXECUTION" = 1 || test "$COST_AWARE_AI" = 1 || test "$AUTOMATIONS" = 1; then sudo test -f "$RELEASE/hub/src/HubArtifactStore.php"; fi
if test "$ANYWHERE_EXECUTION" = 1 || test "$COST_AWARE_AI" = 1 || test "$AUTOMATIONS" = 1; then sudo test -f "$RELEASE/hub/bin/migrate-anywhere-execution.php"; sudo test -f "$RELEASE/hub/migrations/012_anywhere_execution_fabric.sql"; sudo test -f "$RELEASE/hub/src/HubAnywhereExecutionMigration.php"; sudo test -f "$RELEASE/hub/src/HubCapabilityRegistryService.php"; fi
if test "$COST_AWARE_AI" = 1 || test "$AUTOMATIONS" = 1; then sudo test -f "$RELEASE/hub/bin/migrate-cost-aware-ai.php"; sudo test -f "$RELEASE/hub/migrations/013_cost_aware_ai.sql"; sudo test -f "$RELEASE/hub/src/HubCostAwareAiMigration.php"; sudo test -f "$RELEASE/hub/src/HubProviderPricingService.php"; fi
if test "$AUTOMATIONS" = 1 || test "$SELF_SUFFICIENT_AI" = 1; then sudo test -f "$RELEASE/hub/bin/migrate-automations.php"; sudo test -f "$RELEASE/hub/migrations/014_automations.sql"; sudo test -f "$RELEASE/hub/src/HubAutomationMigration.php"; sudo test -f "$RELEASE/hub/src/HubAutomationRegistryService.php"; sudo test -f "$RELEASE/hub/src/HubAutomationSchedulerService.php"; fi
if test "$SELF_SUFFICIENT_AI" = 1; then sudo test -f "$RELEASE/hub/bin/migrate-self-sufficient-ai.php"; sudo test -f "$RELEASE/hub/migrations/015_self_sufficient_ai.sql"; sudo test -f "$RELEASE/hub/src/HubSelfSufficientAiMigration.php"; sudo test -f "$RELEASE/hub/src/HubAiGovernanceService.php"; sudo test -f "$RELEASE/hub/src/HubAiProviderAdapter.php"; sudo test -f "$RELEASE/hub/src/HubOpenAiProviderAdapter.php"; sudo test -f "$RELEASE/hub/src/HubDurableExecutionService.php"; sudo test -f "$RELEASE/hub/src/HubExecutionTriageService.php"; sudo test -f "$RELEASE/hub/src/HubStaffGovernorService.php"; sudo test -f "$RELEASE/hub/src/HubStaffOperationsService.php"; sudo test -f "$RELEASE/deploy/systemd/awh-native-executor.service"; sudo test -f "$RELEASE/deploy/systemd/awh-native-executor.timer"; sudo test -s "$RELEASE/.awh-build/awh-source.zip"; fi
OWNER_AUTH_SETUP=$RELEASE/hub/bin/setup-owner-auth.php; OWNER_AUTH_RUNTIME=$RELEASE/hub/bin/verify-owner-auth-runtime.php; ASSISTANT_MIGRATION=$RELEASE/hub/bin/migrate-assistant-workstream.php; WORKSPACE_MIGRATION=$RELEASE/hub/bin/migrate-workspace-continuity.php; UNIFIED_MIGRATION=$RELEASE/hub/bin/migrate-unified-workspace.php; FINAL_MIGRATION=$RELEASE/hub/bin/migrate-final-product.php; FOUNDING_MIGRATION=$RELEASE/hub/bin/migrate-founding-memory.php; SELF_SERVICE_MIGRATION=$RELEASE/hub/bin/migrate-self-service.php; CENTRAL_PROJECT_MIGRATION=$RELEASE/hub/bin/migrate-central-project-authority.php; ANYWHERE_MIGRATION=$RELEASE/hub/bin/migrate-anywhere-execution.php; COST_AWARE_MIGRATION=$RELEASE/hub/bin/migrate-cost-aware-ai.php; AUTOMATION_MIGRATION=$RELEASE/hub/bin/migrate-automations.php; SELF_SUFFICIENT_MIGRATION=$RELEASE/hub/bin/migrate-self-sufficient-ai.php; OWNER_AUTH_TRANSFORM=$RELEASE/deploy/nginx/transform-owner-auth.php; CONTROL_ORIGIN_RENDER=$RELEASE/deploy/nginx/render-control-plane-include.php; CONTROL_INCLUDE=$RELEASE/deploy/nginx/awh-control-plane.conf; CONTROL_INCLUDE_TMP=/tmp/awh-control-include-$RELEASE_ID.conf
stage CONTROL_ORIGIN_RENDER; sudo /usr/bin/php "$CONTROL_ORIGIN_RENDER" "$CONTROL_INCLUDE" "$CONTROL_INCLUDE_TMP" "$HOSTNAME" "$AWH_FPM_SOCKET" >/dev/null; sudo test -s "$CONTROL_INCLUDE_TMP"; sudo install -o awh-hub -g awh-hub -m 0644 "$CONTROL_INCLUDE_TMP" "$CONTROL_INCLUDE"; sudo rm -f "$CONTROL_INCLUDE_TMP"; CONTROL_INCLUDE_TMP=
stage NGINX_CUTOVER_PREPARE; sudo /usr/bin/php "$OWNER_AUTH_TRANSFORM" "$NGINX_CONFIG" "$NGINX_CANDIDATE" "$HOSTNAME" "$AWH_FPM_SOCKET" >/dev/null; sudo test -s "$NGINX_CANDIDATE"; sudo chown root:root "$NGINX_CANDIDATE"; sudo chmod 0644 "$NGINX_CANDIDATE"
if test "$SELF_SUFFICIENT_AI" = 1; then
  # M16 extends the existing provider/execution authorities with governance evidence.
  stage WORKSPACE_PRESERVED
  M16_START_VERSION=$(sudo sqlite3 "$DB" 'PRAGMA user_version;')
  case "$M16_START_VERSION" in 15|16) ;; *) exit 20 ;; esac
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm15-automation-registry' AND schema_version = 15;")" = 1
  if test "$M16_START_VERSION" = 16; then M16_REFRESH=1; test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm16-self-sufficient-ai' AND schema_version = 16;")" = 1; fi
  sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$OWNER_AUTH_RUNTIME" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok; test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  stage PROJECT_VAULT_RUNTIME_READY; sudo -u awh-hub /usr/bin/php -r 'exit((extension_loaded("pdo_sqlite") && class_exists("ZipArchive")) ? 0 : 1);'
  stage PROJECT_VAULT_STORAGE_READY; sudo -u awh-hub test -w /var/lib/awh-hub/project-vault; sudo -u awh-hub test -w /var/lib/awh-hub/task-workspaces; sudo -u awh-hub test -w /var/lib/awh-hub/task-transfers; sudo -u awh-hub test -w /var/lib/awh-hub/artifacts
  test -f "$EXECUTOR_SERVICE_UNIT" && test -f "$EXECUTOR_TIMER_UNIT"; test "$PREVIOUS_POINTER" = PRESENT
  sudo cmp -s "$EXECUTOR_SERVICE_UNIT" "$PREVIOUS_TARGET/deploy/systemd/awh-native-executor.service"; sudo cmp -s "$EXECUTOR_TIMER_UNIT" "$PREVIOUS_TARGET/deploy/systemd/awh-native-executor.timer"
  sudo install -d -o root -g root -m 0750 "$EXECUTOR_BACKUP_ROOT"; sudo test ! -e "$EXECUTOR_SERVICE_BACKUP"; sudo test ! -e "$EXECUTOR_TIMER_BACKUP"
  sudo cp -p "$EXECUTOR_SERVICE_UNIT" "$EXECUTOR_SERVICE_BACKUP"; sudo cp -p "$EXECUTOR_TIMER_UNIT" "$EXECUTOR_TIMER_BACKUP"; sudo chown root:root "$EXECUTOR_SERVICE_BACKUP" "$EXECUTOR_TIMER_BACKUP"; sudo chmod 0600 "$EXECUTOR_SERVICE_BACKUP" "$EXECUTOR_TIMER_BACKUP"
  EXECUTOR_UNITS_PREEXISTING=1; sudo systemctl stop awh-native-executor.timer; sudo systemctl stop awh-native-executor.service >/dev/null 2>&1 || true; EXECUTOR_TIMER_STOPPED=1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM control_task_executions WHERE state IN ('LEASED','RUNNING');")" = 0; stage NATIVE_EXECUTOR_QUIESCED
  DB_MUTATED=1
  if test "$M16_REFRESH" -eq 0; then stage SELF_SUFFICIENT_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$SELF_SUFFICIENT_MIGRATION" "$DB" >/dev/null; fi
  stage SELF_SUFFICIENT_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$SELF_SUFFICIENT_MIGRATION" "$DB" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 16; test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm16-self-sufficient-ai' AND schema_version = 16;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('control_ai_provider_profiles','control_ai_models','control_ai_model_qualifications','control_ai_model_health','control_ai_route_decisions','control_ai_outcomes','control_ai_budget_policies');")" = 7
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok; test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"; stage SELF_SUFFICIENT_MIGRATION_VERIFIED; stage PROJECTS_READY
elif test "$AUTOMATIONS" = 1; then
  # M15 is additive over M14. Quiesce the existing managed executor so no due
  # occurrence can materialize while schema/source authority is switching.
  stage WORKSPACE_PRESERVED
  M15_START_VERSION=$(sudo sqlite3 "$DB" 'PRAGMA user_version;')
  case "$M15_START_VERSION" in 14|15) ;; *) exit 20 ;; esac
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm14-cost-aware-ai' AND schema_version = 14;")" = 1
  if test "$M15_START_VERSION" = 15; then M15_REFRESH=1; test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm15-automation-registry' AND schema_version = 15;")" = 1; fi
  sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$OWNER_AUTH_RUNTIME" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok; test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  stage PROJECT_VAULT_RUNTIME_READY; sudo -u awh-hub /usr/bin/php -r 'exit((extension_loaded("pdo_sqlite") && class_exists("ZipArchive")) ? 0 : 1);'
  stage PROJECT_VAULT_STORAGE_READY; sudo -u awh-hub test -w /var/lib/awh-hub/project-vault; sudo -u awh-hub test -w /var/lib/awh-hub/task-workspaces; sudo -u awh-hub test -w /var/lib/awh-hub/task-transfers; sudo -u awh-hub test -w /var/lib/awh-hub/artifacts
  test -f "$EXECUTOR_SERVICE_UNIT" && test -f "$EXECUTOR_TIMER_UNIT"; test "$PREVIOUS_POINTER" = PRESENT
  sudo cmp -s "$EXECUTOR_SERVICE_UNIT" "$PREVIOUS_TARGET/deploy/systemd/awh-native-executor.service"; sudo cmp -s "$EXECUTOR_TIMER_UNIT" "$PREVIOUS_TARGET/deploy/systemd/awh-native-executor.timer"
  sudo install -d -o root -g root -m 0750 "$EXECUTOR_BACKUP_ROOT"; sudo test ! -e "$EXECUTOR_SERVICE_BACKUP"; sudo test ! -e "$EXECUTOR_TIMER_BACKUP"
  sudo cp -p "$EXECUTOR_SERVICE_UNIT" "$EXECUTOR_SERVICE_BACKUP"; sudo cp -p "$EXECUTOR_TIMER_UNIT" "$EXECUTOR_TIMER_BACKUP"; sudo chown root:root "$EXECUTOR_SERVICE_BACKUP" "$EXECUTOR_TIMER_BACKUP"; sudo chmod 0600 "$EXECUTOR_SERVICE_BACKUP" "$EXECUTOR_TIMER_BACKUP"
  EXECUTOR_UNITS_PREEXISTING=1; sudo systemctl stop awh-native-executor.timer; sudo systemctl stop awh-native-executor.service >/dev/null 2>&1 || true; EXECUTOR_TIMER_STOPPED=1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM control_task_executions WHERE state IN ('LEASED','RUNNING');")" = 0; stage NATIVE_EXECUTOR_QUIESCED
  DB_MUTATED=1
  if test "$M15_REFRESH" -eq 0; then stage AUTOMATION_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$AUTOMATION_MIGRATION" "$DB" >/dev/null; fi
  stage AUTOMATION_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$AUTOMATION_MIGRATION" "$DB" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 15; test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm15-automation-registry' AND schema_version = 15;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='control_automations';")" = 1
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok; test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"; stage AUTOMATION_MIGRATION_VERIFIED; stage PROJECTS_READY
elif test "$COST_AWARE_AI" = 1; then
  # M14 is additive over M13. Personal devices remain optional; the managed
  # Cloud executor is quiesced before schema/source mutation.
  stage WORKSPACE_PRESERVED
  M14_START_VERSION=$(sudo sqlite3 "$DB" 'PRAGMA user_version;')
  case "$M14_START_VERSION" in 13|14) ;; *) exit 20 ;; esac
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm13-anywhere-execution-fabric' AND schema_version = 13;")" = 1
  if test "$M14_START_VERSION" = 14; then M14_REFRESH=1; test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm14-cost-aware-ai' AND schema_version = 14;")" = 1; fi
  sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$OWNER_AUTH_RUNTIME" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok; test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  stage PROJECT_VAULT_RUNTIME_READY; sudo -u awh-hub /usr/bin/php -r 'exit((extension_loaded("pdo_sqlite") && class_exists("ZipArchive")) ? 0 : 1);'
  stage PROJECT_VAULT_STORAGE_READY; sudo -u awh-hub test -w /var/lib/awh-hub/project-vault; sudo -u awh-hub test -w /var/lib/awh-hub/task-workspaces; sudo -u awh-hub test -w /var/lib/awh-hub/task-transfers; sudo -u awh-hub test -w /var/lib/awh-hub/artifacts
  test -f "$EXECUTOR_SERVICE_UNIT" && test -f "$EXECUTOR_TIMER_UNIT"; test "$PREVIOUS_POINTER" = PRESENT
  sudo cmp -s "$EXECUTOR_SERVICE_UNIT" "$PREVIOUS_TARGET/deploy/systemd/awh-native-executor.service"; sudo cmp -s "$EXECUTOR_TIMER_UNIT" "$PREVIOUS_TARGET/deploy/systemd/awh-native-executor.timer"
  sudo install -d -o root -g root -m 0750 "$EXECUTOR_BACKUP_ROOT"; sudo test ! -e "$EXECUTOR_SERVICE_BACKUP"; sudo test ! -e "$EXECUTOR_TIMER_BACKUP"
  sudo cp -p "$EXECUTOR_SERVICE_UNIT" "$EXECUTOR_SERVICE_BACKUP"; sudo cp -p "$EXECUTOR_TIMER_UNIT" "$EXECUTOR_TIMER_BACKUP"; sudo chown root:root "$EXECUTOR_SERVICE_BACKUP" "$EXECUTOR_TIMER_BACKUP"; sudo chmod 0600 "$EXECUTOR_SERVICE_BACKUP" "$EXECUTOR_TIMER_BACKUP"
  EXECUTOR_UNITS_PREEXISTING=1; sudo systemctl stop awh-native-executor.timer; sudo systemctl stop awh-native-executor.service >/dev/null 2>&1 || true; EXECUTOR_TIMER_STOPPED=1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM control_task_executions WHERE state IN ('LEASED','RUNNING');")" = 0; stage NATIVE_EXECUTOR_QUIESCED
  DB_MUTATED=1
  if test "$M14_REFRESH" -eq 0; then stage COST_AWARE_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$COST_AWARE_MIGRATION" "$DB" >/dev/null; fi
  stage COST_AWARE_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$COST_AWARE_MIGRATION" "$DB" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 14; test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm14-cost-aware-ai' AND schema_version = 14;")" = 1
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok; test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"; stage COST_AWARE_MIGRATION_VERIFIED; stage PROJECTS_READY
elif test "$ANYWHERE_EXECUTION" = 1; then
  # M13 is additive over the canonical M12 authority. Both v12 activation and
  # v13 source refresh prove the managed executor before touching schema/source.
  stage WORKSPACE_PRESERVED
  M13_START_VERSION=$(sudo sqlite3 "$DB" 'PRAGMA user_version;')
  case "$M13_START_VERSION" in 12|13) ;; *) exit 20 ;; esac
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm12-central-project-authority' AND schema_version = 12;")" = 1
  if test "$M13_START_VERSION" = 13; then M13_REFRESH=1; test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm13-anywhere-execution-fabric' AND schema_version = 13;")" = 1; fi
  sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$OWNER_AUTH_RUNTIME" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok; test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  stage PROJECT_VAULT_RUNTIME_READY; sudo -u awh-hub /usr/bin/php -r 'exit((extension_loaded("pdo_sqlite") && class_exists("ZipArchive")) ? 0 : 1);'
  stage PROJECT_VAULT_STORAGE_READY; sudo -u awh-hub test -w /var/lib/awh-hub/project-vault; sudo -u awh-hub test -w /var/lib/awh-hub/task-workspaces; sudo -u awh-hub test -w /var/lib/awh-hub/task-transfers; sudo -u awh-hub test -w /var/lib/awh-hub/artifacts
  test -f "$EXECUTOR_SERVICE_UNIT" && test -f "$EXECUTOR_TIMER_UNIT"; test "$PREVIOUS_POINTER" = PRESENT
  sudo cmp -s "$EXECUTOR_SERVICE_UNIT" "$PREVIOUS_TARGET/deploy/systemd/awh-native-executor.service"; sudo cmp -s "$EXECUTOR_TIMER_UNIT" "$PREVIOUS_TARGET/deploy/systemd/awh-native-executor.timer"
  sudo install -d -o root -g root -m 0750 "$EXECUTOR_BACKUP_ROOT"; sudo test ! -e "$EXECUTOR_SERVICE_BACKUP"; sudo test ! -e "$EXECUTOR_TIMER_BACKUP"
  sudo cp -p "$EXECUTOR_SERVICE_UNIT" "$EXECUTOR_SERVICE_BACKUP"; sudo cp -p "$EXECUTOR_TIMER_UNIT" "$EXECUTOR_TIMER_BACKUP"; sudo chown root:root "$EXECUTOR_SERVICE_BACKUP" "$EXECUTOR_TIMER_BACKUP"; sudo chmod 0600 "$EXECUTOR_SERVICE_BACKUP" "$EXECUTOR_TIMER_BACKUP"
  EXECUTOR_UNITS_PREEXISTING=1; sudo systemctl stop awh-native-executor.timer; sudo systemctl stop awh-native-executor.service >/dev/null 2>&1 || true; EXECUTOR_TIMER_STOPPED=1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM control_task_executions WHERE state IN ('LEASED','RUNNING');")" = 0; stage NATIVE_EXECUTOR_QUIESCED
  DB_MUTATED=1
  if test "$M13_REFRESH" -eq 0; then stage ANYWHERE_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$ANYWHERE_MIGRATION" "$DB" >/dev/null; fi
  stage ANYWHERE_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$ANYWHERE_MIGRATION" "$DB" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 13; test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm13-anywhere-execution-fabric' AND schema_version = 13;")" = 1
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok; test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"; stage ANYWHERE_MIGRATION_VERIFIED; stage PROJECTS_READY
elif test "$CENTRAL_PROJECT_AUTHORITY" = 1; then
  # M12 supports both first v11-to-v12 activation and source-only refresh over v12.
  stage WORKSPACE_PRESERVED
  M12_START_VERSION=$(sudo sqlite3 "$DB" 'PRAGMA user_version;')
  case "$M12_START_VERSION" in 11|12) ;; *) exit 20 ;; esac
  if test "$M12_START_VERSION" = 11; then
    test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm11-self-service' AND schema_version = 11;")" = 1
  else
    M12_REFRESH=1
    test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm12-central-project-authority' AND schema_version = 12;")" = 1
  fi
  sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$OWNER_AUTH_RUNTIME" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
  test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  stage PROJECT_VAULT_RUNTIME_READY; sudo -u awh-hub /usr/bin/php -r 'exit((extension_loaded("pdo_sqlite") && class_exists("ZipArchive")) ? 0 : 1);'
  stage PROJECT_VAULT_STORAGE_READY; sudo install -d -o awh-hub -g awh-hub -m 0750 /var/lib/awh-hub/project-vault /var/lib/awh-hub/task-workspaces /var/lib/awh-hub/task-transfers; sudo -u awh-hub test -w /var/lib/awh-hub/project-vault; sudo -u awh-hub test -w /var/lib/awh-hub/task-workspaces; sudo -u awh-hub test -w /var/lib/awh-hub/task-transfers
  stage ARTIFACT_STORAGE_READY; sudo install -d -o awh-hub -g awh-hub -m 0750 /var/lib/awh-hub/artifacts; sudo -u awh-hub test -w /var/lib/awh-hub/artifacts
  if test "$M12_REFRESH" -eq 1; then
    test -f "$EXECUTOR_SERVICE_UNIT" && test -f "$EXECUTOR_TIMER_UNIT"
    test "$PREVIOUS_POINTER" = PRESENT
    sudo cmp -s "$EXECUTOR_SERVICE_UNIT" "$PREVIOUS_TARGET/deploy/systemd/awh-native-executor.service"
    sudo cmp -s "$EXECUTOR_TIMER_UNIT" "$PREVIOUS_TARGET/deploy/systemd/awh-native-executor.timer"
    sudo install -d -o root -g root -m 0750 "$EXECUTOR_BACKUP_ROOT"
    sudo test ! -e "$EXECUTOR_SERVICE_BACKUP"; sudo test ! -e "$EXECUTOR_TIMER_BACKUP"
    sudo cp -p "$EXECUTOR_SERVICE_UNIT" "$EXECUTOR_SERVICE_BACKUP"; sudo cp -p "$EXECUTOR_TIMER_UNIT" "$EXECUTOR_TIMER_BACKUP"
    sudo chown root:root "$EXECUTOR_SERVICE_BACKUP" "$EXECUTOR_TIMER_BACKUP"; sudo chmod 0600 "$EXECUTOR_SERVICE_BACKUP" "$EXECUTOR_TIMER_BACKUP"
    EXECUTOR_UNITS_PREEXISTING=1
    sudo systemctl stop awh-native-executor.timer
    sudo systemctl stop awh-native-executor.service >/dev/null 2>&1 || true
    EXECUTOR_TIMER_STOPPED=1
    test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM control_task_executions WHERE state IN ('LEASED','RUNNING');")" = 0
    stage CENTRAL_PROJECT_MIGRATION_VERIFIED
  else
    DB_MUTATED=1; stage CENTRAL_PROJECT_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$CENTRAL_PROJECT_MIGRATION" "$DB" >/dev/null
    stage CENTRAL_PROJECT_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$CENTRAL_PROJECT_MIGRATION" "$DB" >/dev/null
    test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 12
    test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm12-central-project-authority' AND schema_version = 12;")" = 1
    test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
    test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
    stage CENTRAL_PROJECT_MIGRATION_VERIFIED
  fi
  stage PROJECTS_READY
elif test "$SELF_SERVICE" = 1 && test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 11; then
  # A self-service UI hotfix may be activated over an already-live M11
  # database. Preserve the canonical v11 authority and verify it instead of
  # replaying the historical v7-to-v11 chain.
  stage WORKSPACE_PRESERVED
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm4-control-plane' AND schema_version = 4;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm5-owner-auth' AND schema_version = 5;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm6-assistant-workstream' AND schema_version = 6;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm7-workspace-continuity' AND schema_version = 7;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm8-unified-workspace' AND schema_version = 8;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm9-final-product' AND schema_version = 9;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm10-founding-memory' AND schema_version = 10;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm11-self-service' AND schema_version = 11;")" = 1
  sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$OWNER_AUTH_RUNTIME" >/dev/null
  test "$(sudo sqlite3 "$DB" 'SELECT count(*) FROM owner_bootstrap b JOIN owner_passwords p ON p.user_id = b.owner_user_id WHERE b.singleton_id = 1 AND b.bootstrap_closed = 1 AND p.enabled = 1 AND length(p.password_hash) > 20;')" = 1
  test -d /var/lib/awh-hub/attachments
  test -d /var/lib/awh-hub/provider-credentials
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
  test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  stage SELF_SERVICE_MIGRATION_VERIFIED
  stage PROJECTS_READY
elif test "$SELF_SERVICE" = 1; then
  # M11 is one bounded activation from the known M7 production baseline. It
  # reuses the M8/M9/M10 authorities, then adds only provider-secret metadata
  # and the protected empty server-side credential directory. No credential is
  # provisioned during deployment.
  stage WORKSPACE_PRESERVED
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 7
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm4-control-plane' AND schema_version = 4;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm5-owner-auth' AND schema_version = 5;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm6-assistant-workstream' AND schema_version = 6;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm7-workspace-continuity' AND schema_version = 7;")" = 1
  sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$OWNER_AUTH_RUNTIME" >/dev/null
  test "$(sudo sqlite3 "$DB" 'SELECT count(*) FROM owner_bootstrap b JOIN owner_passwords p ON p.user_id = b.owner_user_id WHERE b.singleton_id = 1 AND b.bootstrap_closed = 1 AND p.enabled = 1 AND length(p.password_hash) > 20;')" = 1
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
  test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  DB_MUTATED=1
  stage UNIFIED_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$UNIFIED_MIGRATION" "$DB" "$RELEASE/hub/migrations/007_unified_workspace.sql" >/dev/null
  stage UNIFIED_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$UNIFIED_MIGRATION" "$DB" "$RELEASE/hub/migrations/007_unified_workspace.sql" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 8
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm8-unified-workspace' AND schema_version = 8;")" = 1
  stage UNIFIED_MIGRATION_VERIFIED
  stage ATTACHMENT_STORAGE_READY; sudo install -d -o awh-hub -g awh-hub -m 0750 /var/lib/awh-hub/attachments; sudo -u awh-hub test -w /var/lib/awh-hub/attachments
  stage FINAL_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" AWH_ATTACHMENT_ROOT=/var/lib/awh-hub/attachments /usr/bin/php "$FINAL_MIGRATION" "$DB" >/dev/null
  stage FINAL_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" AWH_ATTACHMENT_ROOT=/var/lib/awh-hub/attachments /usr/bin/php "$FINAL_MIGRATION" "$DB" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 9
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm9-final-product' AND schema_version = 9;")" = 1
  stage FINAL_MIGRATION_VERIFIED
  stage FOUNDING_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$FOUNDING_MIGRATION" "$DB" >/dev/null
  stage FOUNDING_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$FOUNDING_MIGRATION" "$DB" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 10
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm10-founding-memory' AND schema_version = 10;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM control_memory_import_batches WHERE provenance = 'Founding Memory Migration' AND rolled_back_at IS NULL;")" = 1
  stage FOUNDING_MIGRATION_VERIFIED
  stage PROVIDER_CREDENTIAL_STORAGE_READY; sudo install -d -o awh-hub -g awh-hub -m 0700 /var/lib/awh-hub/provider-credentials; sudo -u awh-hub test -w /var/lib/awh-hub/provider-credentials
  stage SELF_SERVICE_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$SELF_SERVICE_MIGRATION" "$DB" >/dev/null
  stage SELF_SERVICE_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$SELF_SERVICE_MIGRATION" "$DB" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 11
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm11-self-service' AND schema_version = 11;")" = 1
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
  test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  stage SELF_SERVICE_MIGRATION_VERIFIED
  stage PROJECTS_READY
elif test "$FOUNDING_MEMORY" = 1; then
  # M10 is the one bounded activation from the actual deployed M7 baseline.
  # It chains the reviewed M8/M9 authorities and then imports only curated,
  # owner-private Founding Memory records. It never seeds a Project or replays
  # historical M3E/M4/M5/M6/M7 migrations.
  stage WORKSPACE_PRESERVED
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 7
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm4-control-plane' AND schema_version = 4;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm5-owner-auth' AND schema_version = 5;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm6-assistant-workstream' AND schema_version = 6;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm7-workspace-continuity' AND schema_version = 7;")" = 1
  sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$OWNER_AUTH_RUNTIME" >/dev/null
  test "$(sudo sqlite3 "$DB" 'SELECT count(*) FROM owner_bootstrap b JOIN owner_passwords p ON p.user_id = b.owner_user_id WHERE b.singleton_id = 1 AND b.bootstrap_closed = 1 AND p.enabled = 1 AND length(p.password_hash) > 20;')" = 1
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
  test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  DB_MUTATED=1; stage UNIFIED_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$UNIFIED_MIGRATION" "$DB" "$RELEASE/hub/migrations/007_unified_workspace.sql" >/dev/null
  stage UNIFIED_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$UNIFIED_MIGRATION" "$DB" "$RELEASE/hub/migrations/007_unified_workspace.sql" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 8
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm8-unified-workspace' AND schema_version = 8;")" = 1
  stage UNIFIED_MIGRATION_VERIFIED
  stage ATTACHMENT_STORAGE_READY; sudo install -d -o awh-hub -g awh-hub -m 0750 /var/lib/awh-hub/attachments; sudo -u awh-hub test -w /var/lib/awh-hub/attachments
  stage FINAL_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" AWH_ATTACHMENT_ROOT=/var/lib/awh-hub/attachments /usr/bin/php "$FINAL_MIGRATION" "$DB" >/dev/null
  stage FINAL_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" AWH_ATTACHMENT_ROOT=/var/lib/awh-hub/attachments /usr/bin/php "$FINAL_MIGRATION" "$DB" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 9
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm9-final-product' AND schema_version = 9;")" = 1
  stage FINAL_MIGRATION_VERIFIED
  stage FOUNDING_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$FOUNDING_MIGRATION" "$DB" >/dev/null
  stage FOUNDING_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$FOUNDING_MIGRATION" "$DB" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 10
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm10-founding-memory' AND schema_version = 10;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM control_memory_import_batches WHERE provenance = 'Founding Memory Migration' AND rolled_back_at IS NULL;")" = 1
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
  test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  stage FOUNDING_MIGRATION_VERIFIED
  stage PROJECTS_READY
elif test "$FINAL_PRODUCT" = 1; then
  # The final activation is the only path from the actual deployed v7 baseline.
  # It applies the already-reviewed M8 authority first, then the additive M9
  # product layer; no historical M3E/M4/M5/M6/M7 migration is replayed.
  stage WORKSPACE_PRESERVED
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 7
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm4-control-plane' AND schema_version = 4;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm5-owner-auth' AND schema_version = 5;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm6-assistant-workstream' AND schema_version = 6;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm7-workspace-continuity' AND schema_version = 7;")" = 1
  sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$OWNER_AUTH_RUNTIME" >/dev/null
  test "$(sudo sqlite3 "$DB" 'SELECT count(*) FROM owner_bootstrap b JOIN owner_passwords p ON p.user_id = b.owner_user_id WHERE b.singleton_id = 1 AND b.bootstrap_closed = 1 AND p.enabled = 1 AND length(p.password_hash) > 20;')" = 1
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
  test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  DB_MUTATED=1; stage UNIFIED_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$UNIFIED_MIGRATION" "$DB" "$RELEASE/hub/migrations/007_unified_workspace.sql" >/dev/null
  stage UNIFIED_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$UNIFIED_MIGRATION" "$DB" "$RELEASE/hub/migrations/007_unified_workspace.sql" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 8
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm8-unified-workspace' AND schema_version = 8;")" = 1
  stage UNIFIED_MIGRATION_VERIFIED
  stage ATTACHMENT_STORAGE_READY; sudo install -d -o awh-hub -g awh-hub -m 0750 /var/lib/awh-hub/attachments; sudo -u awh-hub test -w /var/lib/awh-hub/attachments
  stage FINAL_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" AWH_ATTACHMENT_ROOT=/var/lib/awh-hub/attachments /usr/bin/php "$FINAL_MIGRATION" "$DB" >/dev/null
  stage FINAL_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" AWH_ATTACHMENT_ROOT=/var/lib/awh-hub/attachments /usr/bin/php "$FINAL_MIGRATION" "$DB" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 9
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm9-final-product' AND schema_version = 9;")" = 1
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
  test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  stage FINAL_MIGRATION_VERIFIED
  stage PROJECTS_READY
elif test "$UNIFIED_WORKSPACE" = 1; then
  # M8 is a strict v7-to-v8 extension. It preserves all M3E/M4/M5/M6/M7
  # authorities and adds only the Hub projection/configuration tables.
  stage WORKSPACE_PRESERVED
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 7
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm4-control-plane' AND schema_version = 4;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm5-owner-auth' AND schema_version = 5;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm6-assistant-workstream' AND schema_version = 6;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm7-workspace-continuity' AND schema_version = 7;")" = 1
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
  test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  DB_MUTATED=1; stage UNIFIED_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$UNIFIED_MIGRATION" "$DB" "$RELEASE/hub/migrations/007_unified_workspace.sql" >/dev/null
  stage UNIFIED_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$UNIFIED_MIGRATION" "$DB" "$RELEASE/hub/migrations/007_unified_workspace.sql" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 8
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm8-unified-workspace' AND schema_version = 8;")" = 1
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
  test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  stage UNIFIED_MIGRATION_VERIFIED
  stage PROJECTS_READY
elif test "$WORKSPACE_CONTINUITY" = 1; then
  # M7 is a release-locked v5-to-v7 extension. It applies the accepted M6
  # conversation migration once, then the M7 metadata-only workspace layer.
  # It never replays historical M3E/M4/M5 migrations or seeds a user project.
  stage OWNER_AUTH_PRESERVED
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 5
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm4-control-plane' AND schema_version = 4;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm5-owner-auth' AND schema_version = 5;")" = 1
  sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$OWNER_AUTH_RUNTIME" >/dev/null
  test "$(sudo sqlite3 "$DB" 'SELECT count(*) FROM owner_bootstrap b JOIN owner_passwords p ON p.user_id = b.owner_user_id WHERE b.singleton_id = 1 AND b.bootstrap_closed = 1 AND p.enabled = 1 AND length(p.password_hash) > 20;')" = 1
  DB_MUTATED=1; stage ASSISTANT_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$ASSISTANT_MIGRATION" "$DB" "$RELEASE/hub/migrations/005_assistant_workstream.sql" >/dev/null
  stage ASSISTANT_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$ASSISTANT_MIGRATION" "$DB" "$RELEASE/hub/migrations/005_assistant_workstream.sql" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 6
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm6-assistant-workstream' AND schema_version = 6;")" = 1
  stage ASSISTANT_MIGRATION_VERIFIED
  stage WORKSPACE_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$WORKSPACE_MIGRATION" "$DB" "$RELEASE/hub/migrations/006_workspace_continuity.sql" >/dev/null
  stage WORKSPACE_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$WORKSPACE_MIGRATION" "$DB" "$RELEASE/hub/migrations/006_workspace_continuity.sql" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 7
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm7-workspace-continuity' AND schema_version = 7;")" = 1
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
  test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  stage WORKSPACE_MIGRATION_VERIFIED
  stage PROJECTS_READY
elif test "$ASSISTANT_WORKSTREAM" = 1; then
  # M6 is additive to a healthy owner-auth M5 database. It never replays M3E,
  # M4 or M5 and it does not provision a second owner/password binding.
  stage OWNER_AUTH_PRESERVED
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 5
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm4-control-plane' AND schema_version = 4;")" = 1
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm5-owner-auth' AND schema_version = 5;")" = 1
  sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$OWNER_AUTH_RUNTIME" >/dev/null
  test "$(sudo sqlite3 "$DB" 'SELECT count(*) FROM owner_bootstrap b JOIN owner_passwords p ON p.user_id = b.owner_user_id WHERE b.singleton_id = 1 AND b.bootstrap_closed = 1 AND p.enabled = 1 AND length(p.password_hash) > 20;')" = 1
  DB_MUTATED=1; stage ASSISTANT_MIGRATION_FIRST; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$ASSISTANT_MIGRATION" "$DB" "$RELEASE/hub/migrations/005_assistant_workstream.sql" >/dev/null
  stage ASSISTANT_MIGRATION_IDEMPOTENT; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$ASSISTANT_MIGRATION" "$DB" "$RELEASE/hub/migrations/005_assistant_workstream.sql" >/dev/null
  test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 6
  test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm6-assistant-workstream' AND schema_version = 6;")" = 1
  test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
  test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
  stage ASSISTANT_MIGRATION_VERIFIED
  stage PROJECTS_READY
elif test "$COMPAT_REFRESH" = 1; then
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
if test "$CENTRAL_PROJECT_AUTHORITY" = 1 || test "$ANYWHERE_EXECUTION" = 1 || test "$COST_AWARE_AI" = 1 || test "$AUTOMATIONS" = 1 || test "$SELF_SUFFICIENT_AI" = 1; then
  # M12 first activation may create units; all later authority refreshes require proven managed units.
  if test "$SELF_SUFFICIENT_AI" = 1 || test "$AUTOMATIONS" = 1 || test "$COST_AWARE_AI" = 1 || test "$ANYWHERE_EXECUTION" = 1; then test "$EXECUTOR_UNITS_PREEXISTING" -eq 1; elif test "$M12_REFRESH" -eq 0; then test ! -e "$EXECUTOR_SERVICE_UNIT" && test ! -e "$EXECUTOR_TIMER_UNIT"; else test "$EXECUTOR_UNITS_PREEXISTING" -eq 1; fi
  sudo install -o root -g root -m 0644 "$RELEASE/deploy/systemd/awh-native-executor.service" "$EXECUTOR_SERVICE_UNIT"
  sudo install -o root -g root -m 0644 "$RELEASE/deploy/systemd/awh-native-executor.timer" "$EXECUTOR_TIMER_UNIT"
  EXECUTOR_UNITS_INSTALLED=1
  sudo systemctl daemon-reload
  sudo systemctl enable --now awh-native-executor.timer >/dev/null
  sudo systemctl is-enabled --quiet awh-native-executor.timer
  sudo systemctl is-active --quiet awh-native-executor.timer
  stage NATIVE_EXECUTOR_UNITS_READY
fi
stage PHP_FPM_RELOAD; reload_awh_php_fpm
web_pointer_capture; sudo install -d -o awh-hub -g www-data -m 0750 /var/www/awh-web/releases; if sudo test -e "$WEB_RELEASE" || sudo test -L "$WEB_RELEASE"; then exit 20; fi; sudo install -d -o awh-hub -g www-data -m 0750 "$WEB_RELEASE"; WEB_CREATED=1; stage WEB_RELEASE_COPY; sudo cp -a "$RELEASE/dist-web/." "$WEB_RELEASE/"; rehydrate_desktop_artifacts; deduplicate_desktop_artifacts; sudo chown -R awh-hub:www-data "$WEB_RELEASE"; sudo find "$WEB_RELEASE" -type d -exec chmod 0750 {} +; sudo find "$WEB_RELEASE" -type f -exec chmod 0640 {} +; sudo -n -u awh-hub php "$RELEASE/deploy/awh-control-plane/verify-web-release.php" "$WEB_RELEASE"; stage WEB_MANIFEST_VERIFIED; stage WEB_ACCESS_READY; verify_web_access; stage WEB_POINTER_SWITCH; sudo rm -f "$WEB_POINTER_TMP"; sudo ln -s "$WEB_RELEASE" "$WEB_POINTER_TMP"; sudo mv -Tf "$WEB_POINTER_TMP" "$WEB_POINTER"; WEB_POINTER_CHANGED=1; test "$(readlink "$WEB_POINTER")" = "$WEB_RELEASE"; stage WEB_RELEASE_STAGED
stage NGINX_CUTOVER_INSTALL; sudo install -o root -g root -m 0644 "$NGINX_CANDIDATE" "$NGINX_CONFIG"; NGINX_CHANGED=1; stage NGINX_CONFIGURED; sudo nginx -t >/dev/null
stage SERVICE_RELOAD; sudo systemctl reload nginx
stage OWNER_AUTH_EFFECTIVE_CONFIG; verify_owner_auth_effective_config
stage OWNER_AUTH_SURFACE; verify_owner_auth_surface
if test "$ASSISTANT_WORKSTREAM" = 0 && test "$WORKSPACE_CONTINUITY" = 0 && test "$UNIFIED_WORKSPACE" = 0 && test "$FINAL_PRODUCT" = 0 && test "$FOUNDING_MEMORY" = 0 && test "$SELF_SERVICE" = 0 && test "$CENTRAL_PROJECT_AUTHORITY" = 0 && test "$ANYWHERE_EXECUTION" = 0 && test "$COST_AWARE_AI" = 0 && test "$AUTOMATIONS" = 0 && test "$SELF_SUFFICIENT_AI" = 0; then
  stage OWNER_AUTH_LOGIN; verify_owner_auth_login
  stage OWNER_AUTH_SESSION; session_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -H 'Sec-Fetch-Site: same-origin' -b "$OWNER_AUTH_COOKIE_JAR" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/auth/session" 2>/dev/null || printf 000); test "$session_code" = 200
  stage OWNER_AUTH_CONTROL; projects_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -H 'Sec-Fetch-Site: same-origin' -b "$OWNER_AUTH_COOKIE_JAR" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/projects" 2>/dev/null || printf 000); test "$projects_code" = 200; cleanup_owner_auth_cookie_files
fi
stage OWNER_AUTH_WEB_SURFACE; root_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/" 2>/dev/null || printf 000); test "$root_code" = 200; design_system_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/awh-design-system.css" 2>/dev/null || printf 000); test "$design_system_code" = 200; database_html_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/database.html" 2>/dev/null || printf 000); test "$database_html_code" = 200; infrastructure_html_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/infrastructure.html" 2>/dev/null || printf 000); test "$infrastructure_html_code" = 200; trust_html_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/trust.html" 2>/dev/null || printf 000); test "$trust_html_code" = 200; database_api_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -H 'Sec-Fetch-Site: same-origin' -o /dev/null -w '%{http_code}' "https://$HOSTNAME/database-studio.php?action=overview" 2>/dev/null || printf 000); test "$database_api_code" = 401; control_config_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /tmp/awh-control-web-config-$RELEASE_ID.json -w '%{http_code}' "https://$HOSTNAME/web-config.json" 2>/dev/null || printf 000); test "$control_config_code" = 200; grep -q '"mode": "CONTROL"' /tmp/awh-control-web-config-$RELEASE_ID.json; sudo rm -f /tmp/awh-control-web-config-$RELEASE_ID.json; preview_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/preview/" 2>/dev/null || printf 000); test "$preview_code" = 401
stage M3D_REGRESSION; verify_m3d
stage M3E_POST_SCHEMA_REGRESSION; verify_m3e_after_m4
if test "$ASSISTANT_WORKSTREAM" = 1; then stage ASSISTANT_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/conversations/423b45c0-23e1-408d-ae0f-ac5eca7f6900" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403; fi
if test "$WORKSPACE_CONTINUITY" = 1; then stage ASSISTANT_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/conversations/423b45c0-23e1-408d-ae0f-ac5eca7f6900" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403; stage WORKSPACE_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/workspaces/423b45c0-23e1-408d-ae0f-ac5eca7f6900" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403; fi
if test "$UNIFIED_WORKSPACE" = 1; then stage ASSISTANT_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/conversations/423b45c0-23e1-408d-ae0f-ac5eca7f6900" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403; stage WORKSPACE_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/workspaces/423b45c0-23e1-408d-ae0f-ac5eca7f6900" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403; stage UNIFIED_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/conversations?projectId=423b45c0-23e1-408d-ae0f-ac5eca7f6900" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403; fi
if test "$SELF_SERVICE" = 1; then
  # M11 route probes prove the staged control router owns the new protected
  # surfaces without configuring a provider, exposing a credential or creating
  # a browser session.
  stage ASSISTANT_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/conversations/423b45c0-23e1-408d-ae0f-ac5eca7f6900" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
  stage WORKSPACE_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/workspaces/423b45c0-23e1-408d-ae0f-ac5eca7f6900" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
  stage UNIFIED_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/product-identity" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
  stage FINAL_PRODUCT_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/provider" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
  stage FOUNDING_MEMORY_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/memory" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
  stage SELF_SERVICE_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/owner/status" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
  infrastructure_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/infrastructure" 2>/dev/null || printf 000); test "$infrastructure_code" = 401 || test "$infrastructure_code" = 403
  trust_code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/trust" 2>/dev/null || printf 000); test "$trust_code" = 401 || test "$trust_code" = 403
  code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/auth/profile" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
elif test "$FOUNDING_MEMORY" = 1; then
  # These unauthenticated probes prove routing and server-side authorization
  # only. They do not expose seed contents, create a conversation, or mutate
  # the imported Founding Memory batch.
  stage ASSISTANT_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/conversations/423b45c0-23e1-408d-ae0f-ac5eca7f6900" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
  stage WORKSPACE_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/workspaces/423b45c0-23e1-408d-ae0f-ac5eca7f6900" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
  stage UNIFIED_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/conversations?projectId=423b45c0-23e1-408d-ae0f-ac5eca7f6900" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
  stage FINAL_PRODUCT_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/provider" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
  stage FOUNDING_MEMORY_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/memory" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
fi
if test "$ANYWHERE_EXECUTION" = 1 || test "$COST_AWARE_AI" = 1 || test "$AUTOMATIONS" = 1 || test "$SELF_SUFFICIENT_AI" = 1; then stage ANYWHERE_EXECUTION_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/capabilities" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403; fi
if test "$COST_AWARE_AI" = 1 || test "$AUTOMATIONS" = 1 || test "$SELF_SUFFICIENT_AI" = 1; then stage COST_AWARE_AI_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/provider" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403; fi
if test "$CENTRAL_PROJECT_AUTHORITY" = 1; then
  # Authentication-only probes prove the staged release owns new central
  # authority routes without ingesting content or exposing Vault metadata.
  stage CENTRAL_PROJECT_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/system/readiness" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
  code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/projects/423b45c0-23e1-408d-ae0f-ac5eca7f6900/vault" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
fi
if test "$FINAL_PRODUCT" = 1; then
  # The final route proof is deliberately unauthenticated: it proves that the
  # intended release/router owns all M6/M7/M8/M9 surfaces without creating a
  # conversation, attachment, provider policy, or external AI request.
  stage ASSISTANT_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/conversations/423b45c0-23e1-408d-ae0f-ac5eca7f6900" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
  stage WORKSPACE_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/workspaces/423b45c0-23e1-408d-ae0f-ac5eca7f6900" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
  stage UNIFIED_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/conversations?projectId=423b45c0-23e1-408d-ae0f-ac5eca7f6900" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
  stage FINAL_PRODUCT_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/provider" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
  code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/attachments/423b45c0-23e1-408d-ae0f-ac5eca7f6900/download" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
fi
if test "$AUTOMATIONS" = 1 || test "$SELF_SUFFICIENT_AI" = 1; then stage AUTOMATION_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/automations" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403; fi
if test "$SELF_SUFFICIENT_AI" = 1; then stage AI_GOVERNANCE_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/ai" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403; fi
stage CONTROL_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/session" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
if test "$CENTRAL_PROJECT_AUTHORITY" = 1 || test "$ANYWHERE_EXECUTION" = 1 || test "$COST_AWARE_AI" = 1 || test "$AUTOMATIONS" = 1 || test "$SELF_SUFFICIENT_AI" = 1; then DB_MUTATED=1; stage PROJECT_VAULT_SOURCE_SYNC; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" AWH_PROJECT_VAULT_ROOT=/var/lib/awh-hub/project-vault /usr/bin/php "$RELEASE/hub/bin/sync-deployed-source-vault.php" "$DB" "$RELEASE/.awh-build/awh-source.zip" "$RELEASE_COMMIT" >/dev/null; fi
SUCCESS=1; printf '%s\n' 'DEPLOY_RESULT=PASS'; trap - EXIT HUP INT TERM; sudo rm -f "$REMOTE_STAGE" "$NGINX_BACKUP" "$NGINX_CANDIDATE" "$REMOTE_SCRIPT" "$CONTROL_INCLUDE_TMP" "$EXECUTOR_SERVICE_BACKUP" "$EXECUTOR_TIMER_BACKUP"; exit 0
