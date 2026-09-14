import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const bootstrap = join(root, 'deploy/remote-worker/linux/bootstrap-vps-direct-connector.sh');

test('VPS direct connector bootstrap stays unprivileged and pinned', async () => {
  const source = await readFile(bootstrap, 'utf8');
  assert.match(source, /AGENT_VERSION=\$\{AWH_RDC_VERSION:-0\.2\.50\}/);
  assert.match(source, /AGENT_USER=\$\{AWH_RDC_USER:-awh-remote\}/);
  assert.match(source, /runuser -u "\$AGENT_USER"/);
  assert.match(source, /desktop-commander@\$AGENT_VERSION/);
  assert.match(source, /AWH_VPS_DIRECT_SECURITY=UNPRIVILEGED_NO_SUDO/);
  assert.doesNotMatch(source, /sudoers|NOPASSWD|usermod\s+-aG\s+sudo|exec\s+sudo|npx[^\n]*latest/);
});
