const $ = (id) => document.getElementById(id);
let refreshToken = 0;

function setMessage(id, text, kind = '') {
  const node = $(id); node.textContent = text || ''; node.className = `message ${kind}`.trim();
}

function render(enrollment, worker) {
  const enrolled = enrollment?.ok === true && enrollment?.enrolled === true;
  const hubConfigured = enrollment?.hubConfigured === true;
  const ready = enrolled && hubConfigured;
  $('agent-dot').className = `status-dot ${ready ? 'ready' : hubConfigured ? 'attention' : 'checking'}`;
  $('agent-title').textContent = ready ? 'เครื่องนี้พร้อมทำงานกับ AWH' : hubConfigured ? 'เชื่อมต่อเครื่องนี้กับ AWH' : 'AWH Agent รอการตั้งค่าระบบ';
  $('agent-summary').textContent = ready
    ? 'ใช้งาน AWH ผ่านเว็บได้ตามปกติ Agent จะทำงานบนเครื่องนี้เฉพาะเมื่อมีคำสั่งและสิทธิ์ที่อนุญาต'
    : hubConfigured ? 'เข้าสู่ระบบหนึ่งครั้งเพื่อให้ AWH รู้จักเครื่องนี้' : 'ยังไม่พบ AWH Server ที่กำหนดไว้ในเครื่องนี้';
  $('hub-status').textContent = ready ? 'เชื่อมต่อแล้ว' : hubConfigured ? 'พร้อมให้เชื่อมต่อ' : 'ยังไม่ได้ตั้งค่า';
  $('device-name').textContent = enrollment?.displayName || worker?.device?.displayName || 'เครื่องนี้';
  $('worker-status').textContent = worker?.enabled === true ? (worker?.running === true ? 'กำลังทำงาน' : 'พร้อมเมื่อมีคำสั่ง') : 'หยุดอยู่';
  $('open-awh').disabled = !hubConfigured;
  $('login-form').hidden = enrolled || !hubConfigured;
  $('account-details').hidden = !enrolled;
  if (enrolled) { $('password').value = ''; setMessage('login-message', ''); }
}

async function refresh() {
  const token = ++refreshToken;
  $('refresh-status').disabled = true;
  try {
    const [enrollmentResult, workerResult] = await Promise.allSettled([
      window.awhConnect.getEnrollmentState(),
      window.awhConnect.getWorkerState(),
    ]);
    if (token !== refreshToken) return;
    const enrollment = enrollmentResult.status === 'fulfilled' ? enrollmentResult.value : { ok: false, hubConfigured: false };
    const worker = workerResult.status === 'fulfilled' ? workerResult.value : { enabled: false, running: false };
    render(enrollment, worker);
  } finally { if (token === refreshToken) $('refresh-status').disabled = false; }
}

$('open-awh').addEventListener('click', async () => {
  $('open-awh').disabled = true; setMessage('open-message', 'กำลังเปิด AWH…');
  try {
    const result = await window.awhConnect.openAwhWeb();
    setMessage('open-message', result?.message || (result?.ok ? 'เปิด AWH แล้ว' : 'ยังเปิด AWH ไม่ได้'), result?.ok ? 'success' : 'error');
  } catch { setMessage('open-message', 'ยังเปิด AWH ไม่ได้ กรุณาตรวจการเชื่อมต่อ', 'error'); }
  finally { $('open-awh').disabled = false; }
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

$('logout-button').addEventListener('click', async () => {
  if (!window.confirm('ออกจากระบบ AWH บนเครื่องนี้ใช่หรือไม่?')) return;
  $('logout-button').disabled = true;
  try { await window.awhConnect.logout(); await refresh(); }
  finally { $('logout-button').disabled = false; }
});

$('refresh-status').addEventListener('click', () => { void refresh(); });
window.addEventListener('focus', () => { void refresh(); });
void refresh();
