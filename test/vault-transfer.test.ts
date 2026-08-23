import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createVaultCandidateArchive, extractVaultWorkspaceArchive } from '../src/vault-transfer.js';

test('central Vault transfer archive is binary-safe, cross-platform and rejects secret paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-vault-transfer-'));
  try {
    const source = join(root, 'source'); const target = join(root, 'target'); const archive = join(root, 'candidate.zip');
    await mkdir(join(source, 'nested'), { recursive: true });
    await writeFile(join(source, 'nested', 'note.txt'), 'สวัสดี AWH\r\n', 'utf8');
    await writeFile(join(source, 'binary.bin'), Buffer.from([0, 1, 2, 255]));
    const created = await createVaultCandidateArchive(source, archive);
    assert.equal(created.fileCount, 2); assert.ok(created.sizeBytes > 0); assert.match(created.sha256, /^[0-9a-f]{64}$/);
    await extractVaultWorkspaceArchive(archive, target);
    assert.equal(await readFile(join(target, 'nested', 'note.txt'), 'utf8'), 'สวัสดี AWH\r\n');
    assert.deepEqual(await readFile(join(target, 'binary.bin')), Buffer.from([0, 1, 2, 255]));
    await writeFile(join(source, '.env'), 'must-not-transfer');
    await assert.rejects(() => createVaultCandidateArchive(source, join(root, 'forbidden.zip')), /restricted/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
