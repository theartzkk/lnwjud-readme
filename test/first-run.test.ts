import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readOwnerSession, trustOwner } from '../src/first-run.js';

test('first-run owner trust persists bounded display metadata and no credential fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-first-run-'));
  try {
    const saved = await trustOwner(root, 'Art', 'Mac Home');
    assert.equal(saved.ownerDisplayName, 'Art');
    assert.equal((await readOwnerSession(root))?.deviceName, 'Mac Home');
    const raw = await readFile(join(root, 'owner-session.json'), 'utf8');
    assert.doesNotMatch(raw, /password|token|secret|credential|authorization/i);
    assert.doesNotMatch(raw, /\/Users\/|[A-Za-z]:\\\\/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('first-run owner trust rejects path-like and control-character identity values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-first-run-'));
  try {
    await assert.rejects(() => trustOwner(root, '/Users/secret', 'Mac'), /invalid/i);
    await assert.rejects(() => trustOwner(root, 'Art', 'Mac\nHome'), /invalid/i);
    await writeFile(join(root, 'owner-session.json'), '{"schemaVersion":1,"ownerDisplayName":"Art"}');
    await assert.rejects(() => readOwnerSession(root), /invalid/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
