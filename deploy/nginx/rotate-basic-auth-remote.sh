#!/bin/sh
set -eu

# Fixed, reviewed remote primitive. The only stdin value is the locally-derived
# APR1 record; no plaintext password is accepted here.
ID=${1-}
HOST=${2-}
USER_NAME=${3-}
ACTION=${4-rotate}
case "$ID" in r[0-9a-z-]*) ;; *) exit 20 ;; esac
case "$HOST" in [A-Za-z0-9.-]*) ;; *) exit 20 ;; esac
case "$USER_NAME" in awh-preview) ;; *) exit 20 ;; esac
case "$ACTION" in rotate|rollback|cleanup) ;; *) exit 20 ;; esac

F=/etc/nginx/.awh-preview-users
T=/etc/nginx/.awh-preview-users.$ID.tmp
B=/etc/nginx/.awh-preview-users.$ID.backup
X=/etc/nginx/.awh-preview-users.$ID.meta
MUTATED=0
stage(){ printf '%s\n' "ROTATE_STAGE=$1"; }
fail(){ printf '%s\n' "ROTATE_FAILED_AT=$1" "ROTATE_FAILURE_CODE=$2"; exit 1; }
if test "$ACTION" = cleanup; then
  sudo -n rm -f "$T" "$B" "$X" || exit 1
  printf '%s\n' 'ROTATE_RESULT=CLEANUP'
  exit 0
fi
if test "$ACTION" = rollback; then
  sudo -n test -f "$B" || exit 1
  sudo -n test ! -L "$F" || exit 1
  META=$(sudo -n cat "$X") || exit 1
  IFS=: read -r O G M <<EOF
$META
EOF
  sudo -n cp -p "$B" "$T" || exit 1
  sudo -n chown "$O:$G" "$T" || exit 1
  sudo -n chmod "$M" "$T" || exit 1
  sudo -n mv -f "$T" "$F" || exit 1
  sudo -n nginx -t >/dev/null 2>&1 || exit 1
  sudo -n systemctl reload nginx >/dev/null 2>&1 || exit 1
  sudo -n rm -f "$B" "$T" "$X" || exit 1
  printf '%s\n' 'ROLLBACK=PASS'
  exit 0
fi
rollback(){
  code=$?
  if test "$code" -eq 0 || test "$MUTATED" -ne 1; then
    sudo -n rm -f "$T" "$B" "$X" >/dev/null 2>&1 || true
    exit "$code"
  fi
  if sudo -n test -f "$B" && sudo -n test -f "$X" && META=$(sudo -n cat "$X") && IFS=: read -r O G M <<EOF
$META
EOF
sudo -n cp -p "$B" "$T" && sudo -n chown "$O:$G" "$T" && sudo -n chmod "$M" "$T" && sudo -n mv -f "$T" "$F" && sudo -n nginx -t >/dev/null 2>&1 && sudo -n systemctl reload nginx >/dev/null 2>&1; then
    printf '%s\n' 'ROLLBACK=PASS'
    sudo -n rm -f "$T" "$B" "$X" >/dev/null 2>&1 || true
  else
    printf '%s\n' 'ROLLBACK=FAIL'
    # B/X are the only recovery evidence for an uncertain remote state.
    # Retain them for an explicitly approved reconciliation operation.
    sudo -n rm -f "$T" >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap rollback EXIT HUP INT TERM

stage PRECHECK
sudo -n test -f "$F" || fail PRECHECK TARGET_MISSING
sudo -n test ! -L "$F" || fail PRECHECK TARGET_SYMLINK
O=$(sudo -n stat -c '%u' "$F") || fail PRECHECK METADATA_READ
G=$(sudo -n stat -c '%g' "$F") || fail PRECHECK METADATA_READ
M=$(sudo -n stat -c '%a' "$F") || fail PRECHECK METADATA_READ
test $((0$M & 0022)) -eq 0 || fail PRECHECK PERMISSIONS_TOO_BROAD
stage HASH_RECEIVED
H=$(cat) || fail HASH_RECEIVED HASH_INPUT_READ
printf '%s' "$H" | grep -Eq '^\$apr1\$[^$]{1,16}\$[A-Za-z0-9./]{20,}$' || fail HASH_RECEIVED HASH_FORMAT
stage BACKUP_CREATED
sudo -n cp -p "$F" "$B" || fail BACKUP_CREATED BACKUP_FAILED
sudo -n chmod 600 "$B" || fail BACKUP_CREATED BACKUP_METADATA_FAILED
printf '%s:%s:%s\n' "$O" "$G" "$M" | sudo -n tee "$X" >/dev/null || fail BACKUP_CREATED METADATA_WRITE_FAILED
sudo -n chmod 600 "$X" || fail BACKUP_CREATED METADATA_WRITE_FAILED
stage TEMP_CREATED
printf '%s:%s\n' "$USER_NAME" "$H" | sudo -n tee "$T" >/dev/null || fail TEMP_CREATED TEMP_WRITE_FAILED
sudo -n chown "$O:$G" "$T" || fail TEMP_CREATED TEMP_OWNER_FAILED
sudo -n chmod "$M" "$T" || fail TEMP_CREATED TEMP_MODE_FAILED
sudo -n test ! -L "$T" || fail TEMP_CREATED TEMP_SYMLINK
stage ATOMIC_REPLACE
sudo -n mv -f "$T" "$F" || fail ATOMIC_REPLACE RENAME_FAILED
MUTATED=1
stage NGINX_TEST
sudo -n nginx -t >/dev/null 2>&1 || fail NGINX_TEST CONFIG_INVALID
stage RELOAD
sudo -n systemctl reload nginx >/dev/null 2>&1 || fail RELOAD RELOAD_FAILED
stage PERIMETER_VERIFY
for P in / /api/v1/health /api/v1/status /api/v1/projects; do
  C=$(curl --silent --max-time 10 --resolve "$HOST:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$HOST$P" 2>/dev/null || printf 000)
  test "$C" = 401 || fail PERIMETER_VERIFY UNAUTHENTICATED_PERIMETER
done
stage COMPLETE
# Remote replacement is prepared, not committed. B/X remain for the
# cross-boundary public credential gate and possible rollback.
printf '%s\n' 'ROTATE_RESULT=REMOTE_READY'
trap - EXIT HUP INT TERM
sudo -n rm -f "$T"
