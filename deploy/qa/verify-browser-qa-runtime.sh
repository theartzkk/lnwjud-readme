#!/bin/sh
set -eu
ENV_FILE=${AWH_BROWSER_QA_ENV:-/etc/awh/browser-qa.env}
fail(){ printf '%s\n' "$1" >&2; exit 1; }
[ -r "$ENV_FILE" ] || fail AWH_BROWSER_QA_ENV_MISSING
. "$ENV_FILE"
[ -x "$AWH_CHROME_PATH" ] || fail AWH_BROWSER_QA_CHROME_MISSING
[ -f "$AWH_PLAYWRIGHT_MODULE" ] || fail AWH_BROWSER_QA_PLAYWRIGHT_MISSING
MISSING=$(ldd "$AWH_CHROME_PATH" 2>/dev/null | awk '/not found/{print $1}' | sort -u)
[ -z "$MISSING" ] || { printf '%s\n' "$MISSING"; fail AWH_BROWSER_QA_SHARED_LIBS_MISSING; }
node -e "import(process.argv[1]).then(m=>{if(!m.chromium)process.exit(2)})" "file://$AWH_PLAYWRIGHT_MODULE"
printf '%s\n' AWH_BROWSER_QA_VERIFY=PASS
