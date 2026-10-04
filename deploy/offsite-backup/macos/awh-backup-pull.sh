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
ASSESSMENT_DEST=${AWH_ASSESSMENT_OFFSITE_DEST:-"$DEST/assessment"}
ASSESSMENT_RAW_KEEP=${AWH_ASSESSMENT_OFFSITE_KEEP:-2}
ASSESSMENT_RESTIC_KEEP=${AWH_ASSESSMENT_RESTIC_KEEP:-14}

case "$KEEP" in ''|*[!0-9]*) exit 2 ;; esac
case "$ASSESSMENT_RAW_KEEP" in ''|*[!0-9]*) exit 2 ;; esac
case "$ASSESSMENT_RESTIC_KEEP" in ''|*[!0-9]*) exit 2 ;; esac
test "$KEEP" -ge 3 && test "$KEEP" -le 90
test "$ASSESSMENT_RAW_KEEP" -ge 1 && test "$ASSESSMENT_RAW_KEEP" -le 14
test "$ASSESSMENT_RESTIC_KEEP" -ge 3 && test "$ASSESSMENT_RESTIC_KEEP" -le 90
mkdir -p "$DEST" "$ASSESSMENT_DEST"

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
  rm -rf "$tmp" 2>/dev/null || true
  release_lock
}
trap cleanup EXIT HUP INT TERM

verify_assessment_tree() {
  root=$1
  meta_file=$2
  /usr/bin/python3 - "$root" "$meta_file" <<'PY'
import hashlib,json,sqlite3,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve()
meta=json.loads(Path(sys.argv[2]).read_text())
manifest_path=root/'manifest.json'
manifest=json.loads(manifest_path.read_text())
def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()
if manifest.get('kind')!='BAY_ASSESSMENT_VERIFIED_SNAPSHOT': raise SystemExit(10)
if sha(manifest_path)!=meta.get('manifestSha256'): raise SystemExit(11)
db=root/'assessment.sqlite'
if sha(db)!=meta.get('databaseSha256'): raise SystemExit(12)
con=sqlite3.connect(f'file:{db}?mode=ro&immutable=1',uri=True)
try:
    row=con.execute('PRAGMA quick_check').fetchone()
finally:
    con.close()
if not row or row[0]!='ok': raise SystemExit(13)
rows=manifest.get('files')
if not isinstance(rows,list): raise SystemExit(14)
files_root=(root/'files').resolve()
total=0
for item in rows:
    rel=str(item.get('path') or '').replace('\\','/')
    parts=Path(rel).parts
    if not rel or rel.startswith('/') or '..' in parts: raise SystemExit(15)
    path=(files_root/rel).resolve()
    if files_root not in path.parents or not path.is_file() or path.is_symlink(): raise SystemExit(16)
    if path.stat().st_size!=int(item.get('size',-1)): raise SystemExit(17)
    if sha(path)!=item.get('sha256'): raise SystemExit(18)
    total+=path.stat().st_size
if len(rows)!=int(meta.get('fileCount',-1)) or total!=int(meta.get('fileBytes',-1)): raise SystemExit(19)
PY
}

extract_assessment_tar() {
  archive=$1
  target=$2
  /usr/bin/python3 - "$archive" "$target" <<'PY'
import shutil,sys,tarfile
from pathlib import Path
archive=Path(sys.argv[1])
target=Path(sys.argv[2]).resolve()
target.mkdir(parents=True,exist_ok=True)
with tarfile.open(archive,'r:*') as tf:
    for member in tf:
        name=member.name.replace('\\','/')
        parts=Path(name).parts
        if not name or name.startswith('/') or '..' in parts or member.issym() or member.islnk() or member.isdev():
            raise SystemExit(20)
        out=(target/name).resolve()
        if out!=target and target not in out.parents: raise SystemExit(21)
        if member.isdir():
            out.mkdir(parents=True,exist_ok=True)
            continue
        if not member.isfile(): raise SystemExit(22)
        out.parent.mkdir(parents=True,exist_ok=True)
        src=tf.extractfile(member)
        if src is None: raise SystemExit(23)
        with src,out.open('wb') as dst: shutil.copyfileobj(src,dst,1024*1024)
PY
}

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
  RESTIC_SNAPSHOT=$("$RESTIC_BIN" snapshots --tag awh-offsite --path "$DEST/$file" --latest 1 --json | /usr/bin/python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["id"] if len(d)==1 else "")') || return 1
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

