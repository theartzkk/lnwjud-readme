#!/bin/sh

set -eu

ROOT=${1:-dist-web}
EXPECTED_RELEASE_ID=${2:-${AWH_RELEASE_ID:-}}
case "$ROOT" in
  /*) : ;;
  *) ROOT="$(pwd)/$ROOT" ;;
esac

for file in index.html styles.css app.js hub-read-adapter.js data.json release.json; do
  test -f "$ROOT/$file" || { echo "Missing release file: $file" >&2; exit 1; }
  test ! -L "$ROOT/$file" || { echo "Symlink release file rejected: $file" >&2; exit 1; }
done

case "$ROOT" in
  *"/dist"|*"/node_modules"|*"/.git"|*"/.awh-local") echo "Unsafe release directory" >&2; exit 1 ;;
esac

# A deploy that names a release must prove that both the manifest and the
# rendered HTML carry that exact identity. This prevents a build produced with
# the local fallback from being activated under an immutable production name.
if [ -n "$EXPECTED_RELEASE_ID" ]; then
  case "$EXPECTED_RELEASE_ID" in
    local|''|*[!A-Za-z0-9._-]*) echo "Invalid production release identity: $EXPECTED_RELEASE_ID" >&2; exit 1 ;;
  esac

  grep -F "\"releaseId\": \"$EXPECTED_RELEASE_ID\"" "$ROOT/release.json" >/dev/null || {
    echo "Release manifest identity mismatch: expected $EXPECTED_RELEASE_ID" >&2
    exit 1
  }

  grep -F "release=$EXPECTED_RELEASE_ID" "$ROOT/index.html" >/dev/null || {
    echo "Rendered HTML release identity mismatch: expected $EXPECTED_RELEASE_ID" >&2
    exit 1
  }

  if grep -F 'release=local' "$ROOT/index.html" >/dev/null; then
    echo "Local release identity rejected for named deployment" >&2
    exit 1
  fi
fi

if grep -F '__AWH_WEB_RELEASE_ID__' "$ROOT/index.html" "$ROOT/app.js" >/dev/null; then
  echo "Unrendered web release identity placeholder rejected" >&2
  exit 1
fi

echo "AWH web release validation: PASS"
