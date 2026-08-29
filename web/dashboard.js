import { loadControlData } from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';
import { SCHOOL_TOOLS, OWNER_TOOLS } from './tool-registry.js?release=__AWH_WEB_RELEASE_ID__';
import { LOCAL_TOOL_ACTIONS, mountSchoolTools } from './school-tools.js?release=__AWH_WEB_RELEASE_ID__';
import { executionStatus } from './execution-ux.js?release=__AWH_WEB_RELEASE_ID__';

const DASHBOARD_ID = 'product-dashboard';
const IMAGE_MAX_BYTES = 30 * 1024 * 1024;
const ACTIVE_STATES = new Set(['QUEUED', 'WAITING_FOR_WORKER', 'PREPARING', 'RUNNING', 'QA', 'WAITING_FOR_APPROVAL']);
const state = {
  control: null,
  mounted: false,
  imageFile: null,
  imageUrl: null,
  refreshTimer: null,
  workContext: null,
  taskFilter: 'all',
  selectedTaskId: null,
  filesQuery: '',
};

const $ = (id) => document.getElementById(id);

function safeText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function formatDate(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function compareRecent(a, b) {
  const left = Date.parse(a?.updatedAt || a?.createdAt || a?.completedAt || '') || 0;
  const right = Date.parse(b?.updatedAt || b?.createdAt || b?.completedAt || '') || 0;
  return right - left;
}

function button(label, className, onClick) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

function tapTool(title) {
  const cards = [...document.querySelectorAll('.awh-tool-card')];
  const target = cards.find((card) => card.querySelector('strong')?.textContent?.trim() === title);
  if (target instanceof HTMLButtonElement && !target.disabled) target.click();
}

function mountWelcome(dashboard) {
  const welcome = document.createElement('div');
  welcome.id = 'dashboard-welcome';
  welcome.className = 'awh-home-welcome';
  welcome.innerHTML = '<span><small>ART’S WORKSPACE HUB</small><strong>Workspace ของคุณ</strong></span><span class="awh-cloud-chip"><i aria-hidden="true"></i> Cloud พร้อมใช้งาน</span>';
  dashboard.prepend(welcome);
}

function mountPromptShortcuts(hero) {
  const row = document.createElement('div');
  row.id = 'awh-home-prompts';
  row.className = 'awh-home-prompts';
  const choices = [
    ['↻ งานล่าสุด', () => $('dashboard-continue-work')?.click()],
    ['☰ Multi Chat', () => $('dashboard-open-chats')?.click()],
    ['▤ สร้างเอกสาร', () => tapTool('สร้างเอกสาร')],
    ['PDF จัดการ PDF', () => tapTool('จัดการ PDF')],
    ['QR สร้าง QR', () => tapTool('สร้าง QR')],
  ];
  for (const [label, action] of choices) row.append(button(label, 'awh-home-prompt', action));
  hero.append(row);
}

function updateMobileNavigation() {
  const nav = $('awh-mobile-nav');
  if (!(nav instanceof HTMLElement)) return;
  const home = document.body.classList.contains('product-dashboard-active');
  for (const item of nav.querySelectorAll('[data-mobile-destination]')) {
    const destination = item.dataset.mobileDestination;
    item.classList.toggle('is-active', home ? destination === 'home' : destination === 'chat');
  }
}

function mountMobileNavigation() {
  if ($('awh-mobile-nav')) return;
  const nav = document.createElement('nav');
  nav.id = 'awh-mobile-nav';
  nav.className = 'awh-mobile-nav';
  nav.setAttribute('aria-label', 'เมนูหลัก AWH');
  const make = (icon, label, destination, action) => {
    const item = button('', 'awh-mobile-nav-item', action);
    item.dataset.mobileDestination = destination;
    item.innerHTML = `<span aria-hidden="true">${icon}</span><strong>${label}</strong>`;
    return item;
  };
  nav.append(
    make('⌂', 'หน้าแรก', 'home', returnHome),
    make('✦', 'AI', 'ai', () => openWork()),
    make('☰', 'แชท', 'chat', () => { const context = state.workContext; if (context?.project?.projectId) navigateWork(context.project.projectId, context?.conversation?.conversationId || null, true); else openWork(); }),
    make('▦', 'เครื่องมือ', 'tools', () => { returnHome(); window.setTimeout(() => $('awh-home-tools')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40); }),
    make('•••', 'เพิ่มเติม', 'more', () => { returnHome(); window.setTimeout(() => { const owner = $('dashboard-owner-center-open'); if (owner instanceof HTMLElement && !owner.hidden) owner.click(); else $('account-open')?.click(); }, 40); }),
  );
  document.body.append(nav);
  new MutationObserver(updateMobileNavigation).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  updateMobileNavigation();
}

function mountProductNavigation(dashboard) {
  if ($('awh-product-nav')) return;
  const nav = document.createElement('nav');
  nav.id = 'awh-product-nav';
  nav.className = 'awh-product-nav';
  nav.setAttribute('aria-label', 'เมนูหลัก AWH');
  const brand = document.createElement('div');
  brand.className = 'awh-product-nav-brand';
  brand.innerHTML = '<span class="awh-product-nav-mark" aria-hidden="true">A</span><span><strong>AWH</strong><small>Workspace</small></span>';
  nav.append(brand);
  const entries = [
    ['home', '⌂', 'หน้าแรก', returnHome],
    ['work', '✦', 'AI Work', () => openWork()],
    ['tasks', '↻', 'Tasks', () => openTaskSurface()],
    ['files', '▤', 'Files', () => openFilesSurface()],
    ['tools', '▦', 'เครื่องมือ', () => { returnHome(); window.setTimeout(() => $('awh-home-tools')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40); }],
    ['owner', '⌘', 'Owner Center', () => { returnHome(); window.setTimeout(() => $('dashboard-owner-center-open')?.click(), 40); }],
  ];
  for (const [destination, icon, label, action] of entries) {
    const item = button('', 'awh-product-nav-item', action);
    item.dataset.productDestination = destination;
    item.innerHTML = `<span aria-hidden="true">${icon}</span><strong>${label}</strong>`;
    nav.append(item);
  }
  const note = document.createElement('p');
  note.className = 'awh-product-nav-note';
  note.textContent = 'ทำงานต่อได้ทุกอุปกรณ์';
  nav.append(note);
  dashboard.prepend(nav);
}

function updateProductNavigation() {
  const nav = $('awh-product-nav');
  if (!nav) return;
  const dashboard = $(DASHBOARD_ID);
  const activeDestination = document.body.classList.contains('product-dashboard-active')
    ? (dashboard?.dataset.view === 'tasks' ? 'tasks' : dashboard?.dataset.view === 'files' ? 'files' : 'home')
    : 'work';
  for (const item of nav.querySelectorAll('[data-product-destination]')) {
    const active = item.dataset.productDestination === activeDestination;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-current', active ? 'page' : 'false');
  }
  const owner = nav.querySelector('[data-product-destination="owner"]');
  if (owner instanceof HTMLElement) owner.hidden = state.control?.role !== 'OWNER';
}

function setDashboardView(view) {
  const dashboard = $(DASHBOARD_ID);
  if (!dashboard) return;
  const taskSurface = $('dashboard-tasks');
  const filesSurface = $('dashboard-files');
  const homeIds = ['dashboard-welcome', 'dashboard-hero', 'dashboard-continuity', 'dashboard-pulse', 'awh-home-tools', 'dashboard-overview', 'awh-home-files', 'dashboard-owner-center'];
  const showingTasks = view === 'tasks';
  const showingFiles = view === 'files';
  for (const id of homeIds) {
    const node = $(id);
    if (node) node.hidden = showingTasks || showingFiles;
  }
  if (taskSurface) taskSurface.hidden = !showingTasks;
  if (filesSurface) filesSurface.hidden = !showingFiles;
  dashboard.dataset.view = showingTasks ? 'tasks' : showingFiles ? 'files' : 'home';
  updateProductNavigation();
}

function openWork(prompt = '', submit = false) {
  document.body.classList.remove('product-dashboard-active');
  const dashboard = $(DASHBOARD_ID);
  if (dashboard) dashboard.hidden = true;
  updateProductNavigation();
  const input = $('goal-input');
  if (input && typeof prompt === 'string') {
    input.value = prompt;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }
  if (submit && prompt.trim() && $('goal-form')?.requestSubmit) $('goal-form').requestSubmit();
}

function navigateWork(projectId, conversationId = null, openConversations = false) {
  openWork();
  window.dispatchEvent(new CustomEvent('awh:navigate-work', { detail: { schemaVersion: 1, projectId, conversationId, openConversations } }));
}

function workspaceSummary(workspace) {
  const status = workspace?.syncStatus;
  if (status === 'SYNCED') return 'บริบทงานถูกบันทึกไว้แล้ว พร้อมทำต่อจากอุปกรณ์อื่น';
  if (status === 'HANDOFF_REQUIRED') return `มีงานเปิดอยู่บน ${safeText(workspace?.lease?.owner?.displayName, 'อีกอุปกรณ์หนึ่ง')} · AWH รักษาความต่อเนื่องไว้ให้`;
  if (status === 'SOURCE_OFFLINE') return 'อุปกรณ์ต้นทางออฟไลน์ แต่สถานะที่บันทึกไว้ยังพร้อมให้ทำต่อ';
  if (status === 'UNSYNCED_CHANGES') return 'มีงานจากอุปกรณ์ที่ยังต้องบันทึกสถานะให้สมบูรณ์ก่อนส่งต่อ';
  return 'AWH จะจำ Project, Chat และสถานะงานให้เมื่อเริ่มทำงาน';
}

function pulseAttentionItems() {
  const tasks = Array.isArray(state.control?.tasks) ? state.control.tasks : [];
  const approvals = Array.isArray(state.control?.approvals) ? state.control.approvals : [];
  return {
    failed: tasks.filter((task) => task?.state === 'FAILED').length,
    approvals: approvals.filter((item) => ['PENDING', 'WAITING'].includes(item?.state || item?.status)).length,
  };
}

function renderHomePulse() {
  const control = state.control;
  const set = (id, value, detail) => {
    const valueNode = $(id);
    if (valueNode) valueNode.textContent = value;
    const detailNode = $(`${id}-detail`);
    if (detailNode) detailNode.textContent = detail;
  };
  if (!control) return;
  const projects = Array.isArray(control.projects) ? control.projects : [];
  const tasks = Array.isArray(control.tasks) ? control.tasks : [];
  const artifacts = Array.isArray(control.artifacts) ? control.artifacts : [];
  const active = tasks.filter((task) => ACTIVE_STATES.has(task?.state)).length;
  const attention = pulseAttentionItems();
  const attentionCount = attention.failed + attention.approvals;
  set('dashboard-pulse-projects', String(projects.length), projects.length ? 'พร้อมเปิดดูบริบทและงานต่อ' : 'เพิ่มโปรเจกต์เพื่อเริ่มงาน');
  set('dashboard-pulse-active', String(active), active ? 'AWH กำลังจัดการงานของคุณ' : 'ไม่มีงานค้างในขณะนี้');
  set('dashboard-pulse-artifacts', String(artifacts.length), artifacts.length ? 'เปิดดูผลงานล่าสุดได้ด้านล่าง' : 'ผลงานที่เสร็จแล้วจะมาอยู่ตรงนี้');
  set('dashboard-pulse-attention', String(attentionCount), attentionCount ? `${attention.approvals} รออนุมัติ · ${attention.failed} ต้องตรวจสอบ` : 'ไม่มีรายการที่ต้องดู');

  const workerCard = $('dashboard-pulse-workers-card');
  if (workerCard) {
    const workers = Array.isArray(control.workers) ? control.workers : [];
    const ready = workers.filter((worker) => ['READY', 'WORKING'].includes(worker?.state)).length;
    workerCard.hidden = control.role !== 'OWNER';
    set('dashboard-pulse-workers', String(ready), workers.length ? `${ready} จาก ${workers.length} เครื่องพร้อมรับงาน` : 'ยังไม่มีอุปกรณ์ที่เชื่อมต่อ');
  }
}

function returnHome() {
  if (!state.control?.authenticated) return;
  const dashboard = $(DASHBOARD_ID);
  if (!dashboard) return;
  setDashboardView('home');
  dashboard.hidden = false;
  document.body.classList.add('product-dashboard-active');
  updateProductNavigation();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  refreshDashboard().catch(() => undefined);
}

function taskFilterMatches(task, filter) {
  if (filter === 'active') return ACTIVE_STATES.has(task?.state);
  if (filter === 'attention') return task?.state === 'FAILED' || task?.state === 'WAITING_FOR_APPROVAL';
  if (filter === 'completed') return task?.state === 'COMPLETED';
  return true;
}

function safeArtifactDownloadUrl(value) {
  return typeof value === 'string' && /^\/api\/v1\/control\/artifacts\/[0-9a-f-]{36}\/download$/i.test(value) ? value : null;
}

function appendTaskDetailRow(host, label, value) {
  if (!value) return;
  const row = document.createElement('div');
  row.className = 'awh-task-detail-row';
  const labelNode = document.createElement('small');
  labelNode.textContent = label;
  const valueNode = document.createElement('span');
  valueNode.textContent = value;
  row.append(labelNode, valueNode);
  host.append(row);
}

function renderTaskSurface() {
  const list = $('dashboard-task-list');
  const detail = $('dashboard-task-detail');
  const count = $('dashboard-task-count');
  if (!list || !detail) return;
  const tasks = Array.isArray(state.control?.tasks) ? [...state.control.tasks].sort(compareRecent) : [];
  const workers = Array.isArray(state.control?.workers) ? state.control.workers : [];
  const projects = Array.isArray(state.control?.projects) ? state.control.projects : [];
  const filtered = tasks.filter((task) => taskFilterMatches(task, state.taskFilter));
  if (count) count.textContent = `${filtered.length} งาน`;
  document.querySelectorAll('[data-task-filter]').forEach((node) => {
    const active = node.dataset.taskFilter === state.taskFilter;
    node.classList.toggle('active', active);
    node.setAttribute('aria-selected', String(active));
  });
  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'awh-empty-card';
    empty.textContent = state.taskFilter === 'attention' ? 'ไม่มีงานที่ต้องตัดสินใจหรือแก้ไข' : state.taskFilter === 'active' ? 'ไม่มีงานที่กำลังดำเนินการ' : state.taskFilter === 'completed' ? 'ยังไม่มีงานที่เสร็จแล้ว' : 'ยังไม่มีงานใน AWH';
    list.append(empty);
    state.selectedTaskId = null;
  } else {
    if (!filtered.some((task) => task.taskId === state.selectedTaskId)) state.selectedTaskId = filtered[0].taskId;
    for (const task of filtered) {
      const status = executionStatus(task, workers);
      const project = projects.find((entry) => entry.projectId === task.projectId);
      const item = button('', `awh-task-item${task.taskId === state.selectedTaskId ? ' selected' : ''}`, () => { state.selectedTaskId = task.taskId; renderTaskSurface(); });
      item.setAttribute('aria-label', `${safeText(task.goal, 'งาน AWH')} · ${status.title}`);
      const copy = document.createElement('span');
      const title = document.createElement('strong'); title.textContent = safeText(task.goal, 'งาน AWH');
      const meta = document.createElement('small'); meta.textContent = [safeText(project?.name, 'โปรเจกต์'), status.title].join(' · ');
      copy.append(title, meta);
      const updated = document.createElement('time'); updated.textContent = formatDate(task.updatedAt || task.createdAt);
      item.append(copy, updated);
      list.append(item);
    }
  }

  detail.replaceChildren();
  const task = filtered.find((entry) => entry.taskId === state.selectedTaskId) || null;
  if (!task) {
    const empty = document.createElement('div');
    empty.className = 'awh-task-detail-empty';
    empty.textContent = 'เลือกงานเพื่อดูสถานะ ผลลัพธ์ และหลักฐานที่ผูกกับงาน';
    detail.append(empty);
    return;
  }
  const project = projects.find((entry) => entry.projectId === task.projectId);
  const status = executionStatus(task, workers);
  const heading = document.createElement('div'); heading.className = 'awh-task-detail-heading';
  const eyebrow = document.createElement('span'); eyebrow.textContent = safeText(project?.name, 'โปรเจกต์');
  const title = document.createElement('h3'); title.textContent = safeText(task.goal, 'งาน AWH');
  const badge = document.createElement('strong'); badge.className = `awh-task-status status-${String(task.state || '').toLowerCase()}`; badge.textContent = status.title;
  heading.append(eyebrow, title, badge);
  detail.append(heading);
  const journey = renderMiniExecutionJourney(status); detail.append(journey);
  const summary = document.createElement('p'); summary.className = 'awh-task-detail-summary'; summary.textContent = status.detail; detail.append(summary);
  const facts = document.createElement('div'); facts.className = 'awh-task-detail-facts';
  appendTaskDetailRow(facts, 'ผู้ดูแลงาน', status.actor);
  appendTaskDetailRow(facts, 'อัปเดตล่าสุด', formatDate(task.updatedAt || task.createdAt));
  appendTaskDetailRow(facts, 'ความคืบหน้า', status.progress > 0 ? `${status.progress}%` : null);
  if (task.execution?.continuation && Number.isInteger(task.execution.continuation.step) && Number.isInteger(task.execution.continuation.maxSteps)) appendTaskDetailRow(facts, 'การทำต่ออัตโนมัติ', `ขั้นที่ ${task.execution.continuation.step} จาก ${task.execution.continuation.maxSteps}`);
  detail.append(facts);
  if (task.lastEvent?.message) {
    const event = document.createElement('p'); event.className = 'awh-task-detail-note'; event.textContent = `อัปเดตจาก AWH: ${safeText(task.lastEvent.message)}`; detail.append(event);
  }
  if (task.resultSummary) {
    const result = document.createElement('section'); result.className = 'awh-task-result';
    const resultTitle = document.createElement('strong'); resultTitle.textContent = task.state === 'FAILED' ? 'สิ่งที่ต้องทราบ' : 'ผลลัพธ์';
    const resultCopy = document.createElement('p'); resultCopy.textContent = safeText(task.resultSummary);
    result.append(resultTitle, resultCopy); detail.append(result);
  }
  const artifacts = (Array.isArray(state.control?.artifacts) ? state.control.artifacts : []).filter((artifact) => artifact?.taskId === task.taskId);
  if (artifacts.length) {
    const artifactSection = document.createElement('section'); artifactSection.className = 'awh-task-artifacts';
    const artifactTitle = document.createElement('strong'); artifactTitle.textContent = `ไฟล์ผลลัพธ์ที่ผูกกับงาน (${artifacts.length})`; artifactSection.append(artifactTitle);
    for (const artifact of artifacts) {
      const row = document.createElement('div'); row.className = 'awh-task-artifact-row';
      const name = document.createElement('span'); name.textContent = safeText(artifact.name, 'ไฟล์จาก AWH'); row.append(name);
      const url = safeArtifactDownloadUrl(artifact.downloadUrl);
      if (url) { const link = document.createElement('a'); link.href = url; link.download = safeText(artifact.name, 'awh-artifact'); link.textContent = 'ดาวน์โหลด'; row.append(link); }
      artifactSection.append(row);
    }
    detail.append(artifactSection);
  }
  const pendingApproval = (Array.isArray(state.control?.approvals) ? state.control.approvals : []).find((approval) => approval?.taskId === task.taskId && ['PENDING', 'WAITING'].includes(approval.state || approval.status));
  if (pendingApproval) {
    const approval = document.createElement('section'); approval.className = 'awh-task-attention';
    const copy = document.createElement('span'); copy.textContent = 'งานนี้รอการตัดสินใจจากคุณ';
    const action = button('เปิด Work', 'awh-secondary-action', () => navigateWork(task.projectId, task.conversationId || null));
    approval.append(copy, action); detail.append(approval);
  } else if (task.conversationId) {
    detail.append(button('เปิดบทสนทนานี้', 'awh-secondary-action', () => navigateWork(task.projectId, task.conversationId)));
  }
}

