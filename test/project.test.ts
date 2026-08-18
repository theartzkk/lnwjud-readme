import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { detectProject } from '../src/project.js';

test('project profile detects package manager and approved scripts without dependency payloads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-project-'));
  await writeFile(join(root, 'package.json'), JSON.stringify({
    packageManager: 'pnpm@10.0.0',
    scripts: {
      test: 'node --test',
      build: 'tsc',
      deploy: 'secret-deploy-command',
    },
    dependencies: {
      'sensitive-internal-package-name': '1.0.0',
    },
  }));
  await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

  const profile = await detectProject(root);
  assert.equal(profile.primary, 'node');
  assert.deepEqual(profile.ecosystems, ['node']);
  assert.deepEqual(profile.manifests, ['package.json']);
  assert.equal(profile.packageManager, 'pnpm');
  assert.deepEqual(profile.approvedScripts, ['test', 'build']);
  assert.doesNotMatch(JSON.stringify(profile), /deploy|sensitive-internal-package-name|secret-deploy-command/);
});

test('project profile recognizes mixed ecosystems but ignores manifest symlinks escaping the workspace', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Symlink creation requires elevated/developer permissions on some Windows runners');
    return;
  }

  const root = await mkdtemp(join(tmpdir(), 'art-agent-project-'));
  const outside = await mkdtemp(join(tmpdir(), 'art-agent-project-outside-'));
  await writeFile(join(root, 'composer.json'), '{}\n');
  await writeFile(join(root, 'go.mod'), 'module example.invalid/test\n');
  await writeFile(join(outside, 'package.json'), JSON.stringify({ scripts: { test: 'outside-secret-command' } }));
  await symlink(join(outside, 'package.json'), join(root, 'package.json'));

  const profile = await detectProject(root);
  assert.equal(profile.primary, 'php');
  assert.deepEqual(profile.ecosystems, ['php', 'go']);
  assert.deepEqual(profile.manifests, ['composer.json', 'go.mod']);
  assert.equal(profile.packageManager, null);
  assert.doesNotMatch(JSON.stringify(profile), /outside-secret-command|package\.json/);
});
