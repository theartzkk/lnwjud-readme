#!/bin/sh

set -eu

ROOT=${1:-dist-web}
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

echo "AWH web release validation: PASS"
