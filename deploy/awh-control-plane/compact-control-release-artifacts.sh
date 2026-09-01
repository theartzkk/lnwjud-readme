#!/bin/sh
set -eu
LC_ALL=C
export LC_ALL
MODE=plan
APPROVED=0
TARGET=${AWH_DEPLOY_TARGET:-awh-ready}
LIMIT=${AWH_RELEASE_COMPACTION_LIMIT:-12}
for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE=plan ;;
    --preview) MODE=preview ;;
    --apply) MODE=apply ;;
    --approve) APPROVED=1 ;;
    *) echo 'Usage: compact-control-release-artifacts.sh [--dry-run|--preview] | --apply --approve' >&2; exit 2 ;;
  esac
done
case "$LIMIT" in ''|*[!0-9]*) exit 2 ;; esac
test "$LIMIT" -ge 1 && test "$LIMIT" -le 50 || exit 2
if test "$MODE" = plan; then
  printf '%s\n' "RELEASE_COMPACTION_PLAN=hard-link-only,rollback-history-preserved,bounded-$LIMIT"
  printf '%s\n' 'RELEASE_COMPACTION_APPLY_REQUIRES_APPROVAL'
  exit 0
fi
test "$MODE" != apply || test "$APPROVED" -eq 1 || { echo 'Release compaction requires --approve' >&2; exit 2; }
command -v ssh >/dev/null 2>&1 || { echo 'ssh is required' >&2; exit 1; }
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" sh -s -- "$MODE" "$LIMIT" <<'REMOTE'
set -eu
MODE=$1
LIMIT=$2
ROOT=/opt/awh-hub/control-releases
STORE=/var/www/awh-web/desktop-artifacts
test -d "$ROOT" && test ! -L "$ROOT"
test -d "$STORE" && test ! -L "$STORE"
if test "$(stat -c %d "$ROOT")" != "$(stat -c %d "$STORE")"; then
  printf '%s\n' 'RELEASE_COMPACTION=SKIP_DIFFERENT_FILESYSTEM'
  exit 0
fi
scanned=0
linked=0
reclaimed=0
for release in $(find "$ROOT" -mindepth 1 -maxdepth 1 -type d -print | sort); do
  case "$release" in "$ROOT"/m[0-9]*-[0-9a-fA-F]*) ;; *) continue ;; esac
  for name in AWH-macOS-x64.zip AWH-Windows-x64.zip SHA256SUMS.txt; do
    file="$release/dist-web/downloads/$name"
    test -f "$file" && test ! -L "$file" || continue
    scanned=$((scanned + 1))
    digest=$(sha256sum "$file" | cut -d' ' -f1)
    case "$digest" in *[!0-9a-f]*|'') exit 20 ;; esac
    object="$STORE/$digest-$name"
    if test ! -e "$object" && test ! -L "$object"; then
      if test "$MODE" = apply; then
        ln "$file" "$object"
        chown awh-hub:www-data "$object"
        chmod 0640 "$object"
      else
        continue
      fi
    fi
    test -f "$object" && test ! -L "$object"
    cmp -s "$file" "$object"
    test "$(stat -c %d "$file")" = "$(stat -c %d "$object")"
    if test "$(stat -c %i "$file")" != "$(stat -c %i "$object")"; then
      size=$(stat -c %s "$file")
      if test "$MODE" = apply; then
        temp="$file.awh-compact-link"
        test ! -e "$temp" && test ! -L "$temp"
        ln "$object" "$temp"
        cmp -s "$file" "$temp"
        mv -Tf "$temp" "$file"
      fi
      linked=$((linked + 1))
      reclaimed=$((reclaimed + size))
      test "$linked" -lt "$LIMIT" || break 2
    fi
  done
done
printf '%s\n' "RELEASE_COMPACTION_MODE=$MODE"
printf '%s\n' "RELEASE_COMPACTION_SCANNED=$scanned"
printf '%s\n' "RELEASE_COMPACTION_LINKABLE=$linked"
printf '%s\n' "RELEASE_COMPACTION_RECLAIMABLE_BYTES=$reclaimed"
if test "$MODE" = apply; then printf '%s\n' 'RELEASE_COMPACTION_RESULT=PASS'; else printf '%s\n' 'RELEASE_COMPACTION_RESULT=PREVIEW'; fi
REMOTE
