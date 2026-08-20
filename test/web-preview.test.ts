import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { browserRequestOptions, degradedHubPreview, fetchStaticData, getJson, hubDataFromApi, isSafeRelativePath } from '../web/hub-read-adapter.js';

const runFile = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'dist-web');

async function buildPreview(fixedTimestamp = '2026-01-01T00:00:00.000Z'): Promise<void> {
  await runFile(process.execPath, ['--import', 'tsx', 'scripts/build-web-preview.ts'], { cwd: ROOT, shell: false, env: { ...process.env, AWH_PREVIEW_GENERATED_AT: fixedTimestamp } });
}

test('browser surface builds without Electron and serializes the real portable project safely', async () => {
  await buildPreview();
  const [html, app, adapter, rawData] = await Promise.all([
    readFile(join(OUTPUT, 'index.html'), 'utf8'),
    readFile(join(OUTPUT, 'app.js'), 'utf8'),
    readFile(join(OUTPUT, 'hub-read-adapter.js'), 'utf8'),
    readFile(join(OUTPUT, 'data.json'), 'utf8'),
  ]);
  const data = JSON.parse(rawData) as Record<string, any>;
  assert.equal(data.project.projectId, '113b45c0-23e1-408d-ae0f-ac5eca7f6900');
  assert.equal(data.project.name, 'Art’s Workspace Hub');
  assert.equal(data.project.type, 'node');
  assert.equal(data.preview.label, 'Remote Preview — Read Only');
  assert.equal(data.tasks.status, 'Desktop runtime only');
  assert.equal(data.artifacts.status, 'Preview only');
  assert.ok(data.project.handoffSummary.length <= 480);
  assert.deepEqual(Object.keys(data.project.memory), ['PROJECT.md', 'HANDOFF.md', 'TASKS.md', 'ARCHITECTURE.md', 'DECISIONS.md']);
  assert.match(html, /meta name="viewport"/);
  assert.doesNotMatch(`${html}\n${app}\n${adapter}`, /electron|ipcRenderer|contextBridge|require\(/i);
});

test('browser preview contains no local paths, credentials, source payload, or write/exec surface', async () => {
  await buildPreview();
  const [html, app, adapter, rawData] = await Promise.all([
    readFile(join(OUTPUT, 'index.html'), 'utf8'),
    readFile(join(OUTPUT, 'app.js'), 'utf8'),
    readFile(join(OUTPUT, 'hub-read-adapter.js'), 'utf8'),
    readFile(join(OUTPUT, 'data.json'), 'utf8'),
  ]);
  const browserSurface = `${html}\n${app}\n${adapter}\n${rawData}`;
  assert.doesNotMatch(browserSurface, /workspacePath|absolutePath|\/Users\/|[A-Za-z]:\\\\|accessToken|tokenHash|pairingCode|Authorization|password|privateKey/i);
  assert.doesNotMatch(browserSurface, /Purpose, scope, and stable project constraints|## Now|Key components, boundaries/);
  assert.doesNotMatch(`${html}\n${app}\n${adapter}`, /innerHTML|insertAdjacentHTML|document\.write/i);
  assert.doesNotMatch(`${html}\n${app}\n${adapter}`, /\b(?:POST|PUT|DELETE|PATCH)\b|ipcMain|spawn\(|exec\(|shell\./i);
  assert.match(html, /connect-src 'self'/);
  assert.match(html, /form-action 'none'/);
});

test('static preview serialization is deterministic with a fixed build timestamp and has a future Hub mode boundary', async () => {
  await buildPreview();
  const first = await readFile(join(OUTPUT, 'data.json'), 'utf8');
  await buildPreview();
  const second = await readFile(join(OUTPUT, 'data.json'), 'utf8');
  assert.equal(first, second);
  const adapter = await readFile(join(ROOT, 'web', 'hub-read-adapter.js'), 'utf8');
  assert.match(adapter, /STATIC_PREVIEW/);
  assert.match(adapter, /HUB_READ/);
  assert.doesNotMatch(adapter, /Authorization\s*[:=]|localStorage|sessionStorage|document\.cookie/i);
});

test('static data and Hub reads reuse only the same-origin web perimeter session', async () => {
  const requests = [] as Array<{ path: string; options: RequestInit }>;
  const fakeFetch = async (path: string, options: RequestInit) => {
    requests.push({ path, options });
    return { ok: true, text: async () => JSON.stringify({ static: true }) } as Response;
  };
  await fetchStaticData(fakeFetch);
  await getJson('/api/v1/projects', 'HUB_READ', fakeFetch);
  assert.deepEqual(requests[0], { path: '/data.json', options: { credentials: 'same-origin', cache: 'no-store' } });
  assert.deepEqual(requests[1], { path: '/api/v1/projects', options: { credentials: 'same-origin', cache: 'no-store' } });
  assert.deepEqual(browserRequestOptions('STATIC_PREVIEW'), { credentials: 'same-origin', cache: 'no-store' });
  assert.deepEqual(browserRequestOptions('HUB_READ'), { credentials: 'same-origin', cache: 'no-store' });
  assert.notEqual(browserRequestOptions('HUB_READ').credentials, 'include');
});

test('browser adapter never constructs Authorization headers, generated output has no credential values, and cross-origin paths fail closed', async () => {
  const adapter = await readFile(join(ROOT, 'web', 'hub-read-adapter.js'), 'utf8');
  const output = await readFile(join(OUTPUT, 'data.json'), 'utf8');
  assert.doesNotMatch(adapter, /Authorization\s*[:=]|Bearer\s+|password\s*[:=]|token\s*[:=]/i);
  assert.doesNotMatch(output, /username|password|accessToken|tokenHash|pairingCode|privateKey/i);
  assert.equal(isSafeRelativePath('/api/v1/projects'), '/api/v1/projects');
  assert.equal(isSafeRelativePath('https://evil.example/api'), null);
  assert.equal(isSafeRelativePath('//evil.example/api'), null);
  assert.equal(isSafeRelativePath('/api/v1/projects?token=secret'), null);
  assert.equal(isSafeRelativePath('/api/../secret'), null);
});

test('HUB_READ keeps every live-read request under the configured /api/v1 base', async () => {
  const requests: string[] = [];
  const projectId = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
  const fakeFetch = async (path: string) => {
    requests.push(path);
    const payload = path.endsWith('/projects')
      ? { projects: [{ projectId, name: 'Art’s Workspace Hub', type: 'node', createdAt: '2026-01-01T00:00:00.000Z' }] }
      : path.endsWith('/memory')
        ? { files: {}, handoffSummary: 'bounded' }
        : path.endsWith('/status')
          ? { status: 'ok' }
          : path.endsWith('/devices')
            ? { devices: [] }
            : path.endsWith('/builds')
              ? { builds: [] }
              : path.endsWith('/releases')
                ? { releases: [] }
                : { project: { projectId, name: 'Art’s Workspace Hub', type: 'node', createdAt: '2026-01-01T00:00:00.000Z' } };
    return { ok: true, text: async () => JSON.stringify(payload) } as Response;
  };
  await hubDataFromApi('/api/v1', fakeFetch);
  assert.ok(requests.length === 7);
  assert.ok(requests.every((path) => path.startsWith('/api/v1/')));
  assert.ok(requests.includes('/api/v1/status'));
  assert.ok(!requests.includes('/api/status'));
});

test('Hub outage is truthfully degraded to the static preview and never reported online', () => {
  const degraded = degradedHubPreview({
    preview: { mode: 'STATIC_PREVIEW', status: 'Static preview' },
    hub: { status: 'Static snapshot', summary: 'snapshot' },
  });
  assert.equal(degraded.preview.mode, 'HUB_READ_DEGRADED');
  assert.equal(degraded.preview.status, 'Hub unavailable — Static preview');
  assert.equal(degraded.hub.status, 'Offline');
  assert.doesNotMatch(JSON.stringify(degraded), /Connected|Online|Authenticated Hub read mode/);
});

test('browser surface has responsive mobile structure and bounded read-only status cards', async () => {
  const [html, css] = await Promise.all([
    readFile(join(ROOT, 'web', 'index.html'), 'utf8'),
    readFile(join(ROOT, 'web', 'styles.css'), 'utf8'),
  ]);
  for (const id of ['project-card', 'device-card', 'memory-list', 'handoff-summary', 'build-status', 'audit-status', 'tasks-status', 'artifacts-status']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(css, /@media\(max-width:560px\)/);
  assert.match(css, /status-grid\{grid-template-columns:1fr\}/);
});
