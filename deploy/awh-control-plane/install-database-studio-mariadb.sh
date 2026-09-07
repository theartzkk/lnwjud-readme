#!/usr/bin/env bash
set -eu

MODE=${1:---check}
DB=${AWH_HUB_DB_PATH:-/var/lib/awh-hub/awh.sqlite}
POOL=${AWH_DATABASE_STUDIO_FPM_POOL:-/etc/php/8.3/fpm/pool.d/awh-enrollment.conf}
SOCKET=${AWH_DATABASE_STUDIO_MARIADB_SOCKET:-/run/mysqld/mysqld.sock}
ROOT=${AWH_DATABASE_STUDIO_CONFIG_ROOT:-/etc/awh-database-studio}
PASSFILE=$ROOT/mariadb.password
OBSERVER=awh_studio_ro
MARK_BEGIN='; BEGIN AWH DATABASE STUDIO MARIADB'
MARK_END='; END AWH DATABASE STUDIO MARIADB'

fail(){ echo "DATABASE_STUDIO_MARIADB_STATE=BLOCKED"; echo "DATABASE_STUDIO_MARIADB_REASON=$1"; exit 2; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "MISSING_$(printf '%s' "$1" | tr '[:lower:]-' '[:upper:]_')"; }

case "$MODE" in --check|--apply) ;; *) fail INVALID_MODE;; esac
need mariadb; need sqlite3; need php; need openssl
[ -S "$SOCKET" ] || fail MARIADB_SOCKET_MISSING
[ -f "$DB" ] && [ ! -L "$DB" ] || fail AWH_DATABASE_MISSING
[ -f "$POOL" ] && [ ! -L "$POOL" ] || fail PHP_FPM_POOL_MISSING
php -r 'exit(in_array("mysql",PDO::getAvailableDrivers(),true)?0:3);' || fail PDO_MYSQL_MISSING

DATABASES=$(sqlite3 -readonly "$DB" "SELECT database_name FROM control_site_database_bindings WHERE engine='MARIADB' AND state='READY' AND database_name IS NOT NULL ORDER BY database_name;" 2>/dev/null || true)
VALID=''
while IFS= read -r name; do
  [ -n "$name" ] || continue
  case "$name" in *[!A-Za-z0-9_]* ) fail INVALID_REGISTERED_DATABASE_NAME;; esac
  VALID="${VALID}${name}\n"
done <<EOF
$DATABASES
EOF
COUNT=$(printf '%b' "$VALID" | sed '/^$/d' | wc -l | tr -d ' ')

EXISTS=$(mariadb --protocol=socket --batch --skip-column-names -e "SELECT COUNT(*) FROM mysql.user WHERE User='${OBSERVER}' AND Host='localhost'" 2>/dev/null || echo 0)
CONFIGURED=no
if [ "$EXISTS" = 1 ] && [ -f "$PASSFILE" ] && [ ! -L "$PASSFILE" ]; then CONFIGURED=yes; fi

echo "DATABASE_STUDIO_MARIADB_MODE=$MODE"
echo "DATABASE_STUDIO_MARIADB_REGISTERED_DATABASES=$COUNT"
echo "DATABASE_STUDIO_MARIADB_OBSERVER_EXISTS=$EXISTS"
echo "DATABASE_STUDIO_MARIADB_CONFIGURED=$CONFIGURED"

if [ "$MODE" = --check ]; then
  echo "DATABASE_STUDIO_MARIADB_STATE=CHECKED"
  exit 0
fi

[ "$(id -u)" -eq 0 ] || fail ROOT_REQUIRED
if [ "$EXISTS" = 1 ] && [ ! -f "$PASSFILE" ]; then fail EXISTING_OBSERVER_WITHOUT_LOCAL_CREDENTIAL; fi

BACKUP=/var/backups/awh-hub/config/database-studio-mariadb-$(date -u +%Y%m%dT%H%M%SZ)
install -d -o root -g root -m 0700 "$BACKUP"
cp -p "$POOL" "$BACKUP/awh-enrollment.conf"
NEW_USER=0
if [ "$EXISTS" != 1 ]; then
  install -d -o root -g awh-hub -m 0750 "$ROOT"
  PASSWORD=$(openssl rand -hex 32)
  printf '%s\n' "$PASSWORD" > "$PASSFILE"
  chown root:awh-hub "$PASSFILE"; chmod 0640 "$PASSFILE"
  mariadb --protocol=socket --batch --skip-column-names <<SQL
