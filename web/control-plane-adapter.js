const MAX_JSON_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let csrfToken = null;

export function safeApiPath(path) {
  if (typeof path !== 'string' || path.length < 1 || path.length > 2048 || path.startsWith('//') || path.includes('#') || /%(?:2e|2f|5c)/i.test(path)) throw new Error('AWH control path is not safe');
  let value;
  try { value = new URL(path, 'https://awh.invalid'); } catch { throw new Error('AWH control path is not safe'); }
  if (value.origin !== 'https://awh.invalid' || (!value.pathname.startsWith('/api/v1/control/') && !value.pathname.startsWith('/api/v1/auth/')) || value.pathname.split('/').includes('..') || value.search.length > 1024) throw new Error('AWH control path is not safe');
  return `${value.pathname}${value.search}`;
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
    MEMORY_FORBIDDEN: 'ความจำนี้ไม่พร้อมใช้งานสำหรับบัญชีของคุณ',
    MEMORY_SENSITIVE_EXCLUDED: 'AWH ไม่เก็บข้อมูลลับหรือข้อมูลอ่อนไหวไว้ในความจำปกติ',
    MEMORY_NOT_FOUND: 'ไม่พบความจำที่ต้องการ',
  })[code] || 'AWH ไม่สามารถดำเนินการได้ในขณะนี้';
}

