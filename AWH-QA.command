#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if command -v node >/dev/null 2>&1; then
  exec node "$ROOT/scripts/qa/awh-local-qa.mjs" full
fi
echo "AWH QA requires Node.js 20 or newer. Install Node locally, then run: npm run qa:full"
exit 1
