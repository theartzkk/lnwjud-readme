import { loadControlData } from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';
import { SCHOOL_TOOLS, OWNER_TOOLS } from './tool-registry.js?release=__AWH_WEB_RELEASE_ID__';
import { LOCAL_TOOL_ACTIONS, mountSchoolTools } from './school-tools.js?release=__AWH_WEB_RELEASE_ID__';

const DASHBOARD_ID = 'product-dashboard';
const IMAGE_MAX_BYTES = 30 * 1024 * 1024;
const ACTIVE_STATES = new Set(['QUEUED', 'WAITING_FOR_WORKER', 'PREPARING', 'RUNNING', 'QA', 'WAITING_FOR_APPROVAL']);
const STATUS_LABELS = {
  QUEUED: 'กำลังจัดการ',
  WAITING_FOR_WORKER: 'กำลังหาเครื่องที่เหมาะ',
  PREPARING: 'กำลังเตรียม',
  RUNNING: 'กำลังทำงาน',
  QA: 'กำลังตรวจคุณภาพ',
  WAITING_FOR_APPROVAL: 'รออนุมัติ',
  COMPLETED: 'เสร็จแล้ว',
  FAILED: 'ต้องตรวจสอบ',
  CANCELLED: 'ยกเลิกแล้ว',
};

