#!/bin/sh
set -eu
umask 077

HOST=${AWH_OFFSITE_HOST:-awh-prod}
DEST=${AWH_OFFSITE_DEST:-"$HOME/Library/Application Support/AWH/offsite-backups"}
KEEP=${AWH_OFFSITE_KEEP:-14}

case "$KEEP" in ''|*[!0-9]*) exit 2 ;; esac
test "$KEEP" -ge 3 && test "$KEEP" -le 90
mkdir -p "$DEST"

lock="$DEST/.pull.lock"
acquire_lock() {
  if mkdir "$lock" 2>/dev/null; then
    printf '%s\n' "$$" > "$lock/pid"
    return 0
  fi

  owner=""
  if test -f "$lock/pid"; then
    owner=$(cat "$lock/pid" 2>/dev/null || true)
  fi
  case "$owner" in ''|*[!0-9]*) owner="" ;; esac

  if test -n "$owner" && kill -0 "$owner" 2>/dev/null; then
    command_line=$(ps -p "$owner" -o command= 2>/dev/null || true)
    case "$command_line" in
      *awh-backup-pull.sh*)
        printf '%s\n' "AWH_OFFSITE_BACKUP=SKIP reason=already-running"
        exit 0
        ;;
    esac
  fi

  rm -f "$lock/pid"
  if ! rmdir "$lock" 2>/dev/null; then
    printf '%s\n' "AWH_OFFSITE_BACKUP=FAIL reason=lock-recovery"
    exit 4
  fi
  mkdir "$lock"
  printf '%s\n' "$$" > "$lock/pid"
}

release_lock() {
  rm -f "$lock/pid"
  rmdir "$lock" 2>/dev/null || true
}

acquire_lock

tmp="$DEST/.incoming-$$"
mkdir "$tmp"
cleanup() {
  rm -f "$tmp/"* 2>/dev/null || true
  rmdir "$tmp" 2>/dev/null || true
  release_lock
}
trap cleanup EXIT HUP INT TERM

meta=$(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$HOST" "sudo -n /usr/local/bin/awh-backup-export metadata")
file=$(printf '%s' "$meta" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["file"])')
sha=$(printf '%s' "$meta" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["sha256"])')

case "$file" in awh-????????T??????Z.sqlite) ;; *) exit 3 ;; esac
case "$sha" in *[!0-9a-f]*|'') exit 3 ;; esac
test "${#sha}" -eq 64

printf '%s\n' "$meta" > "$tmp/$file.json"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$HOST" "sudo -n /usr/local/bin/awh-backup-export payload '$file'" > "$tmp/$file"
test "$(shasum -a 256 "$tmp/$file" | awk '{print $1}')" = "$sha"

mv "$tmp/$file" "$DEST/$file"
mv "$tmp/$file.json" "$DEST/$file.json"
rmdir "$tmp"
test "$(shasum -a 256 "$DEST/$file" | awk '{print $1}')" = "$sha"

release_lock
trap - EXIT HUP INT TERM

find "$DEST" -type f -name 'awh-*.sqlite' -print0 | xargs -0 ls -1t 2>/dev/null | awk -v keep="$KEEP" 'NR>keep' | while IFS= read -r old; do
  rm -f "$old" "$old.json"
done

printf '%s\n' "AWH_OFFSITE_BACKUP=PASS file=$file"
