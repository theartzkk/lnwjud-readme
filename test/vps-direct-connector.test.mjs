import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const linux = join(root, 'deploy/remote-worker/linux');

test('VPS direct connector bootstrap stays unprivileged and pinned', async () => {
  const [source, nodeRuntime] = await Promise.all([readFile(join(linux, 'bootstrap-vps-direct-connector.sh'), 'utf8'), readFile(join(linux, 'install-node-runtime.sh'), 'utf8')]);
  assert.match(source, /AGENT_VERSION=\$\{AWH_RDC_VERSION:-0\.2\.51\}/);
  assert.match(source, /AGENT_USER=\$\{AWH_RDC_USER:-awh-remote\}/);
  assert.match(source, /runuser -u "\$AGENT_USER"/);
  assert.match(source, /desktop-commander@\$AGENT_VERSION/);
  assert.match(source, /node-v22\.22\.1-linux-x64/);
  assert.match(source, /install-node-runtime\.sh/);
  assert.match(nodeRuntime, /VERSION=22\.22\.1/);
  assert.match(nodeRuntime, /EXPECTED_SHA=9a6bc82f9b491279147219f6a18add1e18424dce90d41d2a5fcd69d4924ba3aa/);
  assert.match(nodeRuntime, /https:\/\/nodejs\.org\/download\/release\/v\$\{VERSION\}/);
  assert.match(nodeRuntime, /sha256sum -c -/);
  assert.match(source, /AWH_VPS_DIRECT_SECURITY=UNPRIVILEGED_NO_SUDO/);
  assert.doesNotMatch(source, /sudoers|NOPASSWD|usermod\s+-aG\s+sudo|exec\s+sudo|npx[^\n]*latest/);
});

test('Phase 2 installer persists only a bounded unprivileged service', async () => {
  const [install, unit, verify] = await Promise.all([
    readFile(join(linux, 'install-vps-direct-connector.sh'), 'utf8'),
    readFile(join(linux, 'desktop-commander-vps.service.template'), 'utf8'),
    readFile(join(linux, 'verify-vps-direct-connector.sh'), 'utf8'),
  ]);
  assert.match(install, /AGENT_VERSION=\$\{AWH_RDC_VERSION:-0\.2\.51\}/);
  assert.match(install, /NODE_ROOT=\$\{AWH_RDC_NODE_ROOT:-\/opt\/awh-tools\/remote-desktop\/node-v22\.22\.1-linux-x64\}/);
  assert.match(install, /AWH_VPS_DIRECT_NODE22_REQUIRED/);
  assert.match(install, /allowedDirectories.*\/srv\/awh-git.*\/tmp/s);
  assert.match(install, /AWH_RDC_SESSION_SOURCE/);
  assert.match(install, /setfacl -R -m "u:\$AGENT_USER:rX" \/srv\/awh-git/);
  assert.doesNotMatch(install, /NOPASSWD|\/etc\/sudoers|usermod\s+-aG\s+(sudo|adm)/);
  assert.match(unit, /User=__AGENT_USER__/);
  assert.match(unit, /ExecStart=__NODE_ROOT__\/bin\/node/);
  assert.doesNotMatch(unit, /User=(?:root|bayadmin)/);
  assert.match(unit, /NoNewPrivileges=true/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /ReadOnlyPaths=\/srv\/awh-git/);
  assert.match(unit, /CapabilityBoundingSet=\s*$/m);
  assert.match(verify, /AWH_VPS_DIRECT_VERIFY=PASS/);
  assert.match(verify, /AWH_VPS_DIRECT_NODE22_REQUIRED/);
  assert.match(verify, /runuser -u "\$AGENT_USER" -- git --git-dir=\/srv\/awh-git\/awh\.git/);
});
