#!/bin/bash
set -u
ROOT="$HOME/Library/Application Support/AWH/RemoteWorker"
LOG="$HOME/Library/Logs/AWH-Remote-Worker.log"
ERR="$HOME/Library/Logs/AWH-Remote-Worker.err.log"
BIN="$ROOT/runtime/node_modules/.bin/desktop-commander"
PATTERN='node .*desktop-commander remote'
mkdir -p "$ROOT" "$HOME/Library/Logs"
log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$1" >> "$LOG"; }
terminate_tree() { local p="$1"; pkill -TERM -P "$p" 2>/dev/null || true; kill -TERM "$p" 2>/dev/null || true; }
log 'supervisor started (pinned local runtime 0.2.47)'
while true; do
  PIDS="$(pgrep -f "$PATTERN" | sort -n || true)"
  COUNT="$(printf '%s\n' "$PIDS" | awk 'NF{n++} END{print n+0}')"
  if [ "$COUNT" -gt 1 ]; then
    KEEP="$(printf '%s\n' "$PIDS" | awk 'NF{print; exit}')"
    log "duplicate remote detected; keeping $KEEP"
    printf '%s\n' "$PIDS" | awk 'NF' | tail -n +2 | while IFS= read -r PID; do
      log "terminating duplicate tree $PID"; terminate_tree "$PID"
    done
  elif [ "$COUNT" -eq 0 ]; then
    if [ ! -x "$BIN" ]; then log 'ERROR pinned runtime missing; refusing network-dependent installer fallback'
    else
      if [ -f "$LOG" ] && [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 5242880 ]; then mv -f "$LOG" "$LOG.1" 2>/dev/null || true; fi
      if [ -f "$ERR" ] && [ "$(wc -c < "$ERR" 2>/dev/null || echo 0)" -gt 1048576 ]; then mv -f "$ERR" "$ERR.1" 2>/dev/null || true; fi
      log 'starting pinned local remote runtime'
      "$BIN" remote --persist-session >> "$LOG" 2>> "$ERR" &
    fi
  fi
  sleep 5
done
