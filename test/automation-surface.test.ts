import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Owner automation surface uses the canonical control request boundary', async () => {
  const [surface, css, build] = await Promise.all([read('web/automation-surface.js'), read('web/automation-surface.css'), read('scripts/build-web-preview.ts')]);
  assert.match(surface, /import \{ controlRequest \} from '\.\/control-plane-adapter\.js'/);
  assert.match(surface, /\/api\/v1\/control\/automations/);
  assert.match(surface, /สร้าง Automation/);
  assert.match(surface, /ครั้งเดียว/);
  assert.match(surface, /ทุกวัน/);
  assert.match(surface, /ทุกสัปดาห์/);
  assert.match(surface, /เมื่อเกิดเงื่อนไข/);
  assert.match(surface, /project\.task\.failed/);
  assert.match(surface, /project\.approval\.pending/);
  assert.match(surface, /project\.worker\.offline/);
  assert.doesNotMatch(surface, /localStorage|sessionStorage|Authorization|Bearer\s|XMLHttpRequest|new WebSocket|\.fetch\s*\(/);
  assert.doesNotMatch(surface, /Run now|รันทันที|cron/i);
  assert.match(css, /awh-automation-panel/);
  assert.match(build, /asset\('automation-surface\.js'\)/);
  assert.match(build, /asset\('automation-surface\.css'\)/);
  assert.match(build, /\/\* Automations \*\//);
});

test('Owner automation form hides VEVENT implementation details from ordinary users', async () => {
  const surface = await read('web/automation-surface.js');
  assert.match(surface, /BEGIN:VEVENT/);
  assert.match(surface, /RRULE:FREQ=DAILY/);
  assert.match(surface, /RRULE:FREQ=WEEKLY/);
  assert.match(surface, /RRULE:FREQ=HOURLY/);
  assert.doesNotMatch(surface, /textContent\s*=\s*['"`][^'"`]*(?:VEVENT|RRULE)/);
  assert.doesNotMatch(surface, /innerHTML\s*=\s*['"`][^'"`]*(?:VEVENT|RRULE)/);
});

test('editing automation preserves enable state and restores one-time wall clock', async () => {
  const [surface, service] = await Promise.all([read('web/automation-surface.js'), read('hub/src/HubControlPlaneService.php')]);
  assert.match(surface, /function onceLocalValue\(schedule\)/);
  assert.match(surface, /namedItem\('onceAt'\)\.value=onceLocalValue\(def\.schedule\)/);
  assert.match(service, /\$definition\['enabled'\] = \(bool\)\$current\['definition'\]\['enabled'\]/);
  assert.match(service, /setAutomationEnabled/);
});
