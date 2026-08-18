import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';
import { resolveExecutable, runPackageScript } from '../src/process.js';

test('executable resolution returns an absolute PATH target', async () => {
  const nodePath = await resolveExecutable('node');
  assert.equal(isAbsolute(nodePath), true);
});

test('approved package script launcher works without free-form user commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-process-'));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'art-agent-process-fixture',
      private: true,
      scripts: { test: 'node -e "process.stdout.write(\\"ART_AGENT_SMOKE\\")"' },
    }),
  );

  const result = await runPackageScript(root, undefined, 'test');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /ART_AGENT_SMOKE/);
});
