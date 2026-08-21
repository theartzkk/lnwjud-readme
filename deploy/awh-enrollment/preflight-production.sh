#!/bin/sh

# Read-only AWH VPS preflight.
#
# This script deliberately never creates directories, copies files, runs a
# migration, reloads a service, or changes a remote release. It resolves the
# database from the effective deployment configuration first and only uses the
# bounded candidate search as corroborating evidence.
set -eu

TARGET=$(printenv AWH_DEPLOY_TARGET 2>/dev/null || printf awh-vps)

case "$TARGET" in
  ''|*[!A-Za-z0-9._-]*) echo "AWH_DEPLOY_TARGET must be an SSH config alias" >&2; exit 2 ;;
esac

command -v ssh >/dev/null 2>&1 || { echo "ssh is required" >&2; exit 1; }
ssh -G "$TARGET" >/dev/null 2>&1 || { echo "SSH alias does not resolve: $TARGET" >&2; exit 1; }

ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes "$TARGET" 'sh -s' <<'REMOTE'
set -u

MIRROR=/srv/awh/git/awh.git
HUB=/opt/awh-hub
FALLBACK_DB=/var/lib/awh-hub/awh.sqlite
CANONICAL_PROJECT_ID=113b45c0-23e1-408d-ae0f-ac5eca7f6900

say() { printf '%s\n' "$1"; }

