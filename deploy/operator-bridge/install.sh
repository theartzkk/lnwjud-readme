#!/bin/sh
set -eu
ROOT=${AWH_RELEASE_ROOT:-/opt/awh-hub/control-plane-current}
SOCKET_UNIT=/etc/systemd/system/awh-operator-bridge.socket
SERVICE_UNIT=/etc/systemd/system/awh-operator-bridge@.service
CLIENT=/usr/local/bin/awh-operator
BACKUP_ROOT=/var/backups/awh-operator-bridge
STAGE_PARENT=/var/lib/awh-remote
STAGE_ROOT="$STAGE_PARENT/operator-staging"
EVIDENCE_ROOT=/var/lib/awh-hub/verification-evidence
EXPORT_ROOT=/var/lib/awh-hub/operator-exports
BAY_INBOX=/var/www/bay-production-shadow/current/updates/incoming
DROPIN_DIR=/etc/systemd/system/awh-operator-bridge@.service.d
LEGACY_DROPIN_A="$DROPIN_DIR/50-bay-production-shadow.conf"
LEGACY_DROPIN_B="$DROPIN_DIR/bay-production-shadow.conf"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$BACKUP_ROOT/$stamp"
[ "$(id -u)" -eq 0 ] || { echo AWH_OPERATOR_INSTALL_ROOT_REQUIRED >&2; exit 2; }
getent passwd awh-hub >/dev/null; getent passwd awh-remote >/dev/null
getent group awh-hub >/dev/null; getent group www-data >/dev/null; getent group bayadmin >/dev/null
getent group awh-operator >/dev/null || groupadd --system awh-operator
usermod -a -G awh-operator awh-hub
usermod -a -G awh-operator awh-remote
usermod -a -G awh-operator bayadmin
command -v getfacl >/dev/null; command -v setfacl >/dev/null
[ -d "$BAY_INBOX" ]
[ -r "$ROOT/hub/bin/awh-operator-bridge.php" ]
[ -r "$ROOT/hub/src/HubOperatorBridgeService.php" ]
[ -r "$ROOT/deploy/systemd/awh-operator-bridge.socket" ]
[ -r "$ROOT/deploy/systemd/awh-operator-bridge@.service" ]
[ -x "$ROOT/deploy/operator-bridge/awh-operator" ]
install -d -o root -g root -m 0700 "$backup"
getfacl -p "$STAGE_PARENT" >"$backup/stage-parent.acl"
getfacl -p "$BAY_INBOX" >"$backup/bay-inbox.acl"
legacy_dropin_a=0; legacy_dropin_b=0
[ -e "$LEGACY_DROPIN_A" ] && { cp -a "$LEGACY_DROPIN_A" "$backup/legacy-dropin-a.conf"; legacy_dropin_a=1; }
[ -e "$LEGACY_DROPIN_B" ] && { cp -a "$LEGACY_DROPIN_B" "$backup/legacy-dropin-b.conf"; legacy_dropin_b=1; }
stage_existed=0; [ -d "$STAGE_ROOT" ] && stage_existed=1
[ "$stage_existed" -eq 1 ] && getfacl -p "$STAGE_ROOT" >"$backup/stage-root.acl"
setfacl -m u:awh-hub:--x "$STAGE_PARENT"
setfacl -m u:awh-hub:rwx "$BAY_INBOX"
install -d -o awh-remote -g awh-operator -m 2770 "$STAGE_ROOT"
setfacl -m g::rwx,m::rwx "$STAGE_ROOT"
setfacl -m u:awh-hub:rwx "$STAGE_ROOT"
install -d -o awh-hub -g awh-hub -m 0700 "$EVIDENCE_ROOT"
install -d -o awh-hub -g awh-hub -m 0700 "$EXPORT_ROOT"
runuser -u awh-remote -- test -w "$STAGE_ROOT"
runuser -u awh-hub -- test -r "$STAGE_ROOT"
runuser -u awh-hub -- test -w "$STAGE_ROOT"
runuser -u awh-hub -- test -w "$EVIDENCE_ROOT"
runuser -u awh-hub -- test -w "$EXPORT_ROOT"
runuser -u bayadmin -- test -w "$STAGE_ROOT"
runuser -u awh-hub -G www-data -- test -w "$BAY_INBOX"
[ -d /srv/awh-git ] && runuser -u bayadmin -- test -w /srv/awh-git
for repo in awh.git bay-excuse-x.git bay-hub.git bay-learnlab.git bay-assessment.git school-website.git bay-computer-lab.git; do
  path="/srv/awh-git/$repo"
  [ -d "$path" ] || continue
  chgrp -R bayadmin "$path"
  find "$path" -type d -exec chmod g+rwx,g+s {} +
  find "$path" -type f -exec chmod g+rw {} +
  find "$path" -type d -exec setfacl -m g::rwx,m::rwx,d:g::rwx,d:m::rwx {} +
  find "$path" -type f -exec setfacl -m g::rw,m::rw {} +
  git --git-dir="$path" config core.sharedRepository group
  git config --system --get-all safe.directory | grep -Fx "$path" >/dev/null 2>&1 || git config --system --add safe.directory "$path"
  runuser -u bayadmin -- git --git-dir="$path" rev-parse --verify refs/heads/main >/dev/null
  runuser -u awh-hub -G bayadmin -- test -w "$path/objects"
  runuser -u awh-hub -G bayadmin -- test -w "$path/refs/heads"
