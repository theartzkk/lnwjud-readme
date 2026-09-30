#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
LB=${AWH_TOOL_BIN:-/var/lib/awh-remote/.local/bin}
LOCK=${AWH_TOOL_LOCK:-$ROOT/config/platform-toolchain-lock.json}
MODE=${1:---binaries}
need(){
  command -v "$1" >/dev/null 2>&1 || test -x "$LB/$1" || {
    echo "MISSING:$1"
    exit 1
  }
}
for x in mise rg fd yq dust duf btop hyperfine trivy gitleaks syft cosign cue opa conftest uv ansible ansible-playbook gatus beszel beszel-agent; do
  need "$x"
done
test -x "$LB/restic" || command -v restic >/dev/null 2>&1 || {
  echo MISSING:restic
  exit 1
}
if test -f "$LOCK"; then
  python3 - "$LOCK" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
assert d["schemaVersion"]==1
assert d["authority"]=="AWH_PLATFORM_TOOLCHAIN"
assert d["rules"]["singleAuthority"] is True
assert d["futureAdapters"]["openobserve"]=="contract-only"
print("TOOLCHAIN_LOCK=PASS tools=%d" % len(d["tools"]))
PY
fi
"$LB/trivy" --version | head -1
"$LB/gitleaks" version
"$LB/syft" version | head -1
"$LB/conftest" --version | head -1
"$LB/ansible" --version | head -1
"$LB/cue" vet "$LOCK" "$ROOT/policy/platform-toolchain.cue" -d "#Lock"
"$LB/conftest" test "$LOCK" --policy "$ROOT/policy/platform-toolchain.rego" --output stdout
OPA_DENY=$("$LB/opa" eval --format raw -i "$LOCK" -d "$ROOT/policy/platform-toolchain.rego" "count(data.main.deny)")
test "$OPA_DENY" = "0"
echo POLICY_GATES=PASS
if test "$MODE" = "--runtime"; then
  curl -fsS http://127.0.0.1:8088/health | grep -Fq '"status":"UP"'
  "$LB/beszel" health --url http://127.0.0.1:8090 | grep -Fq ok
  systemctl is-active --quiet awh-gatus.service
  systemctl is-active --quiet awh-beszel.service
  echo SENSOR_RUNTIME=PASS
fi
echo PLATFORM_TOOLING=PASS
