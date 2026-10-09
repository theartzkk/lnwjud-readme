#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFile(resolve(root, path), 'utf8');
const json = async (path) => JSON.parse(await read(path));
const fail = (message) => { throw new Error('COMPONENT_STATE_GATE: ' + message); };

const [contract, matrix, feedback, updates, panel, automation, visual] = await Promise.all([
  json('config/kruart-experience-contract.json'),
  json('design/qa/component-state-matrix.json'),
  read('web/interaction-feedback.js'),
  read('web/updates.js'),
  read('web/panel.js'),
  read('web/automation-surface.js'),
  read('scripts/review/visual-review-capture.cjs'),
]);

if (matrix.schemaVersion !== 1) fail('unsupported matrix schema');
if (matrix.authority !== 'config/kruart-experience-contract.json') fail('matrix authority drift');
if (matrix.mode !== 'REAL_SURFACE_FIXTURE') fail('state lab must exercise real surfaces');
if (matrix.storybookPolicy !== 'DEFER_UNTIL_SHARED_COMPONENT_PACKAGE_EXISTS') fail('storybook decision drift');

const required = contract.interaction?.minimumStates;
if (!Array.isArray(required) || JSON.stringify(matrix.requiredStates) !== JSON.stringify(required)) fail('required states drift from experience contract');
for (const state of required) {
  if (!Array.isArray(matrix.evidence?.[state]) || matrix.evidence[state].length < 1) fail(state + ' has no evidence mapping');
}

if (!visual.includes("'home-empty'")) fail('idle real-surface scenario missing');
if (!feedback.includes('kruart-ui-pressed')) fail('pressed feedback missing');
if (!feedback.includes("setAttribute('aria-busy', 'true')") || !feedback.includes("root.dataset.uiLoading = 'true'")) fail('loading feedback missing');
if (!/tone:'good'/.test(updates) || !/is-good/.test(panel)) fail('success state projection missing');
if (!/tone:'bad'/.test(updates) || !/is-bad/.test(panel)) fail('error state projection missing');
if (!feedback.includes(':disabled,[aria-disabled="true"]')) fail('disabled-state guard missing');
if (!automation.includes("'project.worker.offline'")) fail('offline state projection missing');

const lab = matrix.realSurfaceLab || {};
for (const path of [
  'scripts/qa/control-web-fixture.mjs',
  'scripts/review/visual-review-capture.cjs',
  'scripts/qa/chat-modern-browser.mjs',
  'scripts/qa/accessibility-browser.mjs',
]) {
  if (!Object.values(lab).includes(path)) fail('real-surface lab path missing: ' + path);
}

console.log('COMPONENT_STATE_GATE=PASS');
console.log('STATES=' + required.length);
console.log('MODE=' + matrix.mode);
