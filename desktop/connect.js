const $ = (id) => document.getElementById(id);
let refreshToken = 0;

function setMessage(id, text, kind = '') {
  const node = $(id); node.textContent = text || ''; node.className = `message ${kind}`.trim();
}

function permissionEntry(label, ok, detail) {
  const row = document.createElement('div'); row.className = 'permission-row';
  const copy = document.createElement('div');
  const title = document.createElement('strong'); title.textContent = label;
  const sub = document.createElement('span'); sub.textContent = detail;
  const state = document.createElement('b'); state.className = ok ? 'permission-ok' : 'permission-missing'; state.textContent = ok ? 'พร้อม' : 'ต้องอนุญาต';
  copy.append(title, sub); row.append(copy, state); return row;
}

function renderPermissions(permissions, enrolled) {
  const card = $('permission-card');
  const ready = permissions?.ready === true;
  card.hidden = !enrolled || ready;
  $('permission-badge').textContent = ready ? 'READY' : 'REQUIRED';
  $('permission-badge').className = `permission-badge ${ready ? 'ready' : 'required'}`;
  if (!enrolled) return;
  const runtime = permissions?.runtime;
  const automationReady = permissions?.setupVersion === 1;
  const list = $('permission-list'); list.replaceChildren();
  if (permissions?.platform === 'darwin') {
    list.append(
      permissionEntry('Accessibility', runtime?.accessibility === true, 'คลิก พิมพ์ และควบคุมหน้าต่าง'),
      permissionEntry('Screen Recording', runtime?.screenCapture === 'granted', 'มองเห็นหน้าจอและตรวจงานภาพ'),
      permissionEntry('Microphone', runtime?.microphone === 'granted', 'งานเสียงที่สั่งให้ AWH ทำ'),
      permissionEntry('Automation', automationReady, 'ควบคุม System Events และแอปที่รองรับ'),
    );
  }
  list.append(permissionEntry('AWH Full Device Control', permissions?.internalReady === true, 'Write · Execute · Codex · Worker'));
  $('authorize-permissions').disabled = ready;
  $('open-permission-settings').disabled = ready || permissions?.platform !== 'darwin';
}

function render(enrollment, worker, permissions) {
  const enrolled = enrollment?.ok === true && enrollment?.enrolled === true;
  const hubConfigured = enrollment?.hubConfigured === true;
  const permissionReady = permissions?.ready === true;
  const ready = enrolled && hubConfigured && permissionReady;
  $('agent-dot').className = `status-dot ${ready ? 'ready' : hubConfigured ? 'attention' : 'checking'}`;
  $('agent-title').textContent = ready ? 'เครื่องนี้พร้อมทำงานกับ AWH' : enrolled && !permissionReady ? 'อนุญาตสิทธิ์ให้ครบก่อนใช้งาน' : hubConfigured ? 'เชื่อมต่อเครื่องนี้กับ AWH' : 'AWH Agent รอการตั้งค่าระบบ';
  $('agent-summary').textContent = ready
    ? 'AWH Agent พร้อมรับงาน ควบคุมเครื่อง และใช้เครื่องมือที่ติดตั้งไว้บนอุปกรณ์นี้'
    : enrolled && !permissionReady ? 'ระบบจะยังไม่รับงานหรือควบคุมเครื่องจนกว่าจะอนุญาตสิทธิ์ที่จำเป็นครบ'
    : hubConfigured ? 'เข้าสู่ระบบหนึ่งครั้งเพื่อให้ AWH รู้จักเครื่องนี้' : 'ยังไม่พบ AWH Server ที่กำหนดไว้ในเครื่องนี้';
  $('hub-status').textContent = enrolled && hubConfigured ? 'เชื่อมต่อแล้ว' : hubConfigured ? 'พร้อมให้เชื่อมต่อ' : 'ยังไม่ได้ตั้งค่า';
  $('device-name').textContent = enrollment?.displayName || worker?.device?.displayName || 'เครื่องนี้';
  $('worker-status').textContent = !permissionReady ? 'รอสิทธิ์ระบบ' : worker?.enabled === true ? (worker?.running === true ? 'กำลังทำงาน' : 'พร้อมเมื่อมีคำสั่ง') : 'หยุดอยู่';
  const remote = worker?.remoteDesktop;
  $('remote-status').textContent = !permissionReady ? 'รอสิทธิ์ระบบ' : remote?.state === 'READY'
    ? 'พร้อมใช้งาน'
    : remote?.state === 'AUTHORIZATION_REQUIRED'
      ? 'อนุมัติครั้งแรกใน Browser'
      : remote?.state === 'STARTING' ? 'กำลังเชื่อมต่อ' : 'ยังไม่พร้อม';
  $('open-awh').disabled = !hubConfigured || !permissionReady;
  $('login-form').hidden = enrolled || !hubConfigured;
  $('manage-device').disabled = !hubConfigured || !permissionReady;
  renderPermissions(permissions, enrolled);
  if (enrolled) { $('password').value = ''; setMessage('login-message', ''); }
}

