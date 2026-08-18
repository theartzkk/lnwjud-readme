import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyTextPatch, listCheckpoints, restoreCheckpoint } from '../src/changes.js';

const LIMIT = 512 * 1024;

test('applyTextPatch checkpoints before write and can restore', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-patch-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'art-agent-data-'));
  await writeFile(join(root, 'a.txt'), 'alpha\nbeta\n', 'utf8');

  const result = await applyTextPatch(
    dataDir,
    root,
    [{ path: 'a.txt', expected: 'beta', replacement: 'gamma' }],
    LIMIT,
  );
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'alpha\ngamma\n');
  assert.equal(result.paths[0], 'a.txt');

  const checkpoints = await listCheckpoints(dataDir, 10);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0]?.id, result.checkpoint.id);
  assert.equal(checkpoints[0]?.files[0]?.path, 'a.txt');

  await restoreCheckpoint(dataDir, root, result.checkpoint.id);
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'alpha\nbeta\n');
});

test('applyTextPatch fails closed when guard is absent or ambiguous', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-patch-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'art-agent-data-'));
  await writeFile(join(root, 'a.txt'), 'same same', 'utf8');

  await assert.rejects(
    applyTextPatch(dataDir, root, [{ path: 'a.txt', expected: 'same', replacement: 'x' }], LIMIT),
    /occurs 2 times/,
  );
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'same same');
});

test('checkpoint and patch inherit secret-path denial', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-patch-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'art-agent-data-'));
  await writeFile(join(root, '.env'), 'TOKEN=secret', 'utf8');

  await assert.rejects(
    applyTextPatch(dataDir, root, [{ path: '.env', expected: 'secret', replacement: 'changed' }], LIMIT),
    /Secret path is blocked/,
  );
});
