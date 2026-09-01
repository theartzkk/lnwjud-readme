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
  printf '%s\n' "RELEASE_COMPACTION_PLAN=hard-link-only,control+web,rollback-history-preserved,bounded-$LIMIT"
  printf '%s\n' 'RELEASE_COMPACTION_APPLY_REQUIRES_APPROVAL'
  exit 0
fi
if test "$MODE" = preview; then
  AUDIT_SCRIPT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/audit-release-retention.sh
  test -x "$AUDIT_SCRIPT" || { echo 'release retention audit is required' >&2; exit 1; }
  "$AUDIT_SCRIPT"
  printf '%s\n' 'RELEASE_COMPACTION_PREVIEW_SOURCE=BLOCK_AWARE_RETENTION_AUDIT'
  printf '%s\n' 'RELEASE_COMPACTION_RESULT=PREVIEW'
  exit 0
fi
test "$APPROVED" -eq 1 || { echo 'Release compaction requires --approve' >&2; exit 2; }
command -v ssh >/dev/null 2>&1 || { echo 'ssh is required' >&2; exit 1; }
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" sh -s -- "$MODE" "$LIMIT" <<'REMOTE'
set -eu
MODE=$1
LIMIT=$2
CONTROL_ROOT=/opt/awh-hub/control-releases
WEB_ROOT=/var/www/awh-web/releases
STORE=/var/www/awh-web/desktop-artifacts
for root in "$CONTROL_ROOT" "$WEB_ROOT" "$STORE"; do test -d "$root" && test ! -L "$root"; done
scanned=0
linked=0
reclaimed=0
control_linked=0
web_linked=0
compact_root() {
  root=$1
  suffix=$2
  scope=$3
  if test "$(stat -c %d "$root")" != "$(stat -c %d "$STORE")"; then
    printf '%s\n' "RELEASE_COMPACTION_${scope}=SKIP_DIFFERENT_FILESYSTEM"
    return 0
  fi
  for release in $(find "$root" -mindepth 1 -maxdepth 1 -type d -print | sort); do
    case "$release" in "$root"/m[0-9]*-[0-9a-fA-F]*) ;; *) continue ;; esac
    for name in AWH-macOS-x64.zip AWH-Windows-x64.zip SHA256SUMS.txt; do
      file="$release/$suffix/$name"
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
        if test "$scope" = CONTROL; then control_linked=$((control_linked + 1)); else web_linked=$((web_linked + 1)); fi
        test "$linked" -lt "$LIMIT" || return 2
      fi
    done
  done
  return 0
}
compact_root "$CONTROL_ROOT" dist-web/downloads CONTROL || test $? -eq 2
if test "$linked" -lt "$LIMIT"; then compact_root "$WEB_ROOT" downloads WEB || test $? -eq 2; fi
printf '%s\n' "RELEASE_COMPACTION_MODE=$MODE"
printf '%s\n' "RELEASE_COMPACTION_SCANNED=$scanned"
printf '%s\n' "RELEASE_COMPACTION_LINKABLE=$linked"
printf '%s\n' "RELEASE_COMPACTION_CONTROL_LINKABLE=$control_linked"
printf '%s\n' "RELEASE_COMPACTION_WEB_LINKABLE=$web_linked"
printf '%s\n' "RELEASE_COMPACTION_RECLAIMABLE_BYTES=$reclaimed"
if test "$MODE" = apply; then printf '%s\n' 'RELEASE_COMPACTION_RESULT=PASS'; else printf '%s\n' 'RELEASE_COMPACTION_RESULT=PREVIEW'; fi
REMOTE
