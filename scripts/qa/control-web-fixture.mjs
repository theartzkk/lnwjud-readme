#!/usr/bin/env node

// Local-only M9 browser fixture. It implements the already-shipped CONTROL
// contract sufficiently to exercise the real PWA's login → project → Work →
// attachment → canonical request flow. It is deliberately in-memory and never
// contacts ReadyIDC, an owner credential, a provider, or a local workspace.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.cwd(), 'dist-web');
const host = '127.0.0.1';
const port = Number.parseInt(process.env.AWH_WEB_FIXTURE_PORT ?? '4174', 10);
const now = '2026-08-22T00:00:00.000Z';
const project = { projectId: '11111111-1111-4111-8111-111111111111', name: 'โปรเจกต์ตัวอย่างสำหรับตรวจ UI', memoryReady: true, sourceType: 'fixture' };
const csrf = 'fixturecsrffixturecsrffixturecsrffixture';
const conversations = [];
const attachments = [];
const tasks = [];
const fixtureResetToken = 'a'.repeat(43);
let fixtureResetUsed = false;
let counter = 0;

if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('AWH_WEB_FIXTURE_PORT is invalid');

function uuid(prefix) { counter += 1; return `${prefix}-${String(counter).padStart(12, '0')}`; }
function send(response, status, payload, headers = {}) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); response.end(JSON.stringify(payload)); }
function session(request) { return /(?:^|;\s*)awh_fixture_session=1(?:;|$)/.test(request.headers.cookie ?? ''); }
function jsonRequest(request) { return String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json'); }
function requireCsrf(request, response) { if (request.headers['x-awh-csrf'] !== csrf) { send(response, 403, { code: 'CSRF_REJECTED' }); return false; } return true; }
function summary(conversation) { return { conversationId: conversation.conversationId, projectId: project.projectId, title: conversation.title, archivedAt: null, origin: 'native', createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, lastTaskId: conversation.lastTaskId }; }
function thread(conversation) { return { schemaVersion: 3, conversation: summary(conversation), messages: conversation.messages, tasks: tasks.filter((task) => task.conversationId === conversation.conversationId), artifacts: [], attachments: attachments.filter((attachment) => attachment.conversationId === conversation.conversationId), approvals: [] }; }
function attachmentId() { return uuid('33333333-3333-4333-8333'); }
function conversationId() { return uuid('22222222-2222-4222-8222'); }
function messageId() { return uuid('44444444-4444-4444-8444'); }
function taskId() { return uuid('55555555-5555-4555-8555'); }

async function rawBody(request, maximum = 60 * 1024 * 1024) {
  const chunks = []; let bytes = 0;
  for await (const chunk of request) { bytes += chunk.length; if (bytes > maximum) throw new Error('BODY_TOO_LARGE'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const text = (await rawBody(request, 256 * 1024)).toString('utf8');
  try { return JSON.parse(text); } catch { throw new Error('PAYLOAD_INVALID'); }
}

async function readMultipartFiles(request) {
  const raw = await rawBody(request);
  const header = String(request.headers['content-type'] ?? ''); const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(header);
  if (!boundaryMatch) throw new Error('ATTACHMENT_INVALID');
  const boundary = `--${boundaryMatch[1] ?? boundaryMatch[2]}`; const parts = raw.toString('latin1').split(boundary); const files = [];
  for (const part of parts) {
    const marker = part.indexOf('\r\n\r\n'); const name = /filename="([^"\r\n]{1,180})"/.exec(part.slice(0, Math.max(0, marker)));
    if (!name || marker < 0) continue;
    const content = part.slice(marker + 4).replace(/\r\n$/, ''); const decoded = Buffer.from(name[1], 'latin1').toString('utf8').replace(/[\\/]/g, '_');
    files.push({ name: decoded || 'attachment', sizeBytes: Buffer.byteLength(content, 'latin1') });
  }
  if (files.length < 1 || files.length > 8 || files.some((file) => file.sizeBytes < 1)) throw new Error('ATTACHMENT_INVALID');
  return files;
}

function mime(path) { return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' })[extname(path)] ?? 'application/octet-stream'; }
function message(conversation, kind, body, task = null) { const item = { messageId: messageId(), taskId: task?.taskId ?? null, kind, sequence: conversation.messages.length + 1, body, createdAt: now }; conversation.messages.push(item); return item; }

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${host}:${port}`);
    if (url.pathname === '/api/v1/auth/login' && request.method === 'POST') {
      const value = await readJson(request);
      if (typeof value.username !== 'string' || typeof value.password !== 'string' || !value.username.trim() || !value.password) return send(response, 401, { code: 'AUTH_FAILED' });
      return send(response, 200, { csrfToken: csrf }, { 'Set-Cookie': 'awh_fixture_session=1; Path=/; HttpOnly; SameSite=Strict' });
    }
    if (url.pathname === '/api/v1/auth/reset-password' && request.method === 'POST') {
      const value = await readJson(request);
      if (fixtureResetUsed || value.schemaVersion !== 1 || value.resetToken !== fixtureResetToken || typeof value.newPassword !== 'string' || value.newPassword.length < 12) return send(response, 401, { code: 'RESET_FAILED' });
      fixtureResetUsed = true;
      return send(response, 200, { schemaVersion: 1, authenticated: false });
    }
    if (url.pathname === '/api/v1/auth/session') return session(request) ? send(response, 200, { csrfToken: csrf, username: 'fixture', role: 'OWNER' }) : send(response, 401, { code: 'SESSION_INVALID' });
    if (url.pathname === '/api/v1/auth/logout' && request.method === 'POST') {
      if (!session(request) || !requireCsrf(request, response)) return;
      return send(response, 200, { ok: true }, { 'Set-Cookie': 'awh_fixture_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict' });
    }
    if (!url.pathname.startsWith('/api/v1/')) {
      const requested = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
      const file = resolve(root, normalize(requested));
      if (!file.startsWith(`${root}/`) && file !== join(root, 'index.html')) return send(response, 404, { code: 'NOT_FOUND' });
      const content = await readFile(file); response.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control': 'no-store' }); return response.end(content);
    }
    if (!session(request)) return send(response, 401, { code: 'SESSION_INVALID' });
    if (url.pathname === '/api/v1/control/session') return send(response, 200, { csrfToken: csrf, expiresAt: '2026-12-31T00:00:00.000Z', role: 'OWNER' });
    if (url.pathname === '/api/v1/control/projects') return send(response, 200, { projects: [project] });
    if (url.pathname === '/api/v1/control/tasks') return send(response, 200, { tasks });
    if (url.pathname === '/api/v1/control/workers') return send(response, 200, { workers: [{ deviceId: '66666666-6666-4666-8666-666666666666', displayName: 'AWH Desktop ตัวอย่าง', platform: 'darwin', arch: 'arm64', state: 'READY', lastSeenAt: now, boundProjectCount: 1, capabilities: ['project:context'] }] });
    if (url.pathname === '/api/v1/control/results') return send(response, 200, { results: [] });
    if (url.pathname === '/api/v1/control/artifacts') return send(response, 200, { artifacts: [] });
    if (url.pathname === '/api/v1/control/approvals') return send(response, 200, { approvals: [] });
    if (url.pathname === '/api/v1/control/settings' && request.method === 'GET') return send(response, 200, { settings: { productName: { value: 'Art’s Workspace Hub' }, shortName: { value: 'AWH' }, tagline: { value: 'Your Projects. One Workspace. Anywhere.' }, welcome: { value: 'เริ่มคุยกับ Art’s Workspace Hub ได้เลย' }, accent: { value: '#ff8a36' }, founderName: { value: 'Art' }, founderCredit: { value: 'Founder · Product Creator · System Concept' } } });
    if (url.pathname === '/api/v1/control/provider' && request.method === 'GET') return send(response, 200, { schemaVersion: 3, provider: { enabled: false, available: false, keyConfigured: false, credential: { lastTestStatus: 'NOT_TESTED' }, budget: { usedMicrounits: 0, monthlyMicrounits: 0, remainingMicrounits: 0, warningMicrounits: 0 }, rates: { inputMicrounitsPerMillion: 0, outputMicrounitsPerMillion: 0 }, models: { fast: 'gpt-5.4-mini', balanced: 'gpt-5.4', strong: 'gpt-5.4' }, usageByProject: [] } });
    if (url.pathname === '/api/v1/control/provider/projects/' + project.projectId && request.method === 'GET') return send(response, 200, { schemaVersion: 1, projectId: project.projectId, routing: { routingMode: 'AUTO' } });
    if (url.pathname === '/api/v1/auth/people' && request.method === 'GET') return send(response, 200, { people: [{ userId: '77777777-7777-4777-8777-777777777777', displayName: 'Art', role: 'OWNER', status: 'ACTIVE' }] });
    if (url.pathname === '/api/v1/auth/profile' && request.method === 'GET') return send(response, 200, { identity: { displayName: 'Art' } });
    if (url.pathname === '/api/v1/control/owner/status' && request.method === 'GET') return send(response, 200, { schemaVersion: 1, product: { founderName: 'Art', founderCredit: 'Founder · Product Creator · System Concept' }, database: { state: 'HEALTHY' }, recovery: { state: 'READY' }, backup: { state: 'DEPLOYMENT_MANAGED' }, workers: [{ displayName: 'AWH Desktop ตัวอย่าง', state: 'READY', boundProjectCount: 1 }] });
    if (url.pathname === '/api/v1/control/memory' && request.method === 'GET') return send(response, 200, { schemaVersion: 1, memories: [] });
    if (url.pathname === '/api/v1/control/memory/imports' && request.method === 'GET') return send(response, 200, { imports: [] });
    if (url.pathname === '/api/v1/control/conversations' && request.method === 'GET') return send(response, 200, { schemaVersion: 2, conversations: conversations.map(summary) });
    if (url.pathname === '/api/v1/control/conversations/new' && request.method === 'POST') {
      if (!requireCsrf(request, response)) return;
      const value = await readJson(request); if (value.schemaVersion !== 2 || value.projectId !== project.projectId || typeof value.title !== 'string') return send(response, 400, { code: 'PAYLOAD_INVALID' });
      const conversation = { conversationId: conversationId(), title: value.title.trim() || 'Work', createdAt: now, updatedAt: now, lastTaskId: null, messages: [] }; conversations.unshift(conversation); return send(response, 201, thread(conversation));
    }
    const attachmentMatch = /^\/api\/v1\/control\/conversations\/thread\/([0-9a-f-]{36})\/attachments$/i.exec(url.pathname);
    if (attachmentMatch && request.method === 'POST') {
      if (!requireCsrf(request, response) || !String(request.headers['content-type'] ?? '').toLowerCase().startsWith('multipart/form-data')) return;
      const conversation = conversations.find((item) => item.conversationId === attachmentMatch[1]); if (!conversation) return send(response, 404, { code: 'NOT_FOUND' });
      const incoming = await readMultipartFiles(request);
      const stored = incoming.map(({ name, sizeBytes }) => { const value = { attachmentId: attachmentId(), conversationId: conversation.conversationId, messageId: null, name, mimeType: 'application/octet-stream', sizeBytes, downloadUrl: '', createdAt: now }; value.downloadUrl = `/api/v1/control/attachments/${value.attachmentId}/download`; attachments.push(value); return value; });
      return send(response, 201, { schemaVersion: 3, attachments: stored });
    }
    const threadMatch = /^\/api\/v1\/control\/conversations\/thread\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (threadMatch) {
      const conversation = conversations.find((item) => item.conversationId === threadMatch[1]); if (!conversation) return send(response, 404, { code: 'NOT_FOUND' });
      if (request.method === 'GET') return send(response, 200, thread(conversation));
      if (request.method === 'POST') { if (!requireCsrf(request, response)) return; const value = await readJson(request); conversation.title = typeof value.title === 'string' ? value.title.trim() || conversation.title : conversation.title; conversation.updatedAt = now; return send(response, 200, thread(conversation)); }
    }
    if (url.pathname === '/api/v1/control/conversations' && request.method === 'POST') {
      if (!requireCsrf(request, response) || !jsonRequest(request)) return;
      const value = await readJson(request); const conversation = conversations.find((item) => item.conversationId === value.conversationId);
      if (!conversation || value.schemaVersion !== 3 || value.projectId !== project.projectId || typeof value.message !== 'string' || !value.message.trim() || !Array.isArray(value.attachmentIds)) return send(response, 400, { code: 'PAYLOAD_INVALID' });
      const user = message(conversation, 'user', value.message.trim());
      for (const attachment of attachments) if (value.attachmentIds.includes(attachment.attachmentId) && attachment.conversationId === conversation.conversationId && attachment.messageId === null) attachment.messageId = user.messageId;
      const task = { taskId: taskId(), projectId: project.projectId, conversationId: conversation.conversationId, goal: value.message.trim(), state: 'WAITING_FOR_WORKER', createdAt: now, updatedAt: now, lastEvent: { message: 'AWH บันทึกงานแล้ว และกำลังรออุปกรณ์ทำงาน' } }; tasks.unshift(task); conversation.lastTaskId = task.taskId; conversation.updatedAt = now; message(conversation, 'progress', 'กำลังรออุปกรณ์ทำงาน…', task);
      return send(response, 201, thread(conversation));
    }
    const downloadMatch = /^\/api\/v1\/control\/attachments\/([0-9a-f-]{36})\/download$/i.exec(url.pathname);
    if (downloadMatch) { const attachment = attachments.find((item) => item.attachmentId === downloadMatch[1]); if (!attachment) return send(response, 404, { code: 'NOT_FOUND' }); response.writeHead(200, { 'Content-Type': attachment.mimeType, 'Content-Disposition': `attachment; filename="${attachment.name}"`, 'Cache-Control': 'private, no-store' }); return response.end('fixture attachment'); }
    const contextMatch = /^\/api\/v1\/control\/contexts\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (contextMatch && request.method === 'GET') return send(response, 200, { context: conversations[0] ? { conversationId: conversations[0].conversationId } : null });
    if (url.pathname === '/api/v1/control/contexts' && request.method === 'POST') { if (!requireCsrf(request, response)) return; return send(response, 200, { context: true }); }
    const workspaceMatch = /^\/api\/v1\/control\/workspaces\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (workspaceMatch && request.method === 'GET') return send(response, 200, { schemaVersion: 1, workspace: { state: 'READY', syncState: 'SYNCED', lease: null } });
    return send(response, 404, { code: 'NOT_FOUND' });
  } catch (error) { send(response, error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 413 : 500, { code: 'FIXTURE_ERROR' }); }
});

server.listen(port, host, () => process.stdout.write(`AWH_CONTROL_WEB_FIXTURE=http://${host}:${port}/\n`));
