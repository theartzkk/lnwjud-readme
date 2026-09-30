#!/bin/sh
set -eu
umask 077

HOST=${AWH_OFFSITE_HOST:-awh-prod}
DEST=${AWH_OFFSITE_DEST:-"$HOME/Library/Application Support/AWH/offsite-backups"}
KEEP=${AWH_OFFSITE_KEEP:-14}
RESTIC_BIN=${AWH_OFFSITE_RESTIC_BIN:-}
if test -z "$RESTIC_BIN"; then
  for candidate in /usr/local/bin/restic /opt/homebrew/bin/restic; do
    if test -x "$candidate"; then RESTIC_BIN="$candidate"; break; fi
  done
fi
if test -z "$RESTIC_BIN"; then RESTIC_BIN=$(command -v restic 2>/dev/null || true); fi
RESTIC_REPO=${AWH_OFFSITE_RESTIC_REPO:-"$HOME/Library/Application Support/AWH/offsite-restic"}
RESTIC_PASSWORD_FILE=${AWH_OFFSITE_RESTIC_PASSWORD_FILE:-"$HOME/Library/Application Support/AWH/offsite-backup/restic-password"}

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
test "$(shasum -a 256 "$DEST/$file" | awk '{print $1}')" = "$sha"

RESTIC_STATE=SKIP
RESTIC_SNAPSHOT=
restic_mirror() {
  test -n "$RESTIC_BIN" && test -x "$RESTIC_BIN" || return 2
  mkdir -p "$RESTIC_REPO" "$(dirname "$RESTIC_PASSWORD_FILE")" || return 1
  if test ! -s "$RESTIC_PASSWORD_FILE"; then
    /usr/bin/openssl rand -hex 32 > "$RESTIC_PASSWORD_FILE" || return 1
    chmod 600 "$RESTIC_PASSWORD_FILE" || return 1
  fi
  export RESTIC_REPOSITORY="$RESTIC_REPO"
  export RESTIC_PASSWORD_FILE
  test -f "$RESTIC_REPO/config" || "$RESTIC_BIN" init >/dev/null || return 1
  "$RESTIC_BIN" backup "$DEST/$file" "$DEST/$file.json" --tag awh-offsite --host "$(hostname -s)" >/dev/null || return 1
  RESTIC_SNAPSHOT=$("$RESTIC_BIN" snapshots --tag awh-offsite --latest 1 --json | /usr/bin/python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["id"])') || return 1
  test -n "$RESTIC_SNAPSHOT" || return 1
  restore="$tmp/restic-restore"
  mkdir -p "$restore" || return 1
  "$RESTIC_BIN" restore "$RESTIC_SNAPSHOT" --target "$restore" >/dev/null || return 1
  restored=$(find "$restore" -type f -name "$file" | sed -n '1p')
  restored_meta=$(find "$restore" -type f -name "$file.json" | sed -n '1p')
  test -n "$restored" && test -n "$restored_meta" || return 1
  test "$(shasum -a 256 "$restored" | awk '{print $1}')" = "$sha" || return 1
  cmp -s "$restored_meta" "$DEST/$file.json" || return 1
  rm -rf "$restore"
  "$RESTIC_BIN" forget --keep-last "$KEEP" --prune --tag awh-offsite >/dev/null || return 1
  return 0
}

if restic_mirror; then
  RESTIC_STATE=PASS
  printf '%s\n' "AWH_RESTIC_MIRROR=PASS snapshot=$RESTIC_SNAPSHOT"
else
  restic_code=$?
  if test "$restic_code" -eq 2; then RESTIC_STATE=SKIP; else RESTIC_STATE=FAIL; fi
  printf '%s\n' "AWH_RESTIC_MIRROR=$RESTIC_STATE" >&2
  rm -rf "$tmp/restic-restore"
fi

rmdir "$tmp"
release_lock
trap - EXIT HUP INT TERM

find "$DEST" -type f -name 'awh-*.sqlite' -print0 | xargs -0 ls -1t 2>/dev/null | awk -v keep="$KEEP" 'NR>keep' | while IFS= read -r old; do
  rm -f "$old" "$old.json"
done

printf '%s\n' "AWH_OFFSITE_BACKUP=PASS file=$file restic=$RESTIC_STATE"
