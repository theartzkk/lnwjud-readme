#!/bin/sh
set -eu

MODE=dry-run
APPROVE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE=dry-run ;;
    --deploy) MODE=deploy ;;
    --approve) APPROVE=1 ;;
    *) echo "AWH_BACKUP_ACTIVATION_ERROR=ARGUMENT" >&2; exit 64 ;;
  esac
done

ROOT=$(git rev-parse --show-toplevel)
HEAD=$(git -C "$ROOT" rev-parse HEAD | tr 'A-F' 'a-f')
EXPECTED=${AWH_RELEASE_COMMIT:-$HEAD}
TARGET=${AWH_DEPLOY_TARGET:-awh-ready}
case "$EXPECTED" in *[!0-9a-f]*|'') echo "AWH_BACKUP_ACTIVATION_ERROR=REVISION" >&2; exit 2 ;; esac
test "${#EXPECTED}" -eq 40 || { echo "AWH_BACKUP_ACTIVATION_ERROR=REVISION" >&2; exit 2; }
case "$TARGET" in *[!A-Za-z0-9._-]*|'') echo "AWH_BACKUP_ACTIVATION_ERROR=TARGET" >&2; exit 2 ;; esac

test "$HEAD" = "$EXPECTED" || { echo "AWH_BACKUP_ACTIVATION_ERROR=HEAD_MISMATCH" >&2; exit 2; }
test -z "$(git -C "$ROOT" status --porcelain --untracked-files=all)" || { echo "AWH_BACKUP_ACTIVATION_ERROR=DIRTY_TREE" >&2; exit 2; }
SHORT=$(printf '%s' "$EXPECTED" | cut -c1-12)
SERVICE="$ROOT/deploy/systemd/awh-backup.service"
TIMER="$ROOT/deploy/systemd/awh-backup.timer"
REMOTE="$ROOT/deploy/awh-backup/remote-activate-backup.sh"
WRAPPER="$ROOT/hub/bin/scheduled-backup.php"
for file in "$SERVICE" "$TIMER" "$REMOTE" "$WRAPPER"; do test -f "$file" && test ! -L "$file" || { echo "AWH_BACKUP_ACTIVATION_ERROR=ASSET" >&2; exit 2; }; done
SERVICE_SHA=$(shasum -a 256 "$SERVICE" | awk '{print $1}')
TIMER_SHA=$(shasum -a 256 "$TIMER" | awk '{print $1}')
WRAPPER_SHA=$(shasum -a 256 "$WRAPPER" | awk '{print $1}')
STAGE="/tmp/awh-backup-activate-$SHORT"

echo "AWH_BACKUP_RELEASE=$EXPECTED"
echo "AWH_BACKUP_TARGET=$TARGET"
echo "AWH_BACKUP_PLAN=verify-current-release,verify-units,backup-existing-units,install,daemon-reload,enable-timer,one-shot-backup,verify-manifest,verify-database"
if test "$MODE" = dry-run; then
  echo "AWH_BACKUP_DRY_RUN=PASS"
  exit 0
fi
test "$APPROVE" -eq 1 || { echo "AWH_BACKUP_ACTIVATION_ERROR=APPROVAL_REQUIRED" >&2; exit 2; }

ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" "rm -rf '$STAGE' && mkdir -m 0700 '$STAGE'"
scp -q "$SERVICE" "$TIMER" "$REMOTE" "$TARGET:$STAGE/"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" sh "$STAGE/remote-activate-backup.sh" "$SHORT" "$SERVICE_SHA" "$TIMER_SHA" "$WRAPPER_SHA"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" "rm -rf '$STAGE'"
echo "AWH_BACKUP_ACTIVATION=PASS"
