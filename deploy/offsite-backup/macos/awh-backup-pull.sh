#!/bin/sh
set -eu
umask 077
HOST=${AWH_OFFSITE_HOST:-awh-prod}
DEST=${AWH_OFFSITE_DEST:-"$HOME/Library/Application Support/AWH/offsite-backups"}
KEEP=${AWH_OFFSITE_KEEP:-14}
case "$KEEP" in ''|*[!0-9]*) exit 2 ;; esac
test "$KEEP" -ge 3 && test "$KEEP" -le 90
mkdir -p "$DEST"
tmp="$DEST/.incoming-$$"
mkdir "$tmp"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
meta=$(ssh -o BatchMode=yes "$HOST" "sudo -n /usr/local/bin/awh-backup-export metadata")
file=$(printf '%s' "$meta" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["file"])')
sha=$(printf '%s' "$meta" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["sha256"])')
case "$file" in awh-*.sqlite) ;; *) exit 3 ;; esac
case "$sha" in *[!0-9a-f]*|'') exit 3 ;; esac
test "${#sha}" -eq 64
printf '%s\n' "$meta" > "$tmp/$file.json"
ssh -o BatchMode=yes "$HOST" "sudo -n /usr/local/bin/awh-backup-export payload '$file'" > "$tmp/$file"
test "$(shasum -a 256 "$tmp/$file" | awk '{print $1}')" = "$sha"
mv "$tmp/$file" "$DEST/$file"
mv "$tmp/$file.json" "$DEST/$file.json"
rmdir "$tmp"
trap - EXIT HUP INT TERM
find "$DEST" -type f -name 'awh-*.sqlite' -print0 | xargs -0 ls -1t 2>/dev/null | awk -v keep="$KEEP" 'NR>keep' | while IFS= read -r old; do rm -f "$old" "$old.json"; done
printf '%s\n' "AWH_OFFSITE_BACKUP=PASS file=$file"
