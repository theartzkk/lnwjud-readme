import { loadAuthProfile, loadControlData, listPeople, loadDatabaseOverview } from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';

const $ = (id) => document.getElementById(id);
const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const VIEW_LABELS = {
  home: 'หน้าหลัก', chat: 'AI', tools: 'เครื่องมือ', files: 'ไฟล์', tasks: 'กล่องงาน',
  projects: 'โปรเจกต์', executions: 'การทำงาน', memory: 'Memory', devices: 'อุปกรณ์',
  automations: 'งานอัตโนมัติ', users: 'ผู้ใช้', database: 'ฐานข้อมูล', settings: 'ตั้งค่า',
};
const VIEW_FEATURE = {
  chat: 'ai.chat', files: 'files.use', tasks: 'tasks.use', projects: 'projects.use',
  devices: 'devices.use', automations: 'automations.use', users: 'users.manage',
};
const state = {
  mounted: false, view: 'home', control: null, profile: null, catalog: null,
  people: [], database: null, toolQuery: '', workspaceContext: null,
};

function normalizedRole(role) { return ({ COLLABORATOR: 'STAFF', APPROVER: 'DIRECTOR' })[role] || role; }
function roleLabel(role) {
  return ({ OWNER: 'Owner', ADMIN: 'ผู้ดูแลระบบ', DIRECTOR: 'ผู้อำนวยการ', TEACHER: 'ครู',
    STAFF: 'บุคลากร', VIEWER: 'ผู้ดู', COLLABORATOR: 'บุคลากร', APPROVER: 'ผู้อำนวยการ' })[role] || 'AWH';
}
function defaultFeatures(rawRole) {
  const role = normalizedRole(rawRole);
  const keys = ['ai.chat','tools.pdf','tools.image','documents.use','files.use','tasks.use','approvals.use',
    'projects.use','developer.use','devices.use','automations.use','users.manage','system.manage','database.view'];
  const out = Object.fromEntries(keys.map((key) => [key, false]));
  const enabled = role === 'OWNER' ? keys
    : role === 'ADMIN' ? ['ai.chat','tools.pdf','tools.image','documents.use','files.use','tasks.use','approvals.use','projects.use','automations.use','users.manage']
    : role === 'DIRECTOR' ? ['ai.chat','tools.pdf','tools.image','documents.use','files.use','tasks.use','approvals.use']
    : ['TEACHER','STAFF'].includes(role) ? ['ai.chat','tools.pdf','tools.image','documents.use','files.use','tasks.use']
    : ['files.use','tasks.use'];
  enabled.forEach((key) => { out[key] = true; });
  return out;
}
function features() {
  return state.profile?.features && typeof state.profile.features === 'object'
    ? state.profile.features : defaultFeatures(state.control?.role);
}
function feature(key) { return features()?.[key] === true; }
function isOwner() { return normalizedRole(state.control?.role) === 'OWNER'; }
function canManageUsers() { return isOwner() || (normalizedRole(state.control?.role) === 'ADMIN' && feature('users.manage')); }
function allowed(view) {
  if (['home','settings'].includes(view)) return true;
  if (view === 'tools') return feature('tools.pdf') || feature('tools.image') || feature('developer.use');
  if (['memory','executions','database'].includes(view)) return isOwner();
  const key = VIEW_FEATURE[view]; return key ? feature(key) : false;
}
function text(id, value) { const node = $(id); if (node) node.textContent = value; }
function empty(host, message) {
  if (!host) return; const p = document.createElement('p'); p.className = 'hub-empty'; p.textContent = message; host.append(p);
}
function card(title, copy = '') {
  const article = document.createElement('article'); article.className = 'hub-item-card';
  const strong = document.createElement('strong'); strong.textContent = title; article.append(strong);
  if (copy) { const p = document.createElement('p'); p.textContent = copy; article.append(p); }
  return article;
}
function actionCard(title, copy, view) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'hub-action-card';
  const strong = document.createElement('strong'); strong.textContent = title;
  const span = document.createElement('span'); span.textContent = copy;
  button.append(strong, span); button.addEventListener('click', () => activate(view)); return button;
}
function stateLabel(value) {
  return ({ QUEUED:'รอเริ่ม', WAITING_FOR_WORKER:'รอเครื่องที่เหมาะสม', PREPARING:'กำลังเตรียม', RUNNING:'กำลังทำ',
    QA:'กำลังตรวจ', WAITING_FOR_APPROVAL:'รออนุมัติ', COMPLETED:'เสร็จแล้ว', FAILED:'ต้องตรวจสอบ', CANCELLED:'ยกเลิกแล้ว',
    WAITING_FOR_CAPABILITY:'รอความสามารถที่จำเป็น' })[value] || 'กำลังอัปเดต';
}
function navButton(view, icon) {
  return `<button type="button" data-hub-view="${view}"><span>${icon}</span><b>${VIEW_LABELS[view]}</b></button>`;
}
function shellMarkup() {
  const primary = [['home','⌂'],['chat','✦'],['tools','⌘'],['files','▱'],['tasks','✓']].map(([v,i]) => navButton(v,i)).join('');
  const owner = [['projects','◫'],['executions','↻'],['memory','◇'],['devices','▣'],['automations','⟳']].map(([v,i]) => navButton(v,i)).join('');
  const system = [['users','◎'],['database','▤'],['settings','⚙']].map(([v,i]) => navButton(v,i)).join('');
  return `<aside class="hub-sidebar">
    <div class="hub-identity"><span class="hub-avatar">A</span><div><strong id="hub-user-name">AWH</strong><span id="hub-role-badge">Workspace</span></div></div>
    <nav class="hub-nav" aria-label="เมนูหลัก AWH">
      <div class="hub-nav-group" data-hub-nav-group="primary"><small>WORKSPACE</small>${primary}</div>
      <div class="hub-nav-group" data-hub-nav-group="owner"><small>OWNER WORKSPACE</small>${owner}</div>
      <div class="hub-nav-group" data-hub-nav-group="system"><small>SYSTEM</small>${system}</div>
    </nav><div class="hub-sidebar-foot"><i></i><span>Art’s Workspace Hub</span></div>
  </aside><div class="hub-stage">
    <header class="hub-topbar"><div><p>ART'S WORKSPACE HUB</p><h1 id="hub-page-heading">หน้าหลัก</h1></div><button id="hub-account-button" type="button" aria-label="บัญชีและความปลอดภัย">A</button></header>
    <section class="hub-page" data-hub-page="home">
      <div class="hub-welcome"><div><small id="hub-home-kicker">WELCOME</small><h2 id="hub-greeting">พร้อมทำงานต่อ</h2><p id="hub-home-copy">เปิด AWH แล้วเลือกหรือพิมพ์สิ่งที่ต้องการ ระบบจะพาไปยังงานที่เหมาะสม</p></div></div>
      <form id="hub-command-form" class="hub-command" role="search"><span aria-hidden="true">⌘</span><input id="hub-command-input" autocomplete="off" maxlength="500" placeholder="พิมพ์สิ่งที่ต้องการ…" /><button type="submit">ไป</button></form>
      <div id="hub-role-actions" class="hub-role-actions"></div>
      <div id="hub-metrics" class="hub-metrics"><article><span>โปรเจกต์</span><strong id="hub-metric-projects">0</strong><small>ที่เข้าถึงได้</small></article><article><span>งานกำลังทำ</span><strong id="hub-metric-active">0</strong><small>กำลังดำเนินการ</small></article><article><span>รออนุมัติ</span><strong id="hub-metric-approvals">0</strong><small>ต้องการการตัดสินใจ</small></article><article><span>ไฟล์ผลลัพธ์</span><strong id="hub-metric-files">0</strong><small>Artifacts</small></article></div>
      <div class="hub-grid"><section class="hub-card hub-card-wide"><header><div><small id="hub-home-primary-kicker">CONTINUE</small><h3 id="hub-home-primary-title">ทำงานต่อ</h3></div></header><div id="hub-home-primary-list" class="hub-list"></div></section><section class="hub-card"><header><div><small>INBOX</small><h3>สิ่งที่ควรดูตอนนี้</h3></div><button type="button" data-hub-view="tasks">เปิดกล่องงาน</button></header><div id="hub-home-inbox" class="hub-list"></div></section></div>
    </section>
    <section class="hub-page hub-chat-page" data-hub-page="chat" hidden></section>
    <section class="hub-page" data-hub-page="tools" hidden><div class="hub-section-intro"><div><small>TOOLS</small><h2>เครื่องมือ AWH</h2><p id="hub-tools-subtitle">เครื่องมือที่บัญชีนี้ใช้งานได้</p></div><input id="hub-tool-search" class="hub-search" maxlength="80" placeholder="ค้นหาเครื่องมือ…" /></div><div id="hub-tools-list" class="hub-tool-grid"></div></section>
    <section class="hub-page" data-hub-page="files" hidden><div class="hub-section-intro"><div><small>FILES</small><h2>ไฟล์และผลลัพธ์</h2><p>หาไฟล์ที่ AWH สร้างให้จากงานและโปรเจกต์ของคุณ</p></div></div><div id="hub-files-list" class="hub-card-grid"></div></section>
    <section class="hub-page" data-hub-page="tasks" hidden><div class="hub-section-intro"><div><small>INBOX</small><h2>กล่องงาน</h2><p>งานที่กำลังทำ งานเสร็จ และรายการที่ต้องอนุมัติอยู่ที่เดียว</p></div></div><div id="hub-tasks-list" class="hub-stack"></div></section>
    <section class="hub-page" data-hub-page="projects" hidden><div class="hub-section-intro"><div><small>PROJECTS</small><h2>โปรเจกต์</h2><p>งาน Source และบริบทของแต่ละโปรเจกต์อยู่ภายใต้ authority เดียวกัน</p></div><button id="hub-project-add" class="secondary-button" type="button">+ เพิ่ม / เลือกโปรเจกต์</button></div><div id="hub-projects-grid" class="hub-card-grid"></div></section>`;
}

