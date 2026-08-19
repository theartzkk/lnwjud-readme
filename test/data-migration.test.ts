import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  cleanupOwnedMigrationStaging,
  inspectDataMigration,
  migrateData,
  resolveActiveDataDir,
  MIGRATION_MARKER_FILENAME,
  MIGRATION_SCHEMA_VERSION,
  MIGRATION_STAGING_KIND,
} from '../src/data-migration.js';

async function fixture(): Promise<{ root: string; legacy: string; awh: string }> {
  const root = await mkdtemp(join(tmpdir(), 'awh-migration-'));
  return { root, legacy: join(root, '.art-agent'), awh: join(root, '.awh') };
}

async function clean(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

async function writeCheckpoint(legacy: string, corrupt = false): Promise<void> {
  const content = Buffer.from('checkpoint-content');
  const record = {
    path: 'notes.txt',
    bytes: content.byteLength,
    sha256: corrupt ? '0'.repeat(64) : createHash('sha256').update(content).digest('hex'),
    contentBase64: content.toString('base64'),
  };
  await mkdir(join(legacy, 'checkpoints', 'checkpoint-1'), { recursive: true });
  await writeFile(join(legacy, 'checkpoints', 'checkpoint-1', 'checkpoint.json'), JSON.stringify({ id: 'checkpoint-1', createdAt: new Date().toISOString(), files: [record] }));
}

test('reports no legacy data without touching the filesystem', async () => {
  const { root, legacy, awh } = await fixture();
  try {
    assert.equal((await inspectDataMigration({ legacyDir: legacy, awhDir: awh })).state, 'NO_LEGACY_DATA');
    assert.deepEqual(await readdir(root), []);
  } finally { await clean(root); }
});

test('migrates validated metadata atomically and keeps the legacy source unchanged', async () => {
  const { root, legacy, awh } = await fixture();
  try {
    await mkdir(join(legacy, 'tasks'), { recursive: true });
    await writeCheckpoint(legacy);
    await writeFile(join(legacy, 'settings.json'), JSON.stringify({ defaultWorkspace: '/tmp/project', allowWrite: false, allowExec: false, allowCodex: false, futureField: 'not copied by the runtime' }));
    await writeFile(join(legacy, 'tasks', 'task-1.json'), JSON.stringify({ schema: 1, runtimeId: 'runtime', id: 'task-1', label: 'build', state: 'succeeded', code: 0, signal: null, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), truncated: false }));
    const sourceSettings = await readFile(join(legacy, 'settings.json'));
    const sourceTask = await readFile(join(legacy, 'tasks', 'task-1.json'));
    const sourceCheckpoint = await readFile(join(legacy, 'checkpoints', 'checkpoint-1', 'checkpoint.json'));
    assert.equal((await inspectDataMigration({ legacyDir: legacy, awhDir: awh })).state, 'MIGRATION_AVAILABLE');
    const result = await migrateData({ legacyDir: legacy, awhDir: awh });
    assert.equal(result.state, 'MIGRATION_COMPLETE');
    assert.equal(result.changed, true);
    assert.deepEqual(await readFile(join(legacy, 'settings.json')), sourceSettings);
    assert.deepEqual(await readFile(join(legacy, 'tasks', 'task-1.json')), sourceTask);
    assert.deepEqual(await readFile(join(legacy, 'checkpoints', 'checkpoint-1', 'checkpoint.json')), sourceCheckpoint);
    assert.match(await readFile(join(awh, 'audit.jsonl'), 'utf8'), /data_migration/);
    assert.deepEqual(JSON.parse(await readFile(join(awh, 'settings.json'), 'utf8')), { defaultWorkspace: '/tmp/project', allowWrite: false, allowExec: false, allowCodex: false });
    assert.deepEqual(JSON.parse(await readFile(join(awh, 'tasks', 'task-1.json'), 'utf8')), JSON.parse(await readFile(join(legacy, 'tasks', 'task-1.json'), 'utf8')));
    assert.deepEqual(JSON.parse(await readFile(join(awh, 'checkpoints', 'checkpoint-1', 'checkpoint.json'), 'utf8')), JSON.parse(await readFile(join(legacy, 'checkpoints', 'checkpoint-1', 'checkpoint.json'), 'utf8')));
    assert.equal((await stat(join(awh, 'settings.json'))).mode & 0o777, process.platform === 'win32' ? (await stat(join(awh, 'settings.json'))).mode & 0o777 : 0o600);
    assert.equal((await stat(awh)).mode & 0o777, process.platform === 'win32' ? (await stat(awh)).mode & 0o777 : 0o700);
    const markerBeforeRerun = await readFile(join(awh, MIGRATION_MARKER_FILENAME));
    const auditBeforeRerun = await readFile(join(awh, 'audit.jsonl'));
    const rerun = await migrateData({ legacyDir: legacy, awhDir: awh });
    assert.equal(rerun.state, 'MIGRATION_COMPLETE');
    assert.deepEqual(await readFile(join(awh, MIGRATION_MARKER_FILENAME)), markerBeforeRerun);
    assert.deepEqual(await readFile(join(awh, 'audit.jsonl')), auditBeforeRerun);
  } finally { await clean(root); }
});

