import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { automationOccurrenceKey, materializeAutomationOccurrence, validateAutomationDefinition } from '../src/automation-contract.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AUTOMATION_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';

function exact(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    automationId: AUTOMATION_ID,
    projectId: PROJECT_ID,
    conversationId: null,
    name: 'Morning brief',
    goal: 'สรุปงานสำคัญของ Project นี้ให้ฉัน',
    timingMode: 'exact_schedule',
    schedule: 'BEGIN:VEVENT\nDTSTART;TZID=Asia/Bangkok:20260828T080000\nEND:VEVENT',
    condition: null,
    enabled: true,
    ...overrides,
  };
}

test('exact schedule validates and materializes only the canonical task submission contract', () => {
  const definition = validateAutomationDefinition(exact());
  assert.equal(definition.timingMode, 'exact_schedule');
  const result = materializeAutomationOccurrence(definition, '2026-08-28T08:00:00+07:00');
  assert.equal(result.kind, 'TASK');
  if (result.kind !== 'TASK') return;
  assert.deepEqual(Object.keys(result.payload).sort(), ['goal', 'idempotencyKey', 'projectId', 'schemaVersion']);
  assert.equal(result.payload.schemaVersion, 1);
  assert.equal(result.payload.projectId, PROJECT_ID);
  assert.equal(result.payload.goal, definition.goal);
  assert.match(result.payload.idempotencyKey, /^[A-Za-z0-9._-]{8,120}$/);
});

test('conversation-bound automation materializes through the existing conversation work contract', () => {
  const result = materializeAutomationOccurrence(exact({ conversationId: CONVERSATION_ID }), '2026-08-28T08:00:00+07:00');
  assert.equal(result.kind, 'CONVERSATION');
  if (result.kind !== 'CONVERSATION') return;
  assert.equal(result.payload.schemaVersion, 3);
  assert.equal(result.payload.projectId, PROJECT_ID);
  assert.equal(result.payload.conversationId, CONVERSATION_ID);
  assert.deepEqual(result.payload.attachmentIds, []);
  assert.equal(result.payload.message, exact().goal);
});

test('occurrence idempotency is deterministic across equivalent timezone representations', () => {
  const a = automationOccurrenceKey(AUTOMATION_ID, '2026-08-28T01:00:00Z');
  const b = automationOccurrenceKey(AUTOMATION_ID, '2026-08-28T08:00:00+07:00');
  const c = automationOccurrenceKey(AUTOMATION_ID, '2026-08-29T01:00:00Z');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^automation\.[a-f0-9]{40}$/);
});

test('condition watches require a bounded recurring schedule no faster than hourly', () => {
  const value = exact({
    timingMode: 'condition_watch',
    schedule: 'BEGIN:VEVENT\nRRULE:FREQ=HOURLY\nEND:VEVENT',
    condition: { schemaVersion: 1, key: 'weather.school', description: 'ตรวจว่ามีเงื่อนไขที่ตั้งไว้เกิดขึ้นหรือยัง' },
  });
  const definition = validateAutomationDefinition(value);
  assert.equal(definition.condition?.key, 'weather.school');
  assert.throws(() => validateAutomationDefinition({ ...value, schedule: 'BEGIN:VEVENT\nRRULE:FREQ=MINUTELY;INTERVAL=5\nEND:VEVENT' }), /AUTOMATION_FREQUENCY_TOO_HIGH/);
  assert.throws(() => validateAutomationDefinition({ ...value, schedule: 'BEGIN:VEVENT\nDTSTART:20260828T080000\nEND:VEVENT' }), /AUTOMATION_CONDITION_REQUIRES_RECURRENCE/);
});

test('schedule and condition fields remain data-only and fail closed on executable extensions', () => {
  assert.throws(() => validateAutomationDefinition(exact({ schedule: 'BEGIN:VEVENT\nDTSTART:20260828T080000\nSUMMARY:run this\nEND:VEVENT' })), /AUTOMATION_SCHEDULE_FIELD_FORBIDDEN/);
  assert.throws(() => validateAutomationDefinition(exact({ schedule: 'BEGIN:VEVENT\nDTSTART:20260828T080000\nCOMMAND:curl example\nEND:VEVENT' })), /AUTOMATION_SCHEDULE_FIELD_FORBIDDEN/);
  assert.throws(() => validateAutomationDefinition(exact({ timingMode: 'condition_watch', schedule: 'BEGIN:VEVENT\nRRULE:FREQ=HOURLY\nEND:VEVENT', condition: { schemaVersion: 1, key: 'watch.test', description: 'check', expression: 'process.exit()' } })), /AUTOMATION_FIELDS_INVALID/);
  assert.throws(() => validateAutomationDefinition(exact({ timingMode: 'condition_watch', schedule: 'BEGIN:VEVENT\nRRULE:FREQ=HOURLY\nEND:VEVENT', condition: { schemaVersion: 1, key: 'watch.test', description: 'shell: rm -rf' } })), /AUTOMATION_CONDITION_EXECUTABLE_FORBIDDEN/);
  assert.throws(() => validateAutomationDefinition(exact({ timingMode: 'condition_watch', schedule: 'BEGIN:VEVENT\nRRULE:FREQ=HOURLY\nEND:VEVENT', condition: { schemaVersion: 1, key: 'watch.test', description: 'ตรวจ token=abcd ทุกชั่วโมง' } })), /AUTOMATION_CONDITION_SECRET/);
});

test('disabled definitions and secret-looking goals cannot create canonical work', () => {
  assert.throws(() => materializeAutomationOccurrence(exact({ enabled: false }), '2026-08-28T08:00:00+07:00'), /AUTOMATION_DISABLED/);
  assert.throws(() => validateAutomationDefinition(exact({ goal: 'ส่ง token=abcd ไปให้ระบบ' })), /AUTOMATION_GOAL_SECRET/);
  assert.throws(() => validateAutomationDefinition({ ...exact(), extraAuthority: true }), /AUTOMATION_FIELDS_INVALID/);
});

test('automation contract has no scheduler, network, process, filesystem or persistence authority', async () => {
  const source = await readFile(join(ROOT, 'src', 'automation-contract.ts'), 'utf8');
  assert.doesNotMatch(source, /child_process|node:fs|node:http|node:https|fetch\(|XMLHttpRequest|WebSocket|process\.env|setInterval|setTimeout|localStorage|sessionStorage|sqlite|PDO|INSERT INTO|UPDATE /i);
  assert.doesNotMatch(source, /\beval\(|new Function|spawn\(|exec\(/i);
  assert.match(source, /CanonicalAutomationSubmission/);
  assert.match(source, /kind: 'TASK'/);
  assert.match(source, /kind: 'CONVERSATION'/);
});
