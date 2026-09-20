import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadOwnerProtocol, OWNER_PROTOCOL_VERSION } from '../src/owner-protocol.js';
import { buildProjectContext, initializeProject } from '../src/project-registry.js';

test('loads durable non-binding AWH working context', async () => {
  const context = await loadOwnerProtocol();
  assert.match(context, /# AWH Working Context/);
  assert.match(context, /Mode: context-only/);
  assert.match(context, new RegExp(`Version: ${OWNER_PROTOCOL_VERSION.replace('.', '\\.')}`));
  assert.match(context, /professional judgment/i);
  assert.match(context, /capabilit/i);
  assert.doesNotMatch(context, /Art ↔ AI Working Constitution|Execution First — mandatory|KRUART Owner Operating Model/i);
});

test('agent entry context does not impose workflow', async () => {
  const agents = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');
  assert.match(agents, /non-binding working context/i);
  assert.match(agents, /one active writer per mutation scope/i);
  assert.doesNotMatch(agents, /30.?minute|3.?5 minutes|Execution First — mandatory/i);
});

test('project context carries working context before project memory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'awh-working-context-'));
  try {
    await initializeProject(dir, { name: 'Context Fixture', type: 'general' });
    const context = await buildProjectContext(dir);
    assert.match(context.ownerProtocol, /# AWH Working Context/);
    assert.deepEqual(Object.keys(context.memory), ['CURRENT_STATE.md', 'PROJECT.md', 'HANDOFF.md', 'TASKS.md', 'ARCHITECTURE.md', 'DECISIONS.md']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
