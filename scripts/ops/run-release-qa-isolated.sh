#!/bin/sh
set -eu
ROOT=$1
SCRIPT=$2
case "$ROOT" in /*) ;; *) echo "QA root must be absolute" >&2; exit 2 ;; esac
case "$SCRIPT" in qa:fast|qa:local|qa:full) ;; *) echo "QA script is not allowlisted" >&2; exit 2 ;; esac
test -d "$ROOT"
cd "$ROOT"
if test "$(id -u)" -eq 0 && command -v systemd-run >/dev/null 2>&1; then
  unit="awh-release-qa-$$-$(printf '%s' "$SCRIPT" | tr ':' '-')"
  if systemctl cat awh-build.slice >/dev/null 2>&1; then
    exec systemd-run --quiet --scope --unit="$unit" --slice=awh-build.slice --property=CPUWeight=20 --property=IOWeight=10 --property=Nice=10 --property=MemoryHigh=2G npm run "$SCRIPT"
  fi
  exec systemd-run --quiet --scope --unit="$unit" --property=CPUWeight=20 --property=IOWeight=10 --property=Nice=10 --property=MemoryHigh=2G npm run "$SCRIPT"
fi
exec npm run "$SCRIPT"
