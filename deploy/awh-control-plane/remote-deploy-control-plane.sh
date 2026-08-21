#!/bin/sh

# Fixed-argument remote M4 activation. It prints allowlisted stage/result lines
# only. Raw stderr and all secret-bearing diagnostics are intentionally hidden.
set -eu
exec 2>/dev/null
DB=$1; REMOTE_ROOT=$2; REMOTE_STAGE=$3; RELEASE=$4; RELEASE_ID=$5; NGINX_CONFIG=$6; PHP_VERSION=$7; HOSTNAME=$8
case "$DB" in /var/lib/awh-hub/*|/opt/awh-hub/*|/srv/awh/*) ;; *) exit 20 ;; esac
case "$REMOTE_ROOT" in /opt/awh-hub) ;; *) exit 20 ;; esac
case "$REMOTE_STAGE" in /tmp/awh-control-plane-*.tar.gz) ;; *) exit 20 ;; esac
case "$RELEASE" in /opt/awh-hub/control-releases/*) ;; *) exit 20 ;; esac
case "$RELEASE_ID" in m4-[0-9a-fA-F]*) ;; *) exit 20 ;; esac
case "$NGINX_CONFIG" in /etc/nginx/sites-enabled/*) ;; *) exit 20 ;; esac
case "$PHP_VERSION" in [0-9]*.[0-9]*) ;; *) exit 20 ;; esac
case "$HOSTNAME" in ''|*[!A-Za-z0-9.-]*|.*|*.) exit 20 ;; esac

BACKUP=/var/backups/awh-hub/awh.sqlite.pre-$RELEASE_ID
POINTER=$REMOTE_ROOT/control-plane-current
POINTER_TMP=$REMOTE_ROOT/.control-plane-current-$RELEASE_ID
NGINX_BACKUP=$NGINX_CONFIG.$RELEASE_ID
WEB_RELEASE=/var/www/awh-web/releases/$RELEASE_ID
WEB_POINTER=/var/www/awh-web/current
WEB_POINTER_TMP=/var/www/awh-web/.current-$RELEASE_ID
RELEASE_CREATED=0; WEB_CREATED=0; DB_MUTATED=0; POINTER_CHANGED=0; WEB_POINTER_CHANGED=0; NGINX_CHANGED=0; SUCCESS=0; CURRENT_STAGE=PREPARE

stage() { printf '%s\n' "DEPLOY_STAGE=$1"; CURRENT_STAGE=$1; }
verify_m3d() { for path in /api/v1/health /api/v1/status /api/v1/projects; do code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME$path" 2>/dev/null || printf 000); test "$code" = 401 || return 1; done; }
pointer_capture() { PREVIOUS_POINTER=ABSENT; PREVIOUS_TARGET=; if test -L "$POINTER"; then PREVIOUS_TARGET=$(readlink "$POINTER"); case "$PREVIOUS_TARGET" in /opt/awh-hub/control-releases/*) test -d "$PREVIOUS_TARGET" || return 1 ;; *) return 1 ;; esac; PREVIOUS_POINTER=PRESENT; elif test -e "$POINTER"; then return 1; fi; }
pointer_restore() { if test "$PREVIOUS_POINTER" = ABSENT; then sudo rm -f "$POINTER"; test ! -e "$POINTER" && test ! -L "$POINTER"; else sudo rm -f "$POINTER"; sudo ln -s "$PREVIOUS_TARGET" "$POINTER"; test "$(readlink "$POINTER")" = "$PREVIOUS_TARGET"; fi; }
web_pointer_capture() { WEB_PREVIOUS=ABSENT; WEB_TARGET=; if test -L "$WEB_POINTER"; then WEB_TARGET=$(readlink "$WEB_POINTER"); case "$WEB_TARGET" in /var/www/awh-web/releases/*) test -d "$WEB_TARGET" || return 1 ;; *) return 1 ;; esac; WEB_PREVIOUS=PRESENT; elif test -e "$WEB_POINTER"; then return 1; fi; }
web_pointer_restore() { if test "$WEB_PREVIOUS" = ABSENT; then sudo rm -f "$WEB_POINTER"; test ! -e "$WEB_POINTER" && test ! -L "$WEB_POINTER"; else sudo rm -f "$WEB_POINTER"; sudo ln -s "$WEB_TARGET" "$WEB_POINTER"; test "$(readlink "$WEB_POINTER")" = "$WEB_TARGET"; fi; }
rollback() { status=$?; if test "$SUCCESS" -eq 0; then ok=1; if test "$DB_MUTATED" -eq 1; then sudo sqlite3 "$BACKUP" 'PRAGMA integrity_check;' >/dev/null || ok=0; sudo sqlite3 "$BACKUP" 'PRAGMA foreign_key_check;' >/dev/null || ok=0; sudo sqlite3 "$DB" ".restore '$BACKUP'" >/dev/null || ok=0; fi; if test "$POINTER_CHANGED" -eq 1; then pointer_restore || ok=0; fi; if test "$WEB_POINTER_CHANGED" -eq 1; then web_pointer_restore || ok=0; fi; if test "$NGINX_CHANGED" -eq 1; then sudo cp -p "$NGINX_BACKUP" "$NGINX_CONFIG" || ok=0; fi; if test "$NGINX_CHANGED" -eq 1 || test "$POINTER_CHANGED" -eq 1; then sudo nginx -t >/dev/null || ok=0; fi; if test "$ok" -eq 1 && test "$NGINX_CHANGED" -eq 1; then sudo systemctl reload nginx || ok=0; fi; if test "$ok" -eq 1; then verify_m3d || ok=0; fi; sudo rm -rf "$RELEASE" "$WEB_RELEASE" >/dev/null 2>&1 || true; sudo rm -f "$REMOTE_STAGE" "$POINTER_TMP" "$WEB_POINTER_TMP" >/dev/null 2>&1 || true; printf '%s\n' "DEPLOY_FAILED_AT=$CURRENT_STAGE"; printf '%s\n' "ROLLBACK=$([ "$ok" -eq 1 ] && echo PASS || echo FAIL)"; fi; if test "$status" -eq 0; then status=1; fi; exit "$status"; }
trap rollback EXIT HUP INT TERM

sudo test -f "$DB"; sudo test -f "$REMOTE_STAGE"; pointer_capture; stage PREMUTATION_READY
sudo install -d -o root -g root -m 0750 /var/backups/awh-hub
sudo sqlite3 "$DB" ".backup '$BACKUP'"; sudo chown root:root "$BACKUP"; sudo chmod 0600 "$BACKUP"; test "$(sudo sqlite3 "$BACKUP" 'PRAGMA integrity_check;')" = ok; test -z "$(sudo sqlite3 "$BACKUP" 'PRAGMA foreign_key_check;')"; stage BACKUP_VERIFIED
if sudo test -e "$RELEASE" || sudo test -L "$RELEASE"; then exit 20; fi
sudo install -d -o awh-hub -g awh-hub -m 0750 "$RELEASE"; RELEASE_CREATED=1; sudo tar -xzf "$REMOTE_STAGE" -C "$RELEASE"; sudo chown -R awh-hub:awh-hub "$RELEASE"; sudo test -f "$RELEASE/hub/public/control-plane.php"; sudo test -f "$RELEASE/hub/bin/migrate-m4.php"; sudo -u awh-hub test -r "$RELEASE/hub/src/HubControlPlaneService.php"; stage RELEASE_STAGED
DB_MUTATED=1; sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$RELEASE/hub/bin/migrate-m4.php" "$DB" "$RELEASE/hub/migrations/003_m4_control_plane.sql" >/dev/null; stage MIGRATION_FIRST_PASS
sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$RELEASE/hub/bin/migrate-m4.php" "$DB" "$RELEASE/hub/migrations/003_m4_control_plane.sql" >/dev/null; stage MIGRATION_IDEMPOTENT
test "$(sudo sqlite3 "$DB" 'PRAGMA user_version;')" = 4
test "$(sudo sqlite3 "$DB" "SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm4-control-plane';")" = 1
test "$(sudo sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
test -z "$(sudo sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
stage MIGRATION_VERIFIED
sudo -u awh-hub env AWH_HUB_DB_PATH="$DB" /usr/bin/php "$RELEASE/hub/bin/register-m4-projects.php" >/dev/null; stage PROJECTS_READY
sudo rm -f "$POINTER_TMP"; sudo ln -s "$RELEASE" "$POINTER_TMP"; sudo mv -Tf "$POINTER_TMP" "$POINTER"; POINTER_CHANGED=1; test "$(readlink "$POINTER")" = "$RELEASE"; stage CONTROL_POINTER
web_pointer_capture; sudo install -d -o awh-hub -g awh-hub -m 0750 /var/www/awh-web/releases; if sudo test -e "$WEB_RELEASE" || sudo test -L "$WEB_RELEASE"; then exit 20; fi; sudo install -d -o awh-hub -g awh-hub -m 0750 "$WEB_RELEASE"; WEB_CREATED=1; stage WEB_RELEASE_COPY; sudo cp -a "$RELEASE/dist-web/." "$WEB_RELEASE/"; sudo chown -R awh-hub:awh-hub "$WEB_RELEASE"; stage WEB_POINTER_SWITCH; sudo rm -f "$WEB_POINTER_TMP"; sudo ln -s "$WEB_RELEASE" "$WEB_POINTER_TMP"; sudo mv -Tf "$WEB_POINTER_TMP" "$WEB_POINTER"; WEB_POINTER_CHANGED=1; test "$(readlink "$WEB_POINTER")" = "$WEB_RELEASE"; stage WEB_RELEASE_STAGED
CONTROL_INCLUDE=$REMOTE_ROOT/control-plane-current/deploy/nginx/awh-control-plane.conf; stage NGINX_INCLUDE_PREPARE; sudo sed "s/PREVIEW_HOSTNAME/$HOSTNAME/g" "$RELEASE/deploy/nginx/awh-control-plane.conf" > "$RELEASE/deploy/nginx/awh-control-plane.active.conf"; sudo install -o root -g root -m 0640 "$RELEASE/deploy/nginx/awh-control-plane.active.conf" "$RELEASE/deploy/nginx/awh-control-plane.conf"; sudo cp -p "$NGINX_CONFIG" "$NGINX_BACKUP"; NGINX_TMP=$(sudo mktemp /tmp/awh-control-nginx.XXXXXX); stage NGINX_INCLUDE_INSERT; sudo /usr/bin/php "$RELEASE/deploy/awh-enrollment/insert-nginx-include.php" "$NGINX_CONFIG" "$NGINX_TMP" "$CONTROL_INCLUDE"; sudo install -o root -g root -m 0644 "$NGINX_TMP" "$NGINX_CONFIG"; sudo rm -f "$NGINX_TMP"; NGINX_CHANGED=1; stage NGINX_CONFIGURED; sudo nginx -t >/dev/null
stage SERVICE_RELOAD; sudo systemctl reload nginx
stage M3D_REGRESSION; verify_m3d
stage CONTROL_ROUTE; code=$(curl --silent --max-time 10 --resolve "$HOSTNAME:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOSTNAME/api/v1/control/session" 2>/dev/null || printf 000); test "$code" = 401 || test "$code" = 403
SUCCESS=1; printf '%s\n' 'DEPLOY_RESULT=PASS'; trap - EXIT HUP INT TERM; sudo rm -f "$REMOTE_STAGE" "$NGINX_BACKUP"; exit 0
