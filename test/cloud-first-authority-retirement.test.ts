import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const text = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function migrationText(): string {
  return readdirSync(join(ROOT, 'hub/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => text(`hub/migrations/${name}`))
    .join('\n');
}

test('Cloud-first retirement contract forbids shadow work authorities', () => {
  const migrations = migrationText();
  for (const forbidden of ['cloud_jobs', 'cloud_tasks', 'review_jobs', 'review_tasks', 'hosting_queue', 'hosting_jobs']) {
    assert.doesNotMatch(migrations, new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${forbidden}\\b`, 'i'));
  }

  const cloud = text('hub/src/HubCloudWorkflowService.php');
  const hosting = text('hub/src/HubManagedHostingOperator.php');
  assert.doesNotMatch(cloud, /CREATE\s+TABLE|INSERT\s+INTO\s+control_tasks/i);
  assert.doesNotMatch(hosting, /CREATE\s+TABLE|INSERT\s+INTO\s+control_tasks/i);
});

test('Local and privileged processes are adapters, not product authorities', () => {
  const decisions = text('DECISIONS.md');
  const authority = text('docs/AWH-AUTHORITY-MAP.md');
  const nativeExecutor = text('hub/bin/awh-native-executor.php');
  const hostingService = text('deploy/systemd/awh-hosting-operator.service');

  assert.match(decisions, /Cloud-first supersedes local-first/);
  assert.match(authority, /## Privilege-separated adapters/);
  assert.match(authority, /root-only Managed Hosting operator/);
  assert.match(nativeExecutor, /HubCloudWorkflowService::fromEnvironment/);
  assert.match(hostingService, /User=root/);
  assert.match(hostingService, /NoNewPrivileges=true/);
  assert.doesNotMatch(hostingService, /ExecStart=.*(?:bash|sh)\s+-c/i);
});
