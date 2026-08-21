const MAX_JSON_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let csrfToken = null;

function safeApiPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/api/v1/control/') || path.includes('..') || /[?#]/.test(path)) throw new Error('AWH control path is not safe');
  return path;
}

async function json(response) {
  const body = await response.text();
  if (body.length > MAX_JSON_BYTES) throw new Error('AWH response exceeds the browser bound');
  let value;
  try { value = JSON.parse(body); } catch { throw new Error('AWH response is invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AWH response is invalid');
  if (!response.ok) throw new Error(typeof value.message === 'string' ? value.message : 'AWH request was rejected');
  return value;
}

export async function controlRequest(path, init = {}, fetchImpl = globalThis.fetch) {
  const headers = new Headers(init.headers || {});
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (init.method && init.method !== 'GET' && csrfToken) headers.set('X-AWH-CSRF', csrfToken);
  const response = await fetchImpl(safeApiPath(path), { ...init, headers, credentials: 'include', cache: 'no-store' });
  const value = await json(response);
  if (typeof value.csrfToken === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value.csrfToken)) csrfToken = value.csrfToken;
  return value;
}

export async function openMobileSession(pairingCode, displayName = 'AWH iPhone', appVersion = 'web') {
  if (typeof pairingCode !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(pairingCode)) throw new Error('รหัสเชื่อมต่อไม่ถูกต้อง');
  return controlRequest('/api/v1/control/session', { method: 'POST', body: JSON.stringify({ schemaVersion: 1, pairingCode, displayName, appVersion }) });
}

export async function loadControlData() {
  const session = await controlRequest('/api/v1/control/session');
  const [projects, tasks, workers, results, artifacts, approvals] = await Promise.all([
    controlRequest('/api/v1/control/projects'),
    controlRequest('/api/v1/control/tasks'),
    controlRequest('/api/v1/control/workers'),
    controlRequest('/api/v1/control/results'),
    controlRequest('/api/v1/control/artifacts'),
    controlRequest('/api/v1/control/approvals'),
  ]);
  return { mode: 'CONTROL', authenticated: true, expiresAt: session.expiresAt, projects: projects.projects.filter((project) => UUID.test(project.projectId)), tasks: Array.isArray(tasks.tasks) ? tasks.tasks : [], workers: Array.isArray(workers.workers) ? workers.workers : [], results: Array.isArray(results.results) ? results.results : [], artifacts: Array.isArray(artifacts.artifacts) ? artifacts.artifacts : [], approvals: Array.isArray(approvals.approvals) ? approvals.approvals : [] };
}

export async function submitGoal(projectId, goal) {
  if (!UUID.test(projectId) || typeof goal !== 'string' || !goal.trim() || goal.length > 2000) throw new Error('กรุณาเลือกโปรเจกต์และเขียน Goal ที่ชัดเจน');
  const idempotencyKey = `web-${crypto.randomUUID()}`;
  return controlRequest('/api/v1/control/tasks', { method: 'POST', body: JSON.stringify({ schemaVersion: 1, projectId, goal: goal.trim(), idempotencyKey }) });
}

export async function decideApproval(approvalId, decision) {
  if (!UUID.test(approvalId) || !['approve', 'reject'].includes(decision)) throw new Error('การอนุมัติไม่ถูกต้อง');
  return controlRequest(`/api/v1/control/approvals/${approvalId}/${decision}`, { method: 'POST', body: JSON.stringify({ schemaVersion: 1 }) });
}
