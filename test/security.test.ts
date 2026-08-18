import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalWorkspace, resolveForRead, resolveForWrite, SecurityError } from '../src/security.js';

test('allows normal workspace files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-'));
  await writeFile(join(root, 'ok.txt'), 'ok');
  const canonical = await canonicalWorkspace(root);
  assert.equal(await resolveForRead(canonical, 'ok.txt'), join(canonical, 'ok.txt'));
});

test('blocks traversal outside workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-'));
  const canonical = await canonicalWorkspace(root);
  await assert.rejects(() => resolveForWrite(canonical, '../escape.txt'), (error: unknown) => error instanceof SecurityError && error.code === 'PATH_OUTSIDE_WORKSPACE');
});

test('blocks secret filenames', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-'));
  const canonical = await canonicalWorkspace(root);
  await assert.rejects(() => resolveForWrite(canonical, '.env'), (error: unknown) => error instanceof SecurityError && error.code === 'SECRET_BLOCKED');
});

test('blocks symlink escape for reads', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows symlink creation may require developer mode/admin in CI');
    return;
  }
  const root = await mkdtemp(join(tmpdir(), 'art-agent-'));
  const outside = await mkdtemp(join(tmpdir(), 'art-agent-outside-'));
  await writeFile(join(outside, 'secret.txt'), 'secret');
  await mkdir(join(root, 'links'));
  await symlink(outside, join(root, 'links', 'outside'));
  const canonical = await canonicalWorkspace(root);
  await assert.rejects(() => resolveForRead(canonical, 'links/outside/secret.txt'), (error: unknown) => error instanceof SecurityError && error.code === 'PATH_OUTSIDE_WORKSPACE');
});

test('blocks symlink escape for existing write targets', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows symlink creation may require developer mode/admin in CI');
    return;
  }
  const root = await mkdtemp(join(tmpdir(), 'art-agent-'));
  const outside = await mkdtemp(join(tmpdir(), 'art-agent-outside-'));
  await writeFile(join(outside, 'secret.txt'), 'secret');
  await symlink(join(outside, 'secret.txt'), join(root, 'linked.txt'));
  const canonical = await canonicalWorkspace(root);
  await assert.rejects(() => resolveForWrite(canonical, 'linked.txt'), (error: unknown) => error instanceof SecurityError && error.code === 'PATH_OUTSIDE_WORKSPACE');
});