allowed_db_path() {
  case "$1" in
    /var/lib/awh-hub/*|/opt/awh-hub/*|/srv/awh/*) return 0 ;;
    *) return 1 ;;
  esac
}

stat_line() {
  sudo -n stat -c '%n|%U|%G|%a|%s' "$1" 2>/dev/null || stat -c '%n|%U|%G|%a|%s' "$1" 2>/dev/null || true
}

sqlite_ready() {
  command -v sqlite3 >/dev/null 2>&1 || sudo -n sqlite3 :memory: 'SELECT 1;' >/dev/null 2>&1
}

run_sqlite() {
  if test -r "$1" && command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$@"
  else
    sudo -n sqlite3 "$@"
  fi
}

table_exists() {
  test "$(run_sqlite "$1" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='$2';" 2>/dev/null || printf 0)" = 1
}

base_schema_present() {
  db=$1
  for table in projects project_memory devices builds releases; do
    table_exists "$db" "$table" || return 1
  done
}

integrity_clean() {
  db=$1
  test "$(run_sqlite "$db" 'PRAGMA integrity_check;' 2>/dev/null | head -n 1 || true)" = ok || return 1
  test "$(run_sqlite "$db" 'PRAGMA foreign_key_check;' 2>/dev/null | wc -l | tr -d ' ')" = 0 || return 1
}

authority_evidence() {
  db=$1
  sudo -n test -f "$db" && sudo -n test -r "$db" || return 1
  sqlite_ready || return 1
  integrity_clean "$db" || return 1
  base_schema_present "$db" || return 1
}

describe_db() {
  db=$1
  integrity=$(run_sqlite "$db" 'PRAGMA integrity_check;' 2>/dev/null | head -n 1 || true)
  foreign_keys=$(run_sqlite "$db" 'PRAGMA foreign_key_check;' 2>/dev/null | wc -l | tr -d ' ')
  user_version=$(run_sqlite "$db" 'PRAGMA user_version;' 2>/dev/null | head -n 1 || true)
  tables=$(run_sqlite "$db" "SELECT group_concat(name, ',') FROM (SELECT name FROM sqlite_master WHERE type='table' ORDER BY name);" 2>/dev/null || true)
  project_count=UNAVAILABLE
  devices_count=UNAVAILABLE
  builds_count=UNAVAILABLE
  releases_count=UNAVAILABLE
  if table_exists "$db" projects; then project_count=$(run_sqlite "$db" 'SELECT count(*) FROM projects;' 2>/dev/null || printf UNAVAILABLE); fi
  if table_exists "$db" devices; then devices_count=$(run_sqlite "$db" 'SELECT count(*) FROM devices;' 2>/dev/null || printf UNAVAILABLE); fi
  if table_exists "$db" builds; then builds_count=$(run_sqlite "$db" 'SELECT count(*) FROM builds;' 2>/dev/null || printf UNAVAILABLE); fi
  if table_exists "$db" releases; then releases_count=$(run_sqlite "$db" 'SELECT count(*) FROM releases;' 2>/dev/null || printf UNAVAILABLE); fi
  ledger=ABSENT
  ledger_rows=UNAVAILABLE
  migration_ids=UNAVAILABLE
  if table_exists "$db" awh_schema_migrations; then
    ledger=PRESENT
    ledger_rows=$(run_sqlite "$db" 'SELECT count(*) FROM awh_schema_migrations;' 2>/dev/null || printf UNAVAILABLE)
    migration_ids=$(run_sqlite "$db" 'SELECT group_concat(migration_id, ",") FROM awh_schema_migrations;' 2>/dev/null || printf UNAVAILABLE)
  fi
  rate_limits=ABSENT
  if table_exists "$db" enrollment_rate_limits; then rate_limits=PRESENT; fi
  project_identity=UNAVAILABLE
  canonical_project=MISSING
  if table_exists "$db" projects; then
    project_identity=$(run_sqlite "$db" "SELECT project_id || '|' || name || '|' || type FROM projects WHERE project_id='$CANONICAL_PROJECT_ID' LIMIT 1;" 2>/dev/null || true)
    if test -n "$project_identity"; then canonical_project=PRESENT; else project_identity=UNAVAILABLE; fi
  fi
  say "db_stat=$(stat_line "$db")"
  say "db_integrity=$integrity"
  say "db_foreign_keys=$foreign_keys"
  say "db_user_version=$user_version"
  say "db_tables=$tables"
  say "db_migration_ledger=$ledger|rows=$ledger_rows|ids=$migration_ids"
  say "db_enrollment_rate_limits=$rate_limits"
  say "db_counts|projects=$project_count|devices=$devices_count|builds=$builds_count|releases=$releases_count"
  say "db_canonical_project=$canonical_project|identity=$project_identity"
}

say 'ssh=PASS'

if test -d "$MIRROR" && test "$(git -C "$MIRROR" rev-parse --is-bare-repository 2>/dev/null || true)" = true; then
  say 'git_mirror=PASS'
else
  say 'git_mirror=FAIL'
fi
if test -d "$HUB"; then say 'hub_root=PASS'; else say 'hub_root=FAIL'; fi

NGINX_CONFIG=$(sudo -n nginx -T 2>/dev/null || true)
if test -n "$NGINX_CONFIG"; then
  say 'nginx_dump=PASS'
  printf '%s\n' "$NGINX_CONFIG" \
    | grep -E 'AWH_HUB_DB_PATH|SCRIPT_FILENAME|fastcgi_pass|auth_basic[[:space:]]|auth_basic_user_file|location[[:space:]]|server_name|awh-hub|awh-web|enrollment-current' \
    | sed -E 's/(^[[:space:]]*server_name)[[:space:]]+[^;]+;/\1 [REDACTED];/' \
    | sed -E 's/^[[:space:]]*# configuration file .*$/[nginx include redacted]/' \
    | head -n 120
else
  say 'nginx_dump=FAIL'
fi

NGINX_DB=$(printf '%s\n' "$NGINX_CONFIG" | awk '/AWH_HUB_DB_PATH/ { for (i=1; i<=NF; i++) if ($i ~ /^\//) { gsub(/;/, "", $i); print $i; exit } }')
NGINX_SERVER_CONFIG=$(printf '%s\n' "$NGINX_CONFIG" | awk '/^# configuration file / { file=$0 } /AWH_HUB_DB_PATH/ { sub(/^# configuration file /, "", file); sub(/:$/, "", file); print file; exit }')
NGINX_GATEWAY=$(printf '%s\n' "$NGINX_CONFIG" | awk '/SCRIPT_FILENAME/ && /web-gateway\.php/ { print; exit }' | sed -E 's/^[[:space:]]*//')
NGINX_FCGI=$(printf '%s\n' "$NGINX_CONFIG" | awk '/fastcgi_pass/ { print; exit }' | sed -E 's/^[[:space:]]*//')
if test -n "$NGINX_DB"; then say "effective_nginx_db=$NGINX_DB"; else say 'effective_nginx_db=UNAVAILABLE'; fi
if test -n "$NGINX_SERVER_CONFIG"; then say "effective_nginx_server_config=$NGINX_SERVER_CONFIG"; else say 'effective_nginx_server_config=UNAVAILABLE'; fi
if test -n "$NGINX_GATEWAY"; then say "effective_gateway=$NGINX_GATEWAY"; else say 'effective_gateway=UNAVAILABLE'; fi
if test -n "$NGINX_FCGI"; then say "effective_fastcgi=$NGINX_FCGI"; else say 'effective_fastcgi=UNAVAILABLE'; fi

PHP_DB=$(grep -hE '^[[:space:]]*env\[AWH_HUB_DB_PATH\][[:space:]]*=' /etc/php/*/fpm/pool.d/*.conf 2>/dev/null \
  | awk -F= '{v=$2; gsub(/[[:space:]]/, "", v); print v; exit}' || true)
if test -n "$PHP_DB"; then say "effective_php_fpm_db=$PHP_DB"; else say 'effective_php_fpm_db=UNAVAILABLE'; fi
PHP_SERVICES=$(systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk '$1 ~ /^php[0-9.]+-fpm\.service$/ {print $1}')
for service in $PHP_SERVICES; do
  state=$(systemctl is-active "$service" 2>/dev/null || true)
  if test -n "$state"; then say "php_service_$service=$state"; else say "php_service_$service=unknown"; fi
done
for socket in /run/php/php8.3-fpm.sock /run/php/php*-fpm.sock; do
  if test -S "$socket"; then say "php_socket=$(stat -c '%n|%U|%G|%a' "$socket")"; fi
done

for path in /opt/awh-hub /var/www/awh-web/current /srv/awh; do
  if test -L "$path"; then say "location=$path|symlink|$(readlink "$path")"; elif test -d "$path"; then say "location=$path|directory"; elif test -e "$path"; then say "location=$path|file"; else say "location=$path|missing"; fi
done
for path in /opt/awh-hub/public/web-gateway.php /var/www/awh-web/current/index.html; do
  if sudo -n test -e "$path" 2>/dev/null; then say "runtime_file=$path|$(sudo -n stat -c '%U|%G|%a|%s' "$path" 2>/dev/null || true)"; else say "runtime_file=$path|missing"; fi
done

DB_FROM_ENV=$(printenv AWH_HUB_DB_PATH 2>/dev/null || true)
if test -n "$DB_FROM_ENV"; then
  DB_PATH=$DB_FROM_ENV
  DB_SOURCE=explicit_environment
elif test -n "$NGINX_DB"; then
  DB_PATH=$NGINX_DB
  DB_SOURCE=effective_nginx
elif test -n "$PHP_DB"; then
  DB_PATH=$PHP_DB
  DB_SOURCE=effective_php_fpm
else
  DB_PATH=$FALLBACK_DB
  DB_SOURCE=documented_fallback
fi
say "db_resolution_source=$DB_SOURCE"
say "db_resolution_path=$DB_PATH"

DB_CLASS=DB_NOT_FOUND
DB_REASON=not_found
if ! sqlite_ready; then
  DB_CLASS=DB_INTEGRITY_FAILED
  DB_REASON=sqlite3_unavailable
elif ! allowed_db_path "$DB_PATH"; then
  DB_CLASS=DB_INTEGRITY_FAILED
  DB_REASON=path_outside_bounded_awh_roots
elif sudo -n test -f "$DB_PATH"; then
  if authority_evidence "$DB_PATH"; then
    DB_CLASS=DB_AUTHORITY_RESOLVED
    DB_REASON=effective_config_and_schema
  else
    DB_CLASS=DB_INTEGRITY_FAILED
    DB_REASON=effective_config_target_failed_schema_or_integrity
  fi
else
  CANDIDATE_LIST=$(sudo -n find /var/lib/awh-hub /opt/awh-hub /srv/awh -type f \( -name '*.sqlite' -o -name '*.db' \) -print 2>/dev/null | sort -u || true)
  MATCHING_COUNT=0
  MATCHING_PATH=
  if test -n "$CANDIDATE_LIST"; then
    while IFS= read -r candidate; do
      test -n "$candidate" || continue
      say "candidate=$(stat_line "$candidate")"
      describe_db "$candidate"
      if authority_evidence "$candidate"; then
        MATCHING_COUNT=$((MATCHING_COUNT + 1))
        MATCHING_PATH=$candidate
      fi
    done <<EOF_CANDIDATES
$CANDIDATE_LIST
EOF_CANDIDATES
  fi
  if test "$MATCHING_COUNT" = 1; then
    DB_PATH=$MATCHING_PATH
    DB_CLASS=DB_AUTHORITY_RESOLVED
    DB_REASON=single_bounded_candidate_with_awh_schema
  elif test "$MATCHING_COUNT" -gt 1; then
    DB_CLASS=DB_AMBIGUOUS
    DB_REASON=multiple_bounded_candidates_with_awh_schema
  elif test -n "$CANDIDATE_LIST"; then
    DB_CLASS=DB_INTEGRITY_FAILED
    DB_REASON=bounded_candidates_failed_awh_schema_or_integrity
  else
    DB_CLASS=DB_NOT_FOUND
    DB_REASON=effective_path_and_bounded_roots_empty
  fi
fi
say "db_classification=$DB_CLASS"
say "db_classification_reason=$DB_REASON"
if test "$DB_CLASS" = DB_AUTHORITY_RESOLVED; then describe_db "$DB_PATH"; fi
if test "$DB_CLASS" = DB_AUTHORITY_RESOLVED \
  && sudo -n -u awh-hub test -w "$DB_PATH" 2>/dev/null \
  && sudo -n -u awh-hub test -w "$(dirname "$DB_PATH")" 2>/dev/null; then
  say 'db_enrollment_write=PASS'
else
  say 'db_enrollment_write=BLOCKED'
fi

if printenv AWH_BACKUP_DIR >/dev/null 2>&1; then BACKUP_DIR=$(printenv AWH_BACKUP_DIR); else BACKUP_DIR=/var/backups/awh-hub; fi
say "backup_path=$BACKUP_DIR"
if test -d "$BACKUP_DIR" && sudo -n test -w "$BACKUP_DIR" 2>/dev/null; then
  say 'backup_classification=BACKUP_READY'
else
  BACKUP_PARENT=$(dirname "$BACKUP_DIR")
  if test "$BACKUP_DIR" = /var/backups/awh-hub && test -d "$BACKUP_PARENT" && df -P "$BACKUP_PARENT" >/dev/null 2>&1 && sudo -n test -d "$BACKUP_PARENT" 2>/dev/null; then
    say 'backup_classification=BACKUP_PROVISION_REQUIRED'
  else
    say 'backup_classification=BACKUP_BLOCKED'
  fi
fi

if test -L "$HUB/enrollment-current"; then
  ENROLLMENT_TARGET=$(readlink -f "$HUB/enrollment-current" 2>/dev/null || true)
  if test -n "$ENROLLMENT_TARGET" && test -d "$ENROLLMENT_TARGET" \
    && test -f "$ENROLLMENT_TARGET/public/enrollment.php" \
    && test -f "$ENROLLMENT_TARGET/src/HubEnrollmentService.php" \
    && test -f "$ENROLLMENT_TARGET/src/HubEnrollmentRouter.php" \
    && test -f "$ENROLLMENT_TARGET/migrations/002_m3e2_enrollment_api.sql" \
    && test -f "$ENROLLMENT_TARGET/bin/migrate-m3e2.php"; then
    say 'enrollment_classification=ENROLLMENT_RELEASE_READY'
  else
    say 'enrollment_classification=ENROLLMENT_RELEASE_INVALID'
  fi
elif test -e "$HUB/enrollment-current"; then
  say 'enrollment_classification=ENROLLMENT_RELEASE_INVALID'
else
  say 'enrollment_classification=FIRST_DEPLOY_EXPECTED'
fi
if printf '%s\n' "$NGINX_CONFIG" | grep -q 'enrollment-current'; then say 'enrollment_route=CONFIGURED'; else say 'enrollment_route=ABSENT'; fi
if test -f /etc/php/8.3/fpm/pool.d/awh-enrollment.conf; then say 'enrollment_pool=CONFIGURED'; else say 'enrollment_pool=ABSENT'; fi

for path in / /var/lib/awh-hub /opt/awh-hub; do
  if df -P "$path" >/dev/null 2>&1; then
    pathbase=$(basename "$path")
    say "disk_$pathbase=$(df -P "$path" | awk 'NR==2 {print $4}')"
  fi
done

if sudo -n nginx -t >/dev/null 2>&1; then say 'nginx_config_test=PASS'; else say 'nginx_config_test=FAIL'; fi
for endpoint in /api/v1/health /api/v1/status /api/v1/projects /api/v1/projects/113b45c0-23e1-408d-ae0f-ac5eca7f6900/memory; do
  label=$(printf '%s' "$endpoint" | tr '/.' '__')
  code=$(curl -k -sS --max-time 10 -o /dev/null -w '%{http_code}' "https://127.0.0.1$endpoint" -H 'Host: awh.invalid' 2>/dev/null || printf UNAVAILABLE)
  say "hub_read_$label=$code"
done
REMOTE
