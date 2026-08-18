import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gitDiff, gitDiffPage, gitStatus } from '../src/git.js';
import { execCommand } from '../src/process.js';

async function git(root: string, args: string[]): Promise<void> {
  const result = await execCommand('git', ['--no-pager', ...args], root);
  assert.equal(result.code, 0, result.stderr);
}

test('git views suppress blocked secret paths and content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-git-'));
  await git(root, ['init']);
  await git(root, ['config', 'user.name', 'Art Agent Test']);
  await git(root, ['config', 'user.email', 'art-agent@example.invalid']);
  await writeFile(join(root, 'safe.txt'), 'safe old\n');
  await writeFile(join(root, '.env'), 'SECRET_OLD=one\n');
  await git(root, ['add', 'safe.txt', '.env']);
  await git(root, ['commit', '-m', 'fixture']);

  await writeFile(join(root, 'safe.txt'), 'safe new\n');
  await writeFile(join(root, '.env'), 'SECRET_NEW=two\n');

  const diff = await gitDiff(root);
  assert.equal(diff.code, 0, diff.stderr);
  assert.match(diff.stdout, /safe new/);
  assert.doesNotMatch(diff.stdout, /SECRET_OLD|SECRET_NEW|\.env/);

  const status = await gitStatus(root);
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, /safe\.txt/);
  assert.doesNotMatch(status.stdout, /\.env/);
  assert.match(status.stdout, /secret-path status entry hidden/);
});

test('paged git diff is bounded, path-selectable and digest-suppressible without secret leakage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-git-page-'));
  await git(root, ['init']);
  await git(root, ['config', 'user.name', 'Art Agent Test']);
  await git(root, ['config', 'user.email', 'art-agent@example.invalid']);
  await writeFile(join(root, 'safe.txt'), 'base\n');
  await writeFile(join(root, '.env'), 'SECRET_BASE=one\n');
  await git(root, ['add', 'safe.txt', '.env']);
  await git(root, ['commit', '-m', 'fixture']);

  const safeNew = Array.from({ length: 40 }, (_, index) => `safe-${index + 1}`).join('\n') + '\n';
  await writeFile(join(root, 'safe.txt'), safeNew);
  await writeFile(join(root, '.env'), 'SECRET_CHANGED=two\n');

  const page = await gitDiffPage(root, { path: 'safe.txt', startLine: 1, maxLines: 5 });
  assert.equal(page.code, 0, page.stderr);
  assert.equal(page.selectedPath, 'safe.txt');
  assert.equal(page.pathFound, true);
  assert.deepEqual(page.availablePaths, ['safe.txt']);
  assert.equal(page.hiddenPathCount, 1);
  assert.equal(page.page?.hasMore, true);
  assert.equal(page.page?.endLine, 5);
  assert.match(page.page?.content ?? '', /safe\.txt/);
  assert.doesNotMatch(JSON.stringify(page), /SECRET_BASE|SECRET_CHANGED|\.env/);

  const unchanged = await gitDiffPage(root, {
    path: 'safe.txt',
    startLine: 1,
    maxLines: 5,
    knownDigest: page.page?.digest,
  });
  assert.equal(unchanged.page?.unchanged, true);
  assert.equal(unchanged.page?.content, undefined);
  assert.equal(unchanged.page?.digest, page.page?.digest);
});
