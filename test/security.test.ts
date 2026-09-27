import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalWorkspace, resolveForRead, resolveForWrite, SecurityError } from '../src/security.js';
import { controlRequest } from '../web/control-plane-adapter.js';

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


test('large control responses keep endpoint-specific safe errors', async () => {
  const oversized = JSON.stringify({ schemaVersion: 1, payload: 'x'.repeat(800 * 1024) });
  const fetchImpl = async () => new Response(oversized, { status: 200, headers: { 'content-type': 'application/json' } });

  await assert.rejects(
    controlRequest('/api/v1/control/infrastructure', {}, fetchImpl),
    (error: unknown) => error instanceof Error
      && (error as Error & { code?: string }).code === 'RESPONSE_TOO_LARGE'
      && error.message.includes('ข้อมูลของส่วนนี้มีขนาดใหญ่เกินขอบเขต')
      && !error.message.includes('แชทนี้ยาวมาก'),
  );

  await assert.rejects(
    controlRequest('/api/v1/control/conversations?projectId=00000000-0000-4000-8000-000000000000', {}, fetchImpl),
    (error: unknown) => error instanceof Error
      && (error as Error & { code?: string }).code === 'RESPONSE_TOO_LARGE'
      && error.message.includes('แชทนี้ยาวมาก'),
  );

  const backendTooLarge = async () => new Response(JSON.stringify({ schemaVersion: 1, error: 'ERROR', code: 'RESPONSE_TOO_LARGE', requestId: 'fixture' }), { status: 413, headers: { 'content-type': 'application/json' } });
  await assert.rejects(
    controlRequest('/api/v1/control/infrastructure/summary', {}, backendTooLarge),
    (error: unknown) => error instanceof Error
      && (error as Error & { code?: string }).code === 'RESPONSE_TOO_LARGE'
      && error.message.includes('ข้อมูลของส่วนนี้มีขนาดใหญ่เกินขอบเขต')
      && !error.message.includes('แชทนี้ยาวมาก'),
  );
});
