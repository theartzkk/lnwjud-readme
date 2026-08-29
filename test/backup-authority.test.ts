import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const run = promisify(execFile);
const ROOT = process.cwd();

test('Database Studio reuses the canonical verified backup authority', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'awh-backup-authority-'));
  const database = join(directory, 'control.sqlite');
  const backupSource = join(directory, 'backup-source.sqlite');
  const backupRoot = join(directory, 'backups');
  const service = await readFile(join(ROOT, 'hub/src/HubDatabaseStudioService.php'), 'utf8');
  try {
    const code = `
      $main = new PDO('sqlite:' . ${JSON.stringify(database)});
      $main->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
      $main->exec("CREATE TABLE hub_users(user_id TEXT PRIMARY KEY, revoked_at TEXT); CREATE TABLE owner_bootstrap(owner_user_id TEXT, singleton_id INTEGER, bootstrap_closed INTEGER); CREATE TABLE control_sessions(session_id TEXT PRIMARY KEY, user_id TEXT, session_hash TEXT, csrf_hash TEXT, expires_at TEXT, last_seen_at TEXT, revoked_at TEXT, session_kind TEXT, step_up_at TEXT); CREATE TABLE visible_rows(id INTEGER);");
      $main->exec("INSERT INTO hub_users VALUES ('owner-1', NULL); INSERT INTO owner_bootstrap VALUES ('owner-1', 1, 1); INSERT INTO control_sessions VALUES ('session-1', 'owner-1', '" . hash('sha256', 'session-token') . "', 'csrf-hash', '2026-08-30T00:00:00Z', '2026-08-29T00:00:00Z', NULL, 'password', '2026-08-29T00:00:00Z'); INSERT INTO visible_rows VALUES (1);");
      $source = new PDO('sqlite:' . ${JSON.stringify(backupSource)});
      $source->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
      $source->exec("CREATE TABLE sample(id INTEGER); PRAGMA user_version = 42;");
      mkdir(${JSON.stringify(backupRoot)}, 0700, true);
      require ${JSON.stringify(join(ROOT, 'hub/src/HubBackupService.php'))};
      HubBackupService::create(${JSON.stringify(backupSource)}, ${JSON.stringify(backupRoot)}, '2026-08-29T01:00:00Z');
      require ${JSON.stringify(join(ROOT, 'hub/src/HubDatabaseStudioService.php'))};
      putenv('AWH_HUB_BACKUP_ROOT=' . ${JSON.stringify(backupRoot)});
      $overview = HubDatabaseStudioService::openExisting(${JSON.stringify(database)})->overview('session-token', '2026-08-29T01:00:30Z');
      echo json_encode($overview, JSON_THROW_ON_ERROR);
    `;
    const { stdout } = await run('php', ['-r', code], { cwd: ROOT, shell: false });
    const overview = JSON.parse(stdout) as { backup?: { configured?: boolean; latest?: { status?: string; sha256?: string; databaseUserVersion?: number } } };
    assert.equal(overview.backup?.configured, true);
    assert.equal(overview.backup?.latest?.status, 'VERIFIED');
    assert.match(overview.backup?.latest?.sha256 ?? '', /^[0-9a-f]{64}$/);
    assert.equal(overview.backup?.latest?.databaseUserVersion, 42);
    const backupMethod = service.slice(service.indexOf('private function backupMetadata'), service.indexOf('private function preferredTimeColumn'));
    assert.match(backupMethod, /HubBackupService::latestMetadata\(\$root\)/);
    assert.doesNotMatch(backupMethod, /glob\(|filemtime\(|basename\(\$latestPath\)/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
