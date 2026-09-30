#!/usr/bin/env bash
set -euo pipefail
test "$#" -ge 2 || { echo "usage: $0 <artifact> <output-dir>"; exit 2; }
ARTIFACT=$(realpath "$1")
OUT=$2
LB=${AWH_TOOL_BIN:-/var/lib/awh-remote/.local/bin}
test -f "$ARTIFACT"
mkdir -p "$OUT"
BASE=$(basename "$ARTIFACT")
sha256sum "$ARTIFACT" >"$OUT/$BASE.sha256"
"$LB/syft" "$ARTIFACT" -o spdx-json="$OUT/$BASE.spdx.json" >/dev/null
SIGNING_STATE=CREDENTIAL_REQUIRED
if test -n "${AWH_COSIGN_KEY:-}"; then
  test -n "${COSIGN_PASSWORD:-}" || { echo "COSIGN_PASSWORD_REQUIRED"; exit 3; }
  "$LB/cosign" sign-blob --yes --key "$AWH_COSIGN_KEY" --bundle "$OUT/$BASE.cosign.bundle" "$ARTIFACT" >/dev/null
  SIGNING_STATE=SIGNED
fi
printf '{"artifact":"%s","signingState":"%s"}\n' "$BASE" "$SIGNING_STATE" >"$OUT/$BASE.provenance.json"
echo "PROVENANCE=PASS signing=$SIGNING_STATE"
