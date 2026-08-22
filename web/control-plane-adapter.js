const MAX_JSON_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let csrfToken = null;

function safeApiPath(path) {
  if (typeof path !== 'string' || (!path.startsWith('/api/v1/control/') && !path.startsWith('/api/v1/auth/')) || path.includes('..') || /[?#]/.test(path)) throw new Error('AWH control path is not safe');
  return path;
}

async function json(response) {
  const body = await response.text();
  if (body.length > MAX_JSON_BYTES) throw new Error('AWH response exceeds the browser bound');
  let value;
  try { value = JSON.parse(body); } catch { throw new Error('AWH response is invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AWH response is invalid');
  if (!response.ok) throw new Error(safeErrorMessage(value));
  return value;
}

function safeErrorMessage(value) {
  const code = typeof value?.code === 'string' ? value.code : '';
  return ({
    AUTH_FAILED: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
    SESSION_INVALID: 'กรุณาเข้าสู่ AWH อีกครั้ง',
    SESSION_EXPIRED: 'เซสชันหมดอายุ กรุณาเข้าสู่ AWH อีกครั้ง',
    ORIGIN_FORBIDDEN: 'ไม่สามารถยืนยันความปลอดภัยของหน้านี้ได้ กรุณารีเฟรชแล้วลองใหม่',
    CSRF_REJECTED: 'ไม่สามารถยืนยันคำขอได้ กรุณารีเฟรชแล้วลองใหม่',
    PROJECT_FORBIDDEN: 'โปรเจกต์นี้ไม่พร้อมใช้งานสำหรับบัญชีของคุณ',
  })[code] || 'AWH ไม่สามารถดำเนินการได้ในขณะนี้';
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

export async function login(username, password, remember = false) {
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || password.length < 1) throw new Error('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  return controlRequest('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ schemaVersion: 1, username: username.trim(), password, remember: Boolean(remember) }) });
}

export async function loadAuthSession() { return controlRequest('/api/v1/auth/session'); }
export async function logout() { return controlRequest('/api/v1/auth/logout', { method: 'POST', body: JSON.stringify({ schemaVersion: 1 }) }); }
export async function logoutAll() { return controlRequest('/api/v1/auth/logout-all', { method: 'POST', body: JSON.stringify({ schemaVersion: 1 }) }); }
export async function changePassword(oldPassword, newPassword) { return controlRequest('/api/v1/auth/password', { method: 'POST', body: JSON.stringify({ schemaVersion: 1, oldPassword, newPassword }) }); }
export async function changeUsername(currentPassword, username) { return controlRequest('/api/v1/auth/identity', { method: 'POST', body: JSON.stringify({ schemaVersion: 1, currentPassword, username: username.trim() }) }); }
export async function createRecoveryCodes() { return controlRequest('/api/v1/auth/recovery-codes', { method: 'POST', body: JSON.stringify({ schemaVersion: 1 }) }); }
export async function recover(username, recoveryCode, newPassword) { return controlRequest('/api/v1/auth/recover', { method: 'POST', body: JSON.stringify({ schemaVersion: 1, username, recoveryCode, newPassword }) }); }
export async function listAuthSessions() { return controlRequest('/api/v1/auth/sessions'); }
export async function revokeAuthSession(sessionId) { if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('เซสชันไม่ถูกต้อง'); return controlRequest(`/api/v1/auth/sessions/${sessionId}/revoke`, { method: 'POST', body: JSON.stringify({ schemaVersion: 1 }) }); }

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

export async function loadConversations(projectId, query = '') {
  if (!UUID.test(projectId) || (typeof query !== 'string' || query.length > 120)) throw new Error('โปรเจกต์ไม่ถูกต้อง');
  const value = await controlRequest(`/api/v1/control/conversations?projectId=${encodeURIComponent(projectId)}${query ? `&q=${encodeURIComponent(query)}` : ''}`);
  if (value.schemaVersion !== 2 || !Array.isArray(value.conversations)) throw new Error('รายการการสนทนาของ AWH ไม่ถูกต้อง');
  return value.conversations.filter((conversation) => conversation && UUID.test(conversation.conversationId) && conversation.projectId === projectId);
}

export async function loadConversation(conversationId) {
  if (!UUID.test(conversationId)) throw new Error('การสนทนาไม่ถูกต้อง');
  const value = await controlRequest(`/api/v1/control/conversations/thread/${conversationId}`);
  if (value.schemaVersion !== 2 || !value.conversation || !Array.isArray(value.messages) || !Array.isArray(value.tasks) || !Array.isArray(value.artifacts) || !Array.isArray(value.approvals)) throw new Error('ประวัติการทำงานของ AWH ไม่ถูกต้อง');
  return value;
}