function moreMarkup() {
  return `<section class="hub-page" data-hub-page="executions" hidden><div class="hub-section-intro"><div><small>EXECUTIONS</small><h2>การทำงานของ AWH</h2><p>ติดตามการทำงานจริงโดยไม่ต้องเปิด Terminal</p></div></div><div id="hub-executions-list" class="hub-stack"></div></section>
    <section class="hub-page" data-hub-page="memory" hidden><div class="hub-section-intro"><div><small>MEMORY</small><h2>ความจำของ Workspace</h2><p>ใช้เพื่อทำงานต่อเนื่อง โดย Source of Truth ปัจจุบันมีสิทธิ์เหนือความจำเสมอ</p></div><button id="hub-memory-manage" class="secondary-button" type="button">จัดการ Memory</button></div><div id="hub-memory-summary" class="hub-card"></div></section>
    <section class="hub-page" data-hub-page="devices" hidden><div class="hub-section-intro"><div><small>DEVICES</small><h2>เครื่องที่พร้อมทำงาน</h2><p>AWH จะแสดงความพร้อมตาม capability จริงของแต่ละเครื่อง</p></div><button id="hub-devices-manage" class="secondary-button" type="button">จัดการอุปกรณ์</button></div><div id="hub-devices-list" class="hub-card-grid"></div></section>
    <section class="hub-page" data-hub-page="automations" hidden><div class="hub-section-intro"><div><small>AUTOMATIONS</small><h2>งานอัตโนมัติ</h2><p>พื้นที่กลางสำหรับงานที่ทำซ้ำและงานตามเงื่อนไข โดยทุกครั้งต้องมี Execution record</p></div></div><div id="hub-automations-list" class="hub-card-grid"></div></section>
    <section class="hub-page" data-hub-page="users" hidden><div class="hub-section-intro"><div><small>USERS</small><h2>ผู้ใช้และสิทธิ์</h2><p>สร้างบัญชีแบบ Username/Email + Password และกำหนดสิทธิ์เท่าที่จำเป็น</p></div><button id="hub-users-manage" class="secondary-button" type="button">จัดการผู้ใช้</button></div><div id="hub-users-list" class="hub-stack"></div></section>
    <section class="hub-page" data-hub-page="database" hidden><div class="hub-section-intro"><div><small>DATABASE</small><h2>ศูนย์ฐานข้อมูล</h2><p>ตรวจสุขภาพ Schema และ Migration โดยไม่เปิด Raw SQL ในหน้าปกติ</p></div><button id="hub-database-refresh" class="secondary-button" type="button">ตรวจใหม่</button></div><div id="hub-database-health" class="hub-metrics hub-database-metrics"></div><div class="hub-grid"><section class="hub-card hub-card-wide"><header><div><small>TABLES</small><h3>ตารางข้อมูล</h3></div></header><div id="hub-database-tables" class="hub-database-table"></div></section><section class="hub-card"><header><div><small>MIGRATIONS</small><h3>ประวัติ Schema</h3></div></header><div id="hub-database-migrations" class="hub-list"></div></section></div><p class="hub-safety-note">การแก้ข้อมูลสำคัญจะต้องผ่าน Owner confirmation, backup, verify และ rollback reference ก่อนเสมอ</p></section>
    <section class="hub-page" data-hub-page="settings" hidden><div class="hub-section-intro"><div><small>SETTINGS</small><h2>ตั้งค่า AWH</h2><p>แสดงเฉพาะการตั้งค่าที่บัญชีนี้มีสิทธิ์ใช้งาน</p></div></div><div id="hub-settings-grid" class="hub-settings-grid"><button type="button" data-hub-setting="account"><strong>บัญชีและความปลอดภัย</strong><span>Username, Password และอุปกรณ์ที่เข้าสู่ระบบ</span></button><button type="button" data-hub-setting="people"><strong>ผู้ใช้และสิทธิ์</strong><span>สร้างบัญชี Role และการเข้าถึง</span></button><button type="button" data-hub-setting="ai"><strong>AI Providers</strong><span>Provider, budget และ routing</span></button><button type="button" data-hub-setting="devices"><strong>อุปกรณ์</strong><span>AWH Desktop และเครื่องที่ช่วยทำงาน</span></button><button type="button" data-hub-setting="data"><strong>ข้อมูลและ Memory</strong><span>ความจำ การส่งออก และข้อมูล Workspace</span></button></div></section>
  </div>`;
}