ASSESSMENT_RESTIC_STATE=SKIP
ASSESSMENT_RESTIC_SNAPSHOT=
assessment_meta=$(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$HOST" "sudo -n /usr/local/bin/awh-assessment-backup-export metadata")
assessment_snapshot=$(printf '%s' "$assessment_meta" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["snapshot"])')
case "$assessment_snapshot" in ????????T??????Z-????????) ;; *) exit 3 ;; esac
assessment_meta_file="$tmp/assessment-meta.json"
printf '%s\n' "$assessment_meta" > "$assessment_meta_file"
assessment_tar="$tmp/assessment.tar"
assessment_extract="$tmp/assessment-extract"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$HOST" "sudo -n /usr/local/bin/awh-assessment-backup-export payload '$assessment_snapshot'" > "$assessment_tar"
extract_assessment_tar "$assessment_tar" "$assessment_extract"
verify_assessment_tree "$assessment_extract" "$assessment_meta_file"

assessment_dir="$ASSESSMENT_DEST/$assessment_snapshot"
if test -d "$assessment_dir"; then
  verify_assessment_tree "$assessment_dir" "$assessment_meta_file"
  rm -rf "$assessment_extract"
else
  mv "$assessment_extract" "$assessment_dir"
fi
printf '%s\n' "$assessment_meta" > "$assessment_dir/offsite-metadata.json"
verify_assessment_tree "$assessment_dir" "$assessment_dir/offsite-metadata.json"

assessment_restic_mirror() {
  test -n "$RESTIC_BIN" && test -x "$RESTIC_BIN" || return 2
  export RESTIC_REPOSITORY="$RESTIC_REPO"
  export RESTIC_PASSWORD_FILE
  test -f "$RESTIC_REPO/config" || "$RESTIC_BIN" init >/dev/null || return 1
  "$RESTIC_BIN" backup "$assessment_dir" --tag bay-assessment-offsite --host "$(hostname -s)" >/dev/null || return 1
  ASSESSMENT_RESTIC_SNAPSHOT=$("$RESTIC_BIN" snapshots --tag bay-assessment-offsite --path "$assessment_dir" --latest 1 --json | /usr/bin/python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["id"] if len(d)==1 else "")') || return 1
  test -n "$ASSESSMENT_RESTIC_SNAPSHOT" || return 1
  assessment_restore="$tmp/assessment-restic-restore"
  mkdir -p "$assessment_restore" || return 1
  "$RESTIC_BIN" restore "$ASSESSMENT_RESTIC_SNAPSHOT" --target "$assessment_restore" >/dev/null || return 1
  restored_manifest=$(find "$assessment_restore" -type f -name manifest.json | grep "/$assessment_snapshot/manifest.json$" | sed -n '1p')
  test -n "$restored_manifest" || return 1
  verify_assessment_tree "$(dirname "$restored_manifest")" "$assessment_meta_file" || return 1
  rm -rf "$assessment_restore"
  "$RESTIC_BIN" forget --keep-last "$ASSESSMENT_RESTIC_KEEP" --prune --tag bay-assessment-offsite >/dev/null || return 1
  return 0
}

if assessment_restic_mirror; then
  ASSESSMENT_RESTIC_STATE=PASS
  printf '%s\n' "BAY_ASSESSMENT_RESTIC_MIRROR=PASS snapshot=$ASSESSMENT_RESTIC_SNAPSHOT"
else
  assessment_restic_code=$?
  if test "$assessment_restic_code" -eq 2; then ASSESSMENT_RESTIC_STATE=SKIP; else ASSESSMENT_RESTIC_STATE=FAIL; fi
  printf '%s\n' "BAY_ASSESSMENT_RESTIC_MIRROR=$ASSESSMENT_RESTIC_STATE" >&2
  rm -rf "$tmp/assessment-restic-restore"
fi

ls -1dt "$ASSESSMENT_DEST"/????????T??????Z-???????? 2>/dev/null | awk -v keep="$ASSESSMENT_RAW_KEEP" 'NR>keep' | while IFS= read -r old; do
  rm -rf "$old"
done

rm -rf "$tmp"
release_lock
trap - EXIT HUP INT TERM

find "$DEST" -type f -name 'awh-*.sqlite' -print0 | xargs -0 ls -1t 2>/dev/null | awk -v keep="$KEEP" 'NR>keep' | while IFS= read -r old; do
  rm -f "$old" "$old.json"
done

printf '%s\n' "AWH_OFFSITE_BACKUP=PASS file=$file restic=$RESTIC_STATE"
printf '%s\n' "BAY_ASSESSMENT_OFFSITE_BACKUP=PASS snapshot=$assessment_snapshot restic=$ASSESSMENT_RESTIC_STATE"
if test "$RESTIC_STATE" = FAIL || test "$ASSESSMENT_RESTIC_STATE" = FAIL; then
  printf '%s\n' "AWH_OFFSITE_BACKUP=FAIL reason=restic-verification" >&2
  exit 5
fi
