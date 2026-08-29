import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('automation scheduler delegates work instead of creating a shadow queue', async () => {
  const source = await read('hub/src/HubAutomationSchedulerService.php');
  assert.match(source, /Closure::fromCallable\(\$materialize\)/);
  assert.match(source, /\(\$this->materialize\)\(/);
  assert.match(source, /control_automations/);
  assert.doesNotMatch(source, /INSERT\s+INTO\s+control_tasks/i);
  assert.doesNotMatch(source, /INSERT\s+INTO\s+control_conversation_messages/i);
  assert.doesNotMatch(source, /UPDATE\s+control_tasks/i);
  assert.doesNotMatch(source, /automation_runs|automation_queue|control_automation_runs/i);
  assert.doesNotMatch(source, /shell_exec|proc_open|passthru|\bpopen\s*\(/i);
});

test('automation scheduler only evaluates bounded built-in condition keys', async () => {
  const source = await read('hub/src/HubAutomationSchedulerService.php');
  for (const key of ['project.task.failed', 'project.approval.pending', 'project.worker.offline']) assert.match(source, new RegExp(key.replaceAll('.', '\\.')));
  assert.match(source, /MAX_DEFINITIONS = 500/);
  assert.match(source, /MAX_STEPS = 20000/);
  assert.match(source, /HOURLY.*DAILY.*WEEKLY.*MONTHLY.*YEARLY/s);
  assert.match(source, /AUTOMATION_RRULE_TOO_LARGE/);
});

test('control plane materializes automation through the same task and conversation authorities', async () => {
  const source = await read('hub/src/HubControlPlaneService.php');
  assert.match(source, /require_once __DIR__ \. \'\/HubEnrollmentService\.php\';/);
  assert.match(source, /private function submitTaskForUser/);
  assert.match(source, /submitTaskForUser\(\(string\) \$session\['user_id'\]/);
  assert.match(source, /public function materializeAutomationSubmission/);
  assert.match(source, /\$this->submitTaskForUser\(/);
  assert.match(source, /\$this->submitConversationForUser\(/);
  assert.match(source, /\$this->automations->get\(/);
  assert.match(source, /'automation\.' \.[\s\S]*hash\('sha256'/);
});

test('native executor reuses its existing tick for automations and remains backward compatible', async () => {
  const source = await read('hub/bin/awh-native-executor.php');
  assert.match(source, /HubAutomationSchedulerService/);
  assert.match(source, /materializeAutomationSubmission/);
  assert.match(source, /user_version'[\s\S]*>= 15/);
  assert.match(source, /'status' => 'UNAVAILABLE'/);
  assert.match(source, /HubDurableExecutionService::fromEnvironment\(\$pdo[\s\S]*materializeContinuationSubmission[\s\S]*runBatch\(4\)/);
  assert.doesNotMatch(source, /daemonize|systemctl|crontab|OnCalendar/);
});