function bottomMarkup() {
  const items = [['home','⌂','หน้าแรก'],['chat','✦','AI'],['tools','⌘','Tools'],['files','▱','ไฟล์'],['tasks','✓','งาน']];
  return `<nav class="hub-bottom-nav" aria-label="เมนู AWH บนมือถือ">${items.map(([view,icon,label]) => `<button type="button" data-hub-view="${view}"><span>${icon}</span><b>${label}</b></button>`).join('')}</nav>`;
}
function mount() {
  if (state.mounted) return;
  const workspace = $('workspace-view'); if (!workspace) return;
  const chatNodes = [...workspace.children];
  const shell = document.createElement('div'); shell.className = 'hub-shell'; shell.innerHTML = shellMarkup() + moreMarkup();
  const bottom = document.createElement('div'); bottom.innerHTML = bottomMarkup();
  workspace.replaceChildren(shell, bottom.firstElementChild);
  const chatPage = shell.querySelector('[data-hub-page="chat"]'); chatNodes.forEach((node) => chatPage.append(node));
  document.body.classList.add('hub-active'); state.mounted = true;
  workspace.querySelectorAll('[data-hub-view]').forEach((button) => button.addEventListener('click', () => activate(button.dataset.hubView)));
  $('hub-account-button')?.addEventListener('click', () => $('account-open')?.click());
  $('hub-project-add')?.addEventListener('click', () => $('project-open')?.click());
  $('hub-memory-manage')?.addEventListener('click', () => openSettings('data'));
  $('hub-devices-manage')?.addEventListener('click', () => openSettings('devices'));
  $('hub-users-manage')?.addEventListener('click', () => openSettings('people'));
  $('hub-database-refresh')?.addEventListener('click', () => void refreshDatabase(true));
  shell.querySelectorAll('[data-hub-setting]').forEach((button) => button.addEventListener('click', () => openSettings(button.dataset.hubSetting)));
  $('hub-tool-search')?.addEventListener('input', (event) => { state.toolQuery = event.target.value.trim().toLowerCase(); renderTools(); });
  $('hub-command-form')?.addEventListener('submit', handleCommand);
  window.addEventListener('awh:workspace-context', (event) => { state.workspaceContext = event.detail || null; });
}

