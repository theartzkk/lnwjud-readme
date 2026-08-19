import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PRODUCT } from '../src/product.js';
import { compatibilityEnv, loadConfig } from '../src/config.js';

test('AWH product identity is centralized while legacy compatibility identity remains explicit', () => {
  assert.deepEqual(PRODUCT, {
    productName: 'Art’s Workspace Hub',
    shortName: 'AWH',
    desktopName: 'AWH Desktop',
    tagline: 'Your Projects. One Workspace. Anywhere.',
    legacyCodename: 'Art Agent',
    legacyPackageId: 'art-agent',
  });
});

test('AWH environment aliases take precedence over ART_AGENT compatibility values', () => {
  const originalAwh = process.env.AWH_WORKSPACE;
  const originalLegacy = process.env.ART_AGENT_WORKSPACE;
  try {
    process.env.AWH_WORKSPACE = '/tmp/awh-workspace';
    process.env.ART_AGENT_WORKSPACE = '/tmp/legacy-workspace';
    assert.equal(compatibilityEnv('workspace'), '/tmp/awh-workspace');
    delete process.env.AWH_WORKSPACE;
    assert.equal(compatibilityEnv('workspace'), '/tmp/legacy-workspace');
  } finally {
    if (originalAwh === undefined) delete process.env.AWH_WORKSPACE;
    else process.env.AWH_WORKSPACE = originalAwh;
    if (originalLegacy === undefined) delete process.env.ART_AGENT_WORKSPACE;
    else process.env.ART_AGENT_WORKSPACE = originalLegacy;
  }
});

test('loadConfig applies AWH aliases before legacy values and stored defaults', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'awh-config-'));
  const keys = ['AWH_DATA_DIR', 'ART_AGENT_DATA_DIR', 'AWH_WORKSPACE', 'ART_AGENT_WORKSPACE', 'AWH_ALLOW_WRITE', 'ART_AGENT_ALLOW_WRITE'];
  const original = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.AWH_DATA_DIR = dataDir;
    process.env.ART_AGENT_DATA_DIR = join(dataDir, 'legacy');
    process.env.AWH_WORKSPACE = join(dataDir, 'awh-workspace');
    process.env.ART_AGENT_WORKSPACE = join(dataDir, 'legacy-workspace');
    process.env.AWH_ALLOW_WRITE = '1';
    process.env.ART_AGENT_ALLOW_WRITE = '0';
    const config = loadConfig();
    assert.equal(config.dataDir, dataDir);
    assert.equal(config.workspace, join(dataDir, 'awh-workspace'));
    assert.equal(config.allowWrite, true);
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});