async function refresh() {
  const token = ++refreshToken;
  $('refresh-status').disabled = true;
  try {
    const [enrollmentResult, workerResult, permissionResult] = await Promise.allSettled([
      window.awhConnect.getEnrollmentState(),
      window.awhConnect.getWorkerState(),
      window.awhConnect.getPermissionState(),
    ]);
    if (token !== refreshToken) return;
    const enrollment = enrollmentResult.status === 'fulfilled' ? enrollmentResult.value : { ok: false, hubConfigured: false };
    const worker = workerResult.status === 'fulfilled' ? workerResult.value : { enabled: false, running: false };
    const permissions = permissionResult.status === 'fulfilled' ? permissionResult.value : { ready: false, platform: 'unknown', internalReady: false, runtime: null };
    render(enrollment, worker, permissions);
  } finally { if (token === refreshToken) $('refresh-status').disabled = false; }
}

async function openWeb(target) {
  const button = target === 'devices' ? $('manage-device') : $('open-awh');
  button.disabled = true; setMessage('open-message', target === 'devices' ? 'กำลังเปิดศูนย์จัดการอุปกรณ์…' : 'กำลังเปิด AWH…');
  try {
    const result = await window.awhConnect.openAwhWeb(target);
    setMessage('open-message', result?.message || (result?.ok ? 'เปิด AWH แล้ว' : 'ยังเปิด AWH ไม่ได้'), result?.ok ? 'success' : 'error');
  } catch { setMessage('open-message', 'ยังเปิด AWH ไม่ได้ กรุณาตรวจการเชื่อมต่อ', 'error'); }
  finally { button.disabled = false; }
}

$('open-awh').addEventListener('click', () => { void openWeb('home'); });
$('manage-device').addEventListener('click', () => { void openWeb('devices'); });
$('authorize-permissions').addEventListener('click', async () => {
  const authorize = $('authorize-permissions');
  const settings = $('open-permission-settings');
  authorize.disabled = true;
  settings.disabled = true;
  setMessage('permission-message', 'กำลังขอสิทธิ์จาก macOS ให้ครบ กรุณากดอนุญาตในหน้าต่างที่ปรากฏ…');
  try {
    const result = await window.awhConnect.authorizePermissions();
    if (result?.ready === true) setMessage('permission-message', 'สิทธิ์ครบแล้ว AWH Agent พร้อมใช้งาน', 'success');
    else setMessage('permission-message', 'ยังมีสิทธิ์บางรายการที่ต้องเปิดใน System Settings แล้วกลับมากด “ตรวจสถานะอีกครั้ง”', 'error');
  } catch {
    setMessage('permission-message', 'ยังขอสิทธิ์ไม่ครบ กรุณาเปิด System Settings แล้วอนุญาต AWH Device Runtime', 'error');
  } finally {
    await refresh();
  }
});
$('open-permission-settings').addEventListener('click', async () => {
  const button = $('open-permission-settings');
  button.disabled = true;
  try { await window.awhConnect.openPermissionSettings(''); }
  finally { setTimeout(() => { button.disabled = false; void refresh(); }, 1200); }
});

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = $('username').value.trim(); const password = $('password').value;
  if (!username || !password) { setMessage('login-message', 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน', 'error'); return; }
  $('login-button').disabled = true; setMessage('login-message', 'กำลังเชื่อมต่อเครื่องนี้…');
  try {
    const result = await window.awhConnect.login(username, password);
    if (result?.ok !== true) { setMessage('login-message', result?.message || 'เชื่อมต่อไม่สำเร็จ', 'error'); return; }
    setMessage('login-message', 'เชื่อมต่อแล้ว', 'success'); await refresh();
  } catch { setMessage('login-message', 'เชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง', 'error'); }
  finally { $('login-button').disabled = false; }
});

$('refresh-status').addEventListener('click', () => { void refresh(); });
window.addEventListener('focus', () => { void refresh(); });
void refresh();