function openTaskSurface(filter = 'all', taskId = null) {
  if (!state.control?.authenticated) return;
  state.taskFilter = ['all', 'active', 'attention', 'completed'].includes(filter) ? filter : 'all';
  state.selectedTaskId = taskId;
  setDashboardView('tasks');
  const dashboard = $(DASHBOARD_ID);
  if (dashboard) dashboard.hidden = false;
  document.body.classList.add('product-dashboard-active');
  renderTaskSurface();
  $('dashboard-tasks')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderFilesSurface() {
  const list = $('dashboard-file-list');
  const count = $('dashboard-file-count');
  if (!list) return;
  const projects = Array.isArray(state.control?.projects) ? state.control.projects : [];
  const tasks = Array.isArray(state.control?.tasks) ? state.control.tasks : [];
  const artifacts = (Array.isArray(state.control?.artifacts) ? [...state.control.artifacts] : []).sort(compareRecent);
  const query = state.filesQuery.trim().toLocaleLowerCase('th-TH');
  const filtered = query ? artifacts.filter((artifact) => [artifact?.name, artifact?.kind].some((value) => safeText(value).toLocaleLowerCase('th-TH').includes(query))) : artifacts;
  if (count) count.textContent = `${filtered.length} จาก ${artifacts.length} ไฟล์`;
  const input = $('dashboard-files-search');
  if (input instanceof HTMLInputElement && input.value !== state.filesQuery) input.value = state.filesQuery;
  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement('div'); empty.className = 'awh-empty-card';
    empty.textContent = artifacts.length ? 'ไม่พบไฟล์ที่ตรงกับคำค้น' : 'ยังไม่มีไฟล์ผลลัพธ์ที่บันทึกไว้ ลองส่งงานหรือใช้เครื่องมือบน Home';
    list.append(empty); return;
  }
  for (const artifact of filtered) {
    const project = projects.find((entry) => entry.projectId === artifact.projectId);
    const task = tasks.find((entry) => entry.taskId === artifact.taskId);
    const row = document.createElement('article'); row.className = 'awh-file-item';
    const icon = document.createElement('span'); icon.className = 'awh-file-icon'; icon.textContent = '▤'; icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span'); copy.className = 'awh-file-copy';
    const name = document.createElement('strong'); name.textContent = safeText(artifact.name, 'ไฟล์จาก AWH');
    const meta = document.createElement('small'); meta.textContent = [safeText(artifact.kind, 'ไฟล์'), safeText(project?.name, 'โปรเจกต์'), formatBytes(Number(artifact.sizeBytes)), formatDate(artifact.createdAt)].filter(Boolean).join(' · ');
    copy.append(name, meta);
    if (task?.goal) { const source = document.createElement('em'); source.textContent = `จากงาน: ${safeText(task.goal)}`; copy.append(source); }
    const actions = document.createElement('span'); actions.className = 'awh-file-actions';
    const url = safeArtifactDownloadUrl(artifact.downloadUrl);
    if (url) { const link = document.createElement('a'); link.href = url; link.download = safeText(artifact.name, 'awh-artifact'); link.textContent = 'ดาวน์โหลด'; actions.append(link); }
    if (task?.conversationId) actions.append(button('เปิดงาน', 'awh-file-open-task', () => navigateWork(task.projectId, task.conversationId)));
    row.append(icon, copy, actions); list.append(row);
  }
}

