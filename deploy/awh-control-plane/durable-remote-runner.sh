#!/bin/sh
set -u
RESULT=$1
LOG=$2
SCRIPT=$3
shift 3
TMP_RESULT="$RESULT.tmp.$$"
rm -f "$TMP_RESULT"
set +e
sh "$SCRIPT" "$@" >"$LOG" 2>&1
STATUS=$?
set -e
printf '%s\n' "$STATUS" >"$TMP_RESULT"
mv -f "$TMP_RESULT" "$RESULT"
exit "$STATUS"