test('fails closed for conflicts, invalid settings, corrupt checkpoints, and symlinks', async () => {
  const cases = [
    async (legacy: string) => { await writeFile(join(legacy, 'settings.json'), '{'); },
    async (legacy: string) => { await writeFile(join(legacy, 'settings.json'), JSON.stringify({ apiToken: 'redacted' })); },
    async (legacy: string) => { await writeCheckpoint(legacy, true); },
    async (legacy: string) => {
      await mkdir(join(legacy, 'tasks'), { recursive: true });
      await writeFile(join(legacy, 'tasks', 'task-1.json'), JSON.stringify({ schema: 1, runtimeId: 'runtime', id: 'task-1', label: 'build', state: 'succeeded', code: 0, signal: null, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), truncated: false, stdout: 'must not migrate' }));
    },
  ];
  for (const createInvalid of cases) {
    const { root, legacy, awh } = await fixture();
    try {
      await mkdir(legacy, { recursive: true });
      await createInvalid(legacy);
      assert.equal((await inspectDataMigration({ legacyDir: legacy, awhDir: awh })).state, 'MIGRATION_INVALID_LEGACY');
    } finally { await clean(root); }
  }
  const symlinkFixture = await fixture();
  try {
    await mkdir(symlinkFixture.legacy, { recursive: true });
    await writeFile(join(symlinkFixture.root, 'outside.json'), '{}');
    await symlink(join(symlinkFixture.root, 'outside.json'), join(symlinkFixture.legacy, 'settings.json'));
    assert.equal((await inspectDataMigration({ legacyDir: symlinkFixture.legacy, awhDir: symlinkFixture.awh })).state, 'MIGRATION_INVALID_LEGACY');
  } finally { await clean(symlinkFixture.root); }

  const unknown = await fixture();
  try {
    await mkdir(unknown.legacy, { recursive: true });
    await writeFile(join(unknown.legacy, 'unrecognized.bin'), 'not migration data');
    const inspection = await inspectDataMigration({ legacyDir: unknown.legacy, awhDir: unknown.awh });
    assert.equal(inspection.state, 'MIGRATION_INVALID_LEGACY');
    assert.match(inspection.blockers.join(' '), /unknown entry/);
  } finally { await clean(unknown.root); }

  const conflict = await fixture();
  try {
    await mkdir(conflict.legacy, { recursive: true });
    await mkdir(conflict.awh, { recursive: true });
    await writeFile(join(conflict.awh, 'settings.json'), '{}');
    assert.equal((await inspectDataMigration({ legacyDir: conflict.legacy, awhDir: conflict.awh })).state, 'MIGRATION_CONFLICT');
  } finally { await clean(conflict.root); }
});

test('recognizes and safely cleans only owned interrupted staging', async () => {
  const { root, legacy, awh } = await fixture();
  const staging = join(root, '.awh-migration-interrupted');
  try {
    await mkdir(legacy, { recursive: true });
    await mkdir(staging, { recursive: true });
    await writeFile(join(staging, MIGRATION_MARKER_FILENAME), JSON.stringify({ schemaVersion: MIGRATION_SCHEMA_VERSION, kind: MIGRATION_STAGING_KIND, source: '.art-agent', target: '.awh', migrationId: 'interrupted' }));
    assert.equal((await inspectDataMigration({ legacyDir: legacy, awhDir: awh })).state, 'MIGRATION_IN_PROGRESS');
    assert.equal(await cleanupOwnedMigrationStaging(staging), true);
    assert.equal((await inspectDataMigration({ legacyDir: legacy, awhDir: awh })).state, 'MIGRATION_AVAILABLE');
  } finally { await clean(root); }
});

test('uses one active data directory with AWH and legacy compatibility precedence', async () => {
  const { root, legacy, awh } = await fixture();
  try {
    assert.equal(resolveActiveDataDir({ AWH_DATA_DIR: awh, ART_AGENT_DATA_DIR: legacy }, root), awh);
    assert.equal(resolveActiveDataDir({ ART_AGENT_DATA_DIR: legacy }, root), legacy);
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, 'settings.json'), '{}');
    await migrateData({ legacyDir: legacy, awhDir: awh });
    assert.equal(resolveActiveDataDir({}, root), awh);
  } finally { await clean(root); }
});
