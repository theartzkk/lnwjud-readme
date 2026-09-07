#!/usr/bin/env bash
set -eu

# Read-only, sanitized VPS migration inventory. It intentionally never prints
# database credentials, environment files, secret paths, or SQL row content.
section() { printf '\n=== %s ===\n' "$1"; }

section HOST
printf 'hostname=%s\n' "$(hostname 2>/dev/null || echo unknown)"
printf 'kernel=%s\n' "$(uname -sr 2>/dev/null || echo unknown)"
printf 'cpu_count=%s\n' "$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo unknown)"

section MEMORY
if command -v free >/dev/null 2>&1; then free -h; else printf 'state=UNKNOWN\n'; fi

section DISK
if command -v df >/dev/null 2>&1; then df -hT /; else printf 'state=UNKNOWN\n'; fi

section SERVICES
for service in nginx mariadb php8.3-fpm fail2ban; do
  if command -v systemctl >/dev/null 2>&1; then
    printf '%s=%s\n' "$service" "$(systemctl is-active "$service" 2>/dev/null || echo inactive)"
  fi
done

section NGINX_HOSTS
if command -v nginx >/dev/null 2>&1; then
  nginx -T 2>/dev/null | awk '$1=="server_name" {for(i=2;i<=NF;i++){gsub(/;/,"",$i); if($i!="_") print $i}}' | sort -u
else
  printf 'state=UNKNOWN\n'
fi

section MARIADB_DATABASE_SIZES_MIB
if command -v mariadb >/dev/null 2>&1; then
  mariadb --protocol=socket --batch --skip-column-names -e "SELECT table_schema,ROUND(COALESCE(SUM(data_length+index_length),0)/1024/1024,1) FROM information_schema.tables WHERE table_schema NOT IN ('information_schema','performance_schema','mysql','sys') GROUP BY table_schema ORDER BY 2 DESC" 2>/dev/null || printf 'state=UNAVAILABLE\n'
else
  printf 'state=NOT_INSTALLED\n'
fi

section STORAGE_CLASSIFICATION_INPUTS
for path in /var/backups /var/www/awh-web/releases /var/www/awh-web/desktop-artifacts /opt/awh-hub/control-releases /var/lib/awh-hub/project-vault /var/lib/mysql; do
  if test -e "$path"; then du -sh "$path" 2>/dev/null || true; fi
done

section JOURNAL
if command -v journalctl >/dev/null 2>&1; then journalctl --disk-usage 2>/dev/null || true; fi

printf '\nAUDIT_MODE=READ_ONLY\n'
