#!/bin/sh
set -eu
AWH_ROOT="$HOME/Library/Application Support/AWH"
ENGINE_LINK="$AWH_ROOT/Engines/lnwjud/current"
ENGINE="$(readlink "$ENGINE_LINK" 2>/dev/null || printf '%s' "$ENGINE_LINK")"
DATA="$AWH_ROOT/DeviceRuntime/device-runtime"
mkdir -p "$DATA"
chmod 700 "$DATA"
unset ELECTRON_RUN_AS_NODE
export AWH_DEVICE_RUNTIME_HEADLESS=1
export LNWJUD_DATA_PATH="$DATA"
exec "$ENGINE/Contents/MacOS/AWH Device Runtime" --mcp-stdio "$@"
