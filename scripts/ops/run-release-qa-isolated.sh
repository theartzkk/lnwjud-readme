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
text_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 | awk '{print $NF}'
  else
    echo "No SHA-256 tool is available" >&2
    return 2
  fi
}
files_digest() {
  for rel in "$@"; do
    test -f "$ROOT/$rel" || { echo "Verification input is missing: $rel" >&2; return 2; }
    printf '%s\n' "$rel"
    file_sha256 "$ROOT/$rel"
  done | text_sha256
}
LOCK_HASH=$(file_sha256 "$ROOT/package-lock.json")
CONFIG_HASH=$(files_digest \
  config/execution-policy.json \
  config/kruart-engineering-eval.json \
  config/ecosystem-platform-policy.json \
  config/ecosystem-release-contract.json)
TEST_SUITE_HASH=$(files_digest \
  package.json \
  scripts/qa/awh-local-qa.mjs \
  scripts/qa/test-singleflight.mjs \
  scripts/qa/run-hub-tests.mjs \
  hub/src/HubVerificationIntelligence.php)
RUNNER_HASH=$(file_sha256 "$ROOT/scripts/ops/run-release-qa-isolated.sh")
PHP_VERSION=$(php -r 'echo PHP_VERSION;' 2>/dev/null || printf unavailable)
RUNTIME_HASH=$(printf '%s\n' "$NODE_VERSION" "$NPM_VERSION" "$PHP_VERSION" "$(uname -s 2>/dev/null || printf unknown)" "$(uname -m 2>/dev/null || printf unknown)" | text_sha256)
INPUT_DIGEST=$(printf '%s\n' "$SHA" "$SCRIPT" "$LOCK_HASH" "$CONFIG_HASH" "$TEST_SUITE_HASH" "$RUNNER_HASH" "$RUNTIME_HASH" | text_sha256)
CACHE_ROOT=${AWH_RELEASE_QA_CACHE_ROOT:-${HOME:-/tmp}/.cache/awh/release-qa}
CACHE_KEY="${SHA}-${SCRIPT_SAFE}-${INPUT_DIGEST}"
CACHE_FILE="$CACHE_ROOT/${CACHE_KEY}.pass"
EVIDENCE_ROOT=${AWH_RELEASE_QA_EVIDENCE_ROOT:-$CACHE_ROOT/evidence}
EVIDENCE_PREFIX="$EVIDENCE_ROOT/${SHA}-${SCRIPT_SAFE}-${INPUT_DIGEST}"
mkdir -p "$CACHE_ROOT" "$EVIDENCE_ROOT"
chmod 700 "$CACHE_ROOT" 2>/dev/null || true
cache_matches() {
  test -f "$CACHE_FILE" &&
  grep -Fxq 'schemaVersion=2' "$CACHE_FILE" &&
  grep -Fxq "sha=$SHA" "$CACHE_FILE" &&
  grep -Fxq "script=$SCRIPT" "$CACHE_FILE" &&
  grep -Fxq "inputDigest=$INPUT_DIGEST" "$CACHE_FILE" &&
  grep -Fxq "lock=$LOCK_HASH" "$CACHE_FILE" &&
  grep -Fxq "config=$CONFIG_HASH" "$CACHE_FILE" &&
  grep -Fxq "testSuite=$TEST_SUITE_HASH" "$CACHE_FILE" &&
  grep -Fxq "runner=$RUNNER_HASH" "$CACHE_FILE" &&
  grep -Fxq "runtime=$RUNTIME_HASH" "$CACHE_FILE"
}
if cache_matches; then
  echo "QA_EXACT_SHA_REUSE=PASS sha=$SHA script=$SCRIPT inputDigest=$INPUT_DIGEST"
  exit 0
fi
if test -f "$CACHE_FILE"; then
  echo "QA_EXACT_SHA_CACHE=INVALID sha=$SHA script=$SCRIPT inputDigest=$INPUT_DIGEST" >&2
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
run_bounded() {
  phase=$1
  shift
  if test "$(id -u)" -eq 0 && command -v systemd-run >/dev/null 2>&1; then
    unit="awh-release-qa-$phase-$$-$SCRIPT_SAFE"
    if systemctl cat awh-build.slice >/dev/null 2>&1; then
      systemd-run --quiet --scope --collect --unit="$unit" --slice=awh-build.slice /usr/bin/nice -n 10 "$@"
      return
    fi
    systemd-run --quiet --scope --collect --unit="$unit" --property=CPUWeight=10 --property=IOWeight=10 --property=CPUQuota=100% --property=MemoryHigh=1G --property=MemoryMax=1536M --property=TasksMax=1024 /usr/bin/nice -n 10 "$@"
    return
  fi
  "$@"
}
run_bounded install npm ci --ignore-scripts --no-audit --no-fund --prefer-offline
export AWH_QA_SINGLEFLIGHT_ROOT=${AWH_QA_SINGLEFLIGHT_ROOT:-${HOME:-/tmp}/.cache/awh/qa-singleflight}
mkdir -p "$AWH_QA_SINGLEFLIGHT_ROOT"
run_qa() {
  run_bounded qa npm run "$SCRIPT"
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
printf 'schemaVersion=2\nsha=%s\nscript=%s\ninputDigest=%s\nnode=%s\nnpm=%s\nphp=%s\nlock=%s\nconfig=%s\ntestSuite=%s\nrunner=%s\nruntime=%s\n' "$SHA" "$SCRIPT" "$INPUT_DIGEST" "$NODE_VERSION" "$NPM_VERSION" "$PHP_VERSION" "$LOCK_HASH" "$CONFIG_HASH" "$TEST_SUITE_HASH" "$RUNNER_HASH" "$RUNTIME_HASH" > "$TMP_CACHE"
mv "$TMP_CACHE" "$CACHE_FILE"
echo "QA_EXACT_SHA_CACHE=STORED sha=$SHA script=$SCRIPT inputDigest=$INPUT_DIGEST"
