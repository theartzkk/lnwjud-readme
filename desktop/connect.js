const $ = (id) => document.getElementById(id);
let refreshToken = 0;
let currentPermissionPlatform = 'unknown';

function setMessage(id, text, kind = '') {
  const node = $(id); node.textContent = text || ''; node.className = `message ${kind}`.trim();
}

function permissionEntry(label, ok, detail, missingLabel = 'ต้องอนุญาต') {
  const row = document.createElement('div'); row.className = 'permission-row';
  const copy = document.createElement('div');
  const title = document.createElement('strong'); title.textContent = label;
  const sub = document.createElement('span'); sub.textContent = detail;
  const state = document.createElement('b'); state.className = ok ? 'permission-ok' : 'permission-missing'; state.textContent = ok ? 'พร้อม' : missingLabel;
  copy.append(title, sub); row.append(copy, state); return row;
}

function renderPermissions(permissions, enrolled) {
  const card = $('permission-card');
  const ready = permissions?.ready === true;
  const platform = permissions?.platform || 'unknown';
  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';
  currentPermissionPlatform = platform;
  card.hidden = !enrolled || ready;
  $('permission-badge').textContent = ready ? 'READY' : isWindows ? 'SETUP' : 'REQUIRED';
  $('permission-badge').className = `permission-badge ${ready ? 'ready' : 'required'}`;
  $('permission-eyebrow').textContent = isMac ? 'MACOS PERMISSIONS' : isWindows ? 'WINDOWS DEVICE CONTROL' : 'DEVICE SETUP';
  $('permission-title').textContent = isMac ? 'อนุญาตสิทธิ์ macOS ให้ครบ' : isWindows ? 'เปิดการควบคุมเครื่องให้พร้อม' : 'เตรียมสิทธิ์การควบคุมเครื่อง';
  $('permission-copy').textContent = isMac
    ? 'AWH จะยังไม่รับงานที่ต้องควบคุมหน้าจอจนกว่า Accessibility และ Screen Recording จะพร้อม ครั้งต่อไปจะไม่ถามซ้ำหาก macOS ยังอนุญาตอยู่'
    : isWindows
      ? 'Windows ไม่ต้องเปิด Accessibility หรือ Screen Recording แบบ macOS เพียงเปิด AWH Full Device Control เพื่อให้ Agent เขียนไฟล์ รันงาน ใช้ Codex และรับงาน Worker ได้'
      : 'AWH จะยังไม่รับงานหรือควบคุมเครื่องจนกว่าสิทธิ์ที่จำเป็นจะพร้อมครบ';
  $('authorize-permissions').textContent = isMac ? 'อนุญาตทั้งหมด' : isWindows ? 'เปิดการควบคุมเครื่อง' : 'เตรียมเครื่อง';
  const settings = $('open-permission-settings');
  settings.hidden = !isMac;
  settings.disabled = ready || !isMac;
  $('emergency-shortcut').textContent = `Emergency hotkey: ${isMac ? '⌘ + Shift + F12' : 'Ctrl + Shift + F12'}`;
  if (!enrolled) return;
  const runtime = permissions?.runtime;
  const list = $('permission-list'); list.replaceChildren();
  if (isMac) {
    list.append(
      permissionEntry('Accessibility', runtime?.accessibility === true, 'คลิก พิมพ์ และควบคุมหน้าต่าง'),
      permissionEntry('Screen Recording', runtime?.screenCapture === 'granted', 'มองเห็นหน้าจอและตรวจงานภาพ'),
    );
  }
  list.append(permissionEntry(
    'AWH Full Device Control',
    permissions?.internalReady === true,
    'Write · Execute · Codex · Worker',
    isWindows ? 'ต้องเปิดใช้' : 'ต้องอนุญาต',
  ));
  $('authorize-permissions').disabled = ready;
}

function activityLabel(value) {
  return ({IDLE:'ว่าง',READING_FILES:'กำลังอ่านไฟล์',CHECKING_WEBSITE:'กำลังตรวจเว็บไซต์',USING_CHROME:'กำลังใช้ Chrome',USING_ADOBE:'กำลังทำงานใน Adobe',EXPORTING:'กำลัง Export',UPDATING_TOOL_PACK:'กำลังอัปเดต Tool Pack',RUNNING_PROCESS:'กำลังรันงานเบื้องหลัง',OTHER:'กำลังทำงาน'})[value] || 'กำลังทำงาน';
}

