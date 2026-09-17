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
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$BACKUP_ROOT/$stamp"
[ "$(id -u)" -eq 0 ] || { echo AWH_OPERATOR_INSTALL_ROOT_REQUIRED >&2; exit 2; }
getent passwd awh-hub >/dev/null; getent passwd awh-remote >/dev/null
getent group awh-hub >/dev/null; getent group www-data >/dev/null; getent group bay-staging >/dev/null
command -v getfacl >/dev/null; command -v setfacl >/dev/null
[ -r "$ROOT/hub/bin/awh-operator-bridge.php" ]
[ -r "$ROOT/hub/src/HubOperatorBridgeService.php" ]
[ -r "$ROOT/deploy/systemd/awh-operator-bridge.socket" ]
[ -r "$ROOT/deploy/systemd/awh-operator-bridge@.service" ]
[ -x "$ROOT/deploy/operator-bridge/awh-operator" ]
install -d -o root -g root -m 0700 "$backup"
getfacl -p "$STAGE_PARENT" >"$backup/stage-parent.acl"
stage_existed=0; [ -d "$STAGE_ROOT" ] && stage_existed=1
setfacl -m u:awh-hub:--x "$STAGE_PARENT"
install -d -o awh-remote -g awh-hub -m 0750 "$STAGE_ROOT"
install -d -o awh-hub -g awh-hub -m 0700 "$EVIDENCE_ROOT"
runuser -u awh-remote -- test -w "$STAGE_ROOT"
runuser -u awh-hub -- test -r "$STAGE_ROOT"
runuser -u awh-hub -- test -w "$EVIDENCE_ROOT"
old_socket=0; old_service=0; old_client=0
[ -e "$SOCKET_UNIT" ] && { cp -a "$SOCKET_UNIT" "$backup/socket"; old_socket=1; }
[ -e "$SERVICE_UNIT" ] && { cp -a "$SERVICE_UNIT" "$backup/service"; old_service=1; }
[ -e "$CLIENT" ] && { cp -a "$CLIENT" "$backup/client"; old_client=1; }
check=
rollback(){
  [ -n "$check" ] && rm -f "$check" || true
  setfacl --restore="$backup/stage-parent.acl" >/dev/null 2>&1 || true
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
systemctl daemon-reload
systemctl enable --now awh-operator-bridge.socket >/dev/null
systemctl is-enabled --quiet awh-operator-bridge.socket
systemctl is-active --quiet awh-operator-bridge.socket
check=$(mktemp /tmp/awh-operator-install-check.XXXXXX)
chmod 0600 "$check"
runuser -u awh-remote -- "$CLIENT" status >"$check"
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
