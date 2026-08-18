import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { searchText } from '../src/files.js';

test('automatic text search skips blocked secret paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-files-'));
  await writeFile(join(root, 'safe.txt'), 'needle SAFE_VALUE');
  await writeFile(join(root, '.env'), 'needle SECRET_VALUE');
  await mkdir(join(root, '.ssh'));
  await writeFile(join(root, '.ssh', 'config'), 'needle SSH_SECRET');

  const results = await searchText(root, 'needle', 20);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.path, 'safe.txt');
  assert.match(results[0]?.text ?? '', /SAFE_VALUE/);
  assert.doesNotMatch(JSON.stringify(results), /SECRET_VALUE|SSH_SECRET/);
});
