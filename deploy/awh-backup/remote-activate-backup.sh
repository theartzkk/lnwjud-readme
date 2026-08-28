#!/bin/sh
set -eu

SHORT=${1:-}
SERVICE_SHA=${2:-}
TIMER_SHA=${3:-}
WRAPPER_SHA=${4:-}
case "$SHORT" in *[!0-9a-f]*|'') exit 64 ;; esac
test "${#SHORT}" -eq 12 || exit 64
for hash in "$SERVICE_SHA" "$TIMER_SHA" "$WRAPPER_SHA"; do case "$hash" in *[!0-9a-f]*|'') exit 64 ;; esac; test "${#hash}" -eq 64 || exit 64; done

STAGE="/tmp/awh-backup-activate-$SHORT"
SERVICE_STAGE="$STAGE/awh-backup.service"
TIMER_STAGE="$STAGE/awh-backup.timer"
SERVICE_UNIT=/etc/systemd/system/awh-backup.service
TIMER_UNIT=/etc/systemd/system/awh-backup.timer
POINTER=/opt/awh-hub/control-plane-current
EXPECTED_RELEASE="/opt/awh-hub/control-releases/m15-$SHORT"
WRAPPER="$POINTER/hub/bin/scheduled-backup.php"
DB=/var/lib/awh-hub/awh.sqlite
BACKUP_ROOT=/var/backups/awh-hub
STATE_BACKUP="$BACKUP_ROOT/config/systemd/backup-activate-$SHORT"

sha256() { sha256sum "$1" | awk '{print $1}'; }
test "$(sha256 "$SERVICE_STAGE")" = "$SERVICE_SHA"
test "$(sha256 "$TIMER_STAGE")" = "$TIMER_SHA"
test "$(readlink -f "$POINTER")" = "$EXPECTED_RELEASE"
test -f "$WRAPPER" && test ! -L "$WRAPPER" && test "$(sha256 "$WRAPPER")" = "$WRAPPER_SHA"
test "$(sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
test -z "$(sqlite3 "$DB" 'PRAGMA foreign_key_check;')"
test "$(sqlite3 "$DB" 'PRAGMA user_version;')" -ge 15
systemd-analyze verify "$SERVICE_STAGE" "$TIMER_STAGE" >/dev/null

PRE_SERVICE=0; PRE_TIMER=0
PRE_ENABLED=$(systemctl is-enabled awh-backup.timer 2>/dev/null || true)
PRE_ACTIVE=$(systemctl is-active awh-backup.timer 2>/dev/null || true)
sudo install -d -m 0750 -o root -g root "$STATE_BACKUP"
if sudo test -f "$SERVICE_UNIT"; then PRE_SERVICE=1; sudo cp -p "$SERVICE_UNIT" "$STATE_BACKUP/awh-backup.service"; fi
if sudo test -f "$TIMER_UNIT"; then PRE_TIMER=1; sudo cp -p "$TIMER_UNIT" "$STATE_BACKUP/awh-backup.timer"; fi
SUCCESS=0

rollback() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$SUCCESS" -ne 1; then
    sudo systemctl disable --now awh-backup.timer >/dev/null 2>&1 || true
    if test "$PRE_SERVICE" -eq 1; then sudo cp -p "$STATE_BACKUP/awh-backup.service" "$SERVICE_UNIT"; else sudo rm -f "$SERVICE_UNIT"; fi
    if test "$PRE_TIMER" -eq 1; then sudo cp -p "$STATE_BACKUP/awh-backup.timer" "$TIMER_UNIT"; else sudo rm -f "$TIMER_UNIT"; fi
    sudo systemctl daemon-reload >/dev/null 2>&1 || true
    if test "$PRE_ENABLED" = enabled; then sudo systemctl enable awh-backup.timer >/dev/null 2>&1 || true; else sudo systemctl disable awh-backup.timer >/dev/null 2>&1 || true; fi
    if test "$PRE_ACTIVE" = active; then sudo systemctl start awh-backup.timer >/dev/null 2>&1 || true; fi
    echo "AWH_BACKUP_ROLLBACK=PASS"
  fi
  exit "$status"
}
trap rollback EXIT HUP INT TERM
sudo install -o root -g root -m 0644 "$SERVICE_STAGE" "$SERVICE_UNIT"
sudo install -o root -g root -m 0644 "$TIMER_STAGE" "$TIMER_UNIT"
sudo systemctl daemon-reload
sudo systemctl enable --now awh-backup.timer >/dev/null
sudo systemctl is-enabled --quiet awh-backup.timer
sudo systemctl is-active --quiet awh-backup.timer
sudo systemctl start awh-backup.service
sudo systemctl is-failed --quiet awh-backup.service && exit 20 || true

LATEST_MANIFEST=$(find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'awh-*.sqlite.json' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)
test -n "$LATEST_MANIFEST"
case "$LATEST_MANIFEST" in "$BACKUP_ROOT"/awh-*.sqlite.json) ;; *) exit 21 ;; esac
LATEST_BACKUP=${LATEST_MANIFEST%.json}
test -f "$LATEST_BACKUP" && test ! -L "$LATEST_BACKUP" && test ! -L "$LATEST_MANIFEST"
test "$(stat -c '%U:%G %a' "$LATEST_BACKUP")" = 'root:awh-hub 640'
test "$(stat -c '%U:%G %a' "$LATEST_MANIFEST")" = 'root:awh-hub 640'
VERIFY=$(sudo -u awh-hub /usr/bin/php "$POINTER/hub/bin/backup.php" verify "$LATEST_BACKUP" "$LATEST_MANIFEST")
printf '%s' "$VERIFY" | grep -q '"status":"VERIFIED"'
printf '%s' "$VERIFY" | grep -q '"databaseUserVersion":15'
test "$(sqlite3 "$DB" 'PRAGMA integrity_check;')" = ok
test -z "$(sqlite3 "$DB" 'PRAGMA foreign_key_check;')"

SUCCESS=1
trap - EXIT HUP INT TERM
echo "AWH_BACKUP_TIMER=ACTIVE"
echo "AWH_BACKUP_ONE_SHOT=VERIFIED"
echo "AWH_BACKUP_ACTIVATION_REMOTE=PASS"
