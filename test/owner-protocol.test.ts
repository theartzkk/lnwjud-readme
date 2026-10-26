import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadOwnerProtocol } from '../src/owner-protocol.js';
import { buildProjectContext, initializeProject } from '../src/project-registry.js';

test('historical GitHub mirror explicitly defers to the single VPS policy source', async () => {
  const protocol = await loadOwnerProtocol();
  assert.match(protocol, /ARCHIVED_GITHUB_MIRROR_NOT_POLICY_AUTHORITY/);
  assert.match(protocol, /root AGENTS\.md in canonical AWH VPS Git/);
  assert.match(protocol, /authenticated AWH\/VPS/);
  assert.doesNotMatch(protocol, /Art ↔ AI Working Constitution/);
  assert.doesNotMatch(protocol, /AWH_VAULT/);
  assert.doesNotMatch(protocol, /One Main Orchestration Chat/);
});

test('project context does not inject archived GitHub owner instructions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-owner-protocol-'));
  try {
    await initializeProject(root, { name: 'Protocol Fixture', type: 'general' });
    const context = await buildProjectContext(root);
    assert.equal(context.ownerProtocol, await loadOwnerProtocol());
    assert.match(context.ownerProtocol, /NOT_POLICY_AUTHORITY/);
    assert.deepEqual(Object.keys(context.memory), ['CURRENT_STATE.md', 'PROJECT.md', 'HANDOFF.md', 'TASKS.md', 'ARCHITECTURE.md', 'DECISIONS.md']);
    assert.equal(context.project.name, 'Protocol Fixture');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
