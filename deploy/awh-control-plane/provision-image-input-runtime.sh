#!/bin/sh
set -eu
LC_ALL=C
export LC_ALL
MODE=dry-run
APPROVED=0
TARGET=${AWH_DEPLOY_TARGET:-awh-ready}
for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE=dry-run ;;
    --apply) MODE=apply ;;
    --approve) APPROVED=1 ;;
    *) echo 'Usage: provision-image-input-runtime.sh [--dry-run] | --apply --approve' >&2; exit 2 ;;
  esac
done
if test "$MODE" = dry-run; then
  printf '%s\n' 'IMAGE_INPUT_RUNTIME_PLAN=ubuntu-24.04,libvips-tools,vipsthumbnail,libheif,verify-only-after-install'
  printf '%s\n' "IMAGE_INPUT_RUNTIME_TARGET=$TARGET"
  printf '%s\n' 'IMAGE_INPUT_RUNTIME_APPLY_REQUIRES_APPROVAL'
  exit 0
fi
test "$APPROVED" -eq 1 || { echo 'Image input runtime provisioning requires --approve' >&2; exit 2; }
command -v ssh >/dev/null 2>&1 || { echo 'ssh is required' >&2; exit 1; }
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$TARGET" 'sh -s' <<'REMOTE'
set -eu
LC_ALL=C
export LC_ALL
. /etc/os-release
test "${ID:-}" = ubuntu
case "${VERSION_ID:-}" in 24.04*) ;; *) echo 'IMAGE_INPUT_RUNTIME_UNSUPPORTED_OS' >&2; exit 20 ;; esac
if ! test -x /usr/bin/vipsthumbnail; then
  sudo apt-get update -qq
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends libvips-tools
fi
test -x /usr/bin/vipsthumbnail
test ! -L /usr/bin/vipsthumbnail
test "$(stat -c '%U:%G:%a' /usr/bin/vipsthumbnail)" = 'root:root:755'
dpkg-query -W -f='${Status}\n' libvips-tools libvips42t64 libheif1 | grep -c '^install ok installed$' | grep -q '^3$'
printf '%s\n' 'IMAGE_INPUT_RUNTIME=READY'
REMOTE
