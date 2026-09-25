#!/bin/bash
set -u
ROOT="$HOME/Library/Application Support/AWH/RemoteWorker"
LOG="$HOME/Library/Logs/AWH-Remote-Worker.log"
ERR="$HOME/Library/Logs/AWH-Remote-Worker.err.log"
BIN="$ROOT/runtime/node_modules/.bin/desktop-commander"
UPDATER="$ROOT/awh-runtime-update.sh"
PATTERN='node .*desktop-commander remote'
UPDATE_INTERVAL=21600
NEXT_UPDATE=0
mkdir -p "$ROOT" "$HOME/Library/Logs"
log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$1" >> "$LOG"; }
terminate_tree() { local p="$1"; pkill -TERM -P "$p" 2>/dev/null || true; kill -TERM "$p" 2>/dev/null || true; }
VERSION="$(node -e 'try{process.stdout.write(require(process.argv[1]).version)}catch{process.stdout.write("missing")}' "$ROOT/runtime/node_modules/@wonderwhy-er/desktop-commander/package.json" 2>/dev/null || echo missing)"
log "supervisor started (AWH Device Runtime $VERSION)"
while true; do
  NOW="$(date +%s)"
  if [ "$NOW" -ge "$NEXT_UPDATE" ]; then
    NEXT_UPDATE=$((NOW + UPDATE_INTERVAL))
    if [ -x "$UPDATER" ]; then "$UPDATER" --background >> "$LOG" 2>> "$ERR" & fi
  fi
  PIDS="$(pgrep -f "$PATTERN" | sort -n || true)"
  COUNT="$(printf '%s\n' "$PIDS" | awk 'NF{n++} END{print n+0}')"
  if [ "$COUNT" -gt 1 ]; then
    KEEP="$(printf '%s\n' "$PIDS" | awk 'NF{print; exit}')"
    log "duplicate remote detected; keeping $KEEP"
    printf '%s\n' "$PIDS" | awk 'NF' | tail -n +2 | while IFS= read -r PID; do log "terminating duplicate tree $PID"; terminate_tree "$PID"; done
  elif [ "$COUNT" -eq 0 ]; then
    if [ ! -x "$BIN" ]; then log 'ERROR AWH Device Runtime missing'
    else
      [ ! -f "$LOG" ] || [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -le 5242880 ] || mv -f "$LOG" "$LOG.1" 2>/dev/null || true
      [ ! -f "$ERR" ] || [ "$(wc -c < "$ERR" 2>/dev/null || echo 0)" -le 1048576 ] || mv -f "$ERR" "$ERR.1" 2>/dev/null || true
      log 'starting AWH Device Runtime'
      "$BIN" remote --persist-session >> "$LOG" 2>> "$ERR" &
    fi
  fi
  sleep 5
done
