#!/bin/sh
set -eu
BASE=${1:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}
test "$(id -u)" -eq 0 || { echo 'run as root' >&2; exit 2; }
test -f "$BASE/deploy/awh-database/awh-database-inventory.py"
test -f "$BASE/deploy/systemd/awh-database-inventory.service"
test -f "$BASE/deploy/systemd/awh-database-inventory.timer"
command -v mariadb >/dev/null 2>&1
command -v python3 >/dev/null 2>&1
getent group awh-hub >/dev/null 2>&1
install -o root -g root -m 0755 "$BASE/deploy/awh-database/awh-database-inventory.py" /usr/local/sbin/awh-database-inventory.py
install -o root -g root -m 0644 "$BASE/deploy/systemd/awh-database-inventory.service" /etc/systemd/system/awh-database-inventory.service
install -o root -g root -m 0644 "$BASE/deploy/systemd/awh-database-inventory.timer" /etc/systemd/system/awh-database-inventory.timer
systemctl daemon-reload
systemctl start awh-database-inventory.service
python3 - <<'PY'
import json, os
p='/var/lib/awh-hub/database-fleet.json'
st=os.stat(p)
assert st.st_mode & 0o777 == 0o640
v=json.load(open(p))
assert v.get('schemaVersion') == 1 and isinstance(v.get('databases'),list)
raw=open(p).read().lower()
for forbidden in ('password','credential_ref','db_password','private_key','/var/lib/mysql'):
    assert forbidden not in raw, forbidden
print('database-fleet-initial-qa=PASS count='+str(len(v['databases'])))
PY
systemctl enable --now awh-database-inventory.timer >/dev/null
systemctl is-active --quiet awh-database-inventory.timer
printf '%s\n' 'AWH_DATABASE_INVENTORY=READY'