function openFilesSurface(query = '') {
  if (!state.control?.authenticated) return;
  state.filesQuery = typeof query === 'string' ? query.slice(0, 120) : '';
  setDashboardView('files');
  const dashboard = $(DASHBOARD_ID);
  if (dashboard) dashboard.hidden = false;
  document.body.classList.add('product-dashboard-active');
  renderFilesSurface();
  $('dashboard-files')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openAccountTab(tab = null) {
  $('account-open')?.click();
  if (!tab) return;
  window.setTimeout(() => {
    const target = document.querySelector(`[data-settings-tab="${tab}"]`);
    if (target instanceof HTMLButtonElement && !target.hidden) target.click();
  }, 0);
}

function createToolCard({ icon, title, copy, badge = '', disabled = false, action }) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'awh-tool-card';
  card.disabled = disabled;
  const iconNode = document.createElement('span');
  iconNode.className = 'awh-tool-icon';
  iconNode.textContent = icon;
  const body = document.createElement('span');
  body.className = 'awh-tool-copy';
  const name = document.createElement('strong');
  name.textContent = title;
  const description = document.createElement('small');
  description.textContent = copy;
  body.append(name, description);
  card.append(iconNode, body);
  if (badge) {
    const chip = document.createElement('span');
    chip.className = 'awh-tool-badge';
    chip.textContent = badge;
    card.append(chip);
  }
  if (!disabled && typeof action === 'function') card.addEventListener('click', action);
  return card;
}

