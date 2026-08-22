import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, resolveExecutable } from '../src/process.js';
import { WorkspaceContinuityError, createWorkspaceWipCheckpoint, reconstructWorkspaceWip } from '../src/workspace-continuity.js';

const PROJECT_ID = '9d38a50d-7c0e-4ca0-8d18-7e7f4b86cb25';
const MAC_ID = '8f3822a1-03c7-47e3-90ce-5e02efc945f4';
const WINDOWS_ID = '5c0375a4-c7f6-4d5e-8e34-0622ea943c52';

async function git(cwd: string, ...args: string[]): Promise<string> {
  const executable = await resolveExecutable('git');
  const result = await execFile(executable, args, cwd, 60_000);
  assert.equal(result.code, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

test('cross-device WIP handoff uses a bounded Git ref, preserves source WIP and never transfers caches or secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-workspace-continuity-'));
  const remote = join(root, 'origin.git'); const mac = join(root, 'mac'); const windows = join(root, 'windows');
  try {
    await git(root, 'init', '--bare', remote);
    await git(root, 'clone', remote, mac);
    await writeFile(join(mac, 'app.txt'), 'base\n');
    await git(mac, 'add', 'app.txt');
    await git(mac, '-c', 'user.name=AWH Test', '-c', 'user.email=awh-test@local.invalid', 'commit', '-m', 'base');
    await git(mac, 'push', '-u', 'origin', 'HEAD');
    await git(root, 'clone', remote, windows);

    const cleanCheckpoint = await createWorkspaceWipCheckpoint({ workspace: mac, projectId: PROJECT_ID, sourceDeviceId: MAC_ID });
    assert.equal(cleanCheckpoint.syncState, 'CLEAN', 'a pushed clean revision is durable for a Mac-to-Windows handoff');
    await reconstructWorkspaceWip({ workspace: windows, checkpoint: cleanCheckpoint });
    assert.equal(await readFile(join(windows, 'app.txt'), 'utf8'), 'base\n', 'clean handoff never changes matching source');

    await writeFile(join(mac, 'app.txt'), 'mac WIP\n');
    await writeFile(join(mac, 'notes.md'), 'continue on Windows\n');
    await writeFile(join(mac, 'node_modules-cache.txt'), 'not a cache root\n');
    // A generated root is deliberately ignored when it is untracked.
    await mkdir(join(mac, 'node_modules'), { recursive: true });
    await writeFile(join(mac, 'node_modules', 'ignored.js'), 'generated cache\n');
    const macCheckpoint = await createWorkspaceWipCheckpoint({ workspace: mac, projectId: PROJECT_ID, sourceDeviceId: MAC_ID });
    assert.equal(macCheckpoint.syncState, 'SYNCED');
    assert.equal(macCheckpoint.files.some((entry) => entry.path.startsWith('node_modules/')), false);
    assert.match(macCheckpoint.wipRef ?? '', /^refs\/awh\/wip\//);
    assert.equal(await readFile(join(mac, 'app.txt'), 'utf8'), 'mac WIP\n', 'capture must not alter source working copy');

    await reconstructWorkspaceWip({ workspace: windows, checkpoint: macCheckpoint });
    assert.equal(await readFile(join(windows, 'app.txt'), 'utf8'), 'mac WIP\n');
    assert.equal(await readFile(join(windows, 'notes.md'), 'utf8'), 'continue on Windows\n');
    await assert.rejects(() => readFile(join(windows, 'node_modules', 'ignored.js')), { code: 'ENOENT' });
    assert.match(await git(windows, 'status', '--porcelain=v1'), /app\.txt/);

    await writeFile(join(windows, 'app.txt'), 'windows continuation\n');
    await writeFile(join(windows, 'handoff.txt'), 'safe reverse handoff\n');
    const windowsCheckpoint = await createWorkspaceWipCheckpoint({ workspace: windows, projectId: PROJECT_ID, sourceDeviceId: WINDOWS_ID });
    assert.equal(windowsCheckpoint.syncState, 'SYNCED');
    await git(mac, 'reset', '--hard', windowsCheckpoint.baseRevision);
    await git(mac, 'clean', '-fd');
    await reconstructWorkspaceWip({ workspace: mac, checkpoint: windowsCheckpoint });
    assert.equal(await readFile(join(mac, 'app.txt'), 'utf8'), 'windows continuation\n');
    assert.equal(await readFile(join(mac, 'handoff.txt'), 'utf8'), 'safe reverse handoff\n');

    await writeFile(join(mac, '.env'), 'API_TOKEN=not-for-handoff\n');
    await assert.rejects(
      () => createWorkspaceWipCheckpoint({ workspace: mac, projectId: PROJECT_ID, sourceDeviceId: MAC_ID }),
      (error: unknown) => error instanceof WorkspaceContinuityError && error.code === 'WIP_SECRET_PATH',
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a clean local revision ahead of its configured upstream is truthfully UNSYNCED', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-workspace-upstream-'));
  const remote = join(root, 'origin.git'); const workspace = join(root, 'workspace');
  try {
    await git(root, 'init', '--bare', remote); await git(root, 'clone', remote, workspace);
    await writeFile(join(workspace, 'source.txt'), 'base\n'); await git(workspace, 'add', 'source.txt');
    await git(workspace, '-c', 'user.name=AWH Test', '-c', 'user.email=awh-test@local.invalid', 'commit', '-m', 'base'); await git(workspace, 'push', '-u', 'origin', 'HEAD');
    await writeFile(join(workspace, 'source.txt'), 'local-only commit\n'); await git(workspace, 'add', 'source.txt');
    await git(workspace, '-c', 'user.name=AWH Test', '-c', 'user.email=awh-test@local.invalid', 'commit', '-m', 'local only');
    const checkpoint = await createWorkspaceWipCheckpoint({ workspace, projectId: PROJECT_ID, sourceDeviceId: MAC_ID });
    assert.equal(checkpoint.syncState, 'UNSYNCED');
  } finally { await rm(root, { recursive: true, force: true }); }
});
