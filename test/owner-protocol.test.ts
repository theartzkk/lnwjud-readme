import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadOwnerProtocol, OWNER_PROTOCOL_VERSION } from '../src/owner-protocol.js';
import { buildProjectContext, initializeProject } from '../src/project-registry.js';

test('loads the durable Art AI owner working constitution', async () => {
  const protocol = await loadOwnerProtocol();
  assert.match(protocol, /Art ↔ AI Working Constitution/);
  assert.match(protocol, /KRUART Owner Operating Model/);
  assert.match(protocol, /Outcome & continuity/);
  assert.match(protocol, /Tool-fit execution routing/);
  assert.match(protocol, /Maximum automation & minimum user touch/);
  assert.match(protocol, new RegExp(`Version: ${OWNER_PROTOCOL_VERSION.replace('.', '\\.')}`));
  assert.match(protocol, /System-first, patch-second/i);
  assert.match(protocol, /ChatGPT-direct contract/);
  assert.match(protocol, /AWH-direct contract/);
  assert.match(protocol, /Execution routing authority/);
  assert.match(protocol, /AWH_VAULT.*must not be silently stolen/);
  assert.match(protocol, /GitHub quota\/outage must not block work/);
  assert.match(protocol, /Remote Desktop \/ Desktop Commander.*is preferred when the requested outcome depends on a named managed device/s);
  assert.match(protocol, /Execution First — mandatory for every project and task/);
  assert.match(protocol, /One mutation scope has one Mission Owner\/Writer/);
  assert.match(protocol, /config\/execution-policy\.json.*machine-readable authority/s);
  assert.match(protocol, /Permanent Fix \/ Root-Cause Closure contract/);
  assert.match(protocol, /Global Visual Truth contract/);
  assert.match(protocol, /do not require every typed\/headless route to fail first/i);
});

test('agent entry contract preserves Vault-first and device-optional routing', async () => {
  const agents = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');
  assert.match(agents, /Project source authority is singular/);
  assert.match(agents, /AWH_VAULT/);
  assert.match(agents, /Execution First — mandatory for every project and task/);
  assert.match(agents, /VPS\/control plane.*M5.*AY-TEACHER.*ART-MAC-INTEL/s);
  assert.match(agents, /Never use a personal endpoint as gratuitous transit back to VPS/);
  assert.match(agents, /Permanent Fix \/ Root-Cause Closure/);
  assert.match(agents, /Global Visual Truth/);
  assert.match(agents, /AI-generated images, stock photos, or images of another school/);
  assert.match(agents, /online device must never become a hidden dependency/);
  assert.doesNotMatch(agents, /`main` on the reviewed .+ is the AWH canonical source branch/);
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
