#!/bin/sh
set -eu
LC_ALL=C
export LC_ALL

TARGET=/etc/ssh/sshd_config.d/00-awh-hardening.conf
SOURCE=${AWH_SSH_HARDENING_SOURCE:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)/deploy/ssh/00-awh-hardening.conf}
BACKUP_ROOT=/var/backups/awh-hub/config/ssh
ADMIN_USER=${AWH_SSH_ADMIN_USER:-awh-remote}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)-$$
BACKUP="$BACKUP_ROOT/00-awh-hardening.conf.$STAMP"
PREVIOUS=ABSENT

test "$(id -u)" -eq 0 || { echo SSH_HARDENING_REQUIRES_ROOT >&2; exit 2; }
test -f "$SOURCE" || { echo SSH_HARDENING_SOURCE_MISSING >&2; exit 2; }
test -x /usr/sbin/sshd || { echo SSH_HARDENING_SSHD_MISSING >&2; exit 2; }

home=$(getent passwd "$ADMIN_USER" | awk -F: 'NR==1{print $6}')
test -n "$home" && test -s "$home/.ssh/authorized_keys" || { echo SSH_HARDENING_KEY_AUTHORITY_MISSING >&2; exit 2; }

mkdir -p "$BACKUP_ROOT" /etc/ssh/sshd_config.d
chmod 0750 "$BACKUP_ROOT"
if test -f "$TARGET"; then
  cp -p "$TARGET" "$BACKUP"
  PREVIOUS=PRESENT
else
  : > "$BACKUP.absent"
fi

reload_ssh() {
  if systemctl list-unit-files ssh.service 2>/dev/null | grep -q '^ssh\.service'; then systemctl reload ssh.service
  elif systemctl list-unit-files sshd.service 2>/dev/null | grep -q '^sshd\.service'; then systemctl reload sshd.service
  else return 1
  fi
}

rollback() {
  if test "$PREVIOUS" = PRESENT; then cp -p "$BACKUP" "$TARGET"; else rm -f "$TARGET"; fi
  /usr/sbin/sshd -t >/dev/null 2>&1 && reload_ssh >/dev/null 2>&1 || true
}
trap 'code=$?; if test "$code" -ne 0; then rollback; echo SSH_HARDENING_ROLLBACK=PASS >&2; fi; exit "$code"' EXIT HUP INT TERM

install -o root -g root -m 0644 "$SOURCE" "$TARGET"
/usr/sbin/sshd -t

effective=$(/usr/sbin/sshd -T -C "user=$ADMIN_USER,host=localhost,addr=127.0.0.1")
printf '%s\n' "$effective" | grep -qx 'passwordauthentication no'
printf '%s\n' "$effective" | grep -qx 'kbdinteractiveauthentication no'
printf '%s\n' "$effective" | grep -qx 'permitrootlogin no'
printf '%s\n' "$effective" | grep -qx 'pubkeyauthentication yes'
printf '%s\n' "$effective" | grep -qx 'maxauthtries 4'
printf '%s\n' "$effective" | grep -qx 'x11forwarding no'

reload_ssh
/usr/sbin/sshd -t
trap - EXIT HUP INT TERM

echo SSH_HARDENING=PASS
echo SSH_HARDENING_BACKUP="$BACKUP"
