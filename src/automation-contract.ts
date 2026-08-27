import { createHash } from 'node:crypto';

export type AutomationTimingMode = 'exact_schedule' | 'flexible_schedule' | 'condition_watch';

export interface AutomationCondition {
  schemaVersion: 1;
  key: string;
  description: string;
}

export interface AutomationDefinition {
  schemaVersion: 1;
  automationId: string;
  projectId: string;
  conversationId: string | null;
  name: string;
  goal: string;
  timingMode: AutomationTimingMode;
  schedule: string;
  condition: AutomationCondition | null;
  enabled: boolean;
}

export type CanonicalAutomationSubmission =
  | { kind: 'TASK'; payload: { schemaVersion: 1; projectId: string; goal: string; idempotencyKey: string } }
  | { kind: 'CONVERSATION'; payload: { schemaVersion: 3; projectId: string; conversationId: string; message: string; attachmentIds: []; idempotencyKey: string } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONDITION_KEY = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const IDEMPOTENCY = /^[A-Za-z0-9._-]{8,120}$/;
const OCCURRENCE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const DTSTART = /^DTSTART(?:;TZID=[A-Za-z0-9_+\/-]{1,64})?:\d{8}T\d{6}$/;
const RRULE = /^RRULE:[A-Z0-9=;,+-]{1,500}$/;
const TIMING = new Set<AutomationTimingMode>(['exact_schedule', 'flexible_schedule', 'condition_watch']);
const DEFINITION_KEYS = ['automationId', 'condition', 'conversationId', 'enabled', 'goal', 'name', 'projectId', 'schedule', 'schemaVersion', 'timingMode'];
const CONDITION_KEYS = ['description', 'key', 'schemaVersion'];

function exactKeys(value: Record<string, unknown>, expected: string[]): void {
  const keys = Object.keys(value).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error('AUTOMATION_FIELDS_INVALID');
}

function text(value: unknown, min: number, max: number, code: string): string {
  if (typeof value !== 'string') throw new Error(code);
  const trimmed = value.trim();
  if (trimmed.length < min || Buffer.byteLength(trimmed, 'utf8') > max || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(trimmed)) throw new Error(code);
  return trimmed;
}

function safeGoal(value: unknown): string {
  const goal = text(value, 1, 2000, 'AUTOMATION_GOAL_INVALID').replace(/\r\n?/g, '\n');
  if (/(?:^|\s)(?:Bearer\s+|password\s*[=:]|secret\s*[=:]|token\s*[=:]|api[_-]?key\s*[=:])/i.test(goal)) throw new Error('AUTOMATION_GOAL_SECRET');
  return goal;
}

function uuid(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('AUTOMATION_ID_INVALID');
  return value.toLowerCase();
}

function schedule(value: unknown, timingMode: AutomationTimingMode): string {
  const input = text(value, 1, 4096, 'AUTOMATION_SCHEDULE_INVALID').replace(/\r\n?/g, '\n');
  const lines = input.split('\n');
  if (lines[0] !== 'BEGIN:VEVENT' || lines.at(-1) !== 'END:VEVENT' || lines.length < 3 || lines.length > 10 || lines.some((line) => line.length > 512)) throw new Error('AUTOMATION_SCHEDULE_INVALID');
  const body = lines.slice(1, -1);
  if (body.some((line) => !DTSTART.test(line) && !RRULE.test(line))) throw new Error('AUTOMATION_SCHEDULE_FIELD_FORBIDDEN');
  const dtstarts = body.filter((line) => DTSTART.test(line));
  const rrules = body.filter((line) => RRULE.test(line));
  if (dtstarts.length > 1 || rrules.length > 1 || (dtstarts.length === 0 && rrules.length === 0)) throw new Error('AUTOMATION_SCHEDULE_INVALID');
  const rrule = rrules[0] ?? null;
  if (rrule) {
    if (/FREQ=(?:SECONDLY|MINUTELY)(?:;|$)/.test(rrule)) throw new Error('AUTOMATION_FREQUENCY_TOO_HIGH');
    if (!/FREQ=(?:HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|$)/.test(rrule)) throw new Error('AUTOMATION_RRULE_INVALID');
  }
  if (timingMode === 'condition_watch' && !rrule) throw new Error('AUTOMATION_CONDITION_REQUIRES_RECURRENCE');
  return input;
}

function condition(value: unknown, timingMode: AutomationTimingMode): AutomationCondition | null {
  if (timingMode !== 'condition_watch') {
    if (value !== null) throw new Error('AUTOMATION_CONDITION_NOT_ALLOWED');
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AUTOMATION_CONDITION_REQUIRED');
  const row = value as Record<string, unknown>; exactKeys(row, CONDITION_KEYS);
  if (row.schemaVersion !== 1) throw new Error('AUTOMATION_CONDITION_SCHEMA');
  const key = text(row.key, 3, 80, 'AUTOMATION_CONDITION_KEY_INVALID');
  if (!CONDITION_KEY.test(key)) throw new Error('AUTOMATION_CONDITION_KEY_INVALID');
  const description = text(row.description, 1, 500, 'AUTOMATION_CONDITION_DESCRIPTION_INVALID');
  if (/(?:javascript:|\beval\s*\(|\bexec\s*\(|\bsql\s*:|\bshell\s*:)/i.test(description)) throw new Error('AUTOMATION_CONDITION_EXECUTABLE_FORBIDDEN');
  return { schemaVersion: 1, key, description };
}

export function validateAutomationDefinition(value: unknown): AutomationDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AUTOMATION_INVALID');
  const row = value as Record<string, unknown>; exactKeys(row, DEFINITION_KEYS);
  if (row.schemaVersion !== 1) throw new Error('AUTOMATION_SCHEMA');
  if (typeof row.timingMode !== 'string' || !TIMING.has(row.timingMode as AutomationTimingMode)) throw new Error('AUTOMATION_TIMING_MODE_INVALID');
  const timingMode = row.timingMode as AutomationTimingMode;
  if (typeof row.enabled !== 'boolean') throw new Error('AUTOMATION_ENABLED_INVALID');
  return {
    schemaVersion: 1,
    automationId: uuid(row.automationId)!,
    projectId: uuid(row.projectId)!,
    conversationId: uuid(row.conversationId, true),
    name: text(row.name, 1, 120, 'AUTOMATION_NAME_INVALID'),
    goal: safeGoal(row.goal),
    timingMode,
    schedule: schedule(row.schedule, timingMode),
    condition: condition(row.condition, timingMode),
    enabled: row.enabled,
  };
}

export function automationOccurrenceKey(automationId: string, occurrenceAt: string): string {
  const id = uuid(automationId)!;
  if (!OCCURRENCE.test(occurrenceAt)) throw new Error('AUTOMATION_OCCURRENCE_INVALID');
  const epoch = Date.parse(occurrenceAt);
  if (!Number.isFinite(epoch)) throw new Error('AUTOMATION_OCCURRENCE_INVALID');
  const digest = createHash('sha256').update(`${id}\n${new Date(epoch).toISOString()}`, 'utf8').digest('hex').slice(0, 40);
  const key = `automation.${digest}`;
  if (!IDEMPOTENCY.test(key)) throw new Error('AUTOMATION_IDEMPOTENCY_INVALID');
  return key;
}

export function materializeAutomationOccurrence(value: unknown, occurrenceAt: string): CanonicalAutomationSubmission {
  const automation = validateAutomationDefinition(value);
  if (!automation.enabled) throw new Error('AUTOMATION_DISABLED');
  const idempotencyKey = automationOccurrenceKey(automation.automationId, occurrenceAt);
  if (automation.conversationId) return { kind: 'CONVERSATION', payload: { schemaVersion: 3, projectId: automation.projectId, conversationId: automation.conversationId, message: automation.goal, attachmentIds: [], idempotencyKey } };
  return { kind: 'TASK', payload: { schemaVersion: 1, projectId: automation.projectId, goal: automation.goal, idempotencyKey } };
}
