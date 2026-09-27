#!/bin/sh
set -eu
ROOT=$1
SCRIPT=$2
case "$ROOT" in /*) ;; *) echo "QA root must be absolute" >&2; exit 2 ;; esac
case "$SCRIPT" in qa:fast|qa:local|qa:full) ;; *) echo "QA script is not allowlisted" >&2; exit 2 ;; esac
test -d "$ROOT"
if test -x /opt/awh-toolchain/node/bin/node && test -x /opt/awh-toolchain/node/bin/npm; then
  PATH=/opt/awh-toolchain/node/bin:$PATH
  export PATH
fi
SHA=$(git -C "$ROOT" rev-parse HEAD)
case "$SHA" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;;
  *) echo "QA source SHA is invalid" >&2; exit 2 ;;
esac
if test -n "$(git -C "$ROOT" status --porcelain --untracked-files=all)"; then
  echo "QA source must be clean before isolation" >&2
  exit 2
fi
SCRIPT_SAFE=$(printf '%s' "$SCRIPT" | tr ':' '-')
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  else
    echo "No SHA-256 tool is available" >&2
    return 2
  fi
}
LOCK_HASH=$(file_sha256 "$ROOT/package-lock.json")
CACHE_ROOT=${AWH_RELEASE_QA_CACHE_ROOT:-${HOME:-/tmp}/.cache/awh/release-qa}
CACHE_KEY="${SHA}-${SCRIPT_SAFE}-${NODE_VERSION}-${NPM_VERSION}-${LOCK_HASH}"
CACHE_FILE="$CACHE_ROOT/${CACHE_KEY}.pass"
EVIDENCE_ROOT=${AWH_RELEASE_QA_EVIDENCE_ROOT:-$CACHE_ROOT/evidence}
EVIDENCE_PREFIX="$EVIDENCE_ROOT/${SHA}-${SCRIPT_SAFE}"
mkdir -p "$CACHE_ROOT" "$EVIDENCE_ROOT"
chmod 700 "$CACHE_ROOT" 2>/dev/null || true
if test -f "$CACHE_FILE"; then
  echo "QA_EXACT_SHA_REUSE=PASS sha=$SHA script=$SCRIPT"
  exit 0
fi
QA_ROOT=$(mktemp -d "/tmp/awh-release-qa-${SCRIPT_SAFE}-XXXXXX")
cleanup() {
  rm -rf "$QA_ROOT"
}
trap cleanup EXIT INT TERM HUP
git clone --quiet --shared --no-checkout "$ROOT" "$QA_ROOT"
git -C "$QA_ROOT" checkout --quiet --detach "$SHA"
test "$(git -C "$QA_ROOT" rev-parse HEAD)" = "$SHA"
test -z "$(git -C "$QA_ROOT" status --porcelain --untracked-files=all)"
cd "$QA_ROOT"
echo "QA_ISOLATION=EXACT_SHA sha=$SHA root=$QA_ROOT"
npm ci --ignore-scripts --no-audit --no-fund --prefer-offline
export AWH_QA_SINGLEFLIGHT_ROOT=${AWH_QA_SINGLEFLIGHT_ROOT:-${HOME:-/tmp}/.cache/awh/qa-singleflight}
mkdir -p "$AWH_QA_SINGLEFLIGHT_ROOT"
run_qa() {
  if test "$(id -u)" -eq 0 && command -v systemd-run >/dev/null 2>&1; then
    unit="awh-release-qa-$$-$SCRIPT_SAFE"
    if systemctl cat awh-build.slice >/dev/null 2>&1; then
      systemd-run --quiet --scope --unit="$unit" --slice=awh-build.slice --property=CPUWeight=20 --property=IOWeight=10 --property=MemoryHigh=2G /usr/bin/nice -n 10 npm run "$SCRIPT"
      return
    fi
    systemd-run --quiet --scope --unit="$unit" --property=CPUWeight=20 --property=IOWeight=10 --property=MemoryHigh=2G /usr/bin/nice -n 10 npm run "$SCRIPT"
    return
  fi
  npm run "$SCRIPT"
}
if run_qa; then
  QA_STATUS=0
else
  QA_STATUS=$?
fi
if test "$QA_STATUS" -ne 0; then
  umask 077
  if test -f "$QA_ROOT/.awh-local/qa/latest.log"; then
    cp "$QA_ROOT/.awh-local/qa/latest.log" "${EVIDENCE_PREFIX}.failure.log"
  else
    printf 'QA failed before latest.log was produced\nsha=%s\nscript=%s\nexit=%s\n' "$SHA" "$SCRIPT" "$QA_STATUS" > "${EVIDENCE_PREFIX}.failure.log"
  fi
  if test -f "$QA_ROOT/.awh-local/qa/latest.json"; then
    cp "$QA_ROOT/.awh-local/qa/latest.json" "${EVIDENCE_PREFIX}.failure.json"
  fi
  echo "QA_FAILURE_EVIDENCE=${EVIDENCE_PREFIX}.failure.log" >&2
  exit "$QA_STATUS"
fi
umask 077
TMP_CACHE="${CACHE_FILE}.tmp.$$"
printf 'sha=%s\nscript=%s\nnode=%s\nnpm=%s\nlock=%s\n' "$SHA" "$SCRIPT" "$NODE_VERSION" "$NPM_VERSION" "$LOCK_HASH" > "$TMP_CACHE"
mv "$TMP_CACHE" "$CACHE_FILE"
echo "QA_EXACT_SHA_CACHE=STORED sha=$SHA script=$SCRIPT"