export async function createConversation(projectId, title = 'การสนทนาใหม่') {
  if (!UUID.test(projectId) || typeof title !== 'string' || !title.trim() || title.length > 120) throw new Error('ชื่อการสนทนาไม่ถูกต้อง');
  return controlRequest('/api/v1/control/conversations/new', { method: 'POST', body: JSON.stringify({ schemaVersion: 2, projectId, title: title.trim() }) });
}

export async function updateConversation(conversationId, title, archived = false) {
  if (!UUID.test(conversationId) || typeof title !== 'string' || !title.trim() || title.length > 120 || typeof archived !== 'boolean') throw new Error('การสนทนาไม่ถูกต้อง');
  return controlRequest(`/api/v1/control/conversations/thread/${conversationId}`, { method: 'POST', body: JSON.stringify({ schemaVersion: 2, title: title.trim(), archived }) });
}

export async function loadCurrentContext(projectId) {
  if (!UUID.test(projectId)) throw new Error('โปรเจกต์ไม่ถูกต้อง');
  return controlRequest(`/api/v1/control/contexts/${projectId}`);
}

export async function saveCurrentContext(projectId, conversationId, viewKind = 'work', selectedRef = null, sourceRevision = null) {
  if (!UUID.test(projectId) || !UUID.test(conversationId)) return null;
  return controlRequest('/api/v1/control/contexts', { method: 'POST', body: JSON.stringify({ schemaVersion: 2, projectId, conversationId, viewKind, selectedRef, sourceRevision }) });
}

export async function loadProductSettings() { return controlRequest('/api/v1/control/settings'); }
export async function updateProductSetting(settingKey, value) { return controlRequest('/api/v1/control/settings', { method: 'POST', body: JSON.stringify({ schemaVersion: 2, settingKey, value }) }); }
export async function loadProductSettingHistory(settingKey) { if (!['productName', 'shortName', 'tagline', 'accent', 'welcome', 'starterPrompts'].includes(settingKey)) throw new Error('การตั้งค่าไม่ถูกต้อง'); return controlRequest(`/api/v1/control/settings/history?settingKey=${encodeURIComponent(settingKey)}`); }
export async function resetProductSetting(settingKey) { if (!['productName', 'shortName', 'tagline', 'accent', 'welcome', 'starterPrompts'].includes(settingKey)) throw new Error('การตั้งค่าไม่ถูกต้อง'); return controlRequest('/api/v1/control/settings/reset', { method: 'POST', body: JSON.stringify({ schemaVersion: 2, settingKey }) }); }
export async function exportWorkspace() { return controlRequest('/api/v1/control/export'); }

export async function loadWorkspaceContinuity(projectId) {
  if (!UUID.test(projectId)) throw new Error('โปรเจกต์ไม่ถูกต้อง');
  const value = await controlRequest(`/api/v1/control/workspaces/${projectId}`);
  if (value.schemaVersion !== 1 || !value.workspace || typeof value.workspace !== 'object' || Array.isArray(value.workspace)) throw new Error('สถานะ workspace ไม่ถูกต้อง');
  return value.workspace;
}

export async function submitWorkMessage(projectId, conversationId, message, idempotencyKey = `web-${crypto.randomUUID()}`) {
  if (!UUID.test(projectId) || !UUID.test(conversationId) || typeof message !== 'string' || !message.trim() || message.length > 2000 || !/^[A-Za-z0-9._-]{8,120}$/.test(idempotencyKey)) throw new Error('กรุณาเลือกโปรเจกต์และบอกสิ่งที่อยากให้ AWH ช่วย');
  const value = await controlRequest('/api/v1/control/conversations', { method: 'POST', body: JSON.stringify({ schemaVersion: 2, projectId, conversationId, message: message.trim(), idempotencyKey }) });
  if (value.schemaVersion !== 2 || !Array.isArray(value.messages) || !Array.isArray(value.tasks)) throw new Error('AWH ไม่สามารถบันทึกการสนทนาได้');
  return value;
}

export async function submitGoal(projectId, conversationId, goal) {
  return submitWorkMessage(projectId, conversationId, goal);
}

export async function cancelTask(taskId) {
  if (!UUID.test(taskId)) throw new Error('งานไม่ถูกต้อง');
  return controlRequest(`/api/v1/control/tasks/${taskId}/cancel`, { method: 'POST', body: JSON.stringify({ schemaVersion: 1 }) });
}

export async function decideApproval(approvalId, decision) {
  if (!UUID.test(approvalId) || !['approve', 'reject'].includes(decision)) throw new Error('การอนุมัติไม่ถูกต้อง');
  return controlRequest(`/api/v1/control/approvals/${approvalId}/${decision}`, { method: 'POST', body: JSON.stringify({ schemaVersion: 1 }) });
}
