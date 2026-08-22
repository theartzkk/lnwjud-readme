#!/usr/bin/env node

// Local-only browser fixture for the shipped CONTROL/PWA shell. It is not an
// alternate API or runtime: it provides only bounded, disposable responses so
// a browser can exercise the real login → project → Goal UI without touching
// ReadyIDC or an owner credential.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.cwd(), 'dist-web');
const host = '127.0.0.1';
const port = Number.parseInt(process.env.AWH_WEB_FIXTURE_PORT ?? '4174', 10);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('AWH_WEB_FIXTURE_PORT is invalid');
const project = { projectId: '11111111-1111-4111-8111-111111111111', name: 'โปรเจกต์ตัวอย่างสำหรับตรวจ UI', memoryReady: true };
const csrf = 'fixturecsrffixturecsrffixturecsrffixture';
const tasks = [];

function send(response, status, payload, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(payload));
}

function session(request) { return /(?:^|;\s*)awh_fixture_session=1(?:;|$)/.test(request.headers.cookie ?? ''); }

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function mime(path) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png' })[extname(path)] ?? 'application/octet-stream';
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${host}:${port}`);
    const authenticated = session(request);
    if (url.pathname === '/api/v1/auth/login' && request.method === 'POST') {
      const value = await body(request);
      if (typeof value.username !== 'string' || typeof value.password !== 'string' || !value.username || !value.password) return send(response, 401, { code: 'AUTH_FAILED' });
      return send(response, 200, { csrfToken: csrf }, { 'Set-Cookie': 'awh_fixture_session=1; Path=/; HttpOnly; SameSite=Strict' });
    }
    if (url.pathname.startsWith('/api/v1/')) {
      if (!authenticated) return send(response, 401, { code: 'SESSION_INVALID' });
      if (url.pathname === '/api/v1/control/session') return send(response, 200, { csrfToken: csrf, expiresAt: '2026-12-31T00:00:00.000Z' });
      if (url.pathname === '/api/v1/control/projects') return send(response, 200, { projects: [project] });
      if (url.pathname === '/api/v1/control/tasks' && request.method === 'GET') return send(response, 200, { tasks });
      if (url.pathname === '/api/v1/control/tasks' && request.method === 'POST') {
        if (request.headers['x-awh-csrf'] !== csrf) return send(response, 403, { code: 'CSRF_REJECTED' });
        const value = await body(request);
        if (value.projectId !== project.projectId || typeof value.goal !== 'string' || !value.goal.trim()) return send(response, 400, { code: 'PROJECT_FORBIDDEN' });
        const task = { taskId: `22222222-2222-4222-8222-${String(tasks.length + 1).padStart(12, '0')}`, projectId: project.projectId, goal: value.goal.trim(), state: 'WAITING_FOR_WORKER', createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z', lastEvent: { message: 'AWH บันทึกงานแล้ว และกำลังรออุปกรณ์ทำงาน' } };
        tasks.push(task);
        return send(response, 201, task);
      }
      if (url.pathname === '/api/v1/control/workers') return send(response, 200, { workers: [] });
      if (url.pathname === '/api/v1/control/results') return send(response, 200, { results: [] });
      if (url.pathname === '/api/v1/control/artifacts') return send(response, 200, { artifacts: [] });
      if (url.pathname === '/api/v1/control/approvals') return send(response, 200, { approvals: [] });
      return send(response, 404, { code: 'NOT_FOUND' });
    }
    const requested = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const file = resolve(root, normalize(requested));
    if (!file.startsWith(`${root}/`) && file !== join(root, 'index.html')) return send(response, 404, { code: 'NOT_FOUND' });
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control': 'no-store' });
    response.end(content);
  } catch {
    send(response, 500, { code: 'FIXTURE_ERROR' });
  }
});

server.listen(port, host, () => process.stdout.write(`AWH_CONTROL_WEB_FIXTURE=http://${host}:${port}/\n`));