function renderMode(worker) {
  const mode = ['OFF','ON','LIVE'].includes(worker?.mode) ? worker.mode : 'OFF';
  $('mode-badge').textContent = mode;
  $('mode-badge').className = `mode-badge ${mode.toLowerCase()}`;
  $('mode-status').textContent = mode;
  for (const value of ['off','on','live']) $('mode-'+value).classList.toggle('active', mode === value.toUpperCase());
  const activity = worker?.activity || {activity:'IDLE',foreground:false};
  $('activity-status').textContent = mode === 'LIVE' && activity.foreground ? `LIVE · ${activityLabel(activity.activity)}` : activityLabel(activity.activity);
  const remote = worker?.remoteRuntime;
  $('connection-status').textContent = remote?.connected === true ? 'Connected' : remote ? 'Offline' : worker?.connection === 'CONNECTED' ? 'Connected' : worker?.connection === 'OFFLINE' ? 'Offline' : 'กำลังตรวจ';
}

function renderActivity(payload) {
  const list = $('activity-list'); list.replaceChildren();
  const rows = Array.isArray(payload?.recent) ? payload.recent.slice(-4).reverse() : [];
  if (!rows.length) { const p=document.createElement('p');p.className='activity-empty';p.textContent='ยังไม่มีกิจกรรม';list.append(p);return; }
  for (const row of rows) {
    const item=document.createElement('div');item.className='activity-item';
    const top=document.createElement('div'); const time=document.createElement('strong'); time.textContent=new Date(row.at).toLocaleString('th-TH',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'}); const state=document.createElement('b');state.textContent=row.outcome;top.append(time,state);
    const meta=document.createElement('span');meta.textContent=`${row.source} · ${row.capability}${row.provider?' · '+row.provider:''} · ${row.plane} · ${row.mode}`;
    item.append(top,meta);list.append(item);
  }
}

function renderHealth(health) {
  const grid=$('health-grid');grid.replaceChildren();
  if(!health){const p=document.createElement('p');p.className='activity-empty';p.textContent='ยังตรวจสุขภาพไม่ได้';grid.append(p);return;}
  const rows=[
    ['Agent',health.agent?.state||'UNKNOWN'],
    ['Connection',health.connection?.state||'UNKNOWN'],
    ['Runtime',health.runtime?.state||'UNKNOWN'],
    ['Permissions',health.permissions?.ready===true?'READY':`ขาด ${(health.permissions?.missing||[]).length} รายการ`],
    ['Tool Fabric',`${health.toolFabric?.state||'UNKNOWN'} · ${health.toolFabric?.stableCapabilityCount||0} capability`],
    ['Update',`${health.update?.channel||'stable'} · ${health.update?.state||'UNKNOWN'}`],
    ['Update result',health.update?.lastResult?.state ? `${health.update.lastResult.state}${health.update.lastResult.reason?' · '+health.update.lastResult.reason:''}` : '—'],
    ['Last error',health.lastError||health.update?.error||'ไม่มี'],
  ];
  for(const [label,value] of rows){const row=document.createElement('div');row.className='health-row';const l=document.createElement('span');l.textContent=label;const v=document.createElement('strong');v.textContent=value;row.append(l,v);grid.append(row);}
  $('install-update').disabled = health.update?.state !== 'AVAILABLE';
  $('install-update').textContent = 'ติดตั้งอัปเดต';
}

function render(enrollment, worker, permissions, health) {
  const enrolled = enrollment?.ok === true && enrollment?.enrolled === true;
  const hubConfigured = enrollment?.hubConfigured === true;
  const permissionReady = permissions?.ready === true;
  const ready = enrolled && hubConfigured && permissionReady;
  document.body.classList.toggle('setup-required', enrolled && !permissionReady);
  document.body.classList.toggle('device-ready', ready);
  $('agent-dot').className = `status-dot ${ready ? 'ready' : hubConfigured ? 'attention' : 'checking'}`;
  $('agent-title').textContent = ready ? 'เครื่องนี้พร้อมทำงานกับ AWH' : enrolled && !permissionReady ? 'อนุญาตสิทธิ์ให้ครบก่อนใช้งาน' : hubConfigured ? 'เชื่อมต่อเครื่องนี้กับ AWH' : 'AWH Agent รอการตั้งค่าระบบ';
  $('agent-summary').textContent = ready
    ? 'AWH Agent พร้อมรับงาน ควบคุมเครื่อง และใช้เครื่องมือที่ติดตั้งไว้บนอุปกรณ์นี้'
    : enrolled && !permissionReady ? 'ระบบจะยังไม่รับงานหรือควบคุมเครื่องจนกว่าจะอนุญาตสิทธิ์ที่จำเป็นครบ'
    : hubConfigured ? 'เข้าสู่ระบบหนึ่งครั้งเพื่อให้ AWH รู้จักเครื่องนี้' : 'ยังไม่พบ AWH Server ที่กำหนดไว้ในเครื่องนี้';
  $('hub-status').textContent = enrolled && hubConfigured ? 'เชื่อมต่อแล้ว' : hubConfigured ? 'พร้อมให้เชื่อมต่อ' : 'ยังไม่ได้ตั้งค่า';
  $('device-name').textContent = enrollment?.displayName || worker?.device?.displayName || 'เครื่องนี้';
  renderMode(worker);
  $('worker-status').textContent = !permissionReady ? 'รอสิทธิ์ระบบ' : worker?.enabled === true ? (worker?.running === true ? 'กำลังทำงาน' : 'พร้อมเมื่อมีคำสั่ง') : 'หยุดอยู่';
  const runtime = health?.runtime;
  $('remote-status').textContent = !permissionReady ? 'รอสิทธิ์ระบบ' : runtime?.state === 'READY'
    ? 'พร้อมใช้งาน'
    : runtime?.state === 'FAILED' ? 'ต้องซ่อม Runtime' : 'กำลังตรวจ';
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
    const [enrollmentResult, workerResult, permissionResult, activityResult, healthResult] = await Promise.allSettled([
      window.awhConnect.getEnrollmentState(),
      window.awhConnect.getWorkerState(),
      window.awhConnect.getPermissionState(),
      window.awhConnect.getActivity(),
      window.awhConnect.getHealth(),
    ]);
    if (token !== refreshToken) return;
    const enrollment = enrollmentResult.status === 'fulfilled' ? enrollmentResult.value : { ok: false, hubConfigured: false };
    const worker = workerResult.status === 'fulfilled' ? workerResult.value : { enabled: false, running: false };
    const permissions = permissionResult.status === 'fulfilled' ? permissionResult.value : { ready: false, platform: 'unknown', internalReady: false, runtime: null };
    const activity = activityResult.status === 'fulfilled' ? activityResult.value : { recent: [] };
    const health = healthResult.status === 'fulfilled' ? healthResult.value : null;
    render(enrollment, worker, permissions, health);
    renderActivity(activity);
    renderHealth(health);
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

async function setMode(mode) {
  for (const id of ['mode-off','mode-on','mode-live','emergency-stop']) $(id).disabled = true;
  setMessage('mode-message', `กำลังเปลี่ยนเป็น ${mode}…`);
  try {
    const result = await window.awhConnect.setRuntimeMode(mode);
    setMessage('mode-message', result?.mode === mode ? `เปลี่ยนเป็น ${mode} แล้ว` : 'เปลี่ยนโหมดไม่สำเร็จ', result?.mode === mode ? 'success' : 'error');
  } catch { setMessage('mode-message', 'เปลี่ยนโหมดไม่สำเร็จ', 'error'); }
  finally { for (const id of ['mode-off','mode-on','mode-live','emergency-stop']) $(id).disabled = false; await refresh(); }
}

$('mode-off').addEventListener('click', () => { void setMode('OFF'); });
$('mode-on').addEventListener('click', () => { void setMode('ON'); });
$('mode-live').addEventListener('click', () => { void setMode('LIVE'); });
$('emergency-stop').addEventListener('click', async () => {
  $('emergency-stop').disabled = true;
  setMessage('mode-message', 'กำลังหยุด foreground control ทันที…');
  try { await window.awhConnect.emergencyStop(); setMessage('mode-message', 'หยุดงาน foreground แล้ว และเปลี่ยนเป็น OFF', 'success'); }
  catch { setMessage('mode-message', `ยังหยุดงานไม่ได้ กรุณาลอง hotkey ${currentPermissionPlatform === 'darwin' ? '⌘ + Shift + F12' : 'Ctrl + Shift + F12'}`, 'error'); }
  finally { $('emergency-stop').disabled = false; await refresh(); }
});
$('refresh-activity').addEventListener('click', () => { void refresh(); });
$('refresh-health').addEventListener('click', () => { void refresh(); });
$('check-update').addEventListener('click', async () => {
  const button=$('check-update');button.disabled=true;setMessage('update-message','กำลังตรวจอัปเดต…');
  try{const result=await window.awhConnect.checkUpdate();if(result?.ok&&result.state==='AVAILABLE')setMessage('update-message','มีอัปเดตพร้อมติดตั้ง','success');else if(result?.ok)setMessage('update-message','AWH Agent เป็นเวอร์ชันล่าสุดแล้ว','success');else setMessage('update-message','ยังตรวจอัปเดตไม่ได้','error');}
  catch{setMessage('update-message','ยังตรวจอัปเดตไม่ได้','error');}
  finally{button.disabled=false;await refresh();}
});
$('install-update').addEventListener('click', async () => {
  const button=$('install-update');button.disabled=true;$('check-update').disabled=true;setMessage('update-message','กำลังดาวน์โหลด ตรวจสอบ และเตรียมอัปเดต…');
  try{const result=await window.awhConnect.installUpdate();if(result?.ok)setMessage('update-message','กำลังติดตั้งอัปเดต และจะเปิด AWH Agent ใหม่อัตโนมัติ','success');else setMessage('update-message',result?.message||'ยังติดตั้งอัปเดตไม่ได้','error');}
  catch{setMessage('update-message','ยังติดตั้งอัปเดตไม่ได้ รุ่นปัจจุบันยังคงเดิม','error');}
  finally{if(document.body.isConnected){button.disabled=false;$('check-update').disabled=false;}}
});
$('export-diagnostics').addEventListener('click', async () => {
  const button=$('export-diagnostics');button.disabled=true;setMessage('diagnostics-message','กำลังสร้างรายงานที่ตัดข้อมูลอ่อนไหวออก…');
  try{const result=await window.awhConnect.exportDiagnostics();if(result?.cancelled)setMessage('diagnostics-message','ยกเลิกการสร้างรายงาน');else if(result?.ok)setMessage('diagnostics-message',`สร้าง ${result.fileName||'AWH Diagnostics'} แล้ว`,'success');else setMessage('diagnostics-message','สร้างรายงานไม่สำเร็จ','error');}
  catch{setMessage('diagnostics-message','สร้างรายงานไม่สำเร็จ','error');}
  finally{button.disabled=false;}
});

$('reinstall-runtime').addEventListener('click', async () => {
  const button=$('reinstall-runtime');button.disabled=true;setMessage('diagnostics-message','กำลังล้าง Runtime เก่า โดยเก็บ Device ID + Pairing ไว้…');
  try{const result=await window.awhConnect.reinstallRuntime();if(result?.ok)setMessage('diagnostics-message','Reinstall / Upgrade runtime ผ่านแล้ว Pairing เดิมยังอยู่','success');else setMessage('diagnostics-message',result?.message||'ยัง Reinstall ไม่ได้','error');}
  catch{setMessage('diagnostics-message','ยัง Reinstall ไม่ได้','error');}
  finally{button.disabled=false;await refresh();}
});
$('reset-device').addEventListener('click', async () => {
  const button=$('reset-device');button.disabled=true;setMessage('diagnostics-message','กำลังเตรียม Reset this device…');
  try{const result=await window.awhConnect.resetDevice();if(result?.cancelled)setMessage('diagnostics-message','ยกเลิก Reset');else if(result?.ok)setMessage('diagnostics-message',result.serverRevoked?'Reset แล้ว กำลังเริ่ม AWH Agent ใหม่':'Reset local แล้ว แต่ Hub revoke ยังไม่ยืนยัน กรุณา revoke เครื่องเก่าจากเว็บ','success');else setMessage('diagnostics-message',result?.message||'ยัง Reset ไม่ได้','error');}
  catch{setMessage('diagnostics-message','ยัง Reset ไม่ได้','error');}
  finally{button.disabled=false;}
});

$('open-awh').addEventListener('click', () => { void openWeb('home'); });
$('manage-device').addEventListener('click', () => { void openWeb('devices'); });
$('authorize-permissions').addEventListener('click', async () => {
  const authorize = $('authorize-permissions');
  const settings = $('open-permission-settings');
  const isMac = currentPermissionPlatform === 'darwin';
  const isWindows = currentPermissionPlatform === 'win32';
  authorize.disabled = true;
  settings.disabled = true;
  setMessage(
    'permission-message',
    isMac
      ? 'กำลังขอสิทธิ์จาก macOS ให้ครบ กรุณากดอนุญาตในหน้าต่างที่ปรากฏ…'
      : isWindows
        ? 'กำลังเปิด AWH Full Device Control บนเครื่องนี้…'
        : 'กำลังเตรียมสิทธิ์การควบคุมเครื่อง…',
  );
  try {
    const result = await window.awhConnect.authorizePermissions();
    if (result?.ready === true) setMessage('permission-message', 'AWH Agent พร้อมควบคุมเครื่องแล้ว', 'success');
    else if (isMac) setMessage('permission-message', 'ยังมีสิทธิ์ macOS ที่ต้องเปิดใน System Settings แล้วกลับมากด “ตรวจสถานะอีกครั้ง”', 'error');
    else setMessage('permission-message', 'ยังเปิดการควบคุมเครื่องไม่ครบ กรุณากด “ตรวจสถานะอีกครั้ง”', 'error');
  } catch {
    setMessage(
      'permission-message',
      isMac
        ? 'ยังขอสิทธิ์ไม่ครบ กรุณาเปิด System Settings แล้วอนุญาต AWH Device Runtime'
        : 'ยังเปิด AWH Full Device Control ไม่สำเร็จ กรุณาลองอีกครั้ง',
      'error',
    );
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