CREATE USER '${OBSERVER}'@'localhost' IDENTIFIED BY '${PASSWORD}';
SQL
  NEW_USER=1
fi

rollback(){
  code=$?
  if [ "$code" -ne 0 ]; then
    cp -p "$BACKUP/awh-enrollment.conf" "$POOL" || true
    if [ "$NEW_USER" = 1 ]; then mariadb --protocol=socket --batch --skip-column-names -e "DROP USER IF EXISTS '${OBSERVER}'@'localhost'" >/dev/null 2>&1 || true; rm -f "$PASSFILE" || true; fi
    systemctl reload php8.3-fpm >/dev/null 2>&1 || true
    echo 'DATABASE_STUDIO_MARIADB_ROLLBACK=PASS' >&2
  fi
  exit "$code"
}
trap rollback EXIT HUP INT TERM

# Fail closed if the dedicated observer already owns any global write privilege.
GLOBAL=$(mariadb --protocol=socket --batch --skip-column-names -e "SELECT CONCAT(Select_priv,Insert_priv,Update_priv,Delete_priv,Create_priv,Drop_priv,Grant_priv,Alter_priv) FROM mysql.user WHERE User='${OBSERVER}' AND Host='localhost'" 2>/dev/null || true)
case "$GLOBAL" in YNNNNNNN|NNNNNNNN|'') ;; *) fail OBSERVER_HAS_UNSAFE_GLOBAL_PRIVILEGES;; esac

while IFS= read -r name; do
  [ -n "$name" ] || continue
  mariadb --protocol=socket --batch --skip-column-names -e "GRANT SELECT, SHOW VIEW ON \`${name}\`.* TO '${OBSERVER}'@'localhost'"
done <<EOF
$(printf '%b' "$VALID")
EOF

python3 - "$POOL" "$MARK_BEGIN" "$MARK_END" "$SOCKET" "$PASSFILE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); begin,end,socket,pw=sys.argv[2:]
s=p.read_text()
block=f"{begin}\nenv[AWH_DATABASE_STUDIO_MARIADB_USER] = awh_studio_ro\nenv[AWH_DATABASE_STUDIO_MARIADB_PASSWORD_FILE] = {pw}\nenv[AWH_DATABASE_STUDIO_MARIADB_SOCKET] = {socket}\n{end}"
if begin in s and end in s:
    a=s.index(begin); b=s.index(end,a)+len(end); s=s[:a]+block+s[b:]
else:
    s=s.rstrip()+"\n\n"+block+"\n"
p.write_text(s)
PY

php-fpm8.3 -t >/dev/null 2>&1 || fail PHP_FPM_CONFIG_INVALID
systemctl reload php8.3-fpm

# Prove the observer can read every registered database and cannot create a table.
TMP=$(mktemp -p /tmp awh-studio-client.XXXXXX.cnf)
chmod 0600 "$TMP"
printf '[client]\nuser=%s\npassword=%s\nsocket=%s\n' "$OBSERVER" "$(cat "$PASSFILE")" "$SOCKET" > "$TMP"
while IFS= read -r name; do
  [ -n "$name" ] || continue
  mariadb --defaults-extra-file="$TMP" --batch --skip-column-names "$name" -e 'SELECT 1' >/dev/null
  if mariadb --defaults-extra-file="$TMP" --batch --skip-column-names "$name" -e 'CREATE TABLE awh_studio_write_probe(id INT)' >/dev/null 2>&1; then
    mariadb --protocol=socket --batch --skip-column-names "$name" -e 'DROP TABLE IF EXISTS awh_studio_write_probe' >/dev/null 2>&1 || true
    rm -f "$TMP"
    fail OBSERVER_WRITE_GUARD_FAILED
  fi
done <<EOF
$(printf '%b' "$VALID")
EOF
rm -f "$TMP"

echo 'DATABASE_STUDIO_MARIADB_READ_PROOF=PASS'
echo 'DATABASE_STUDIO_MARIADB_WRITE_GUARD=PASS'
echo 'DATABASE_STUDIO_MARIADB_STATE=READY'
trap - EXIT HUP INT TERM
