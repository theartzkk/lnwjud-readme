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
  $('connection-status').textContent = worker?.connection === 'CONNECTED' ? 'Connected' : worker?.connection === 'OFFLINE' ? 'Offline' : 'กำลังตรวจ';
}

function renderActivity(payload) {
  const list = $('activity-list'); list.replaceChildren();
  const rows = Array.isArray(payload?.recent) ? payload.recent.slice(-8).reverse() : [];
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
    ['Agent',`${health.agent?.state||'UNKNOWN'} · ${health.agent?.version||'—'}`],
    ['Connection',health.connection?.state||'UNKNOWN'],
    ['Runtime',`${health.runtime?.state||'UNKNOWN'}${health.runtime?.version?' · '+health.runtime.version:''}`],
    ['Permissions',health.permissions?.ready===true?'READY':`ขาด ${(health.permissions?.missing||[]).length} รายการ`],
    ['Tool Fabric',`${health.toolFabric?.state||'UNKNOWN'} · ${health.toolFabric?.stableCapabilityCount||0} capability`],
    ['Update',`${health.update?.channel||'stable'} · ${health.update?.state||'UNKNOWN'}${health.update?.candidateVersion?' → '+health.update.candidateVersion:''}`],
    ['Update result',health.update?.lastResult?.state ? `${health.update.lastResult.state}${health.update.lastResult.reason?' · '+health.update.lastResult.reason:''}` : '—'],
    ['Last error',health.lastError||health.update?.error||'ไม่มี'],
  ];
  for(const [label,value] of rows){const row=document.createElement('div');row.className='health-row';const l=document.createElement('span');l.textContent=label;const v=document.createElement('strong');v.textContent=value;row.append(l,v);grid.append(row);}
  $('install-update').disabled = health.update?.state !== 'AVAILABLE';
  $('install-update').textContent = health.update?.candidateVersion ? `ติดตั้ง ${health.update.candidateVersion}` : 'ติดตั้งอัปเดต';
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
  renderMode(worker);
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
    render(enrollment, worker, permissions);
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
  catch { setMessage('mode-message', 'ยังหยุดงานไม่ได้ กรุณาลอง hotkey ⌘/Ctrl + Shift + F12', 'error'); }
  finally { $('emergency-stop').disabled = false; await refresh(); }
});
$('refresh-activity').addEventListener('click', () => { void refresh(); });
$('refresh-health').addEventListener('click', () => { void refresh(); });
$('check-update').addEventListener('click', async () => {
  const button=$('check-update');button.disabled=true;setMessage('update-message','กำลังตรวจอัปเดต…');
  try{const result=await window.awhConnect.checkUpdate();if(result?.ok&&result.state==='AVAILABLE')setMessage('update-message',`มีอัปเดต ${result.candidate?.version||''} พร้อมติดตั้ง`,'success');else if(result?.ok)setMessage('update-message','AWH Agent เป็นเวอร์ชันล่าสุดแล้ว','success');else setMessage('update-message','ยังตรวจอัปเดตไม่ได้','error');}
  catch{setMessage('update-message','ยังตรวจอัปเดตไม่ได้','error');}
  finally{button.disabled=false;await refresh();}
});
$('install-update').addEventListener('click', async () => {
  const button=$('install-update');button.disabled=true;$('check-update').disabled=true;setMessage('update-message','กำลังดาวน์โหลด ตรวจสอบ และเตรียมอัปเดต…');
  try{const result=await window.awhConnect.installUpdate();if(result?.ok)setMessage('update-message',`กำลังติดตั้ง ${result.version||'เวอร์ชันใหม่'} และจะเปิด AWH Agent ใหม่อัตโนมัติ`,'success');else setMessage('update-message',result?.message||'ยังติดตั้งอัปเดตไม่ได้','error');}
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