function openSettings(section) {
  $('account-open')?.click();
  requestAnimationFrame(() => document.querySelector(`[data-settings-tab="${section}"]`)?.click());
}
function activate(view) {
  const selected = allowed(view) ? view : 'home'; state.view = selected;
  document.querySelectorAll('[data-hub-page]').forEach((page) => { page.hidden = page.dataset.hubPage !== selected; });
  document.querySelectorAll('[data-hub-view]').forEach((button) => {
    const active = button.dataset.hubView === selected;
    button.classList.toggle('active', active); button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  text('hub-page-heading', VIEW_LABELS[selected]);
  if (selected === 'users') void refreshPeople();
  if (selected === 'database') void refreshDatabase(false);
  if (selected === 'tools') renderTools();
  if (selected === 'chat') requestAnimationFrame(() => $('goal-input')?.focus());
}
function handleCommand(event) {
  event.preventDefault(); const input = $('hub-command-input'); const value = input?.value.trim(); if (!value) return;
  const q = value.toLowerCase();
  const routes = [
    [['เครื่องมือ','tool','pdf','qr','รูป'], 'tools'], [['ไฟล์','file','เอกสารล่าสุด'], 'files'],
    [['งาน','task','inbox','อนุมัติ'], 'tasks'], [['โปรเจกต์','project'], 'projects'],
    [['ผู้ใช้','user','ครู','บุคลากร'], 'users'], [['ฐานข้อมูล','database','schema'], 'database'],
    [['อุปกรณ์','device','windows','mac'], 'devices'], [['memory','ความจำ'], 'memory'],
  ];
  for (const [terms, view] of routes) {
    if (terms.some((term) => q.includes(term)) && allowed(view)) { activate(view); input.value = ''; return; }
  }
  if (!allowed('chat')) { activate('home'); return; }
  activate('chat'); const chat = $('goal-input');
  if (chat && !chat.disabled && !chat.readOnly) {
    chat.value = value; input.value = ''; requestAnimationFrame(() => $('goal-form')?.requestSubmit());
  } else if (chat) { chat.value = value; input.value = ''; chat.focus(); }
}

function renderRoleActions() {
  const host = $('hub-role-actions'); if (!host) return; host.replaceChildren();
  const role = normalizedRole(state.control?.role);
  const sets = role === 'OWNER'
    ? [['สั่ง AWH','คุยหรือสั่งงานด้วยภาษาปกติ','chat'],['โปรเจกต์','ทำงานต่อจาก Source เดิม','projects'],['กล่องงาน','ดูงานค้างและรายการรออนุมัติ','tasks'],['ระบบ','ตรวจฐานข้อมูลและการตั้งค่าหลัก','database']]
    : role === 'ADMIN'
      ? [['ถาม AI','ช่วยงานและค้นข้อมูล','chat'],['ผู้ใช้','จัดการบัญชีตามสิทธิ์ที่ได้รับ','users'],['โปรเจกต์','เปิดงานที่ได้รับสิทธิ์','projects'],['กล่องงาน','ติดตามงานที่เกี่ยวข้อง','tasks']]
      : role === 'DIRECTOR'
        ? [['รายการรออนุมัติ','ดูสิ่งที่ต้องตัดสินใจ','tasks'],['ถาม AI','ช่วยสรุปและเตรียมข้อมูล','chat'],['ไฟล์ล่าสุด','เปิดผลลัพธ์และเอกสาร','files'],['เครื่องมือ','ใช้เครื่องมือสำนักงาน','tools']]
        : role === 'VIEWER'
          ? [['ไฟล์ของฉัน','ดูไฟล์ที่ได้รับสิทธิ์','files'],['กล่องงาน','ติดตามสถานะงาน','tasks']]
          : [['ถาม AI','ถามหรือให้ AI ช่วยทำงาน','chat'],['เครื่องมือ','งาน PDF รูปภาพ และเครื่องมือสำนักงาน','tools'],['ไฟล์ของฉัน','เปิดไฟล์และผลลัพธ์ล่าสุด','files'],['งานของฉัน','ดูสิ่งที่กำลังทำและเสร็จแล้ว','tasks']];
  sets.filter(([, , view]) => allowed(view)).forEach(([title, copy, view]) => host.append(actionCard(title, copy, view)));
}

function renderHome() {
  const role = normalizedRole(state.control?.role); const projects = state.control?.projects || [];
  const tasks = state.control?.tasks || []; const artifacts = state.control?.artifacts || []; const approvals = state.control?.approvals || [];
  text('hub-user-name', state.profile?.displayName || 'AWH'); text('hub-role-badge', roleLabel(role));
  text('hub-greeting', `สวัสดี ${state.profile?.displayName || ''}`.trim());
  const copy = role === 'OWNER' ? 'สั่งงาน ทำโปรเจกต์ต่อ และดูสิ่งที่ระบบกำลังทำได้จากที่เดียว'
    : role === 'DIRECTOR' ? 'เรื่องที่ต้องตัดสินใจ งานสำคัญ และ AI อยู่ตรงนี้โดยไม่ต้องหาเมนูซับซ้อน'
    : role === 'ADMIN' ? 'ดูแลงาน ผู้ใช้ และ Workspace ที่ได้รับสิทธิ์จากหน้าหลักเดียว'
    : role === 'VIEWER' ? 'ติดตามงานและเปิดไฟล์ที่คุณได้รับสิทธิ์ได้จากที่นี่'
    : 'ถาม AI ใช้เครื่องมือ เปิดไฟล์ และติดตามงานของคุณได้จากที่เดียว';
  text('hub-home-copy', copy); text('hub-home-kicker', role === 'DIRECTOR' ? 'EXECUTIVE HOME' : role === 'OWNER' ? 'OWNER HOME' : 'MY WORKSPACE');
  renderRoleActions();
  const metrics = $('hub-metrics'); if (metrics) metrics.hidden = role !== 'OWNER';
  text('hub-metric-projects', String(projects.length)); text('hub-metric-active', String(tasks.filter((t) => !TERMINAL_STATES.has(t.state)).length));
  text('hub-metric-approvals', String(approvals.filter((a) => a.status === 'PENDING').length)); text('hub-metric-files', String(artifacts.length));
  renderHomePrimary(role, projects, tasks, artifacts, approvals); renderHomeInbox(tasks, approvals);
}
function renderHomePrimary(role, projects, tasks, artifacts, approvals) {
  const host = $('hub-home-primary-list'); if (!host) return; host.replaceChildren();
  if (role === 'OWNER' || role === 'ADMIN') {
    text('hub-home-primary-kicker', 'CONTINUE'); text('hub-home-primary-title', 'ทำงานต่อจากโปรเจกต์ล่าสุด');
    projects.slice(0, 4).forEach((project) => {
      const item = card(project.name, project.memoryReady ? 'บริบทพร้อม · เปิดทำงานต่อได้' : 'กำลังตรวจบริบทของโปรเจกต์');
      item.addEventListener('click', () => { activate('chat'); $('project-open')?.click(); }); host.append(item);
    });
  } else if (role === 'DIRECTOR') {
    text('hub-home-primary-kicker', 'DECISIONS'); text('hub-home-primary-title', 'เรื่องที่รอการตัดสินใจ');
    const pending = approvals.filter((item) => item.status === 'PENDING');
    pending.slice(0, 5).forEach((item) => host.append(card(item.title || item.action || 'รายการรออนุมัติ', 'เปิดกล่องงานเพื่อดูรายละเอียดและตัดสินใจ')));
  } else {
    text('hub-home-primary-kicker', 'RECENT WORK'); text('hub-home-primary-title', 'งานและไฟล์ล่าสุดของคุณ');
    artifacts.slice(0, 3).forEach((item) => host.append(card(item.name || 'ไฟล์ผลลัพธ์', 'พร้อมเปิดจากหน้าไฟล์')));
    tasks.filter((item) => !TERMINAL_STATES.has(item.state)).slice(0, 3).forEach((item) => host.append(card(item.goal || 'งาน AWH', stateLabel(item.state))));
  }
  if (!host.childElementCount) empty(host, role === 'DIRECTOR' ? 'ตอนนี้ไม่มีรายการรออนุมัติ' : 'ยังไม่มีงานล่าสุด เริ่มจาก AI หรือเครื่องมือได้เลย');
}

function renderHomeInbox(tasks, approvals) {
  const host = $('hub-home-inbox'); if (!host) return; host.replaceChildren();
  approvals.filter((item) => item.status === 'PENDING').slice(0, 3).forEach((item) => host.append(card(item.title || item.action || 'รออนุมัติ', 'ต้องการการตัดสินใจ')));
  tasks.filter((item) => !TERMINAL_STATES.has(item.state)).slice(0, 4).forEach((item) => host.append(card(item.goal || 'งาน AWH', stateLabel(item.state))));
  if (!host.childElementCount) empty(host, 'ไม่มีสิ่งที่ต้องจัดการตอนนี้');
}
function renderProjects() {
  const host = $('hub-projects-grid'); if (!host) return; host.replaceChildren();
  for (const project of state.control?.projects || []) {
    const caps = Array.isArray(project.capabilities) ? project.capabilities : [];
    const item = card(project.name, project.memoryReady ? 'บริบทพร้อม · ทำงานต่อได้' : 'บริบทกำลังตรวจสอบ');
    const meta = document.createElement('small'); meta.textContent = caps.includes('conversation.write') ? 'คุยและสั่งงานได้' : 'ดูข้อมูลได้'; item.append(meta);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'hub-inline-action'; button.textContent = 'เปิดใน AI';
    button.addEventListener('click', () => { activate('chat'); $('project-open')?.click(); }); item.append(button); host.append(item);
  }
  if (!host.childElementCount) empty(host, 'ยังไม่มีโปรเจกต์ที่บัญชีนี้เข้าถึงได้');
}
function renderTasks() {
  const host = $('hub-tasks-list'); if (!host) return; host.replaceChildren(); const approvals = state.control?.approvals || [];
  approvals.filter((entry) => entry.status === 'PENDING').forEach((entry) => {
    const item = card(entry.title || entry.action || 'รายการรออนุมัติ', 'ต้องการการตัดสินใจ');
    const badge = document.createElement('span'); badge.className = 'hub-badge warning'; badge.textContent = 'รออนุมัติ'; item.append(badge); host.append(item);
  });
  for (const task of state.control?.tasks || []) {
    const item = card(task.goal || 'งาน AWH', `${stateLabel(task.state)}${task.resultSummary ? ` · ${task.resultSummary}` : ''}`);
    if (task.failureCode) { const badge = document.createElement('span'); badge.className = 'hub-badge warning'; badge.textContent = 'ต้องตรวจสอบ'; item.append(badge); }
    host.append(item);
  }
  if (!host.childElementCount) empty(host, 'กล่องงานว่างอยู่ ตอนนี้ไม่มีงานที่ต้องติดตาม');
}
function renderFiles() {
  const host = $('hub-files-list'); if (!host) return; host.replaceChildren();
  for (const artifact of state.control?.artifacts || []) {
    const item = card(artifact.name || 'ไฟล์ผลลัพธ์', artifact.taskId ? 'สร้างจากงานใน AWH' : 'ไฟล์จาก Workspace');
    if (typeof artifact.downloadUrl === 'string' && artifact.downloadUrl.startsWith('/api/v1/control/artifacts/')) {
      const link = document.createElement('a'); link.href = artifact.downloadUrl; link.className = 'hub-inline-action'; link.textContent = 'ดาวน์โหลด'; item.append(link);
    }
    host.append(item);
  }
  if (!host.childElementCount) empty(host, 'ยังไม่มีไฟล์ผลลัพธ์ เมื่อ AWH สร้างไฟล์ให้จะมาอยู่ที่นี่');
}
function safeToolForWorkspace(tool) {
  if (feature('developer.use')) return true;
  if (!tool || tool.permission !== 'READ') return false;
  return /pdf|image|qr|document|media|office|convert|compress|resize|merge|split/i.test(`${tool.name} ${tool.description || ''}`);
}
function renderTools() {
  const host = $('hub-tools-list'); if (!host) return; host.replaceChildren();
  const all = state.catalog?.tools || []; const visible = all.filter(safeToolForWorkspace);
  const filtered = visible.filter((tool) => !state.toolQuery || `${tool.name} ${tool.description || ''}`.toLowerCase().includes(state.toolQuery));
  text('hub-tools-subtitle', feature('developer.use') && state.catalog ? `${visible.length} เครื่องมือใน AWH Registry` : 'เครื่องมือที่ปลอดภัยสำหรับ Workspace ของคุณ');
  filtered.slice(0, 120).forEach((tool) => {
    const item = card(tool.name, tool.description || 'AWH Tool');
    const badge = document.createElement('span'); badge.className = 'hub-badge'; badge.textContent = tool.readOnly ? 'อ่านอย่างเดียว' : 'ผ่าน AWH'; item.append(badge);
    const use = document.createElement('button'); use.type = 'button'; use.className = 'hub-inline-action'; use.textContent = 'ใช้ผ่าน AI';
    use.addEventListener('click', () => {
      activate('chat'); const input = $('goal-input');
      if (input && !input.disabled && !input.readOnly) { input.value = `ใช้เครื่องมือ ${tool.name} เพื่อ `; input.focus(); }
    });
    item.append(use); host.append(item);
  });
  if (!host.childElementCount) empty(host, feature('developer.use') ? 'ไม่พบเครื่องมือที่ค้นหา' : 'Tool Center พร้อมแล้ว เครื่องมือ PDF / Image / QR แบบไม่ใช้ AI จะเพิ่มใน Batch ถัดไป');
}
function renderExecutions() {
  const host = $('hub-executions-list'); if (!host) return; host.replaceChildren();
  for (const task of state.control?.tasks || []) {
    const execution = task.execution || null; if (!execution && TERMINAL_STATES.has(task.state)) continue;
    const detail = execution?.executorKind ? `${stateLabel(task.state)} · ${execution.executorKind}` : stateLabel(task.state);
    const item = card(task.goal || 'การทำงานของ AWH', detail);
    if (execution?.capability) { const badge = document.createElement('span'); badge.className = 'hub-badge'; badge.textContent = execution.capability; item.append(badge); }
    host.append(item);
  }
  if (!host.childElementCount) empty(host, 'ตอนนี้ไม่มี Execution ที่กำลังทำงาน');
}
function renderDevices() {
  const host = $('hub-devices-list'); if (!host) return; host.replaceChildren();
  for (const worker of state.control?.workers || []) {
    const title = worker.displayName || worker.deviceName || worker.workerId || 'AWH Worker';
    const availability = worker.activity || worker.status || worker.state || 'UNKNOWN';
    host.append(card(title, `${availability}${worker.platform ? ` · ${worker.platform}` : ''}`));
  }
  if (!host.childElementCount) empty(host, 'ยังไม่มีเครื่องที่รายงานความพร้อมเข้ามา AWH Server ยังทำงานต่อได้สำหรับงานที่รองรับ');
}
function renderMemory() {
  const host = $('hub-memory-summary'); if (!host) return; host.replaceChildren();
  const projects = state.control?.projects || []; const ready = projects.filter((project) => project.memoryReady).length;
  host.append(card('Project Memory', `${ready} จาก ${projects.length} โปรเจกต์มีชุด Memory พร้อมใช้`));
  host.append(card('Source of Truth', 'Source, configuration และ revision ปัจจุบันมีสิทธิ์เหนือ Memory เสมอ'));
}
function renderAutomations() {
  const host = $('hub-automations-list'); if (!host) return; host.replaceChildren();
  empty(host, 'Automation authority พร้อมสำหรับการเชื่อมต่อ แต่ยังไม่มีงานอัตโนมัติที่กำหนดไว้ใน Workspace นี้');
}
function renderUsers() {
  const host = $('hub-users-list'); if (!host) return; host.replaceChildren();
  for (const person of state.people) {
    const status = person.status === 'DISABLED' ? 'ปิดใช้งาน' : person.status === 'REVOKED' ? 'ยกเลิกแล้ว' : 'ใช้งานอยู่';
    host.append(card(person.displayName || person.username || 'ผู้ใช้ AWH', `${roleLabel(person.role)} · ${status}${person.lastLoginAt ? ` · เข้าใช้ล่าสุด ${new Date(person.lastLoginAt).toLocaleString('th-TH')}` : ''}`));
  }
  if (!host.childElementCount) empty(host, 'กด “จัดการผู้ใช้” เพื่อสร้างบัญชีและกำหนดสิทธิ์');
}
async function refreshPeople() {
  if (!canManageUsers()) return;
  try { const value = await listPeople(); state.people = Array.isArray(value.people) ? value.people : []; renderUsers(); }
  catch { state.people = []; renderUsers(); }
}
function byteLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'; if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function renderDatabase() {
  const db = state.database?.database; const health = $('hub-database-health'); const tables = $('hub-database-tables'); const migrations = $('hub-database-migrations');
  if (!health || !tables || !migrations) return; health.replaceChildren(); tables.replaceChildren(); migrations.replaceChildren();
  if (!db) { empty(health, 'กำลังตรวจฐานข้อมูล…'); return; }
  const metrics = [
    ['สถานะ', db.health === 'HEALTHY' ? 'ปกติ' : 'ต้องตรวจ', db.quickCheck === 'PASS' ? 'Integrity ผ่าน' : 'Integrity ไม่ผ่าน'],
    ['Schema', String(db.schemaVersion ?? '—'), `${db.tableCount ?? 0} ตาราง`],
    ['ขนาด', byteLabel(db.sizeBytes), `Journal ${db.journalMode || '—'}`],
    ['Foreign Key', String(db.foreignKeyIssueCount ?? 0), (db.foreignKeyIssueCount ?? 0) === 0 ? 'ไม่พบปัญหา' : 'ควรตรวจทันที'],
  ];
  for (const [label, value, copy] of metrics) { const article = document.createElement('article'); article.innerHTML = `<span></span><strong></strong><small></small>`; article.children[0].textContent = label; article.children[1].textContent = value; article.children[2].textContent = copy; health.append(article); }
  for (const table of db.tables || []) {
    const row = document.createElement('div'); row.className = 'hub-database-row'; const name = document.createElement('strong'); name.textContent = table.name;
    const count = document.createElement('span'); count.textContent = table.rowCount >= 0 ? `${table.rowCount.toLocaleString('th-TH')} รายการ` : 'อ่านจำนวนไม่ได้'; row.append(name, count); tables.append(row);
  }
  for (const migration of db.migrations || []) migrations.append(card(migration.migrationId, `Schema ${migration.schemaVersion} · ${new Date(migration.appliedAt).toLocaleString('th-TH')}`));
  if (!tables.childElementCount) empty(tables, 'ยังไม่มีตารางข้อมูล'); if (!migrations.childElementCount) empty(migrations, 'ยังไม่พบ migration ledger');
}
async function refreshDatabase(force = false) {
  if (!isOwner() || (state.database && !force)) { renderDatabase(); return; }
  try { state.database = await loadDatabaseOverview(); renderDatabase(); }
  catch { state.database = null; renderDatabase(); const host = $('hub-database-health'); if (host) { host.replaceChildren(); empty(host, 'ยังตรวจฐานข้อมูลไม่ได้ กรุณาลองใหม่'); } }
}
function renderSettings() {
  const grid = $('hub-settings-grid'); if (!grid) return;
  for (const button of grid.querySelectorAll('[data-hub-setting]')) {
    const section = button.dataset.hubSetting;
    button.hidden = section === 'people' ? !canManageUsers()
      : ['ai','devices','data'].includes(section) ? !isOwner() : false;
  }
}
function applyRole() {
  document.querySelectorAll('[data-hub-view]').forEach((button) => { button.hidden = !allowed(button.dataset.hubView); });
  document.querySelectorAll('[data-hub-nav-group]').forEach((group) => {
    group.hidden = [...group.querySelectorAll('[data-hub-view]')].every((button) => button.hidden);
  });
  const create = $('project-create-form'); if (create) create.hidden = !isOwner();
  if (!allowed(state.view)) state.view = 'home'; renderSettings();
}
function renderAll() {
  if (!state.mounted || !state.control) return;
  applyRole(); renderHome(); renderProjects(); renderTasks(); renderFiles(); renderTools();
  renderExecutions(); renderMemory(); renderDevices(); renderAutomations(); renderUsers(); renderDatabase(); activate(state.view);
}
async function loadCatalog() {
  if (state.catalog) return;
  try {
    const response = await fetch('./tool-catalog.json', { credentials: 'same-origin', cache: 'no-store' }); const value = await response.json();
    if (response.ok && value?.schemaVersion === 1 && value?.source === 'awh-runtime-tool-registry' && Array.isArray(value.tools) && value.tools.length === value.toolCount) state.catalog = value;
  } catch { state.catalog = null; }
}
async function refreshHub() {
  const workspace = $('workspace-view'); if (!workspace || workspace.hidden) return;
  try {
    const [control, profile] = await Promise.all([loadControlData(), loadAuthProfile().catch(() => null), loadCatalog()]);
    state.control = control; state.profile = profile; mount(); renderAll();
  } catch { /* app.js owns canonical control-plane error handling */ }
}

const workspace = $('workspace-view');
if (workspace) {
  const observer = new MutationObserver(() => { if (!workspace.hidden) void refreshHub(); });
  observer.observe(workspace, { attributes: true, attributeFilter: ['hidden'] });
  if (!workspace.hidden) void refreshHub();
  window.setInterval(() => { if (!document.hidden && !workspace.hidden) void refreshHub(); }, 15000);
}
