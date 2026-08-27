import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('M15 automation registry is additive over M14 and stores definitions only', async () => {
  const [sql, migration, service, fixture, hubRunner] = await Promise.all([
    readFile(join(root, 'hub/migrations/014_automations.sql'), 'utf8'),
    readFile(join(root, 'hub/src/HubAutomationMigration.php'), 'utf8'),
    readFile(join(root, 'hub/src/HubAutomationRegistryService.php'), 'utf8'),
    readFile(join(root, 'hub/tests/m15-automation-registry.php'), 'utf8'),
    readFile(join(root, 'scripts/qa/run-hub-tests.mjs'), 'utf8'),
  ]);

  assert.match(migration, /TARGET_USER_VERSION = 15/);
  assert.match(migration, /MIGRATION_ID = 'm15-automation-registry'/);
  assert.match(migration, /version < 14/);
  assert.match(migration, /HubCostAwareAiMigration::assertCapabilityReady/);
  assert.match(sql, /CREATE TABLE control_automations/);
  assert.match(sql, /timing_mode IN \('exact_schedule', 'flexible_schedule', 'condition_watch'\)/);
  assert.match(sql, /FOREIGN KEY \(project_id\) REFERENCES projects/);
  assert.match(sql, /FOREIGN KEY \(conversation_id\) REFERENCES control_conversations/);
  assert.doesNotMatch(sql, /automation_(?:runs|executions|tasks|queue)/i);

  assert.match(service, /Durable automation definitions only/);
  assert.match(service, /user_project_memberships/);
  assert.match(service, /control_conversations WHERE conversation_id=:conversation AND user_id=:user AND project_id=:project/);
  assert.match(service, /Condition watch must be recurring/);
  assert.match(service, /UPDATE control_automations SET enabled=0,archived_at=/);
  assert.doesNotMatch(service, /INSERT\s+INTO\s+control_tasks|UPDATE\s+control_tasks|DELETE\s+FROM\s+control_tasks/i);
  assert.doesNotMatch(service, /shell_exec|proc_open|exec\(|system\(|passthru\(/i);

  assert.match(fixture, /registry never creates canonical tasks early/);
  assert.match(fixture, /no automation run queue or shadow authority/);
  assert.match(hubRunner, /hub\/tests\/m15-automation-registry\.php/);
});

test('M15 scheduling input is bounded to one VEVENT without hidden task execution', async () => {
  const service = await readFile(join(root, 'hub/src/HubAutomationRegistryService.php'), 'utf8');
  assert.match(service, /BEGIN:VEVENT/);
  assert.match(service, /END:VEVENT/);
  assert.match(service, /RRULE:FREQ=/);
  assert.match(service, /DTSTART/);
  assert.match(service, /SUMMARY\|DTEND/);
  for (const operation of ['listForUser', 'get', 'create', 'replace', 'setEnabled', 'archive']) assert.match(service, new RegExp(`function ${operation}\\(`));
  for (const forbidden of ['run', 'execute', 'enqueue', 'dispatch', 'materialize']) assert.doesNotMatch(service, new RegExp(`function ${forbidden}\\(`, 'i'));
});
