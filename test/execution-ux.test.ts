import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const moduleUrl = pathToFileURL(join(ROOT, 'web', 'execution-ux.js')).href;
const ux = await import(moduleUrl);

test('execution UX translates internal executors into plain Thai', () => {
  const vps = ux.executionStatus({ state: 'RUNNING', progress: 42, execution: { executorKind: 'VPS' } });
  assert.equal(vps.title, 'กำลังทำงาน');
  assert.equal(vps.actor, 'ระบบกลาง AWH');
  assert.equal(vps.progress, 42);
  assert.doesNotMatch(`${vps.title} ${vps.detail} ${vps.actor}`, /VPS|executor|capability/i);

  const specialist = ux.executionStatus({ state: 'RUNNING', progress: 12, execution: { executorKind: 'CODEX' } });
  assert.equal(specialist.actor, 'ผู้เชี่ยวชาญโค้ด');
  assert.doesNotMatch(`${specialist.title} ${specialist.detail}`, /CODEX|CLI|runtime/i);
});

test('device work prefers the friendly enrolled device name without exposing ids', () => {
  const task = { state: 'PREPARING', progress: 5, assignedDevice: '123', execution: { executorKind: 'DEVICE' } };
  const status = ux.executionStatus(task, [{ deviceId: '123', displayName: 'MacBook ครูอาร์ต', platform: 'darwin' }]);
  assert.equal(status.actor, 'MacBook ครูอาร์ต');
  assert.match(status.detail, /MacBook ครูอาร์ต/);
  assert.doesNotMatch(JSON.stringify(status), /assignedDevice|requiredCapability/);
});

test('journey is deterministic from accepted through approval and completion', () => {
  const waiting = ux.executionStatus({ state: 'WAITING_FOR_WORKER', progress: 0 });
  assert.equal(waiting.stage, 'accepted');
  assert.equal(waiting.journey[0].state, 'active');

  const approval = ux.executionStatus({ state: 'WAITING_FOR_APPROVAL', progress: 85 });
  assert.equal(approval.needsApproval, true);
  assert.equal(approval.stage, 'approval');
  assert.equal(approval.journey.find((step: { id: string }) => step.id === 'approval')?.state, 'active');

  const done = ux.executionStatus({ state: 'COMPLETED', progress: 100, resultSummary: 'เรียบร้อย' });
  assert.equal(done.terminal, true);
  assert.equal(done.detail, 'เรียบร้อย');
  assert.equal(done.journey.every((step: { state: string }) => step.state === 'done'), true);
});

test('provider failures remain truthful and preserve the task', () => {
  const status = ux.executionStatus({ state: 'FAILED', failureCode: 'PROVIDER_QUOTA_EXHAUSTED', progress: 0 });
  assert.equal(status.title, 'ต้องตรวจสอบ');
  assert.match(status.detail, /โควตา AI/);
  assert.match(status.detail, /งานยังถูกเก็บไว้/);
});

test('execution UX module is presentation-only and has no network or storage authority', async () => {
  const source = await readFile(join(ROOT, 'web', 'execution-ux.js'), 'utf8');
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|Authorization|Bearer/);
  assert.doesNotMatch(source, /api\/v1|controlRequest|submitWorkMessage|decideApproval/);
});