function mountDashboard() {
  if (state.mounted || $(DASHBOARD_ID)) return;
  const main = document.querySelector('.app-main');
  if (!(main instanceof HTMLElement)) return;

  const dashboard = document.createElement('section');
  dashboard.id = DASHBOARD_ID;
  dashboard.className = 'product-dashboard';
  dashboard.hidden = true;

  const hero = document.createElement('section');
  hero.id = 'dashboard-hero';
  hero.className = 'awh-home-hero';
  hero.innerHTML = '<div class="awh-home-kicker">AWH · AI WORKSPACE</div><h1>ทุกงาน เริ่มจากตรงนี้</h1><p>คุยกับ AI · ทำเอกสาร · จัดการไฟล์ · ใช้เครื่องมือฟรี · ทำงานต่อจากทุกอุปกรณ์</p>';
  const commandForm = document.createElement('form');
  commandForm.className = 'awh-command-form';
  commandForm.id = 'dashboard-command-form';
  const command = document.createElement('textarea');
  command.id = 'dashboard-command';
  command.rows = 2;
  command.maxLength = 2000;
  command.placeholder = 'เช่น ช่วยทำบันทึกข้อความ, สรุปรายงาน, จัดการไฟล์ หรือถามอะไรก็ได้…';
  const commandActions = document.createElement('div');
  commandActions.className = 'awh-command-actions';
  const hint = document.createElement('span');
  hint.textContent = 'ไม่ต้องเขียน Prompt ให้เป็น';
  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'awh-command-send';
  send.textContent = 'ให้ AWH ช่วย ✦';
  commandActions.append(hint, send);
  commandForm.append(command, commandActions);
  commandForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = command.value.trim();
    if (!value) { command.focus(); return; }
    openWork(value, true);
  });
  hero.append(commandForm);
  mountPromptShortcuts(hero);

  const continuity = document.createElement('section');
  continuity.id = 'dashboard-continuity';
  continuity.className = 'awh-home-section awh-continuity';
  continuity.innerHTML = '<div class="awh-section-heading"><div><span>ทำต่อจากเดิม</span><h2>กลับมาทำงานได้ทันที</h2></div><small id="dashboard-continuity-memory">AWH จำบริบทของงานให้</small></div><div class="awh-continuity-card"><div class="awh-continuity-copy"><span id="dashboard-continuity-project" class="awh-context-chip">Project</span><h3 id="dashboard-continuity-title">กำลังเตรียมงานล่าสุด…</h3><p id="dashboard-continuity-summary">AWH กำลังเชื่อมงานล่าสุดกับ Dashboard</p><div id="dashboard-continuity-meta" class="awh-context-meta"></div></div><div class="awh-continuity-actions"><button id="dashboard-continue-work" class="awh-command-send" type="button">ทำงานต่อ</button><button id="dashboard-open-chats" class="awh-secondary-action" type="button">Multi Chat</button></div></div>';

  const pulse = document.createElement('section');
  pulse.id = 'dashboard-pulse';
  pulse.className = 'awh-home-section awh-pulse';
  pulse.innerHTML = '<div class="awh-section-heading"><div><span>ภาพรวมตอนนี้</span><h2>รู้ทันงานในไม่กี่วินาที</h2></div><small>ข้อมูลล่าสุดจาก AWH · กดการ์ดเพื่อไปต่อ</small></div><div class="awh-pulse-grid"><button id="dashboard-pulse-projects-card" class="awh-pulse-card" type="button" data-pulse-target="projects"><span class="awh-pulse-icon">◫</span><span><strong id="dashboard-pulse-projects">—</strong><small>โปรเจกต์</small><em id="dashboard-pulse-projects-detail">กำลังตรวจข้อมูล…</em></span></button><button id="dashboard-pulse-active-card" class="awh-pulse-card" type="button" data-pulse-target="work"><span class="awh-pulse-icon">↻</span><span><strong id="dashboard-pulse-active">—</strong><small>กำลังทำอยู่</small><em id="dashboard-pulse-active-detail">กำลังตรวจข้อมูล…</em></span></button><button id="dashboard-pulse-artifacts-card" class="awh-pulse-card" type="button" data-pulse-target="files"><span class="awh-pulse-icon">▤</span><span><strong id="dashboard-pulse-artifacts">—</strong><small>ผลลัพธ์</small><em id="dashboard-pulse-artifacts-detail">กำลังตรวจข้อมูล…</em></span></button><button id="dashboard-pulse-attention-card" class="awh-pulse-card attention" type="button" data-pulse-target="work"><span class="awh-pulse-icon">!</span><span><strong id="dashboard-pulse-attention">—</strong><small>ต้องดู</small><em id="dashboard-pulse-attention-detail">กำลังตรวจข้อมูล…</em></span></button><button id="dashboard-pulse-workers-card" class="awh-pulse-card owner-pulse" type="button" data-pulse-target="devices" hidden><span class="awh-pulse-icon">◇</span><span><strong id="dashboard-pulse-workers">—</strong><small>อุปกรณ์พร้อม</small><em id="dashboard-pulse-workers-detail">กำลังตรวจข้อมูล…</em></span></button></div>';

  const taskSurface = document.createElement('section');
  taskSurface.id = 'dashboard-tasks';
  taskSurface.className = 'awh-home-section awh-task-surface';
  taskSurface.hidden = true;
  taskSurface.innerHTML = '<div class="awh-task-surface-header"><div><span>งานและการดำเนินการ</span><h2>ติดตามงานแบบเข้าใจง่าย</h2><p>ดูสถานะจริงของงาน ผลลัพธ์ และสิ่งที่ต้องทำต่อจากข้อมูล AWH</p></div><button id="dashboard-tasks-close" class="awh-secondary-action" type="button">กลับหน้าแรก</button></div><div class="awh-task-toolbar"><div class="awh-task-filters" role="tablist" aria-label="กรองงาน"><button type="button" class="awh-task-filter active" data-task-filter="all" role="tab" aria-selected="true">ทั้งหมด</button><button type="button" class="awh-task-filter" data-task-filter="active" role="tab" aria-selected="false">กำลังทำ</button><button type="button" class="awh-task-filter" data-task-filter="attention" role="tab" aria-selected="false">ต้องดู</button><button type="button" class="awh-task-filter" data-task-filter="completed" role="tab" aria-selected="false">เสร็จแล้ว</button></div><small id="dashboard-task-count" aria-live="polite">กำลังอ่านข้อมูล…</small></div><div class="awh-task-layout"><div id="dashboard-task-list" class="awh-task-list" role="list" aria-label="รายการงาน"></div><article id="dashboard-task-detail" class="awh-task-detail" aria-live="polite"></article></div>';

  const filesSurface = document.createElement('section');
  filesSurface.id = 'dashboard-files';
  filesSurface.className = 'awh-home-section awh-files-surface';
  filesSurface.hidden = true;
  filesSurface.innerHTML = '<div class="awh-task-surface-header"><div><span>ไฟล์และผลงาน</span><h2>คลังไฟล์ของ AWH</h2><p>ไฟล์ที่อัปโหลดหรือสร้างจากงานของคุณ พร้อมที่มาและผลลัพธ์ที่ดาวน์โหลดได้</p></div><button id="dashboard-files-close" class="awh-secondary-action" type="button">กลับหน้าแรก</button></div><form id="dashboard-files-form" class="awh-files-search"><label for="dashboard-files-search">ค้นหาไฟล์</label><div><input id="dashboard-files-search" type="search" maxlength="120" placeholder="ค้นหาจากชื่อหรือประเภทไฟล์" autocomplete="off" /><button class="awh-secondary-action" type="submit">ค้นหา</button><button id="dashboard-files-clear" class="awh-text-action" type="button">ล้าง</button></div><small id="dashboard-file-count" aria-live="polite">กำลังอ่านข้อมูล…</small></form><div id="dashboard-file-list" class="awh-file-list" role="list" aria-label="คลังไฟล์"></div>';

  const tools = document.createElement('section');
  tools.id = 'awh-home-tools';
  tools.className = 'awh-home-section';
  const toolsHeading = document.createElement('div');
  toolsHeading.className = 'awh-section-heading';
  toolsHeading.innerHTML = '<div><span>เครื่องมือยอดนิยม</span><h2>เริ่มงานได้ทันที</h2></div><small>เครื่องมือทั่วไปพยายามทำบนอุปกรณ์ก่อน เพื่อเร็วและประหยัด AI</small>';
  const toolGrid = document.createElement('div');
  toolGrid.className = 'awh-tool-grid';
  const schoolActions = {
    ai: () => openWork(),
    documents: () => openWork('ช่วยฉันสร้างเอกสารงานโรงเรียน โดยถามเฉพาะข้อมูลที่จำเป็น', true),
    image: openImageTool,
    pdf: LOCAL_TOOL_ACTIONS.pdf,
    qr: LOCAL_TOOL_ACTIONS.qr,
    attach: () => { openWork(); window.setTimeout(() => $('attachment-open')?.click(), 0); },
  };
  for (const tool of SCHOOL_TOOLS) toolGrid.append(createToolCard({ ...tool, action: schoolActions[tool.id] }));
  tools.append(toolsHeading, toolGrid);

  const overview = document.createElement('section');
  overview.id = 'dashboard-overview';
  overview.className = 'awh-home-overview';
  overview.innerHTML = '<section class="awh-home-section awh-recent-panel"><div class="awh-section-heading"><div><span>ทำงานต่อ</span><h2>งานล่าสุดของฉัน</h2></div><div class="awh-heading-actions"><button id="dashboard-open-tasks" class="awh-text-action" type="button">ดูงานทั้งหมด</button><button id="dashboard-open-work" class="awh-text-action" type="button">เปิด AI Workspace</button></div></div><div id="dashboard-recent-work" class="awh-recent-list"></div></section><section class="awh-home-section awh-side-panel"><div class="awh-section-heading"><div><span>สถานะ</span><h2>งานที่กำลังทำ</h2></div></div><div id="dashboard-active-tasks" class="awh-status-list"></div><div id="dashboard-approval-banner" class="awh-approval-banner" hidden></div></section>';

  const files = document.createElement('section');
  files.id = 'awh-home-files';
  files.className = 'awh-home-section';
  files.innerHTML = '<div class="awh-section-heading"><div><span>ไฟล์และผลงาน</span><h2>ล่าสุด</h2></div><button id="dashboard-open-files" class="awh-text-action" type="button">เปิดคลังไฟล์</button></div><div id="dashboard-artifacts" class="awh-artifact-grid"></div>';

  const owner = document.createElement('section');
  owner.id = 'dashboard-owner-center';
  owner.className = 'awh-home-section awh-owner-center';
  owner.hidden = true;
  owner.innerHTML = '<div class="awh-section-heading"><div><span>OWNER</span><h2>ศูนย์รวมทุกอย่างของเรา</h2></div><small>งาน ระบบ AI และอุปกรณ์อยู่ที่เดียว</small></div>';
  const ownerGrid = document.createElement('div');
  ownerGrid.className = 'awh-owner-grid';
  const ownerActions = {
    projects: () => { openWork(); window.setTimeout(() => $('project-open')?.click(), 0); },
    'multi-chat': () => { const context = state.workContext; const projectId = context?.project?.projectId; if (projectId) navigateWork(projectId, context?.conversation?.conversationId || null, true); else { openWork(); window.setTimeout(() => $('conversation-open')?.click(), 0); } },
    memory: () => openAccountTab('data'),
    tasks: () => openTaskSurface(),
    devices: () => openAccountTab('devices'),
    system: () => openAccountTab('system'),
  };
  for (const tool of OWNER_TOOLS) ownerGrid.append(createToolCard({ ...tool, action: ownerActions[tool.id] }));
  owner.append(ownerGrid);

  const imageTool = createImageTool();
  dashboard.append(hero, continuity, pulse, taskSurface, filesSurface, tools, overview, files, owner, imageTool);
  mountProductNavigation(dashboard);
  mountWelcome(dashboard);
  mountSchoolTools(dashboard);
  main.append(dashboard);

  $('dashboard-open-work')?.addEventListener('click', () => openWork());
  $('dashboard-open-tasks')?.addEventListener('click', () => openTaskSurface());
  $('dashboard-tasks-close')?.addEventListener('click', returnHome);
  taskSurface.querySelectorAll('[data-task-filter]').forEach((node) => node.addEventListener('click', () => { state.taskFilter = node.dataset.taskFilter || 'all'; state.selectedTaskId = null; renderTaskSurface(); }));
  $('dashboard-open-files')?.addEventListener('click', () => openFilesSurface());
  $('dashboard-files-close')?.addEventListener('click', returnHome);
  $('dashboard-files-form')?.addEventListener('submit', (event) => { event.preventDefault(); state.filesQuery = $('dashboard-files-search')?.value || ''; renderFilesSurface(); });
  $('dashboard-files-clear')?.addEventListener('click', () => { state.filesQuery = ''; renderFilesSurface(); $('dashboard-files-search')?.focus(); });
  $('dashboard-continue-work')?.addEventListener('click', () => { const context = state.workContext; const projectId = context?.project?.projectId; if (projectId) navigateWork(projectId, context?.conversation?.conversationId || null); else openWork(); });
  $('dashboard-open-chats')?.addEventListener('click', () => { const context = state.workContext; const projectId = context?.project?.projectId; if (projectId) navigateWork(projectId, context?.conversation?.conversationId || null, true); else { openWork(); window.setTimeout(() => $('conversation-open')?.click(), 0); } });
  $('dashboard-pulse-projects-card')?.addEventListener('click', () => { openWork(); window.setTimeout(() => $('project-open')?.click(), 0); });
  $('dashboard-pulse-active-card')?.addEventListener('click', () => openTaskSurface('active'));
  $('dashboard-pulse-attention-card')?.addEventListener('click', () => openTaskSurface('attention'));
  $('dashboard-pulse-artifacts-card')?.addEventListener('click', () => openFilesSurface());
  $('dashboard-pulse-workers-card')?.addEventListener('click', () => openAccountTab('devices'));
  installHomeButton();
  mountMobileNavigation();
  state.mounted = true;
}

