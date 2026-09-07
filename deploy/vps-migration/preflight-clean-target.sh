#!/bin/sh
set -eu
# Read-only preflight for a clean BAY Ecosystem target. It never installs or changes configuration.
fail=0
need() { command -v "$1" >/dev/null 2>&1 || { echo "MISSING_COMMAND=$1"; fail=1; }; }
for c in awk df free getent id stat find; do need "$c"; done
printf 'TARGET_PREFLIGHT_SCHEMA=1\n'
printf 'HOST=%s\n' "$(hostname 2>/dev/null || echo unknown)"
printf 'ROOT_FS=%s\n' "$(df -P / | awk 'NR==2{print $2":"$3":"$4":"$5}')"
if command -v free >/dev/null 2>&1; then free -b | awk 'NR==2{print "MEM_TOTAL_BYTES="$2"\nMEM_AVAILABLE_BYTES="$7}'; fi
for c in nginx php mariadb systemctl; do if command -v "$c" >/dev/null 2>&1; then echo "RUNTIME_${c}=PRESENT"; else echo "RUNTIME_${c}=MISSING"; fi; done
for p in /srv/apps /srv/data /srv/releases /srv/backups /var/log/bay; do
  if [ -e "$p" ]; then [ ! -L "$p" ] || { echo "UNSAFE_SYMLINK=$p"; fail=1; }; echo "PATH_${p}=EXISTS"; else echo "PATH_${p}=ABSENT_EXPECTED_ON_FRESH_TARGET"; fi
done
if [ "$fail" -eq 0 ]; then echo 'TARGET_PREFLIGHT=PASS'; else echo 'TARGET_PREFLIGHT=REVIEW'; exit 1; fi
