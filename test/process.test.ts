import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';
import { execFile, resolveExecutable, runPackageScript } from '../src/process.js';

test('executable resolution returns an absolute PATH target', async () => {
  const nodePath = await resolveExecutable('node');
  assert.equal(isAbsolute(nodePath), true);
});

test('executable resolution survives a reduced GUI PATH using safe macOS/user locations', async () => {
  if (process.platform === 'win32') return;
  const home = await mkdtemp(join(tmpdir(), 'art-agent-capability-home-'));
  const bin = join(home, '.local', 'bin');
  const target = join(bin, 'awh-capability-fixture');
  await mkdir(bin, { recursive: true });
  await writeFile(target, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await chmod(target, 0o700);
  const originalPath = process.env.PATH;
  const originalHome = process.env.HOME;
  process.env.PATH = '/usr/bin:/bin';
  process.env.HOME = home;
  try {
    assert.equal(await resolveExecutable('awh-capability-fixture'), target);
  } finally {
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  }
});

test('shared process runner forwards an explicit child environment without using a shell', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-process-env-'));
  const result = await execFile(
    process.execPath,
    ['-e', 'process.stdout.write(process.env.ART_AGENT_CHILD_ENV ?? "")'],
    root,
    5_000,
    { ...process.env, ART_AGENT_CHILD_ENV: 'FORWARDED' },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'FORWARDED');
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