function installHomeButton() {
  const existing = $('dashboard-home-button');
  if (existing instanceof HTMLButtonElement) {
    if (existing.dataset.awhBound !== '1') { existing.dataset.awhBound = '1'; existing.addEventListener('click', returnHome); }
    return;
  }
  const heading = document.querySelector('.workspace-heading');
  if (!(heading instanceof HTMLElement)) return;
  const home = button('⌂ หน้าแรก', 'workspace-home', returnHome);
  home.id = 'dashboard-home-button';
  home.dataset.awhBound = '1';
  heading.prepend(home);
}

function createImageTool() {
  const dialog = document.createElement('section');
  dialog.id = 'dashboard-image-tool';
  dialog.className = 'awh-tool-dialog';
  dialog.hidden = true;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'dashboard-image-title');
  dialog.innerHTML = '<div class="awh-tool-dialog-backdrop" data-image-close></div><div class="awh-tool-dialog-card"><div class="awh-tool-dialog-head"><div><span>รูปภาพ</span><h2 id="dashboard-image-title">ย่อ บีบอัด และแปลงรูป</h2><p>ประมวลผลในเครื่องนี้ ไม่อัปโหลดรูปไปที่เซิร์ฟเวอร์</p></div><button type="button" data-image-close>ปิด</button></div><label class="awh-image-drop"><input id="dashboard-image-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /><strong>เลือกรูปภาพ</strong><span id="dashboard-image-file">PNG, JPG, WebP หรือ GIF ที่เบราว์เซอร์เปิดได้</span></label><div class="awh-image-options"><label>ขนาดด้านยาวสูงสุด<select id="dashboard-image-size"><option value="1920">1920 px</option><option value="1600" selected>1600 px</option><option value="1280">1280 px</option><option value="960">960 px</option><option value="720">720 px</option></select></label><label>รูปแบบไฟล์<select id="dashboard-image-format"><option value="image/jpeg">JPG</option><option value="image/webp">WebP</option><option value="image/png">PNG</option></select></label><label>คุณภาพ<select id="dashboard-image-quality"><option value="0.9">สูง</option><option value="0.8" selected>สมดุล</option><option value="0.68">ไฟล์เล็ก</option></select></label></div><div id="dashboard-image-preview" class="awh-image-preview" hidden><img alt="ตัวอย่างรูปที่เลือก" /><div><strong id="dashboard-image-dimensions"></strong><span id="dashboard-image-original-size"></span></div></div><button id="dashboard-image-process" class="awh-command-send" type="button" disabled>สร้างไฟล์ใหม่</button><p id="dashboard-image-message" class="awh-local-note">✓ ทำบนอุปกรณ์นี้ · ไม่ใช้ AI token</p></div>';
  dialog.querySelectorAll('[data-image-close]').forEach((node) => node.addEventListener('click', closeImageTool));
  dialog.querySelector('#dashboard-image-input')?.addEventListener('change', selectImageFile);
  dialog.querySelector('#dashboard-image-process')?.addEventListener('click', processImage);
  return dialog;
}