export async function controlRequest(path, init = {}, fetchImpl = globalThis.fetch) {
  const headers = new Headers(init.headers || {});
  headers.set('Accept', 'application/json');
  if (init.body !== undefined && !(typeof FormData !== 'undefined' && init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
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
export async function loadAuthProfile() { return controlRequest('/api/v1/auth/profile'); }
export async function updateAuthProfile(displayName) { if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 80) throw new Error('ชื่อที่แสดงไม่ถูกต้อง'); return controlRequest('/api/v1/auth/profile', { method: 'POST', body: JSON.stringify({ schemaVersion: 1, displayName: displayName.trim() }) }); }
export async function logout() { return controlRequest('/api/v1/auth/logout', { method: 'POST', body: JSON.stringify({ schemaVersion: 1 }) }); }
export async function logoutAll() { return controlRequest('/api/v1/auth/logout-all', { method: 'POST', body: JSON.stringify({ schemaVersion: 1 }) }); }
export async function changePassword(oldPassword, newPassword) { return controlRequest('/api/v1/auth/password', { method: 'POST', body: JSON.stringify({ schemaVersion: 1, oldPassword, newPassword }) }); }
export async function changeUsername(currentPassword, username) { return controlRequest('/api/v1/auth/identity', { method: 'POST', body: JSON.stringify({ schemaVersion: 1, currentPassword, username: username.trim() }) }); }
export async function stepUp(password) { if (typeof password !== 'string' || password.length < 1) throw new Error('กรุณากรอกรหัสผ่าน'); return controlRequest('/api/v1/auth/step-up', { method: 'POST', body: JSON.stringify({ schemaVersion: 1, password }) }); }
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
  return { mode: 'CONTROL', authenticated: true, expiresAt: session.expiresAt, role: typeof session.role === 'string' ? session.role : null, projects: projects.projects.filter((project) => UUID.test(project.projectId)), tasks: Array.isArray(tasks.tasks) ? tasks.tasks : [], workers: Array.isArray(workers.workers) ? workers.workers : [], results: Array.isArray(results.results) ? results.results : [], artifacts: Array.isArray(artifacts.artifacts) ? artifacts.artifacts : [], approvals: Array.isArray(approvals.approvals) ? approvals.approvals : [] };
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
  if (![2, 3].includes(value.schemaVersion) || !value.conversation || !Array.isArray(value.messages) || !Array.isArray(value.tasks) || !Array.isArray(value.artifacts) || !Array.isArray(value.attachments) || !Array.isArray(value.approvals)) throw new Error('ประวัติการทำงานของ AWH ไม่ถูกต้อง');
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
const PRODUCT_SETTING_KEYS = ['productName', 'shortName', 'tagline', 'accent', 'welcome', 'starterPrompts', 'founderName', 'founderCredit'];
export async function loadProductSettingHistory(settingKey) { if (!PRODUCT_SETTING_KEYS.includes(settingKey)) throw new Error('การตั้งค่าไม่ถูกต้อง'); return controlRequest(`/api/v1/control/settings/history?settingKey=${encodeURIComponent(settingKey)}`); }
export async function resetProductSetting(settingKey) { if (!PRODUCT_SETTING_KEYS.includes(settingKey)) throw new Error('การตั้งค่าไม่ถูกต้อง'); return controlRequest('/api/v1/control/settings/reset', { method: 'POST', body: JSON.stringify({ schemaVersion: 2, settingKey }) }); }
export async function loadProductIdentity() { return controlRequest('/api/v1/control/product-identity'); }
export async function loadMemory({ projectId = null, scope = 'all', query = '' } = {}) {
  if (!['all', 'owner', 'constitution', 'project', 'archive'].includes(scope) || typeof query !== 'string' || query.length > 120 || (projectId !== null && !UUID.test(projectId))) throw new Error('ความจำของ AWH ไม่ถูกต้อง');
  if (scope === 'project' && projectId === null) throw new Error('เลือกโปรเจกต์ก่อนดูความจำของโปรเจกต์');
  const params = new URLSearchParams({ scope });
  if (projectId !== null) params.set('projectId', projectId);
  if (query.trim()) params.set('q', query.trim());
  const value = await controlRequest('/api/v1/control/memory?' + params.toString());
  if (value.schemaVersion !== 1 || !Array.isArray(value.memories)) throw new Error('ข้อมูลความจำของ AWH ไม่ถูกต้อง');
  return value;
}
export async function loadMemoryImportReport() { return controlRequest('/api/v1/control/memory/imports'); }
export async function updateMemory(memoryId, action, { content = null, tags = null, pinned = null } = {}) {
  if (!UUID.test(memoryId) || !['EDIT', 'PIN', 'FORGET', 'SHARE', 'UNSHARE', 'MARK_OUTDATED'].includes(action)) throw new Error('การเปลี่ยนความจำไม่ถูกต้อง');
  return controlRequest('/api/v1/control/memory', { method: 'POST', body: JSON.stringify({ schemaVersion: 1, memoryId, action, content, tags, sharingPolicy: null, pinned }) });
}
export async function createMemory({ scope, projectId = null, category, content, tags = [] }) {
  if (!['owner', 'constitution', 'project'].includes(scope) || (scope === 'project' && !UUID.test(projectId)) || (scope !== 'project' && projectId !== null) || typeof category !== 'string' || !/^[A-Z][A-Z0-9_]{2,47}$/.test(category) || typeof content !== 'string' || !content.trim() || content.length > 2000 || !Array.isArray(tags)) throw new Error('ความจำของ AWH ไม่ถูกต้อง');
  return controlRequest('/api/v1/control/memory/create', { method: 'POST', body: JSON.stringify({ schemaVersion: 1, scope, projectId, category, content: content.trim(), tags }) });
}
export async function exportWorkspace() { return controlRequest('/api/v1/control/export'); }
export async function loadProviderStatus() { return controlRequest('/api/v1/control/provider'); }
export async function updateProviderPolicy(policy) { return controlRequest('/api/v1/control/provider', { method: 'POST', body: JSON.stringify(policy) }); }
export async function updateProviderCredential(action, secret = null) { if (!['SET', 'REMOVE'].includes(action) || (action === 'SET' && (typeof secret !== 'string' || !secret.trim() || secret.length > 512)) || (action === 'REMOVE' && secret !== null)) throw new Error('การตั้งค่า credential ไม่ถูกต้อง'); return controlRequest('/api/v1/control/provider/credential', { method: 'POST', body: JSON.stringify({ schemaVersion: 1, action, secret: action === 'SET' ? secret.trim() : null }) }); }
export async function testProviderConnection() { return controlRequest('/api/v1/control/provider/test', { method: 'POST', body: JSON.stringify({ schemaVersion: 1 }) }); }
export async function loadProviderProjectRouting(projectId) { if (!UUID.test(projectId)) throw new Error('โปรเจกต์ไม่ถูกต้อง'); const value = await controlRequest(`/api/v1/control/provider/projects/${projectId}`); if (value.schemaVersion !== 1 || !value.routing || typeof value.routing !== 'object') throw new Error('การกำหนด AI ของโปรเจกต์ไม่ถูกต้อง'); return value.routing; }
export async function updateProviderProjectRouting(projectId, routingMode) { if (!UUID.test(projectId) || !['AUTO', 'FAST', 'BALANCED', 'STRONG'].includes(routingMode)) throw new Error('การกำหนด AI ของโปรเจกต์ไม่ถูกต้อง'); const value = await controlRequest('/api/v1/control/provider/project', { method: 'POST', body: JSON.stringify({ schemaVersion: 1, projectId, routingMode }) }); if (value.schemaVersion !== 1 || !value.routing || typeof value.routing !== 'object') throw new Error('การกำหนด AI ของโปรเจกต์ไม่ถูกต้อง'); return value.routing; }
export async function loadOwnerSelfServiceStatus() { return controlRequest('/api/v1/control/owner/status'); }
export async function listPeople() { return controlRequest('/api/v1/auth/people'); }
export async function invitePerson({ displayName, username, email = null, role, projectIds }) { return controlRequest('/api/v1/auth/people/invite', { method: 'POST', body: JSON.stringify({ displayName, username, email, role, projectIds }) }); }
export async function revokePerson(userId) { if (!UUID.test(userId)) throw new Error('บัญชีไม่ถูกต้อง'); return controlRequest(`/api/v1/auth/people/${userId}/revoke`, { method: 'POST', body: JSON.stringify({ schemaVersion: 1 }) }); }

export async function loadWorkspaceContinuity(projectId) {
  if (!UUID.test(projectId)) throw new Error('โปรเจกต์ไม่ถูกต้อง');
  const value = await controlRequest(`/api/v1/control/workspaces/${projectId}`);
  if (value.schemaVersion !== 1 || !value.workspace || typeof value.workspace !== 'object' || Array.isArray(value.workspace)) throw new Error('สถานะ workspace ไม่ถูกต้อง');
  return value.workspace;
}

export async function uploadConversationAttachments(conversationId, files) {
  if (!UUID.test(conversationId) || !Array.isArray(files) || files.length < 1 || files.length > 8) throw new Error('ไฟล์แนบไม่ถูกต้อง');
  const maxBytes = 60 * 1024 * 1024;
  let totalBytes = 0;
  const form = new FormData();
  for (const file of files) {
    if (!(file instanceof File) || file.size < 1 || file.size > maxBytes) throw new Error('ไฟล์แนบมีขนาดไม่ถูกต้อง');
    totalBytes += file.size;
    if (totalBytes > maxBytes) throw new Error('ไฟล์แนบรวมกันได้ไม่เกิน 60 MB');
    form.append('attachments[]', file, file.name);
  }
  const value = await controlRequest(`/api/v1/control/conversations/thread/${conversationId}/attachments`, { method: 'POST', body: form });
  if (value.schemaVersion !== 3 || !Array.isArray(value.attachments)) throw new Error('AWH ไม่สามารถรับไฟล์แนบได้');
  return value.attachments;
}

export async function submitWorkMessage(projectId, conversationId, message, attachmentIds = [], idempotencyKey = `web-${crypto.randomUUID()}`) {
  if (!UUID.test(projectId) || !UUID.test(conversationId) || typeof message !== 'string' || !message.trim() || message.length > 2000 || !/^[A-Za-z0-9._-]{8,120}$/.test(idempotencyKey)) throw new Error('กรุณาเลือกโปรเจกต์และบอกสิ่งที่อยากให้ AWH ช่วย');
  if (!Array.isArray(attachmentIds) || attachmentIds.length > 8 || attachmentIds.some((id) => !UUID.test(id))) throw new Error('ไฟล์แนบไม่ถูกต้อง');
  const value = await controlRequest('/api/v1/control/conversations', { method: 'POST', body: JSON.stringify({ schemaVersion: 3, projectId, conversationId, message: message.trim(), attachmentIds, idempotencyKey }) });
  if (value.schemaVersion !== 3 || !Array.isArray(value.messages) || !Array.isArray(value.tasks) || !Array.isArray(value.attachments)) throw new Error('AWH ไม่สามารถบันทึกการสนทนาได้');
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