done
old_socket=0; old_service=0; old_client=0
[ -e "$SOCKET_UNIT" ] && { cp -a "$SOCKET_UNIT" "$backup/socket"; old_socket=1; }
[ -e "$SERVICE_UNIT" ] && { cp -a "$SERVICE_UNIT" "$backup/service"; old_service=1; }
[ -e "$CLIENT" ] && { cp -a "$CLIENT" "$backup/client"; old_client=1; }
check=
rollback(){
  [ -n "$check" ] && rm -f "$check" || true
  setfacl --restore="$backup/stage-parent.acl" >/dev/null 2>&1 || true
  [ -f "$backup/stage-root.acl" ] && setfacl --restore="$backup/stage-root.acl" >/dev/null 2>&1 || true
  setfacl --restore="$backup/bay-inbox.acl" >/dev/null 2>&1 || true
  if [ "$legacy_dropin_a" -eq 1 ]; then install -d -o root -g root -m 0755 "$DROPIN_DIR"; cp -a "$backup/legacy-dropin-a.conf" "$LEGACY_DROPIN_A"; else rm -f "$LEGACY_DROPIN_A"; fi
  if [ "$legacy_dropin_b" -eq 1 ]; then install -d -o root -g root -m 0755 "$DROPIN_DIR"; cp -a "$backup/legacy-dropin-b.conf" "$LEGACY_DROPIN_B"; else rm -f "$LEGACY_DROPIN_B"; fi
  [ "$stage_existed" -eq 0 ] && rmdir "$STAGE_ROOT" >/dev/null 2>&1 || true
  systemctl disable --now awh-operator-bridge.socket >/dev/null 2>&1 || true
  if [ "$old_socket" -eq 1 ]; then cp -a "$backup/socket" "$SOCKET_UNIT"; else rm -f "$SOCKET_UNIT"; fi
  if [ "$old_service" -eq 1 ]; then cp -a "$backup/service" "$SERVICE_UNIT"; else rm -f "$SERVICE_UNIT"; fi
  if [ "$old_client" -eq 1 ]; then cp -a "$backup/client" "$CLIENT"; else rm -f "$CLIENT"; fi
  systemctl daemon-reload || true
  [ "$old_socket" -eq 1 ] && systemctl enable --now awh-operator-bridge.socket >/dev/null 2>&1 || true
}
committed=0
finish(){ rc=$?; trap - EXIT HUP INT TERM; if [ "$committed" -ne 1 ]; then rollback; fi; exit "$rc"; }
trap finish EXIT HUP INT TERM
install -o root -g root -m 0644 "$ROOT/deploy/systemd/awh-operator-bridge.socket" "$SOCKET_UNIT"
install -o root -g root -m 0644 "$ROOT/deploy/systemd/awh-operator-bridge@.service" "$SERVICE_UNIT"
install -o root -g root -m 0755 "$ROOT/deploy/operator-bridge/awh-operator" "$CLIENT"
rm -f "$LEGACY_DROPIN_A" "$LEGACY_DROPIN_B"
systemctl daemon-reload
systemctl reset-failed 'awh-operator-bridge@*.service' >/dev/null 2>&1 || true
systemctl enable --now awh-operator-bridge.socket >/dev/null
systemctl is-enabled --quiet awh-operator-bridge.socket
systemctl is-active --quiet awh-operator-bridge.socket
check=$(mktemp /tmp/awh-operator-install-check.XXXXXX)
chmod 0600 "$check"
runuser -u awh-remote -- "$CLIENT" status >"$check"
runuser -u bayadmin -- "$CLIENT" status >/dev/null
CHECK_FILE="$check" python3 - <<'PY'
import json, os
p=json.load(open(os.environ['CHECK_FILE']))
assert p.get('ok') is True
assert p.get('result',{}).get('arbitraryShell') is False
PY
rm -f "$check"
committed=1
trap - EXIT HUP INT TERM
printf 'AWH_OPERATOR_BRIDGE_INSTALL=PASS backup=%s\n' "$backup"