function openImageTool() {
  const dialog = $('dashboard-image-tool');
  if (dialog) dialog.hidden = false;
}

function closeImageTool() {
  const dialog = $('dashboard-image-tool');
  if (dialog) dialog.hidden = true;
}

async function selectImageFile(event) {
  const input = event.currentTarget;
  const file = input instanceof HTMLInputElement ? input.files?.[0] : null;
  const process = $('dashboard-image-process');
  const preview = $('dashboard-image-preview');
  if (!(process instanceof HTMLButtonElement) || !preview) return;
  process.disabled = true;
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  state.imageUrl = null;
  state.imageFile = null;
  preview.hidden = true;
  if (!file) return;
  if (!file.type.startsWith('image/') || file.size > IMAGE_MAX_BYTES) {
    $('dashboard-image-message').textContent = file.size > IMAGE_MAX_BYTES ? 'ไฟล์ใหญ่เกิน 30 MB' : 'ไฟล์นี้ไม่ใช่รูปภาพที่รองรับ';
    return;
  }
  const url = URL.createObjectURL(file);
  state.imageFile = file;
  state.imageUrl = url;
  const image = preview.querySelector('img');
  if (image instanceof HTMLImageElement) image.src = url;
  $('dashboard-image-file').textContent = file.name;
  $('dashboard-image-original-size').textContent = `ต้นฉบับ ${formatBytes(file.size)}`;
  $('dashboard-image-message').textContent = '✓ ทำบนอุปกรณ์นี้ · ไม่ใช้ AI token';
  preview.hidden = false;
  if (image instanceof HTMLImageElement) {
    try {
      await image.decode();
      $('dashboard-image-dimensions').textContent = `${image.naturalWidth} × ${image.naturalHeight} px`;
      process.disabled = false;
    } catch {
      $('dashboard-image-message').textContent = 'เบราว์เซอร์นี้เปิดรูปดังกล่าวไม่ได้ กรุณาใช้ JPG, PNG หรือ WebP';
    }
  }
}

