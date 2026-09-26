#!/bin/sh
set -eu
SCRIPT_SRC=$1
test -f "$SCRIPT_SRC"
BASE="$HOME/Library/Application Support/AWH/offsite-backup"
SCRIPT="$BASE/awh-backup-pull.sh"
LOG="$BASE/offsite-backup.log"
PLIST="$HOME/Library/LaunchAgents/com.awh.offsite-backup.plist"
mkdir -p "$BASE" "$HOME/Library/LaunchAgents"
install -m 0700 "$SCRIPT_SRC" "$SCRIPT"
python3 - "$SCRIPT" "$LOG" "$PLIST" <<'PY'
import plistlib,sys
script,log,path=sys.argv[1:]
doc={"Label":"com.awh.offsite-backup","ProgramArguments":[script],"StartCalendarInterval":{"Hour":4,"Minute":30},"RunAtLoad":True,"StandardOutPath":log,"StandardErrorPath":log}
with open(path,"wb") as f: plistlib.dump(doc,f,sort_keys=False)
PY
chmod 0600 "$PLIST"
launchctl bootout "gui/$(id -u)/com.awh.offsite-backup" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/com.awh.offsite-backup"
printf '%s\n' "AWH_OFFSITE_BACKUP_INSTALL=PASS"
