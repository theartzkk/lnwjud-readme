import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readTextPage, searchText } from '../src/files.js';

test('automatic text search skips blocked secret paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-files-'));
  await writeFile(join(root, 'safe.txt'), 'needle SAFE_VALUE');
  await writeFile(join(root, '.env'), 'needle SECRET_VALUE');
  await mkdir(join(root, '.ssh'));
  await writeFile(join(root, '.ssh', 'config'), 'needle SSH_SECRET');

  const results = await searchText(root, 'needle', 20);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.path, 'safe.txt');
  assert.equal(results[0]?.truncated, false);
  assert.match(results[0]?.text ?? '', /SAFE_VALUE/);
  assert.doesNotMatch(JSON.stringify(results), /SECRET_VALUE|SSH_SECRET/);
});

test('automatic text search bounds very long matching lines around the match', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-search-snippet-'));
  const line = `${'A'.repeat(6_000)}MATCH_NEEDLE${'B'.repeat(6_000)}`;
  await writeFile(join(root, 'long.txt'), `${line}\nshort MATCH_NEEDLE line\n`, 'utf8');

  const results = await searchText(root, 'match_needle', 20);
  assert.equal(results.length, 2);
  assert.equal(results[0]?.line, 1);
  assert.equal(results[0]?.truncated, true);
  assert.ok((results[0]?.text.length ?? 0) <= 500);
  assert.match(results[0]?.text ?? '', /MATCH_NEEDLE/);
  assert.match(results[0]?.text ?? '', /^…/);
  assert.match(results[0]?.text ?? '', /…$/);
  assert.equal(results[1]?.text, 'short MATCH_NEEDLE line');
  assert.equal(results[1]?.truncated, false);
});

test('paged file reads preserve line endings and suppress unchanged content by digest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-page-'));
  const content = Array.from({ length: 450 }, (_, index) => `line-${String(index + 1).padStart(3, '0')}`).join('\r\n');
  await writeFile(join(root, 'large.txt'), content, 'utf8');

  const page = await readTextPage(root, 'large.txt', 512 * 1024, { startLine: 201, maxLines: 50 });
  assert.equal(page.totalLines, 450);
  assert.equal(page.startLine, 201);
  assert.equal(page.endLine, 250);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextStartLine, 251);
  assert.equal(page.unchanged, false);
  assert.equal(page.content, Array.from({ length: 50 }, (_, index) => `line-${String(index + 201).padStart(3, '0')}\r\n`).join(''));

  const unchanged = await readTextPage(root, 'large.txt', 512 * 1024, {
    startLine: 201,
    maxLines: 50,
    knownDigest: page.digest.toUpperCase(),
  });
  assert.equal(unchanged.unchanged, true);
  assert.equal(unchanged.digest, page.digest);
  assert.equal(unchanged.content, undefined);
  assert.equal(unchanged.totalBytes, Buffer.byteLength(content, 'utf8'));
});
