import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadOwnerProtocol, OWNER_PROTOCOL_VERSION } from '../src/owner-protocol.js';
import { buildProjectContext, initializeProject } from '../src/project-registry.js';

test('loads the durable Art AI owner working constitution', async () => {
  const protocol = await loadOwnerProtocol();
  assert.match(protocol, /Art ↔ AI Working Constitution/);
  assert.match(protocol, new RegExp(`Version: ${OWNER_PROTOCOL_VERSION.replace('.', '\\.')}`));
  assert.match(protocol, /System-first, patch-second/i);
  assert.match(protocol, /ChatGPT-direct contract/);
  assert.match(protocol, /AWH-direct contract/);
});

test('injects owner protocol into every bounded project context before project-specific memory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-owner-protocol-'));
  try {
    await initializeProject(root, { name: 'Protocol Fixture', type: 'general' });
    const context = await buildProjectContext(root);
    assert.match(context.ownerProtocol, /Art ↔ AI Working Constitution/);
    assert.deepEqual(Object.keys(context.memory), ['CURRENT_STATE.md', 'PROJECT.md', 'HANDOFF.md', 'TASKS.md', 'ARCHITECTURE.md', 'DECISIONS.md']);
    assert.equal(context.project.name, 'Protocol Fixture');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