async function processImage() {
  const file = state.imageFile;
  const previewImage = $('dashboard-image-preview')?.querySelector('img');
  const process = $('dashboard-image-process');
  if (!file || !(previewImage instanceof HTMLImageElement) || !(process instanceof HTMLButtonElement)) return;
  process.disabled = true;
  $('dashboard-image-message').textContent = 'กำลังสร้างไฟล์ใหม่…';
  try {
    const maxSize = Number.parseInt($('dashboard-image-size')?.value || '1600', 10);
    const format = $('dashboard-image-format')?.value || 'image/jpeg';
    const quality = Number.parseFloat($('dashboard-image-quality')?.value || '0.8');
    const sourceWidth = previewImage.naturalWidth;
    const sourceHeight = previewImage.naturalHeight;
    const ratio = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * ratio));
    const height = Math.max(1, Math.round(sourceHeight * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: format === 'image/png' });
    if (!context) throw new Error('ไม่สามารถประมวลผลรูปได้');
    if (format === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(previewImage, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('ไม่สามารถสร้างไฟล์รูปได้')), format, quality));
    const extension = format === 'image/png' ? 'png' : format === 'image/webp' ? 'webp' : 'jpg';
    const base = file.name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 80) || 'awh-image';
    const outputUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = outputUrl;
    link.download = `${base}-AWH-${width}x${height}.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(outputUrl), 1500);
    $('dashboard-image-message').textContent = `เสร็จแล้ว · ${width} × ${height} px · ${formatBytes(blob.size)}`;
  } catch (error) {
    $('dashboard-image-message').textContent = error instanceof Error ? error.message : 'ไม่สามารถสร้างไฟล์รูปได้';
  } finally {
    process.disabled = false;
  }
}

function renderContinuity() {
  const context = state.workContext;
  const tasks = Array.isArray(state.control?.tasks) ? [...state.control.tasks].sort(compareRecent) : [];
  const projects = Array.isArray(state.control?.projects) ? state.control.projects : [];
  const fallbackTask = tasks[0] || null;
  const fallbackProject = fallbackTask ? projects.find((item) => item.projectId === fallbackTask.projectId) : projects[0] || null;
  const project = context?.project || fallbackProject;
  const conversation = context?.conversation || null;
  const workspace = context?.workspace || null;
  const title = $('dashboard-continuity-title');
  const projectNode = $('dashboard-continuity-project');
  const summary = $('dashboard-continuity-summary');
  const meta = $('dashboard-continuity-meta');
  const memory = $('dashboard-continuity-memory');
  const continueButton = $('dashboard-continue-work');
  const chatsButton = $('dashboard-open-chats');
  if (!title || !projectNode || !summary || !meta || !memory) return;
  if (!project) {
    projectNode.textContent = 'AWH';
    title.textContent = 'พร้อมเริ่มงานแรก';
    summary.textContent = 'บอกสิ่งที่ต้องการด้านบนได้เลย AWH จะสร้างความต่อเนื่องให้จากงานแรก';
    meta.textContent = '';
    memory.textContent = 'ยังไม่มี Project';
    if (continueButton instanceof HTMLButtonElement) continueButton.disabled = false;
    if (chatsButton instanceof HTMLButtonElement) chatsButton.disabled = true;
    return;
  }
  projectNode.textContent = safeText(project.name, 'Project');
  title.textContent = safeText(conversation?.title, safeText(fallbackTask?.goal, 'ทำงานต่อในโปรเจกต์นี้'));
  summary.textContent = workspaceSummary(workspace);
  const details = [];
  if (conversation) details.push(`Multi Chat · ${Math.max(1, Number(context?.conversationCount) || 1)} ห้อง`);
  if (conversation?.updatedAt) details.push(`อัปเดต ${formatDate(conversation.updatedAt)}`);
  else if (fallbackTask?.updatedAt || fallbackTask?.createdAt) details.push(`อัปเดต ${formatDate(fallbackTask.updatedAt || fallbackTask.createdAt)}`);
  if (workspace?.checkpoint?.createdAt) details.push(`บันทึกงาน ${formatDate(workspace.checkpoint.createdAt)}`);
  meta.textContent = details.join(' · ');
  memory.textContent = project.memoryReady === true ? 'Memory พร้อม · AWH จำบริบทของ Project นี้' : 'Project + Chat + สถานะงานเชื่อมต่อกัน';
  if (continueButton instanceof HTMLButtonElement) continueButton.disabled = false;
  if (chatsButton instanceof HTMLButtonElement) chatsButton.disabled = !context?.project?.projectId;
}

function renderRecentWork() {
  const host = $('dashboard-recent-work');
  if (!host) return;
  host.replaceChildren();
  const projects = Array.isArray(state.control?.projects) ? [...state.control.projects] : [];
  const workers = Array.isArray(state.control?.workers) ? state.control.workers : [];
  const tasks = Array.isArray(state.control?.tasks) ? [...state.control.tasks].sort(compareRecent) : [];
  const items = [];
  for (const task of tasks.slice(0, 4)) {
    const project = projects.find((entry) => entry.projectId === task.projectId);
    const status = executionStatus(task, workers);
    items.push({ title: safeText(task.goal, 'งานใน AWH'), meta: [safeText(project?.name, 'โปรเจกต์'), status.title, status.actor].filter(Boolean).join(' · '), date: formatDate(task.updatedAt || task.createdAt), action: () => openTaskSurface('all', task.taskId) });
  }
  if (!items.length) {
    for (const project of projects.slice(0, 4)) items.push({ title: safeText(project.name, 'โปรเจกต์'), meta: project.memoryReady === true ? 'Memory พร้อม · โปรเจกต์ของฉัน' : 'โปรเจกต์ของฉัน', date: '', action: () => navigateWork(project.projectId) });
  }
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'awh-empty-card';
    empty.textContent = 'เริ่มงานแรกได้จากช่อง “วันนี้อยากให้ AWH ช่วยอะไร?” ด้านบน';
    host.append(empty);
    return;
  }
  for (const item of items) {
    const row = button('', 'awh-recent-item', item.action);
    const text = document.createElement('span');
    const title = document.createElement('strong'); title.textContent = item.title;
    const meta = document.createElement('small'); meta.textContent = item.meta;
    text.append(title, meta);
    const dateNode = document.createElement('time'); dateNode.textContent = item.date;
    row.append(text, dateNode);
    host.append(row);
  }
}

function renderMiniExecutionJourney(status) {
  const journey = document.createElement('div');
  journey.className = 'awh-execution-journey';
  for (const step of status.journey) {
    const item = document.createElement('span');
    item.className = `awh-execution-step ${step.state}`;
    item.textContent = step.label;
    journey.append(item);
  }
  return journey;
}

function renderTaskStatus() {
  const host = $('dashboard-active-tasks');
  if (!host) return;
  host.replaceChildren();
  const workers = Array.isArray(state.control?.workers) ? state.control.workers : [];
  const tasks = (Array.isArray(state.control?.tasks) ? state.control.tasks : []).filter((task) => ACTIVE_STATES.has(task.state)).sort(compareRecent).slice(0, 4);
  if (!tasks.length) {
    const ready = document.createElement('div'); ready.className = 'awh-ready-state'; ready.textContent = '✓ ไม่มีงานค้าง · พร้อมรับงานใหม่'; host.append(ready);
  } else {
    for (const task of tasks) {
      const row = button('', 'awh-status-item awh-status-item-button', () => openTaskSurface('all', task.taskId));
      const dot = document.createElement('span'); dot.className = 'awh-status-dot';
      const text = document.createElement('span');
      const title = document.createElement('strong'); title.textContent = safeText(task.goal, 'งาน AWH');
      const status = executionStatus(task, workers);
      const meta = document.createElement('small'); meta.textContent = [status.title, status.actor, Number.isFinite(status.progress) && status.progress > 0 ? `${status.progress}%` : ''].filter(Boolean).join(' · ');
      const journey = renderMiniExecutionJourney(status);
      text.append(title, meta, journey); row.append(dot, text); host.append(row);
    }
  }
  const approvals = (Array.isArray(state.control?.approvals) ? state.control.approvals : []).filter((item) => ['PENDING', 'WAITING'].includes(item.state || item.status));
  const banner = $('dashboard-approval-banner');
  if (banner) {
    banner.hidden = approvals.length === 0;
    banner.replaceChildren();
    if (approvals.length) {
      const text = document.createElement('span'); text.textContent = `มี ${approvals.length} รายการรออนุมัติ`;
      banner.append(text, button('เปิดดู', 'awh-text-action', () => openWork()));
    }
  }
}

function renderArtifacts() {
  const host = $('dashboard-artifacts');
  if (!host) return;
  host.replaceChildren();
  const artifacts = (Array.isArray(state.control?.artifacts) ? [...state.control.artifacts] : []).sort(compareRecent).slice(0, 6);
  if (!artifacts.length) {
    const empty = document.createElement('div'); empty.className = 'awh-empty-card'; empty.textContent = 'ผลงานและไฟล์ที่ AWH สร้างจะกลับมาอยู่ตรงนี้'; host.append(empty); return;
  }
  for (const artifact of artifacts) {
    const card = button('', 'awh-artifact-card awh-artifact-card-button', () => openFilesSurface(artifact.name || ''));
    const icon = document.createElement('span'); icon.textContent = '▤';
    const copy = document.createElement('span');
    const title = document.createElement('strong'); title.textContent = safeText(artifact.name || artifact.displayName || artifact.filename, 'ผลงานจาก AWH');
    const meta = document.createElement('small'); meta.textContent = [safeText(artifact.kind || artifact.type, 'ไฟล์'), formatDate(artifact.updatedAt || artifact.createdAt)].filter(Boolean).join(' · ');
    copy.append(title, meta); card.append(icon, copy); host.append(card);
  }
}

function renderRole() {
  const owner = $('dashboard-owner-center');
  if (owner) owner.hidden = state.control?.role !== 'OWNER';
  updateProductNavigation();
}

async function refreshDashboard() {
  if ($('workspace-view')?.hidden !== false) return;
  const control = await loadControlData();
  state.control = control;
  renderRole();
  renderHomePulse();
  renderContinuity();
  renderRecentWork();
  renderTaskStatus();
  renderArtifacts();
  renderTaskSurface();
  renderFilesSurface();
}

async function syncSurface() {
  mountDashboard();
  const workspace = $('workspace-view');
  const authenticated = workspace?.hidden === false;
  if (!authenticated) {
    document.body.classList.remove('product-dashboard-active');
    const dashboard = $(DASHBOARD_ID); if (dashboard) dashboard.hidden = true;
    state.control = null;
    return;
  }
  const dashboard = $(DASHBOARD_ID);
  if (dashboard && !document.body.classList.contains('product-dashboard-active') && !document.body.dataset.awhDashboardVisited) {
    document.body.dataset.awhDashboardVisited = '1';
    dashboard.hidden = false;
    document.body.classList.add('product-dashboard-active');
  }
  if (!state.control) {
    try { await refreshDashboard(); } catch { return; }
  }
}

function start() {
  mountDashboard();
  window.addEventListener('awh:work-context', (event) => {
    if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail !== 'object' || event.detail.schemaVersion !== 1) return;
    state.workContext = event.detail; renderContinuity();
  });
  const workspace = $('workspace-view');
  if (workspace) new MutationObserver(() => syncSurface().catch(() => undefined)).observe(workspace, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && document.body.classList.contains('product-dashboard-active')) refreshDashboard().catch(() => undefined); });
  state.refreshTimer = window.setInterval(() => { if (document.body.classList.contains('product-dashboard-active')) refreshDashboard().catch(() => undefined); }, 30000);
  syncSurface().catch(() => undefined);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
