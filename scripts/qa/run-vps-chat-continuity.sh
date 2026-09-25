#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
ENV_FILE=${AWH_BROWSER_QA_ENV:-/etc/awh/browser-qa.env}
[ -r "$ENV_FILE" ] || { echo AWH_BROWSER_QA_ENV_MISSING >&2; exit 1; }
. "$ENV_FILE"
cd "$ROOT"
"$AWH_BROWSER_QA_NODE_BIN" scripts/qa/control-web-fixture.mjs > /tmp/awh-control-web-fixture.log 2>&1 & FIXTURE_PID=$!
cleanup(){ kill "$FIXTURE_PID" 2>/dev/null || true; wait "$FIXTURE_PID" 2>/dev/null || true; }
trap cleanup EXIT HUP INT TERM
i=0; until curl -fsS http://127.0.0.1:4174/ >/dev/null 2>&1; do i=$((i+1)); [ "$i" -lt 50 ] || { cat /tmp/awh-control-web-fixture.log >&2; exit 1; }; sleep 0.1; done
AWH_CLOSURE_FIXTURE_URL=http://127.0.0.1:4174/ AWH_CHROME_PATH="$AWH_CHROME_PATH" AWH_PLAYWRIGHT_MODULE="$AWH_PLAYWRIGHT_MODULE" "$AWH_BROWSER_QA_NODE_BIN" scripts/qa/chat-continuity-browser.mjs