const state = {
  control: null,
  mounted: false,
  imageFile: null,
  imageUrl: null,
  refreshTimer: null,
  workContext: null,
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

function openWork(prompt = '', submit = false) {
  document.body.classList.remove('product-dashboard-active');
  const dashboard = $(DASHBOARD_ID);
  if (dashboard) dashboard.hidden = true;
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

function executionPlace(task) {
  const kind = task?.execution?.executorKind;
  if (kind === 'VPS') return 'ระบบกลาง AWH';
  if (kind === 'CODEX') return 'ผู้เชี่ยวชาญโค้ด';
  if (kind === 'DEVICE') {
    const worker = (Array.isArray(state.control?.workers) ? state.control.workers : []).find((item) => item.deviceId === task?.assignedDevice);
    return safeText(worker?.displayName, 'อุปกรณ์ที่เหมาะกับงาน');
  }
  return '';
}

function workspaceSummary(workspace) {
  const status = workspace?.syncStatus;
  if (status === 'SYNCED') return 'บริบทงานถูกบันทึกไว้แล้ว พร้อมทำต่อจากอุปกรณ์อื่น';
  if (status === 'HANDOFF_REQUIRED') return `มีงานเปิดอยู่บน ${safeText(workspace?.lease?.owner?.displayName, 'อีกอุปกรณ์หนึ่ง')} · AWH รักษาความต่อเนื่องไว้ให้`;
  if (status === 'SOURCE_OFFLINE') return 'อุปกรณ์ต้นทางออฟไลน์ แต่สถานะที่บันทึกไว้ยังพร้อมให้ทำต่อ';
  if (status === 'UNSYNCED_CHANGES') return 'มีงานจากอุปกรณ์ที่ยังต้องบันทึกสถานะให้สมบูรณ์ก่อนส่งต่อ';
  return 'AWH จะจำ Project, Chat และสถานะงานให้เมื่อเริ่มทำงาน';
}

function returnHome() {
  if (!state.control?.authenticated) return;
  const dashboard = $(DASHBOARD_ID);
  if (!dashboard) return;
  dashboard.hidden = false;
  document.body.classList.add('product-dashboard-active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  refreshDashboard().catch(() => undefined);
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
  hero.className = 'awh-home-hero';
  hero.innerHTML = '<div class="awh-home-kicker">AWH · ผู้ช่วยงานโรงเรียน</div><h1>วันนี้อยากให้ AWH ช่วยอะไร?</h1><p>บอกเป็นภาษาปกติได้เลย AWH จะเลือกวิธีที่เหมาะให้เอง</p>';
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

  const continuity = document.createElement('section');
  continuity.id = 'dashboard-continuity';
  continuity.className = 'awh-home-section awh-continuity';
  continuity.innerHTML = '<div class="awh-section-heading"><div><span>ทำต่อจากเดิม</span><h2>กลับมาทำงานได้ทันที</h2></div><small id="dashboard-continuity-memory">AWH จำบริบทของงานให้</small></div><div class="awh-continuity-card"><div class="awh-continuity-copy"><span id="dashboard-continuity-project" class="awh-context-chip">Project</span><h3 id="dashboard-continuity-title">กำลังเตรียมงานล่าสุด…</h3><p id="dashboard-continuity-summary">AWH กำลังเชื่อมงานล่าสุดกับ Dashboard</p><div id="dashboard-continuity-meta" class="awh-context-meta"></div></div><div class="awh-continuity-actions"><button id="dashboard-continue-work" class="awh-command-send" type="button">ทำงานต่อ</button><button id="dashboard-open-chats" class="awh-secondary-action" type="button">Multi Chat</button></div></div>';

  const tools = document.createElement('section');
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
  overview.className = 'awh-home-overview';
  overview.innerHTML = '<section class="awh-home-section awh-recent-panel"><div class="awh-section-heading"><div><span>ทำงานต่อ</span><h2>งานล่าสุดของฉัน</h2></div><button id="dashboard-open-work" class="awh-text-action" type="button">เปิด AI Workspace</button></div><div id="dashboard-recent-work" class="awh-recent-list"></div></section><section class="awh-home-section awh-side-panel"><div class="awh-section-heading"><div><span>สถานะ</span><h2>งานที่กำลังทำ</h2></div></div><div id="dashboard-active-tasks" class="awh-status-list"></div><div id="dashboard-approval-banner" class="awh-approval-banner" hidden></div></section>';

  const files = document.createElement('section');
  files.className = 'awh-home-section';
  files.innerHTML = '<div class="awh-section-heading"><div><span>ไฟล์และผลงาน</span><h2>ล่าสุด</h2></div></div><div id="dashboard-artifacts" class="awh-artifact-grid"></div>';

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
    tasks: () => openWork(),
    devices: () => openAccountTab('devices'),
    system: () => openAccountTab('system'),
  };
  for (const tool of OWNER_TOOLS) ownerGrid.append(createToolCard({ ...tool, action: ownerActions[tool.id] }));
  owner.append(ownerGrid);

  const imageTool = createImageTool();
  dashboard.append(hero, continuity, tools, overview, files, owner, imageTool);
  mountSchoolTools(dashboard);
  main.append(dashboard);

  $('dashboard-open-work')?.addEventListener('click', () => openWork());
  $('dashboard-continue-work')?.addEventListener('click', () => { const context = state.workContext; const projectId = context?.project?.projectId; if (projectId) navigateWork(projectId, context?.conversation?.conversationId || null); else openWork(); });
  $('dashboard-open-chats')?.addEventListener('click', () => { const context = state.workContext; const projectId = context?.project?.projectId; if (projectId) navigateWork(projectId, context?.conversation?.conversationId || null, true); else { openWork(); window.setTimeout(() => $('conversation-open')?.click(), 0); } });
  installHomeButton();
  state.mounted = true;
}

function installHomeButton() {
  if ($('dashboard-home-button')) return;
  const heading = document.querySelector('.workspace-heading');
  if (!(heading instanceof HTMLElement)) return;
  const home = button('⌂ หน้าแรก', 'dashboard-home-button', returnHome);
  home.id = 'dashboard-home-button';
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
  const tasks = Array.isArray(state.control?.tasks) ? [...state.control.tasks].sort(compareRecent) : [];
  const items = [];
  for (const task of tasks.slice(0, 4)) {
    const project = projects.find((entry) => entry.projectId === task.projectId);
    items.push({ title: safeText(task.goal, 'งานใน AWH'), meta: [safeText(project?.name, 'โปรเจกต์'), STATUS_LABELS[task.state] || 'อัปเดตแล้ว', executionPlace(task)].filter(Boolean).join(' · '), date: formatDate(task.updatedAt || task.createdAt), action: () => navigateWork(task.projectId, task.conversationId || null) });
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

function renderTaskStatus() {
  const host = $('dashboard-active-tasks');
  if (!host) return;
  host.replaceChildren();
  const tasks = (Array.isArray(state.control?.tasks) ? state.control.tasks : []).filter((task) => ACTIVE_STATES.has(task.state)).sort(compareRecent).slice(0, 4);
  if (!tasks.length) {
    const ready = document.createElement('div'); ready.className = 'awh-ready-state'; ready.textContent = '✓ ไม่มีงานค้าง · พร้อมรับงานใหม่'; host.append(ready);
  } else {
    for (const task of tasks) {
      const row = document.createElement('div'); row.className = 'awh-status-item';
      const dot = document.createElement('span'); dot.className = 'awh-status-dot';
      const text = document.createElement('span');
      const title = document.createElement('strong'); title.textContent = safeText(task.goal, 'งาน AWH');
      const meta = document.createElement('small'); meta.textContent = [STATUS_LABELS[task.state] || 'กำลังอัปเดต', executionPlace(task), Number.isFinite(task.progress) && task.progress > 0 ? `${task.progress}%` : ''].filter(Boolean).join(' · ');
      text.append(title, meta); row.append(dot, text); host.append(row);
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
    const card = document.createElement('div'); card.className = 'awh-artifact-card';
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
}

async function refreshDashboard() {
  if ($('workspace-view')?.hidden !== false) return;
  const control = await loadControlData();
  state.control = control;
  renderRole();
  renderContinuity();
  renderRecentWork();
  renderTaskStatus();
  renderArtifacts();
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
