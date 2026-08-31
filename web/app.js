import { loadWebData } from './hub-read-adapter.js?release=__AWH_WEB_RELEASE_ID__';
import { executionStatus } from './execution-ux.js?release=__AWH_WEB_RELEASE_ID__';
import { closeAwhDialog, openAwhDialog } from './navigation.js?release=__AWH_WEB_RELEASE_ID__';
import {
  cancelTask, changePassword, changeUsername, createConversation, createMemory, createProject, createRecoveryCodes, decideApproval,
  exportWorkspace, invitePerson, listAuthSessions, listPeople, loadAuthProfile, loadControlData, loadConversation,
  loadConversations, loadCurrentContext, loadMemory, loadMemoryImportReport, loadOwnerSelfServiceStatus,
  loadProductSettings, loadProviderProjectRouting, loadProviderStatus, loadCapabilities, loadSystemReadiness, loadWorkspaceContinuity, login, logout,
  recover, resetPassword, resetProductSetting, revokeAuthSession, revokePerson, saveCurrentContext, stepUp, submitWorkMessage,
  testProviderConnection, updateAuthProfile, updateConversation, updateMemory, updatePersonAccess, updateProductSetting,
  updateProviderCredential, updateProviderPolicy, updateProviderProjectRouting, uploadConversationAttachments,
} from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';

(() => {
  const $ = (id) => document.getElementById(id);
  const MAX_ATTACHMENT_BYTES = 60 * 1024 * 1024;
  const MICRO_BAHT = 1000000;
  const DESKTOP_PACKAGES = [['downloads/AWH-macOS-x64.zip', 'macOS Intel', 'mac'], ['downloads/AWH-Windows-x64.zip', 'Windows x64', 'windows']];
  const state = { control: null, selectedProjectId: null, selectedConversationId: null, conversations: [], conversation: null, conversationAvailable: false, workspaceContinuity: null, productSettings: null, provider: null, profile: null, ownerStatus: null, providerRouting: null, systemReadiness: null, capabilities: null, people: [], memory: [], memoryImport: null, pendingAttachments: [], refreshTimer: null, conversationTimer: null, resetToken: null, selectedArtifact: null, artifactPreviewUrl: null };
  let desktopReleasePromise = null;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => undefined);

  function message(id, value = '') { const node = $(id); if (node) node.textContent = value; }
  function date(value) { const time = Date.parse(value || ''); return Number.isFinite(time) ? new Date(time).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : ''; }
  function ensureStepUpForm() {
    const existing = $('step-up-form'); if (existing) return existing;
    const before = $('username-form'); if (!before) throw new Error('AWH account surface is unavailable');
    const form = document.createElement('form'); form.id = 'step-up-form'; form.className = 'account-form';
    const title = document.createElement('h3'); title.textContent = 'ยืนยันการเปลี่ยนแปลงสำคัญ';
    const copy = document.createElement('p'); copy.className = 'muted'; copy.textContent = 'สำหรับการตั้งค่า AI การจัดการผู้ใช้ และรหัสกู้คืน AWH จะขอรหัสผ่านอีกครั้งทุก 15 นาที';
    const label = document.createElement('label'); label.htmlFor = 'step-up-password'; label.textContent = 'รหัสผ่านปัจจุบัน';
    const password = document.createElement('input'); password.id = 'step-up-password'; password.type = 'password'; password.autocomplete = 'current-password';
    const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'secondary-button'; submit.textContent = 'ยืนยันรหัสผ่าน';
    const result = document.createElement('p'); result.id = 'step-up-message'; result.className = 'form-message'; result.setAttribute('role', 'status');
    form.append(title, copy, label, password, submit, result); before.before(form); return form;
  }
  function selectedProject() { return state.control?.projects?.find((project) => project.projectId === state.selectedProjectId) || null; }
  function preferredProjectId(projects) {
    const available = new Set(projects.map((project) => project.projectId));
    const recentTask = [...(Array.isArray(state.control?.tasks) ? state.control.tasks : [])]
      .filter((task) => available.has(task.projectId))
      .sort((a, b) => (Date.parse(b.updatedAt || b.createdAt || '') || 0) - (Date.parse(a.updatedAt || a.createdAt || '') || 0))[0];
    return recentTask?.projectId || projects[0]?.projectId || null;
  }
  function publishWorkContext() {
    const project = selectedProject();
    const conversation = state.conversations.find((item) => item.conversationId === state.selectedConversationId) || state.conversation?.conversation || null;
    window.dispatchEvent(new CustomEvent('awh:work-context', { detail: {
      schemaVersion: 1,
      project: project ? { projectId: project.projectId, name: project.name, memoryReady: project.memoryReady === true } : null,
      conversation: conversation ? { conversationId: conversation.conversationId, title: conversation.title || 'Work', updatedAt: conversation.updatedAt || null } : null,
      conversationCount: state.conversations.length,
      workspace: state.workspaceContinuity,
    } }));
  }
  function taskExecutionStatus(task) { return executionStatus(task, Array.isArray(state.control?.workers) ? state.control.workers : []); }
  function stateText(task) { return taskExecutionStatus(task).title; }
  function stateClass(task) { return task?.state === 'COMPLETED' ? 'completed' : task?.state === 'FAILED' ? 'failed' : task?.state === 'WAITING_FOR_APPROVAL' ? 'approval' : ''; }
  function progressText(task) { return taskExecutionStatus(task).detail; }

  function size(bytes) { if (!Number.isFinite(bytes) || bytes < 0) return ''; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
  function renderPendingAttachments() {
    const list = $('pending-attachments'); list.replaceChildren(); list.hidden = state.pendingAttachments.length === 0;
    state.pendingAttachments.forEach((file, index) => { const item = document.createElement('li'); const name = document.createElement('span'); name.textContent = `${file.name} · ${size(file.size)}`; const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'ลบ'; remove.setAttribute('aria-label', `ลบ ${file.name}`); remove.addEventListener('click', () => { state.pendingAttachments.splice(index, 1); renderPendingAttachments(); }); item.append(name, remove); list.append(item); });
  }
  function renderMessageAttachments(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) return null;
    const list = document.createElement('ul'); list.className = 'message-attachments';
    for (const attachment of attachments) {
      const item = document.createElement('li'); const label = `↳ ${attachment.name || 'ไฟล์แนบ'}${Number.isFinite(attachment.sizeBytes) ? ` · ${size(attachment.sizeBytes)}` : ''}`;
      if (attachment.pending || typeof attachment.downloadUrl !== 'string' || !attachment.downloadUrl.startsWith('/api/v1/control/attachments/')) { const pending = document.createElement('span'); pending.textContent = label; item.append(pending); }
      else { const link = document.createElement('a'); link.href = attachment.downloadUrl; link.textContent = label; link.setAttribute('download', ''); item.append(link); }
      list.append(item);
    }
    return list;
  }

  function artifactUrl(artifact) {
    const value = typeof artifact?.downloadUrl === 'string' ? artifact.downloadUrl : '';
    return /^\/api\/v1\/control\/artifacts\/[0-9a-f-]{36}\/download$/i.test(value) ? value : null;
  }
  function suggestWork(prompt, submit = false) {
    const input = $('goal-input'); if (!(input instanceof HTMLTextAreaElement)) return;
    input.value = prompt; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
    if (submit && $('goal-form')?.requestSubmit) $('goal-form').requestSubmit();
  }
  function renderArtifactCard(artifact) {
    const card = document.createElement('article'); card.className = 'result-file-card';
    const icon = document.createElement('span'); icon.className = 'result-file-icon';
    const name = String(artifact?.name || 'ไฟล์ผลลัพธ์'); const extension = name.includes('.') ? name.split('.').pop().toUpperCase() : 'FILE';
    icon.textContent = extension === 'DOCX' ? 'W' : extension === 'PDF' ? 'PDF' : '▤';
    const copy = document.createElement('span'); copy.className = 'result-file-copy';
    const title = document.createElement('strong'); title.textContent = name;
    const meta = document.createElement('small'); meta.textContent = [extension, Number.isFinite(artifact?.sizeBytes) ? size(artifact.sizeBytes) : '', 'พร้อมใช้'].filter(Boolean).join(' · ');
    copy.append(title, meta); card.append(icon, copy);
    const url = artifactUrl(artifact);
    if (url) {
      const actions = document.createElement('span'); actions.className = 'result-file-actions';
      const open = document.createElement('button'); open.type = 'button'; open.textContent = 'เปิด'; open.addEventListener('click', () => void openArtifactWorkspace(artifact));
      const download = document.createElement('a'); download.href = url; download.setAttribute('download', name); download.textContent = 'ดาวน์โหลด';
      actions.append(open, download);
      if (extension === 'DOCX') {
        const pdf = document.createElement('button'); pdf.type = 'button'; pdf.textContent = 'ทำ PDF'; pdf.addEventListener('click', () => suggestWork('ทำไฟล์นี้เป็น PDF', true)); actions.append(pdf);
        }
      card.append(actions);
    }
    return card;
  }
  function clearArtifactWorkspace() {
    if (state.artifactPreviewUrl) { URL.revokeObjectURL(state.artifactPreviewUrl); state.artifactPreviewUrl = null; }
    state.selectedArtifact = null;
    $('artifact-preview')?.replaceChildren(); $('artifact-workspace-actions')?.replaceChildren();
  }
  function artifactWorkspaceMessage(title, detail = '') {
    const box = document.createElement('div'); box.className = 'artifact-preview-message';
    const heading = document.createElement('strong'); heading.textContent = title; box.append(heading);
    if (detail) { const copy = document.createElement('p'); copy.textContent = detail; box.append(copy); }
    return box;
  }
  async function openArtifactWorkspace(artifact) {
    clearArtifactWorkspace(); state.selectedArtifact = artifact;
    const name = String(artifact?.name || 'ไฟล์ผลลัพธ์'); const extension = name.includes('.') ? name.split('.').pop().toUpperCase() : 'FILE';
    const url = artifactUrl(artifact); $('artifact-sheet-title').textContent = name;
    $('artifact-sheet-meta').textContent = [extension, Number.isFinite(artifact?.sizeBytes) ? size(artifact.sizeBytes) : '', 'อยู่ในงานนี้'].filter(Boolean).join(' · ');
    const preview = $('artifact-preview'); const actions = $('artifact-workspace-actions');
    const download = document.createElement('a'); download.className = 'secondary-button'; download.textContent = 'ดาวน์โหลด'; if (url) { download.href = url; download.setAttribute('download', name); }
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary-button'; edit.textContent = 'แก้ด้วย AWH'; edit.addEventListener('click', () => { closeSheet('artifact-sheet'); suggestWork('แก้ไฟล์นี้ ', false); });
    actions.append(download, edit);
    if (extension === 'DOCX') { const pdf = document.createElement('button'); pdf.type = 'button'; pdf.className = 'secondary-button'; pdf.textContent = 'ทำ PDF'; pdf.addEventListener('click', () => { closeSheet('artifact-sheet'); suggestWork('ทำไฟล์นี้เป็น PDF', true); }); actions.append(pdf); }
    openSheet('artifact-sheet');
    if (!url) { preview.replaceChildren(artifactWorkspaceMessage('ยังไม่มีไฟล์สำหรับเปิดดู', 'ผลลัพธ์ยังผูกกับงานเดิมและจะไม่ถูกสร้างซ้ำ')); return; }
    if (['DOCX','DOC','XLSX','XLS','PPTX','PPT','ZIP'].includes(extension)) { preview.replaceChildren(artifactWorkspaceMessage(extension === 'DOCX' ? 'ไฟล์ Word พร้อมใช้' : `ไฟล์ ${extension} พร้อมใช้`, extension === 'DOCX' ? 'ดาวน์โหลด ทำ PDF หรือสั่ง AWH แก้ต่อได้จากหน้านี้' : 'ไฟล์ชนิดนี้ยังไม่ถูกฝังในหน้าเว็บเพื่อรักษาความถูกต้องของต้นฉบับ')); return; }
    preview.replaceChildren(artifactWorkspaceMessage('กำลังเปิดไฟล์…'));
    try {
      const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: '*/*' } });
      if (!response.ok) throw new Error('ARTIFACT_PREVIEW_UNAVAILABLE');
      const mime = String(response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
      const length = Number(response.headers.get('Content-Length') || artifact?.sizeBytes || 0);
      if (length > 12 * 1024 * 1024 && mime !== 'application/pdf' && !/^image\/(?:png|jpeg|webp|gif)$/.test(mime)) { preview.replaceChildren(artifactWorkspaceMessage('ไฟล์พร้อมดาวน์โหลด', 'ไฟล์นี้ใหญ่เกินขนาด preview ที่ปลอดภัย')); return; }
      if (mime === 'application/pdf') {
        const blob = await response.blob(); state.artifactPreviewUrl = URL.createObjectURL(blob);
        const frame = document.createElement('iframe'); frame.className = 'artifact-preview-frame'; frame.title = `ตัวอย่าง ${name}`; frame.src = state.artifactPreviewUrl; preview.replaceChildren(frame); return;
      }
      if (/^image\/(?:png|jpeg|webp|gif)$/.test(mime)) {
        const blob = await response.blob(); state.artifactPreviewUrl = URL.createObjectURL(blob);
        const image = document.createElement('img'); image.className = 'artifact-preview-image'; image.alt = name; image.src = state.artifactPreviewUrl; preview.replaceChildren(image); return;
      }
      if (['text/plain','text/csv','text/markdown','application/json'].includes(mime)) {
        const text = (await response.text()).slice(0, 250000); const pre = document.createElement('pre'); pre.className = 'artifact-preview-text'; pre.textContent = text; preview.replaceChildren(pre); return;
      }
      preview.replaceChildren(artifactWorkspaceMessage('ไฟล์พร้อมใช้', 'AWH ไม่ฝัง HTML, SVG หรือไฟล์ active content ลงใน workspace เพื่อป้องกันโค้ดจากไฟล์ทำงานในหน้า AWH'));
    } catch { preview.replaceChildren(artifactWorkspaceMessage('เปิดตัวอย่างไม่ได้ในขณะนี้', 'ไฟล์เดิมยังอยู่ครบและดาวน์โหลดได้จากปุ่มด้านล่าง')); }
  }
  function localProgressLabel(goal) {
    const value = String(goal || '');
    if (/(?:docx|word|เวิร์ด)/iu.test(value)) return 'AWH · กำลังเตรียมไฟล์ Word…';
    if (/(?:บันทึกข้อความ|หนังสือราชการ|ขออนุมัติ|ขอเบิก|ไปราชการ)/u.test(value)) return 'AWH · กำลังจัดทำเอกสารราชการ…';
    if (/pdf/iu.test(value)) return 'AWH · กำลังจัดการ PDF…';
    return 'AWH · กำลังจัดการงาน…';
  }
  function resizeGoalInput() {
    const input = $('goal-input'); if (!(input instanceof HTMLTextAreaElement)) return;
    input.style.height = 'auto'; input.style.height = `${Math.min(140, Math.max(52, input.scrollHeight))}px`;
  }

  function renderInspectionEvidence(artifact) {
    const details = document.createElement('details'); details.className = 'inspection-evidence';
    const heading = document.createElement('summary'); heading.textContent = '↳ ดูหลักฐานที่ AWH ใช้วิเคราะห์'; details.append(heading);
    const body = document.createElement('div'); body.textContent = 'กำลังโหลดหลักฐาน…'; details.append(body); let loaded = false;
    details.addEventListener('toggle', async () => {
      if (!details.open || loaded) return; loaded = true;
      try {
        const response = await fetch(artifact.downloadUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('EVIDENCE_UNAVAILABLE'); const data = await response.json();
        if (data?.kind !== 'project-inspection' || data?.readOnly !== true || !data?.evidence) throw new Error('EVIDENCE_INVALID');
        body.replaceChildren(); const meta = document.createElement('p'); meta.textContent = `Source revision ${String(data.vaultRevisionId || '').slice(0, 8)} · read-only`;
        const list = document.createElement('ul');
        for (const search of (data.evidence.searches || []).slice(0, 8)) { const item = document.createElement('li'); const matches = (search.matches || []).slice(0, 6).map((match) => `${match.path}${Number.isInteger(match.line) ? `:${match.line}` : ''}`).join(', '); item.textContent = `ค้นหา “${search.query || ''}” → ${matches || 'ไม่พบผล'}`; list.append(item); }
        for (const read of (data.evidence.reads || []).slice(0, 16)) { const item = document.createElement('li'); item.textContent = `อ่าน ${read.path || 'ไฟล์'} · ${Number.isInteger(read.lineCount) ? `${read.lineCount} บรรทัด` : 'ตรวจ hash แล้ว'} · SHA ${String(read.sha256 || '').slice(0, 12)}`; list.append(item); }
        body.append(meta, list);
      } catch { body.textContent = 'เปิดหลักฐานไม่ได้ในขณะนี้ แต่ไฟล์หลักฐานยังผูกกับงานเดิมอยู่'; }
    });
    return details;
  }

  function setSurface(data) {
    document.title = data?.product?.shortName ? `${data.product.shortName} — Work` : 'AWH';
    const control = data?.control;
    const status = control?.authenticated ? 'พร้อมทำงาน' : control?.available ? 'เข้าสู่ระบบ' : 'ยังไม่พร้อม';
    message('surface-state', status);
    $('login-form').querySelector('button[type="submit"]').disabled = control?.available !== true;
    if (control?.available !== true && control?.error) message('login-message', control.error);
  }

  function settingValue(key, fallback) { const item = state.productSettings?.[key]; return item && Object.prototype.hasOwnProperty.call(item, 'value') ? item.value : fallback; }
  function applyProductSettings() {
    const name = settingValue('productName', 'Art’s Workspace Hub');
    const tagline = settingValue('tagline', 'Your Projects. One Workspace. Anywhere.');
    const accent = settingValue('accent', '#ff7a1a');
    document.title = `${name} — Work`; message('product-name', name); message('product-tagline', tagline);
    document.documentElement.style.setProperty('--accent', accent);
    $('setting-product-name').value = name; $('setting-short-name').value = settingValue('shortName', 'AWH'); $('setting-tagline').value = tagline; $('setting-welcome').value = settingValue('welcome', 'เริ่มคุยกับ Art’s Workspace Hub ได้เลย'); $('setting-accent').value = accent;
    const founder = $('setting-founder-name'); if (founder) founder.value = settingValue('founderName', 'Art');
    const founderCredit = $('setting-founder-credit'); if (founderCredit) founderCredit.value = settingValue('founderCredit', 'Founder · Product Creator · System Concept');
  }

  function isOwner() { return state.control?.role === 'OWNER'; }
  function baht(microunits) { return (Number.isInteger(microunits) ? microunits / MICRO_BAHT : 0).toLocaleString('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function micros(id) { const value = Number.parseFloat($(id).value); if (!Number.isFinite(value) || value < 0) throw new Error('กรอกจำนวนเงินให้ถูกต้อง'); const micro = Math.round(value * MICRO_BAHT); if (!Number.isSafeInteger(micro)) throw new Error('จำนวนเงินมากเกินไป'); return micro; }
  function renderProvider() {
    const provider = state.provider;
    if (!provider) { message('provider-status', 'ยังไม่ได้ตั้งค่า AI ของ AWH'); return; }
    const budget = provider.budget || {}; const credential = provider.credential || {}; const pricing = provider.pricing || {};
    message('provider-status', provider.available ? `AI เดือนนี้ ${baht(budget.usedMicrounits)} จาก ${baht(budget.monthlyMicrounits)} · เหลือ ${baht(budget.remainingMicrounits)}` : (provider.keyConfigured ? `เชื่อม API แล้ว · ทดสอบล่าสุด ${credential.lastTestStatus === 'PASS' ? 'ผ่าน' : credential.lastTestStatus === 'FAILED' ? 'ไม่ผ่าน' : 'ยังไม่ทดสอบ'}` : 'ยังไม่ได้เชื่อม OpenAI API key'));
    $('provider-budget').value = (Number.isInteger(budget.monthlyMicrounits) ? budget.monthlyMicrounits / MICRO_BAHT : 0).toFixed(2); $('provider-warning').value = (Number.isInteger(budget.warningMicrounits) ? budget.warningMicrounits / MICRO_BAHT : 0).toFixed(2); $('provider-enabled').checked = provider.enabled === true;
    if ($('provider-routing-strategy')) $('provider-routing-strategy').value = ['SAVER','BALANCED','QUALITY'].includes(provider.routingStrategy) ? provider.routingStrategy : 'BALANCED';
    const models = provider.models || {}; for (const [id, value] of [['provider-model-fast', models.fast], ['provider-model-balanced', models.balanced], ['provider-model-strong', models.strong]]) if ($(id) && typeof value === 'string') $(id).value = value;
    const pricingSummary = $('provider-pricing-summary'); if (pricingSummary) { pricingSummary.replaceChildren(); const rows = Array.isArray(pricing.catalog) ? pricing.catalog : []; const lead = document.createElement('p'); lead.className = 'muted'; lead.textContent = pricing.mode === 'CATALOG' ? 'ราคามาตรฐานที่ AWH ใช้ประมาณค่าใช้จ่าย (รวม cached input และ cache write)' : 'กำลังใช้การคิดราคาแบบเดิม บันทึกหน้านี้หนึ่งครั้งเพื่อเปลี่ยนเป็นตารางราคามาตรฐาน'; pricingSummary.append(lead); for (const row of rows) { const item = document.createElement('div'); item.className = 'session-item'; item.textContent = `${row.model || 'model'} · input ${baht(row.inputMicrounitsPerMillion || 0)} · cached ${baht(row.cachedInputMicrounitsPerMillion || 0)} · output ${baht(row.outputMicrounitsPerMillion || 0)} / 1M tokens`; pricingSummary.append(item); } }
    if ($('provider-project-routing')) $('provider-project-routing').value = state.providerRouting?.routingMode || 'AUTO';
    const usage = $('provider-usage'); if (usage) { usage.replaceChildren(); const rows = Array.isArray(provider.usageByProject) ? provider.usageByProject : []; for (const row of rows) { const item = document.createElement('li'); item.textContent = `${row.projectName || 'Project'} · ${baht(row.estimatedMicrounits || 0)}`; usage.append(item); } if (!usage.childElementCount) usage.textContent = 'ยังไม่มีการใช้งานที่คิดค่าใช้จ่าย'; }
  }
  function renderCapabilitySurface() {
    const data = state.capabilities; if (!data) return;
    const host = $('settings-panel-ai'); if (!host) return;
    let section = $('capability-overview');
    if (!section) {
      section = document.createElement('section'); section.id = 'capability-overview'; section.className = 'account-form';
      section.innerHTML = '<h3>AWH ทำอะไรได้บ้าง</h3><p id="capability-summary" class="muted"></p><div id="capability-list" class="session-list"></div>';
      host.append(section);
    }
    const summary = data.summary || {}; message('capability-summary', `พร้อมจากระบบกลาง ${summary.cloudReady || 0} · อุปกรณ์เสริม ${summary.optional || 0} · กำลังพัฒนา ${summary.planned || 0}`);
    const list = $('capability-list'); list.replaceChildren();
    for (const capability of data.capabilities || []) {
      const item = document.createElement('div'); item.className = 'session-item';
      const name = document.createElement('strong'); name.textContent = capability.displayName || 'ความสามารถ AWH';
      const stateLabel = capability.state === 'READY' ? (capability.cloudReady ? 'พร้อมใช้จาก AWH Cloud' : 'พร้อมใช้งาน') : capability.state === 'OPTIONAL' ? 'ใช้ได้เมื่อมีอุปกรณ์เสริม' : capability.state === 'PLANNED' ? 'กำลังพัฒนา' : 'ยังไม่พร้อม';
      const detail = document.createElement('span'); detail.textContent = `${stateLabel} · ${capability.description || ''}`; item.append(name, detail); list.append(item);
    }
    if (!list.childElementCount) list.textContent = 'Capability Fabric ยังไม่เปิดใช้งานบนระบบนี้';
  }

  function renderPeople() {
    const select = $('invite-project'); if (!select) return; select.replaceChildren();
    const projects = state.control?.projects || [];
    for (const project of projects) { const option = document.createElement('option'); option.value = project.projectId; option.textContent = project.name; select.append(option); }
    const list = $('people-list'); list.replaceChildren();
    for (const person of state.people) {
      const item = document.createElement('div'); item.className = 'session-item person-card';
      const head = document.createElement('div'); head.className = 'person-head';
      const label = document.createElement('strong'); label.textContent = `${person.displayName} · ${person.role === 'OWNER' ? 'เจ้าของ' : person.role === 'COLLABORATOR' ? 'ผู้ร่วมงาน' : person.role === 'APPROVER' ? 'ผู้อนุมัติ' : 'ดูอย่างเดียว'}`; head.append(label); item.append(head);
      if (person.status === 'ACTIVE' && person.role !== 'OWNER') {
        const editor = document.createElement('div'); editor.className = 'person-access-editor';
        const role = document.createElement('select'); for (const [value, text] of [['COLLABORATOR','ผู้ร่วมงาน'],['APPROVER','ผู้อนุมัติ'],['VIEWER','ดูอย่างเดียว']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = person.role === value; role.append(option); }
        const projectBox = document.createElement('div'); projectBox.className = 'person-projects';
        for (const project of projects) { const row = document.createElement('label'); row.className = 'check-row'; const input = document.createElement('input'); input.type = 'checkbox'; input.value = project.projectId; input.checked = Array.isArray(person.projectIds) && person.projectIds.includes(project.projectId); const text = document.createElement('span'); text.textContent = project.name; row.append(input, text); projectBox.append(row); }
        const actions = document.createElement('div'); actions.className = 'task-actions'; const save = document.createElement('button'); save.type = 'button'; save.className = 'secondary-button'; save.textContent = 'บันทึกสิทธิ์'; const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'text-button'; revoke.textContent = 'เพิกถอน';
        save.addEventListener('click', async () => { const projectIds = [...projectBox.querySelectorAll('input:checked')].map((node) => node.value); if (!projectIds.length) { message('people-message', 'เลือกอย่างน้อย 1 โปรเจกต์'); return; } save.disabled = true; try { await updatePersonAccess(person.userId, role.value, projectIds); state.people = (await listPeople()).people || []; renderPeople(); message('people-message', 'บันทึกสิทธิ์แล้ว ผู้ใช้นั้นจะเข้าสู่ระบบใหม่เพื่อรับสิทธิ์ล่าสุด'); } catch (error) { message('people-message', error instanceof Error ? error.message : 'ยังบันทึกสิทธิ์ไม่ได้'); } finally { save.disabled = false; } });
        revoke.addEventListener('click', async () => { revoke.disabled = true; try { await revokePerson(person.userId); state.people = (await listPeople()).people || []; renderPeople(); message('people-message', 'เพิกถอนบัญชีแล้ว'); } catch (error) { message('people-message', error instanceof Error ? error.message : 'ยังเพิกถอนบัญชีไม่ได้'); revoke.disabled = false; } });
        actions.append(save, revoke); editor.append(role, projectBox, actions); item.append(editor);
      }
      list.append(item);
    }
  }

  function memoryScopeLabel(scope) { return ({ owner: 'ความจำของฉัน', constitution: 'หลักการทำงาน', project: 'ความจำของโปรเจกต์', archive: 'บันทึกย้อนหลัง' })[scope] || 'ความจำของ AWH'; }
  function memoryFreshnessLabel(freshness) { return ({ current: 'ปัจจุบัน', founding: 'จุดตั้งต้น', stale: 'ควรตรวจทาน', superseded: 'ถูกแทนด้วยข้อมูลปัจจุบัน' })[freshness] || 'บันทึกไว้'; }
  function ensureMemorySurface() {
    const existing = $('memory-settings'); if (existing) return existing;
    const host = $('memory-host'); if (!host) throw new Error('AWH memory settings surface is unavailable');
    const section = document.createElement('section'); section.id = 'memory-settings'; section.className = 'account-form';
    const title = document.createElement('h3'); title.textContent = 'ความจำของ AWH';
    const copy = document.createElement('p'); copy.className = 'muted'; copy.textContent = 'แก้ไข ปักหมุด แชร์ หรือให้ AWH ลืมสิ่งที่ไม่ต้องใช้แล้วได้ ข้อมูล Source of Truth ปัจจุบันมีสิทธิ์เหนือความจำเสมอ';
    const search = document.createElement('form'); search.id = 'memory-search-form'; search.className = 'compact-form';
    search.innerHTML = '<label for="memory-search">ค้นหาความจำ</label><input id="memory-search" maxlength="120" autocomplete="off" placeholder="ค้นหาตามเรื่อง แหล่งที่มา หรือคำสำคัญ…" /><button class="secondary-button" type="submit">ค้นหา</button>';
    const refresh = document.createElement('button'); refresh.id = 'memory-refresh'; refresh.type = 'button'; refresh.className = 'secondary-button'; refresh.textContent = 'แสดงทั้งหมด';
    const importSummary = document.createElement('p'); importSummary.id = 'memory-import-summary'; importSummary.className = 'muted';
    const list = document.createElement('div'); list.id = 'memory-list'; list.className = 'session-list';
    const result = document.createElement('p'); result.id = 'memory-message'; result.className = 'form-message'; result.setAttribute('role', 'status');
    const create = document.createElement('form'); create.id = 'memory-create-form'; create.className = 'compact-form';
    create.innerHTML = '<label for="memory-create-category">เพิ่มความจำที่ควรจำ</label><select id="memory-create-category"><option value="WORKING_PREFERENCE">รูปแบบการทำงาน</option><option value="AI_PERSONALITY">วิธีที่ AWH ควรตอบ</option><option value="OWNER_PROFILE">ข้อมูลบริบทของฉัน</option><option value="OWNER_CONSTITUTION">หลักการทำงาน</option><option value="PROJECT_MEMORY">ความจำของโปรเจกต์ที่เลือก</option></select><textarea id="memory-create-content" maxlength="2000" rows="3" placeholder="บอกสิ่งที่ AWH ควรจำอย่างกระชับ…"></textarea><button class="secondary-button" type="submit">บันทึกความจำ</button>';
    section.append(title, copy, create, search, refresh, importSummary, list, result); host.append(section);
    refresh.addEventListener('click', () => { $('memory-search').value = ''; void refreshMemory(); });
    search.addEventListener('submit', (event) => { event.preventDefault(); void refreshMemory(); });
    create.addEventListener('submit', async (event) => {
      event.preventDefault(); const category = $('memory-create-category').value; const content = $('memory-create-content').value.trim(); const project = selectedProject();
      if (!content) { message('memory-message', 'กรอกสิ่งที่ต้องการให้ AWH จำก่อน'); return; }
      const projectScoped = category === 'PROJECT_MEMORY'; const scope = projectScoped ? 'project' : category === 'OWNER_CONSTITUTION' ? 'constitution' : 'owner';
      if (projectScoped && !project) { message('memory-message', 'เลือกโปรเจกต์ก่อนบันทึกความจำของโปรเจกต์'); return; }
      message('memory-message', 'กำลังบันทึกความจำ…');
      try { await createMemory({ scope, projectId: projectScoped ? project.projectId : null, category, content, tags: [] }); $('memory-create-content').value = ''; await refreshMemory(); message('memory-message', 'บันทึกความจำแล้ว'); }
      catch (error) { message('memory-message', error instanceof Error ? error.message : 'ยังบันทึกความจำไม่ได้'); }
    });
    return section;
  }

  /** Settings panels are projections of the canonical M10/M11 authorities. */
  function ensureOwnerSelfServiceSurface() {
    const existing = $('my-awh-settings'); if (existing) return existing;
    const host = $('my-awh-host'); if (!host) throw new Error('AWH owner settings surface is unavailable');
    const section = document.createElement('section'); section.id = 'my-awh-settings'; section.className = 'account-form';
    section.innerHTML = '<h3>My AWH</h3><p class="muted">บอก AWH ว่าคุณอยากทำงานอย่างไร ข้อมูลนี้เป็นส่วนตัวและแยกจากความจำของโปรเจกต์</p><form id="owner-profile-form" class="compact-form"><label for="owner-display-name">ชื่อที่แสดง</label><input id="owner-display-name" maxlength="80" autocomplete="name" /><button class="secondary-button" type="submit">บันทึกโปรไฟล์</button></form><form id="owner-foundation-form" class="compact-form"><label for="founder-name">ผู้ก่อตั้ง / ผู้คิดระบบ</label><input id="founder-name" maxlength="120" autocomplete="off" /><label for="founder-credit">บทบาทในผลิตภัณฑ์</label><input id="founder-credit" maxlength="160" autocomplete="off" /><button class="secondary-button" type="submit">บันทึกข้อมูลผลิตภัณฑ์</button></form><p id="my-awh-message" class="form-message" role="status"></p>';
    host.append(section);
    $('owner-profile-form').addEventListener('submit', async (event) => {
      event.preventDefault(); message('my-awh-message', 'กำลังบันทึกโปรไฟล์…');
      try { const data = await updateAuthProfile($('owner-display-name').value); state.profile = data.identity || data; message('my-awh-message', 'บันทึกโปรไฟล์แล้ว'); }
      catch (error) { message('my-awh-message', error instanceof Error ? error.message : 'ยังบันทึกโปรไฟล์ไม่ได้'); }
    });
    $('owner-foundation-form').addEventListener('submit', async (event) => {
      event.preventDefault(); message('my-awh-message', 'กำลังบันทึกข้อมูลผลิตภัณฑ์…');
      try { state.productSettings = (await updateProductSetting('founderName', $('founder-name').value)).settings; state.productSettings = (await updateProductSetting('founderCredit', $('founder-credit').value)).settings; applyProductSettings(); message('my-awh-message', 'บันทึกข้อมูลผลิตภัณฑ์แล้ว'); }
      catch (error) { message('my-awh-message', error instanceof Error ? error.message : 'ยังบันทึกข้อมูลผลิตภัณฑ์ไม่ได้'); }
    });
    return section;
  }

  function ensureProviderSelfServiceSurface() {
    const existing = $('provider-credential-form'); if (existing) return existing;
    const policy = $('provider-policy-form'); if (!policy) throw new Error('AWH provider settings surface is unavailable');
    const models = document.createElement('details'); models.className = 'technical-entry provider-advanced';
    models.innerHTML = '<summary>ขั้นสูง · โมเดลและการกำหนดรายโปรเจกต์</summary><div class="advanced-ai-fields"><label for="provider-model-fast">ประหยัด · Luna</label><input id="provider-model-fast" maxlength="120" autocomplete="off" readonly /><label for="provider-model-balanced">สมดุล · Terra</label><input id="provider-model-balanced" maxlength="120" autocomplete="off" readonly /><label for="provider-model-strong">งานสำคัญ · Sol</label><input id="provider-model-strong" maxlength="120" autocomplete="off" readonly /><ul id="provider-usage" class="session-list"></ul></div>';
    const enabled = $('provider-enabled');
    const enabledRow = enabled?.closest('label');
    if (!enabledRow || enabledRow.parentElement !== policy) throw new Error('AWH provider settings surface is unavailable');
    policy.insertBefore(models, enabledRow);
    const section = document.createElement('section'); section.className = 'account-form'; section.id = 'provider-credential-settings';
    section.innerHTML = '<h3>การเชื่อมต่อ AI</h3><p class="muted">API key จะถูกส่งครั้งเดียวผ่าน HTTPS และเก็บเฉพาะฝั่ง server; AWH จะไม่แสดงหรือส่งคืน key นี้</p><form id="provider-credential-form" class="compact-form"><label for="provider-api-key">OpenAI API key</label><input id="provider-api-key" type="password" maxlength="512" autocomplete="off" spellcheck="false" /><div class="form-actions"><button class="secondary-button" type="submit">บันทึกหรือแทนที่ key</button><button id="provider-credential-remove" class="text-button" type="button">ลบ key</button><button id="provider-connection-test" class="text-button" type="button">ทดสอบการเชื่อมต่อ</button></div></form><form id="provider-project-routing-form" class="compact-form"><label for="provider-project-routing">AI สำหรับโปรเจกต์ที่เลือก</label><select id="provider-project-routing"><option value="AUTO">Auto (ตามค่า AWH)</option><option value="FAST">ประหยัด · Luna</option><option value="BALANCED">สมดุล · Terra</option><option value="STRONG">งานสำคัญ · Sol</option></select><button class="secondary-button" type="submit">บันทึกการเลือกของโปรเจกต์</button></form><p id="provider-credential-message" class="form-message" role="status"></p>';
    // Credential setup is the only prerequisite for a first-time owner. Keep it
    // before routing and budget controls so it is reachable immediately on mobile.
    policy.before(section);
    $('provider-credential-form').addEventListener('submit', async (event) => {
      event.preventDefault(); const field = $('provider-api-key'); message('provider-credential-message', 'กำลังบันทึก key อย่างปลอดภัย…');
      try { const data = await updateProviderCredential('SET', field.value); state.provider = data.provider; renderProvider(); message('provider-credential-message', 'บันทึก key แล้ว'); }
      catch (error) { message('provider-credential-message', error instanceof Error ? error.message : 'ยังบันทึก key ไม่ได้'); }
      finally { field.value = ''; }
    });
    $('provider-credential-remove').addEventListener('click', async () => {
      if (!window.confirm('ลบ API key ที่เชื่อมต่อกับ AWH ใช่หรือไม่?')) return;
      message('provider-credential-message', 'กำลังลบ key…');
      try { const data = await updateProviderCredential('REMOVE'); state.provider = data.provider; renderProvider(); message('provider-credential-message', 'ลบ key แล้ว'); }
      catch (error) { message('provider-credential-message', error instanceof Error ? error.message : 'ยังลบ key ไม่ได้'); }
    });
    $('provider-connection-test').addEventListener('click', async () => {
      message('provider-credential-message', 'กำลังทดสอบการเชื่อมต่อ…');
      try { const data = await testProviderConnection(); state.provider = (await loadProviderStatus()).provider; renderProvider(); message('provider-credential-message', data.connection?.status === 'PASS' ? `ทดสอบ Responses API ผ่าน (${data.connection.model || 'โมเดลที่ตั้งไว้'})` : 'ยังไม่ได้ตั้งค่า key'); }
      catch (error) { message('provider-credential-message', error instanceof Error ? error.message : 'ทดสอบการเชื่อมต่อไม่ผ่าน'); }
    });
    $('provider-project-routing-form').addEventListener('submit', async (event) => {
      event.preventDefault(); const project = selectedProject(); if (!project) { message('provider-credential-message', 'เลือกโปรเจกต์ก่อนกำหนด AI'); return; }
      try { state.providerRouting = await updateProviderProjectRouting(project.projectId, $('provider-project-routing').value); renderProvider(); message('provider-credential-message', 'บันทึกการเลือก AI ของโปรเจกต์แล้ว'); }
      catch (error) { message('provider-credential-message', error instanceof Error ? error.message : 'ยังบันทึกการเลือก AI ไม่ได้'); }
    });
    return section;
  }

  function renderOwnerSelfService() {
    if (!state.profile || !state.ownerStatus) return;
    ensureOwnerSelfServiceSurface(); const identity = state.profile.identity || state.profile; const product = state.ownerStatus.product || {};
    $('owner-display-name').value = identity.displayName || ''; $('founder-name').value = product.founderName || settingValue('founderName', 'Art'); $('founder-credit').value = product.founderCredit || settingValue('founderCredit', 'Founder · Product Creator · System Concept');
    renderSettingsOverview();
  }

  function workerStateLabel(worker) { return worker.state === 'READY' ? 'ออนไลน์' : worker.state === 'WORKING' ? 'กำลังทำงาน' : worker.state === 'STALE' ? 'สัญญาณเก่า' : 'ออฟไลน์'; }
  async function loadVerifiedDesktopRelease() {
    if (desktopReleasePromise) return desktopReleasePromise;
    desktopReleasePromise = (async () => {
      const response = await fetch('./release.json', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('release metadata unavailable');
      const manifest = await response.json();
      if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.releaseId !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(manifest.releaseId) || !Array.isArray(manifest.files)) throw new Error('release metadata invalid');
      const files = new Map();
      for (const entry of manifest.files) {
        if (!entry || typeof entry.path !== 'string' || !/^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(entry.path) || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 1 || entry.sizeBytes > 1024 * 1024 * 1024 || files.has(entry.path)) throw new Error('release metadata invalid');
        files.set(entry.path, entry);
      }
      return { releaseId: manifest.releaseId, files };
    })().catch((error) => { desktopReleasePromise = null; throw error; });
    return desktopReleasePromise;
  }

  async function loadPublicDesktopRelease() {
    const container = document.querySelector('.login-downloads');
    if (!(container instanceof HTMLElement)) return;
    container.hidden = true;
    try {
      const release = await loadVerifiedDesktopRelease(); let available = 0;
      for (const [path, , platform] of DESKTOP_PACKAGES) {
        const link = document.querySelector(`[data-desktop-package="${platform}"]`); if (!(link instanceof HTMLAnchorElement)) continue;
        const entry = release.files.get(path); link.hidden = !entry;
        if (entry) { link.href = `./${path}`; link.dataset.release = release.releaseId; available += 1; }
        else { link.removeAttribute('href'); delete link.dataset.release; }
      }
      container.hidden = available === 0;
    } catch { container.hidden = true; }
  }

  async function loadDesktopRelease() {
    const list = $('desktop-release-list'); if (!list) return;
    try {
      const release = await loadVerifiedDesktopRelease(); const files = release.files;
      const packages = DESKTOP_PACKAGES.filter(([path]) => files.has(path));
      list.replaceChildren();
      if (!packages.length) throw new Error('verified desktop packages unavailable');
      message('desktop-release-status', `release ${release.releaseId} · เลือก installer ที่ตรวจสอบ checksum แล้ว`);
      for (const [path, , platform] of DESKTOP_PACKAGES) {
        const link = document.querySelector(`[data-desktop-package="${platform}"]`); if (link && files.has(path)) { link.href = `./${path}`; link.dataset.release = release.releaseId; link.hidden = false; }
      }
      for (const [path, label] of packages) {
        const entry = files.get(path); const item = document.createElement('div'); item.className = 'session-item';
        const title = document.createElement('strong'); title.textContent = label;
        const detail = document.createElement('span'); detail.textContent = `${size(entry.sizeBytes)} · SHA-256 ${entry.sha256.slice(0, 12)}…`;
        const link = document.createElement('a'); link.href = `./${path}`; link.textContent = `ดาวน์โหลด ${label}`; link.setAttribute('download', '');
        item.append(title, detail, link); list.append(item);
      }
    } catch {
      list.replaceChildren(); message('desktop-release-status', 'ยังไม่มี installer ที่ตรวจสอบยืนยันได้ใน release นี้');
      const note = document.createElement('div'); note.className = 'session-item'; note.textContent = 'AWH จะไม่แสดงลิงก์ที่ตรวจสอบไม่ได้'; list.append(note);
    }
  }
  function renderSettingsOverview() {
    const provider = state.provider || {}; const credential = provider.credential || {}; const workers = state.ownerStatus?.workers || state.control?.workers || [];
    const ai = provider.available ? 'พร้อมใช้งาน · Auto' : provider.keyConfigured ? `เชื่อมแล้ว · ${credential.lastTestStatus === 'PASS' ? 'ตรวจสอบผ่าน' : 'ต้องทดสอบ'}` : 'ยังไม่เชื่อม API key';
    message('settings-ai-summary', ai);
    message('settings-device-summary', workers.length ? `${workers.filter((worker) => worker.state === 'READY' || worker.state === 'WORKING').length} เครื่องพร้อมทำงาน` : 'ยังไม่มี AWH Desktop ที่พร้อมทำงาน');
    const list = $('settings-worker-list'); if (list) {
      list.replaceChildren();
      for (const worker of workers) {
        const item = document.createElement('div'); item.className = 'session-item';
        const name = document.createElement('strong'); name.textContent = worker.displayName || 'อุปกรณ์เสริม AWH';
        const tools = Array.isArray(worker.detectedTools) ? worker.detectedTools.filter((value) => typeof value === 'string').slice(0, 5) : [];
        const toolSummary = tools.length ? ` · พบ ${tools.join(', ')}` : '';
        const detail = document.createElement('span'); detail.textContent = `${workerStateLabel(worker)}${toolSummary} · ${worker.boundProjectCount || 0} โปรเจกต์`;
        item.append(name, detail); list.append(item);
      }
      if (!list.childElementCount) list.textContent = 'ยังไม่มีอุปกรณ์เสริมที่เชื่อมกับโปรเจกต์';
    }
    const online = workers.filter((worker) => worker?.online || ['READY', 'WORKING', 'ONLINE'].includes(worker?.state)).length;
    message('settings-worker-message', online > 0 ? `มีอุปกรณ์เสริมพร้อมรับงาน ${online} เครื่อง · งาน Cloud ทำต่อได้โดยไม่ต้องเปิดเครื่อง` : 'งาน Cloud ทำต่อได้ตามปกติ · เปิด AWH Desktop เฉพาะงานที่ต้องใช้ไฟล์หรือแอปบนเครื่อง');
    renderCapabilitySurface();
    void loadDesktopRelease();
    const readiness = state.systemReadiness;
    if (readiness) {
      const checks = readiness.checks || {};
      const waiting = Number.isInteger(checks.waitingCapabilityCount) && checks.waitingCapabilityCount > 0 ? ` · งานใช้ความสามารถเพิ่มเติม ${checks.waitingCapabilityCount} งาน` : '';
      message('system-check-message', readiness.state === 'READY' ? 'AWH พร้อมทำงาน' : readiness.state === 'PARTIALLY_READY' ? `AWH พร้อมบางส่วน${waiting}` : 'AWH ต้องตรวจสอบบางรายการก่อนเริ่มงาน');
    }
    const health = $('system-health-details');
    if (health) {
      health.replaceChildren(); const status = state.ownerStatus || {};
      const db = status.database || {}; const backup = status.backup || {}; const storage = status.storage || {}; const queue = status.queue || {}; const aiBudget = status.aiBudget || {}; const workerSummary = status.workerSummary || {};
      const latest = backup.latest || null; const aiTotal = Number(aiBudget.monthlyMicrounits || 0); const aiUsed = Number(aiBudget.usedMicrounits || 0); const aiPercent = aiTotal > 0 ? Math.min(100, Math.round((aiUsed / aiTotal) * 100)) : null;
      const rows = [
        ['ฐานข้อมูล', db.state === 'HEALTHY' ? `ปกติ · Schema ${db.schemaVersion || '—'}` : 'ต้องตรวจสอบ'],
        ['Backup', backup.state === 'VERIFIED' && latest ? `ยืนยันแล้ว · ${date(latest.verifiedAt)} · ${size(latest.sizeBytes)}` : backup.state === 'MISSING' ? 'ยังไม่มี backup ที่ยืนยันแล้ว' : backup.state === 'NOT_CONFIGURED' ? 'ยังไม่ได้ตั้งค่า' : 'ต้องตรวจสอบ'],
        ['พื้นที่จัดเก็บ', Number.isFinite(storage.usedPercent) ? `${storage.state === 'HEALTHY' ? 'ปกติ' : storage.state === 'WARNING' ? 'ใกล้เต็ม' : storage.state === 'CRITICAL' ? 'พื้นที่ต่ำ' : 'กำลังตรวจ'} · ใช้ ${storage.usedPercent}%` : 'กำลังตรวจ'],
        ['คิวงาน', `${Number(queue.activeTaskCount || 0)} งานกำลังทำ · ${Number(queue.waitingCapabilityCount || 0)} งานรอความสามารถ`],
        ['AI Budget', aiBudget.state === 'READY' ? `พร้อม${aiPercent === null ? '' : ` · ใช้ ${aiPercent}%`}` : aiBudget.state === 'NOT_CONFIGURED' ? 'ยังไม่เชื่อม' : aiBudget.state === 'DISABLED' ? 'ปิดอยู่' : aiBudget.state === 'LIMIT_REACHED' ? 'ถึงวงเงินแล้ว' : 'ต้องตรวจสอบ'],
        ['อุปกรณ์เสริม', `${Number(workerSummary.ready || 0)}/${Number(workerSummary.total || 0)} เครื่องพร้อมรับงาน`],
      ];
      for (const [label, value] of rows) { const item = document.createElement('div'); item.className = 'session-item'; const strong = document.createElement('strong'); strong.textContent = label; const detail = document.createElement('span'); detail.textContent = value; item.append(strong, detail); health.append(item); }
    }
  }
  async function changeMemory(record, action) {
    let content = null; let tags = null; let pinned = null;
    if (action === 'EDIT') {
      const next = window.prompt('แก้ไขความจำของ AWH', record.content);
      if (next === null || next.trim() === record.content) return;
      content = next.trim(); tags = Array.isArray(record.tags) ? record.tags : [];
    }
    if (action === 'FORGET' && !window.confirm('ลบความจำนี้ออกจาก AWH ใช่หรือไม่?')) return;
    if (action === 'PIN') pinned = !record.pinned;
    message('memory-message', 'กำลังบันทึกความจำ…');
    try { await updateMemory(record.memoryId, action, { content, tags, pinned }); await refreshMemory(); message('memory-message', 'บันทึกความจำแล้ว'); }
    catch (error) { message('memory-message', error instanceof Error ? error.message : 'ยังบันทึกความจำไม่ได้'); }
  }
  function renderMemory() {
    const list = $('memory-list'); if (!list) return;
    list.replaceChildren();
    for (const record of state.memory) {
      const row = document.createElement('article'); row.className = 'memory-row';
      const header = document.createElement('div'); header.className = 'memory-header';
      const title = document.createElement('strong'); title.textContent = `${memoryScopeLabel(record.scope)}${record.category ? ` · ${record.category}` : ''}`;
      const status = document.createElement('span'); status.textContent = memoryFreshnessLabel(record.freshness);
      header.append(title, status);
      const body = document.createElement('p'); body.textContent = record.content;
      const detail = document.createElement('small'); const verified = record.lastVerifiedAt ? 'ตรวจล่าสุด ' + date(record.lastVerifiedAt) : memoryFreshnessLabel(record.freshness); const provenance = record.provenance ? ` · ที่มา ${record.provenance}` : ''; const supersession = record.supersededBySourceRevision ? ` · ตรวจเทียบ source ${record.supersededBySourceRevision}` : ''; detail.textContent = (record.pinned ? 'ปักหมุดไว้ · ' + verified : verified) + provenance + supersession;
      const actions = document.createElement('div'); actions.className = 'memory-actions';
      for (const [action, label] of [['EDIT', 'แก้ไข'], ['PIN', record.pinned ? 'เลิกปักหมุด' : 'ปักหมุด'], ['MARK_OUTDATED', 'ทำเครื่องหมายว่าต้องตรวจทาน'], ['FORGET', 'ลืม']]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = action === 'FORGET' ? 'text-button' : 'secondary-button'; button.textContent = label;
        button.addEventListener('click', () => { void changeMemory(record, action); }); actions.append(button);
      }
      if (record.scope === 'project' && record.projectId) {
        const share = document.createElement('button'); share.type = 'button'; share.className = 'text-button'; share.textContent = record.sharingPolicy === 'project_shared' ? 'เก็บเป็นส่วนตัว' : 'แชร์กับผู้ร่วมงานในโปรเจกต์';
        share.addEventListener('click', () => { void changeMemory(record, record.sharingPolicy === 'project_shared' ? 'UNSHARE' : 'SHARE'); }); actions.append(share);
      }
      row.append(header, body, detail, actions); list.append(row);
    }
    if (!list.childElementCount) list.textContent = 'ยังไม่มีความจำที่แสดงได้';
    const batch = state.memoryImport; message('memory-import-summary', batch ? 'Founding Memory ' + batch.seedVersion + ' · ' + (batch.status === 'committed' ? 'พร้อมใช้งาน' : 'ต้องตรวจทาน') : 'ความจำปัจจุบันอยู่ภายใต้ Source of Truth');
  }
  async function refreshMemory() {
    if (!isOwner()) return;
    ensureMemorySurface();
    message('memory-message', 'กำลังโหลดความจำ…');
    try {
      const project = selectedProject(); const query = $('memory-search')?.value.trim() || '';
      const requests = [loadMemory({ scope: 'all', query }), loadMemoryImportReport()];
      if (project) requests.push(loadMemory({ projectId: project.projectId, scope: 'project', query }));
      const results = await Promise.all(requests);
      const seen = new Set();
      state.memory = results.flatMap((item) => Array.isArray(item.memories) ? item.memories : []).filter((record) => {
        if (!record || typeof record.memoryId !== 'string' || seen.has(record.memoryId)) return false;
        seen.add(record.memoryId);
        return true;
      });
      state.memoryImport = Array.isArray(results[1]?.batches) ? results[1].batches[0] || null : null;
      renderMemory(); message('memory-message', '');
    } catch (error) { state.memory = []; renderMemory(); message('memory-message', error instanceof Error ? error.message : 'ยังโหลดความจำของ AWH ไม่ได้'); }
  }

  function renderProjectSheet(projects) {
    const list = $('project-list'); list.replaceChildren();
    const empty = !Array.isArray(projects) || projects.length === 0;
    $('project-empty').hidden = !empty;
    if (empty) return;
    for (const project of projects) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `project-choice${project.projectId === state.selectedProjectId ? ' selected' : ''}`;
      const name = document.createElement('strong'); name.textContent = project.name;
      const detail = document.createElement('span'); detail.textContent = project.memoryReady ? 'พร้อมใช้ context ของโปรเจกต์' : 'Project Memory ยังต้องตรวจสอบบน worker';
      button.append(name, detail);
      button.addEventListener('click', async () => { state.selectedProjectId = project.projectId; state.selectedConversationId = null; state.conversations = []; state.conversation = null; state.conversationAvailable = false; state.workspaceContinuity = null; renderWorkspace(); closeSheet('project-sheet'); await refreshConversation(); });
      list.append(button);
    }
  }

  function workerSummary() {
    const ai = state.provider?.available === true ? ' · AI · Ready' : state.provider?.keyConfigured === true ? ' · AI · Connected' : '';
    return `AWH Server · Online${ai}`;
  }

  function continuitySummary(workspace) {
    if (!workspace) return '';
    if (workspace.syncStatus === 'SYNCED') return ' · Source ล่าสุดพร้อมใช้งาน';
    if (workspace.syncStatus === 'HANDOFF_REQUIRED') return ' · มีงานจากเครื่องอื่นที่เชื่อมไว้';
    if (workspace.syncStatus === 'SOURCE_OFFLINE') return ' · ใช้ checkpoint ล่าสุดบน AWH';
    if (workspace.syncStatus === 'UNSYNCED_CHANGES') return ' · มีงานที่ยัง sync ไม่ครบ';
    return '';
  }

  function renderApproval(task, approvals) {
    const approval = approvals.find((item) => item.taskId === task.taskId && item.status === 'PENDING');
    if (!approval) return null;
    const actions = document.createElement('div'); actions.className = 'task-actions';
    for (const [decision, text] of [['approve', 'อนุมัติ'], ['reject', 'ปฏิเสธ']]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = text;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await decideApproval(approval.approvalId, decision); await refreshWorkspace(); }
        catch (error) { message('goal-message', error instanceof Error ? error.message : 'AWH ไม่สามารถบันทึกการอนุมัติได้'); button.disabled = false; }
      });
      actions.append(button);
    }
    return actions;
  }

  function renderCancellation(task) {
    if (!task || task.state !== 'WAITING_FOR_APPROVAL') return null;
    const actions = document.createElement('div'); actions.className = 'task-actions';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = 'ยกเลิกงานนี้';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await cancelTask(task.taskId); await refreshWorkspace(); }
      catch (error) { message('goal-message', error instanceof Error ? error.message : 'AWH ยังยกเลิกงานนี้ไม่ได้'); button.disabled = false; }
    });
    actions.append(button); return actions;
  }

  function renderLiveActivity(task) {
    const status = taskExecutionStatus(task);
    const activeStep = status.journey.find((step) => step.state === 'active');
    const box = document.createElement('div'); box.className = 'live-activity'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    const headline = document.createElement('div'); headline.className = 'live-activity-headline';
    const pulse = document.createElement('span'); pulse.className = 'live-activity-pulse'; pulse.setAttribute('aria-hidden', 'true');
    const title = document.createElement('strong'); title.textContent = activeStep?.label || status.title; headline.append(pulse, title);
    const detail = document.createElement('p'); detail.textContent = status.detail;
    box.append(headline, detail);
    if (status.progress > 0 && status.progress < 100) { const bar = document.createElement('progress'); bar.max = 100; bar.value = status.progress; bar.setAttribute('aria-label', status.detail); box.append(bar); }
    box.append(renderExecutionJourney(task));
    const updated = document.createElement('small'); updated.className = 'live-activity-updated'; updated.textContent = `อัปเดต ${date(task.updatedAt || task.createdAt)}`; box.append(updated);
    return box;
  }

  function renderExecutionJourney(task) {
    const status = taskExecutionStatus(task);
    const details = document.createElement('details'); details.className = 'execution-details';
    const summary = document.createElement('summary'); summary.textContent = 'ดูขั้นตอน';
    const list = document.createElement('ol'); list.className = 'execution-journey';
    for (const step of status.journey) {
      const item = document.createElement('li'); item.className = `execution-step ${step.state}`;
      const dot = document.createElement('span'); dot.className = 'execution-step-dot';
      const label = document.createElement('span'); label.textContent = step.label;
      item.append(dot, label); list.append(item);
    }
    details.append(summary, list); return details;
  }

  function renderThread(conversation, approvals) {
    const thread = $('work-thread'); const stickToBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 140; thread.replaceChildren();
    const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
    const tasks = Array.isArray(conversation?.tasks) ? conversation.tasks : [];
    const taskById = new Map(tasks.map((task) => [task.taskId, task]));
    const taskForTurn = (turn) => {
      if (turn?.taskId) return taskById.get(turn.taskId) || null;
      if (turn?.kind !== 'user') return null;
      const body = String(turn.body || '').trim();
      return tasks.filter((task) => String(task?.goal || '').trim() === body)
        .sort((left, right) => (Date.parse(right?.updatedAt || right?.createdAt || '') || 0) - (Date.parse(left?.updatedAt || left?.createdAt || '') || 0))[0] || null;
    };
    const visibleMessages = [];
    let previousCancelledKey = '';
    for (const turn of messages) {
      const task = taskForTurn(turn);
      const cancelledKey = turn?.kind !== 'user' && task?.state === 'CANCELLED' ? `${turn.kind}|${String(turn.body || '').trim()}` : '';
      if (cancelledKey && cancelledKey === previousCancelledKey) continue;
      visibleMessages.push(turn);
      previousCancelledKey = cancelledKey;
    }
    const artifactsByTask = new Map();
    for (const artifact of conversation?.artifacts || []) {
      if (!artifact?.taskId) continue;
      const list = artifactsByTask.get(artifact.taskId) || []; list.push(artifact); artifactsByTask.set(artifact.taskId, list);
    }
    const attachmentsByMessage = new Map();
    for (const attachment of conversation?.attachments || []) { if (!attachment?.messageId) continue; const list = attachmentsByMessage.get(attachment.messageId) || []; list.push(attachment); attachmentsByMessage.set(attachment.messageId, list); }
    $('empty-work').hidden = visibleMessages.length > 0 || !state.selectedProjectId;
    for (const turn of visibleMessages) {
      if (turn.kind === 'progress') {
        if (String(turn.messageId || '').startsWith('local-progress-')) {
          const typing = document.createElement('li'); typing.className = 'task-turn assistant-turn typing-turn';
          const text = document.createElement('p'); text.className = 'typing-indicator'; text.textContent = turn.body || 'AWH · กำลังจัดการงาน…'; typing.append(text); thread.append(typing);
        }
        continue;
      }
      if (turn.kind === 'assistant' && /(?:เครื่องมือที่เหมาะสม|เตรียมบริบทของโปรเจกต์|เก็บคำขอนี้ไว้แล้ว)/u.test(turn.body || '')) continue;
      const task = taskForTurn(turn);
      const row = document.createElement('li'); row.className = `task-turn ${turn.kind === 'user' ? 'user-turn' : 'assistant-turn'} ${turn.kind}-turn`;
      const body = document.createElement('p'); body.className = turn.kind === 'user' ? 'task-goal' : 'task-summary'; body.textContent = turn.body;
      if (turn.kind === 'user') {
        row.append(body); const attachments = renderMessageAttachments(attachmentsByMessage.get(turn.messageId)); if (attachments) row.append(attachments);
        thread.append(row);
        if (task && task.state !== 'COMPLETED') {
          const statusTurn = document.createElement('li'); statusTurn.className = 'task-turn assistant-turn status-turn';
          const status = document.createElement('div'); status.className = 'task-response active-task-response';
          status.append(renderLiveActivity(task));
          statusTurn.append(status); thread.append(statusTurn);
        }
        continue;
      }
      const response = document.createElement('div'); response.className = 'task-response';
      const artifacts = task ? (artifactsByTask.get(task.taskId) || []) : [];
      const meta = document.createElement('div'); meta.className = 'task-meta';
      const chip = document.createElement('span'); chip.className = `state-chip ${stateClass(task)}`.trim();
      chip.textContent = turn.kind === 'approval' ? 'ต้องอนุมัติ' : turn.kind === 'result' && artifacts.length ? 'ไฟล์พร้อมใช้' : turn.kind === 'result' ? 'เสร็จแล้ว' : turn.kind === 'failure' ? 'ต้องตรวจสอบ' : task ? stateText(task) : 'AWH';
      const time = document.createElement('span'); time.textContent = date(turn.createdAt);
      meta.append(chip, time); response.append(meta, body);
      if (task && !['COMPLETED','FAILED','CANCELLED'].includes(task.state)) response.append(renderLiveActivity(task));
      if (task) {
        const actions = renderApproval(task, approvals) || renderCancellation(task); if (actions) response.append(actions);
        if (artifacts.length) { const list = document.createElement('div'); list.className = 'artifact-results'; for (const artifact of artifacts) { if (artifact.kind === 'project-inspection' && artifactUrl(artifact)) list.append(renderInspectionEvidence(artifact)); else list.append(renderArtifactCard(artifact)); } response.append(list); }
      }
      row.append(response); thread.append(row);
    }
    if (stickToBottom) requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
  }

  function renderConversationSheet() {
    const list = $('conversation-list'); if (!list) return; list.replaceChildren();
    for (const conversation of state.conversations) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `project-choice${conversation.conversationId === state.selectedConversationId ? ' selected' : ''}`;
      const title = document.createElement('strong'); title.textContent = conversation.title || 'Work';
      const detail = document.createElement('span'); detail.textContent = date(conversation.updatedAt) || 'ยังไม่มีข้อความ'; button.append(title, detail);
      button.addEventListener('click', async () => { state.selectedConversationId = conversation.conversationId; closeSheet('conversation-sheet'); await refreshConversation(false); }); list.append(button);
    }
    $('conversation-empty').hidden = state.conversations.length > 0;
    const selected = state.conversations.find((conversation) => conversation.conversationId === state.selectedConversationId) || state.conversation?.conversation || null;
    $('conversation-title-input').value = selected?.title || 'Work';
    $('conversation-title-input').disabled = !selected;
    $('conversation-archive').disabled = !selected;
  }

  function renderWorkspace() {
    const control = state.control;
    if (!control?.authenticated) return;
    const projects = Array.isArray(control.projects) ? control.projects : [];
    if (!projects.some((project) => project.projectId === state.selectedProjectId)) state.selectedProjectId = preferredProjectId(projects);
    const project = selectedProject();
    message('selected-project-name', project?.name || 'ยังไม่มีโปรเจกต์');
    message('selected-conversation-name', state.conversation?.conversation?.title || 'Work');
    message('worker-summary', workerSummary());
    message('work-context', project ? `คุยและสั่งงานได้จากทุกอุปกรณ์${continuitySummary(state.workspaceContinuity)}` : 'เพิ่มโปรเจกต์เพื่อเริ่มคุยกับ AWH');
    message('advanced-status', `${workerSummary()} · งานและผลลัพธ์แสดงตามสิทธิ์ของบัญชีคุณ`);
    const workReady = project !== null && state.conversationAvailable;
    $('goal-submit').disabled = !workReady;
    $('goal-input').disabled = !workReady;
    $('attachment-open').disabled = !workReady;
    $('attachment-input').disabled = !workReady;
    $('goal-input').placeholder = !project ? 'เลือกหรือเพิ่มโปรเจกต์ก่อน' : 'พิมพ์สิ่งที่อยากให้ AWH ช่วย…';
    renderProjectSheet(projects);
    renderConversationSheet();
    renderThread(state.conversation, state.conversation?.approvals || control.approvals);
    publishWorkContext();
  }

  function render(data) {
    setSurface(data);
    state.control = data?.control || { authenticated: false, available: false, error: 'AWH ยังไม่พร้อมใช้งาน' };
    const authenticated = state.control.authenticated === true;
    $('sign-in-view').hidden = authenticated;
    $('workspace-view').hidden = !authenticated;
    document.body.classList.toggle('work-active', authenticated);
    $('account-open').hidden = !authenticated;
    if (authenticated) renderWorkspace();
  }

  async function refreshConversation(refreshList = true) {
    const project = selectedProject();
    if (!project) { state.selectedConversationId = null; state.conversations = []; state.conversation = null; state.conversationAvailable = false; state.workspaceContinuity = null; renderWorkspace(); return; }
    try {
      const [conversations, workspaceContinuity, currentContext] = await Promise.all([loadConversations(project.projectId), loadWorkspaceContinuity(project.projectId), loadCurrentContext(project.projectId)]);
      state.conversations = conversations;
      if (!conversations.some((conversation) => conversation.conversationId === state.selectedConversationId)) {
        const remembered = currentContext?.context?.conversationId;
        state.selectedConversationId = conversations.some((conversation) => conversation.conversationId === remembered) ? remembered : conversations[0]?.conversationId || null;
      }
      if (!state.selectedConversationId) {
        const created = await createConversation(project.projectId, 'Work'); state.selectedConversationId = created.conversation.conversationId; state.conversations = [created.conversation]; state.conversation = created;
      } else state.conversation = await loadConversation(state.selectedConversationId);
      state.workspaceContinuity = workspaceContinuity; state.conversationAvailable = true; renderWorkspace();
      void saveCurrentContext(project.projectId, state.selectedConversationId, 'work').catch(() => undefined);
    } catch (error) { state.conversationAvailable = false; state.conversation = { messages: [{ messageId: 'local-unavailable', taskId: null, kind: 'assistant', sequence: 1, body: 'ยังเปิด Work นี้ไม่ได้ จึงยังไม่ส่งคำขอใหม่เพื่อป้องกันงานสูญหาย', createdAt: new Date().toISOString() }], tasks: [], artifacts: [], attachments: [], approvals: [] }; renderWorkspace(); message('goal-message', error instanceof Error ? error.message : 'AWH ยังโหลดการสนทนาไม่ได้'); }
  }

  async function refreshWorkspace(showBusy = false) {
    if (showBusy) message('goal-message', 'กำลังรีเฟรช…');
    try { state.control = await loadControlData(); if (state.control?.role === 'OWNER') state.provider = await loadProviderStatus().catch(() => state.provider); renderWorkspace(); await refreshConversation(); if (showBusy) message('goal-message', ''); }
    catch (error) { message('goal-message', error instanceof Error ? error.message : 'AWH ไม่สามารถรีเฟรชข้อมูลได้'); }
  }

  const settingsSections = ['start', 'ai', 'account', 'devices', 'data', 'system', 'people'];
  function showSettingsSection(section = 'start') {
    const selected = settingsSections.includes(section) ? section : 'start';
    for (const name of settingsSections) {
      const panel = $(`settings-panel-${name}`); if (panel) panel.hidden = name !== selected;
    }
    let activeButton = null;
    document.querySelectorAll('[data-settings-tab]').forEach((button) => {
      const active = button.dataset.settingsTab === selected;
      button.classList.toggle('active', active); button.setAttribute('aria-current', active ? 'page' : 'false');
      if (active) activeButton = button;
    });
    window.requestAnimationFrame(() => {
      const strip = activeButton?.parentElement;
      if (!activeButton || !strip) return;
      const left = Math.max(0, activeButton.offsetLeft - ((strip.clientWidth - activeButton.offsetWidth) / 2));
      strip.scrollLeft = left;
    });
  }
  function configureSettingsVisibility() {
    const owner = isOwner();
    for (const section of ['ai', 'devices', 'data', 'system', 'people']) {
      const button = document.querySelector(`.settings-tab[data-settings-tab="${section}"]`);
      if (button) button.hidden = !owner;
    }
    document.querySelectorAll('.owner-settings-tab, .owner-settings-action').forEach((element) => { element.hidden = !owner; });
    if (!owner && !['start', 'account'].includes(document.querySelector('.settings-tab.active')?.dataset.settingsTab || '')) showSettingsSection('account');
  }
  function openSheet(id) { const sheet = $(id); if (sheet) openAwhDialog(sheet); }
  function closeSheet(id, options = {}) { const sheet = $(id); if (sheet) closeAwhDialog(sheet, options); if (id === 'artifact-sheet') clearArtifactWorkspace(); }
  function openPasswordRecovery() {
    let token = null;
    const recoveryHash = window.location.hash;
    const recoveryRequested = recoveryHash === '#awh-recovery';
    if (recoveryHash.startsWith('#awh-reset=')) {
      try { const candidate = decodeURIComponent(recoveryHash.slice('#awh-reset='.length)); if (/^[A-Za-z0-9_-]{43}$/.test(candidate)) token = candidate; } catch { token = null; }
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    } else if (recoveryRequested) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    state.resetToken = token;
    $('reset-password-form').hidden = token === null;
    message('reset-instructions', token ? 'ลิงก์นี้ใช้ได้ครั้งเดียวและจะหมดอายุในเวลาอันสั้น เลือกรหัสผ่านใหม่ที่คุณจำได้' : state.control?.authenticated && recoveryRequested ? 'คุณยังเข้าสู่ระบบอยู่ เปิดแท็บ “บัญชีและความปลอดภัย” เพื่อจัดการรหัสผ่านหรือเตรียมรหัสกู้คืน หากกำลังแก้ปัญหาการเข้าสู่ระบบ ให้ใช้รหัสกู้คืนฉุกเฉินที่เตรียมไว้เท่านั้น' : 'กด “ลืมรหัสผ่าน?” จากหน้าเข้าสู่ระบบ แล้วเปิดลิงก์กู้คืนจาก AWH Desktop ที่เชื่อถือได้ ลิงก์มีอายุสั้นและใช้ได้ครั้งเดียว');
    openSheet('recovery-sheet');
  }
  async function openAccount(section = 'start') {
    if (!state.control?.authenticated) return;
    openSheet('account-sheet');
    configureSettingsVisibility(); showSettingsSection(isOwner() ? section : 'account');
    $('owner-only-settings').hidden = !isOwner();
    $('product-settings-form').hidden = !isOwner();
    try { state.productSettings = (await loadProductSettings()).settings; applyProductSettings(); }
    catch { message('product-settings-message', 'ยังโหลดการตั้งค่าลักษณะของ AWH ไม่ได้'); }
    if (isOwner()) {
      ensureOwnerSelfServiceSurface(); ensureProviderSelfServiceSurface();
      const project = selectedProject(); const requests = [loadProviderStatus(), loadCapabilities(), listPeople(), loadAuthProfile(), loadOwnerSelfServiceStatus(), project ? loadProviderProjectRouting(project.projectId) : Promise.resolve(null)];
      const [providerResult, capabilitiesResult, peopleResult, profileResult, ownerStatusResult, routingResult] = await Promise.allSettled(requests);
      if (providerResult.status === 'fulfilled') { state.provider = providerResult.value.provider; renderProvider(); }
      else message('provider-status', 'ยังโหลดสถานะ AI ไม่ได้ ลองรีเฟรชอีกครั้ง');
      if (capabilitiesResult.status === 'fulfilled') { state.capabilities = capabilitiesResult.value; renderCapabilitySurface(); }
      if (peopleResult.status === 'fulfilled') { state.people = Array.isArray(peopleResult.value.people) ? peopleResult.value.people : []; renderPeople(); }
      else message('people-message', 'ยังโหลดผู้ร่วมงานไม่ได้ ลองรีเฟรชอีกครั้ง');
      if (profileResult.status === 'fulfilled') state.profile = profileResult.value;
      if (ownerStatusResult.status === 'fulfilled') state.ownerStatus = ownerStatusResult.value;
      if (routingResult.status === 'fulfilled') state.providerRouting = routingResult.value;
      if (state.profile && state.ownerStatus) renderOwnerSelfService(); else renderSettingsOverview();
      try { await refreshMemory(); } catch { message('memory-message', 'ยังโหลดความจำไม่ได้ ลองรีเฟรชอีกครั้ง'); }
    }
  }

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault(); message('login-message', 'กำลังเข้าสู่ AWH…');
    try {
      await login($('login-username').value, $('login-password').value, $('login-remember').checked);
      $('login-password').value = '';
      state.control = await loadControlData(); render({ product: { shortName: 'AWH' }, control: state.control }); await refreshConversation();
      message('login-message', '');
    } catch (error) { message('login-message', error instanceof Error ? error.message : 'เข้าสู่ AWH ไม่สำเร็จ'); }
  });

  window.addEventListener('awh:navigate-work', async (event) => {
    const detail = event instanceof CustomEvent && event.detail && typeof event.detail === 'object' ? event.detail : {};
    const project = state.control?.projects?.find((item) => item.projectId === detail.projectId);
    if (!project) return;
    const projectChanged = state.selectedProjectId !== project.projectId;
    if (projectChanged) {
      state.selectedProjectId = project.projectId; state.selectedConversationId = null; state.conversations = []; state.conversation = null; state.conversationAvailable = false; state.workspaceContinuity = null;
      renderWorkspace(); await refreshConversation();
    }
    if (typeof detail.conversationId === 'string' && state.conversations.some((item) => item.conversationId === detail.conversationId) && state.selectedConversationId !== detail.conversationId) {
      state.selectedConversationId = detail.conversationId; await refreshConversation(false);
    }
    if (detail.openConversations === true) openSheet('conversation-sheet');
    $('goal-input')?.focus();
  });

  $('goal-input').addEventListener('input', resizeGoalInput); resizeGoalInput();
  $('attachment-open').addEventListener('click', () => { if (!$('attachment-input').disabled) $('attachment-input').click(); });
  $('attachment-input').addEventListener('change', () => {
    const incoming = Array.from($('attachment-input').files || []);
    const available = 8 - state.pendingAttachments.length;
    if (incoming.length > available) message('goal-message', 'แนบได้ครั้งละไม่เกิน 8 ไฟล์');
    let total = state.pendingAttachments.reduce((sum, file) => sum + file.size, 0);
    const accepted = [];
    for (const file of incoming.slice(0, Math.max(0, available))) { if (total + file.size > MAX_ATTACHMENT_BYTES) { message('goal-message', 'ไฟล์แนบรวมกันได้ไม่เกิน 60 MB'); break; } total += file.size; accepted.push(file); }
    state.pendingAttachments.push(...accepted);
    $('attachment-input').value = ''; renderPendingAttachments();
  });

  $('goal-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const goal = $('goal-input').value.trim();
    if (!goal) { message('goal-message', 'พิมพ์สิ่งที่อยากให้ AWH ช่วยก่อน'); return; }
    const project = selectedProject();
    const universalRouter = globalThis.AWH_ROUTE_COMMAND;
    if (typeof universalRouter === 'function' && await universalRouter(goal, { projectId: project?.projectId || null, files: [...state.pendingAttachments], source: 'work' })) {
      state.pendingAttachments = []; renderPendingAttachments(); $('goal-input').value = ''; message('goal-message', ''); return;
    }
    if (!project) { message('goal-message', 'งานนี้ต้องใช้บริบทโปรเจกต์ เลือกโปรเจกต์ที่ต้องการก่อน'); return; }
    const conversationId = state.selectedConversationId;
    if (!conversationId) { message('goal-message', 'กำลังเตรียมการสนทนา กรุณาลองใหม่อีกครั้ง'); return; }
    const idempotencyKey = `web-${crypto.randomUUID()}`;
    const pending = [...state.pendingAttachments];
    const localMessageId = `local-${idempotencyKey}`;
    const localAttachments = pending.map((file, index) => ({ attachmentId: `local-${idempotencyKey}-${index}`, messageId: localMessageId, name: file.name, sizeBytes: file.size, pending: true }));
    state.conversation = { ...(state.conversation || {}), messages: [...(state.conversation?.messages || []), { messageId: localMessageId, taskId: null, kind: 'user', sequence: Number.MAX_SAFE_INTEGER - 1, body: goal, createdAt: new Date().toISOString() }, { messageId: `local-progress-${idempotencyKey}`, taskId: null, kind: 'progress', sequence: Number.MAX_SAFE_INTEGER, body: localProgressLabel(goal), createdAt: new Date().toISOString() }], tasks: state.conversation?.tasks || [], artifacts: state.conversation?.artifacts || [], attachments: [...(state.conversation?.attachments || []), ...localAttachments], approvals: state.conversation?.approvals || [] };
    renderWorkspace(); message('goal-message', ''); $('goal-input').value = ''; resizeGoalInput(); $('goal-input').focus();
    try {
      const uploaded = pending.length ? await uploadConversationAttachments(conversationId, pending) : [];
      await submitWorkMessage(project.projectId, conversationId, goal, uploaded.map((attachment) => attachment.attachmentId), idempotencyKey);
      state.pendingAttachments = []; renderPendingAttachments();
      await refreshConversation();
    } catch (error) { message('goal-message', error instanceof Error ? error.message : 'ส่งงานไม่สำเร็จ'); }
    finally { const unavailable = selectedProject() === null || !state.conversationAvailable; $('goal-submit').disabled = unavailable; $('attachment-open').disabled = unavailable; }
  });

  $('refresh-work').addEventListener('click', () => { void refreshWorkspace(true); });
  $('project-open').addEventListener('click', () => openSheet('project-sheet'));
  $('project-create-form').addEventListener('submit', async (event) => { event.preventDefault(); if (!isOwner()) { message('project-create-message', 'เฉพาะเจ้าของ AWH เท่านั้นที่เพิ่มโปรเจกต์ได้'); return; } const name = $('project-create-name').value.trim(); if (!name) { message('project-create-message', 'กรอกชื่อโปรเจกต์ก่อน'); return; } const button = $('project-create-form').querySelector('button[type="submit"]'); button.disabled = true; message('project-create-message', 'กำลังเพิ่มโปรเจกต์…'); try { const result = await createProject(name, $('project-create-type').value); state.control = await loadControlData(); state.selectedProjectId = result.project.projectId; $('project-create-name').value = ''; renderWorkspace(); await refreshConversation(); message('project-create-message', 'เพิ่มโปรเจกต์แล้ว เริ่มคุยได้ทันที'); } catch (error) { message('project-create-message', error instanceof Error ? error.message : 'ยังเพิ่มโปรเจกต์ไม่ได้'); } finally { button.disabled = false; } });
  $('conversation-open').addEventListener('click', () => openSheet('conversation-sheet'));
  $('conversation-new').addEventListener('click', async () => {
    const project = selectedProject(); if (!project) return; const button = $('conversation-new'); button.disabled = true;
    try { const created = await createConversation(project.projectId, 'การสนทนาใหม่'); state.selectedConversationId = created.conversation.conversationId; state.conversation = created; await refreshConversation(); closeSheet('conversation-sheet'); }
    catch (error) { message('goal-message', error instanceof Error ? error.message : 'AWH ยังสร้างการสนทนาใหม่ไม่ได้'); }
    finally { button.disabled = false; }
  });
  $('conversation-title-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const conversationId = state.selectedConversationId; if (!conversationId) return;
    message('conversation-title-message', 'กำลังบันทึก…');
    try { await updateConversation(conversationId, $('conversation-title-input').value, false); await refreshConversation(); message('conversation-title-message', 'บันทึกแล้ว'); }
    catch (error) { message('conversation-title-message', error instanceof Error ? error.message : 'ยังบันทึกชื่อการสนทนาไม่ได้'); }
  });
  $('conversation-archive').addEventListener('click', async () => {
    const conversationId = state.selectedConversationId; const current = state.conversation?.conversation; if (!conversationId || !current) return;
    $('conversation-archive').disabled = true; message('conversation-title-message', 'กำลังเก็บเข้าคลัง…');
    try { await updateConversation(conversationId, current.title || 'Work', true); state.selectedConversationId = null; await refreshConversation(); message('conversation-title-message', 'เก็บการสนทนาแล้ว'); }
    catch (error) { message('conversation-title-message', error instanceof Error ? error.message : 'ยังเก็บการสนทนาไม่ได้'); }
    finally { $('conversation-archive').disabled = false; }
  });
  $('account-open').addEventListener('click', () => { void openAccount(); });
  $('account-open-work').addEventListener('click', () => { void openAccount('account'); });
  $('account-open-inline').addEventListener('click', () => { void openAccount(); });
  $('system-check').addEventListener('click', async () => {
    if (!isOwner()) { message('system-check-message', 'เฉพาะเจ้าของ AWH เท่านั้นที่ตรวจความพร้อมของระบบได้'); return; }
    const button = $('system-check'); button.disabled = true; message('system-check-message', 'กำลังตรวจความพร้อม…');
    try { state.systemReadiness = await loadSystemReadiness(); renderSettingsOverview(); }
    catch (error) { message('system-check-message', error instanceof Error ? error.message : 'ยังตรวจความพร้อมของ AWH ไม่ได้'); }
    finally { button.disabled = false; }
  });
  document.querySelectorAll('[data-settings-tab]').forEach((button) => button.addEventListener('click', () => showSettingsSection(button.dataset.settingsTab)));
  $('system-check-inline')?.addEventListener('click', () => $('system-check')?.click());
  $('recovery-open').addEventListener('click', openPasswordRecovery);
  document.querySelectorAll('[data-close-sheet]').forEach((button) => button.addEventListener('click', () => closeSheet(button.dataset.closeSheet)));

  $('username-form').addEventListener('submit', async (event) => {
    event.preventDefault(); message('username-message', 'กำลังบันทึกชื่อผู้ใช้…');
    try { await changeUsername($('identity-password').value, $('new-username').value); $('identity-password').value = ''; message('username-message', 'บันทึกแล้ว กรุณาเข้าสู่ AWH อีกครั้ง'); setTimeout(() => window.location.reload(), 700); }
    catch (error) { message('username-message', error instanceof Error ? error.message : 'เปลี่ยนชื่อผู้ใช้ไม่สำเร็จ'); }
  });

  $('password-form').addEventListener('submit', async (event) => {
    event.preventDefault(); message('password-message', 'กำลังบันทึกรหัสผ่าน…');
    try {
      if ($('new-password').value !== $('confirm-password').value) throw new Error('กรุณายืนยันรหัสผ่านใหม่ให้ตรงกัน');
      await changePassword($('old-password').value, $('new-password').value);
      $('old-password').value = ''; $('new-password').value = ''; $('confirm-password').value = '';
      message('password-message', 'บันทึกแล้ว กรุณาเข้าสู่ AWH อีกครั้ง'); setTimeout(() => window.location.reload(), 700);
    } catch (error) { message('password-message', error instanceof Error ? error.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ'); }
  });

  const stepUpForm = ensureStepUpForm();
  stepUpForm.addEventListener('submit', async (event) => {
    event.preventDefault(); const password = $('step-up-password'); message('step-up-message', 'กำลังยืนยันรหัสผ่าน…');
    try { const data = await stepUp(password.value); password.value = ''; message('step-up-message', `ยืนยันแล้ว ใช้ได้ถึง ${date(data.stepUpUntil)}`); }
    catch (error) { message('step-up-message', error instanceof Error ? error.message : 'ยืนยันรหัสผ่านไม่สำเร็จ'); }
  });

  $('product-settings-form').addEventListener('submit', async (event) => {
    event.preventDefault(); message('product-settings-message', 'กำลังบันทึก…');
    try {
      const values = [['productName', $('setting-product-name').value], ['shortName', $('setting-short-name').value], ['tagline', $('setting-tagline').value], ['welcome', $('setting-welcome').value], ['accent', $('setting-accent').value]];
      for (const [key, value] of values) state.productSettings = (await updateProductSetting(key, value)).settings;
      applyProductSettings(); message('product-settings-message', 'บันทึกลักษณะของ AWH แล้ว');
    } catch (error) { message('product-settings-message', error instanceof Error ? error.message : 'ยังบันทึกการตั้งค่าไม่ได้'); }
  });

  $('product-settings-reset').addEventListener('click', async () => {
    const button = $('product-settings-reset'); button.disabled = true; message('product-settings-message', 'กำลังคืนค่ามาตรฐาน…');
    try {
      for (const key of ['productName', 'shortName', 'tagline', 'welcome', 'accent']) state.productSettings = (await resetProductSetting(key)).settings;
      applyProductSettings(); message('product-settings-message', 'คืนค่ามาตรฐานแล้ว');
    } catch (error) { message('product-settings-message', error instanceof Error ? error.message : 'ยังคืนค่ามาตรฐานไม่ได้'); }
    finally { button.disabled = false; }
  });

  $('provider-policy-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (!isOwner()) return; message('provider-message', 'กำลังบันทึกงบ AI…');
    try {
      const models = state.provider?.models || { fast: 'gpt-5.6-luna', balanced: 'gpt-5.6-terra', strong: 'gpt-5.6-sol' };
      const result = await updateProviderPolicy({ enabled: $('provider-enabled').checked, modelFast: $('provider-model-fast')?.value.trim() || models.fast, modelBalanced: $('provider-model-balanced')?.value.trim() || models.balanced, modelStrong: $('provider-model-strong')?.value.trim() || models.strong, monthlyBudgetMicrounits: micros('provider-budget'), warningMicrounits: micros('provider-warning'), routingStrategy: $('provider-routing-strategy')?.value || 'BALANCED', pricingMode: 'CATALOG', serviceTier: 'DEFAULT' });
      state.provider = result.provider; renderProvider(); renderSettingsOverview(); message('provider-message', 'บันทึกงบ AI แล้ว');
    } catch (error) { message('provider-message', error instanceof Error ? error.message : 'ยังบันทึกงบ AI ไม่ได้'); }
  });

  $('people-invite-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (!isOwner()) return; message('people-message', 'กำลังสร้างคำเชิญ…'); $('invitation-code').hidden = true;
    try {
      const invite = await invitePerson({ displayName: $('invite-name').value.trim(), username: $('invite-username').value.trim(), role: $('invite-role').value, projectIds: [$('invite-project').value] });
      $('invite-name').value = ''; $('invite-username').value = ''; const code = $('invitation-code'); code.hidden = false; code.textContent = `รหัสเชิญแบบใช้ครั้งเดียว (ส่งให้ผู้รับผ่านช่องทางที่ปลอดภัย):\n${invite.invitationCode}`; state.people = (await listPeople()).people || []; renderPeople(); message('people-message', 'สร้างคำเชิญแล้ว');
    } catch (error) { message('people-message', error instanceof Error ? error.message : 'ยังสร้างคำเชิญไม่ได้'); }
  });

  $('workspace-export').addEventListener('click', async () => {
    const button = $('workspace-export'); button.disabled = true;
    try {
      const data = await exportWorkspace(); const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `awh-workspace-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
    } catch (error) { message('product-settings-message', error instanceof Error ? error.message : 'ยังส่งออกข้อมูลไม่ได้'); }
    finally { button.disabled = false; }
  });

  $('sessions-load').addEventListener('click', async () => {
    const list = $('session-list'); list.replaceChildren();
    try {
      const data = await listAuthSessions();
      for (const session of data.sessions || []) {
        const row = document.createElement('div'); row.className = 'session-row';
        const detail = document.createElement('span'); detail.textContent = `${session.current ? 'อุปกรณ์นี้' : 'อุปกรณ์อื่น'} · ใช้งานล่าสุด ${date(session.lastSeenAt)}`;
        row.append(detail);
        if (!session.current) {
          const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'secondary-button'; revoke.textContent = 'เพิกถอน';
          revoke.addEventListener('click', async () => { revoke.disabled = true; try { await revokeAuthSession(session.sessionId); row.remove(); } catch { revoke.disabled = false; } }); row.append(revoke);
        }
        list.append(row);
      }
      if (!list.childElementCount) list.textContent = 'ไม่มีเซสชันที่ใช้งานอยู่';
    } catch (error) { list.textContent = error instanceof Error ? error.message : 'โหลดเซสชันไม่สำเร็จ'; }
  });

  $('recovery-codes-create').addEventListener('click', async () => {
    const output = $('recovery-codes'); output.hidden = false; output.textContent = 'กำลังสร้างรหัสกู้คืน…';
    try { const data = await createRecoveryCodes(); output.textContent = Array.isArray(data.recoveryCodes) ? data.recoveryCodes.join('\n') : 'ไม่สามารถสร้างรหัสกู้คืนได้'; }
    catch (error) { output.textContent = error instanceof Error ? error.message : 'ไม่สามารถสร้างรหัสกู้คืนได้'; }
  });

  $('recovery-form').addEventListener('submit', async (event) => {
    event.preventDefault(); message('recovery-message', 'กำลังตรวจสอบรหัสกู้คืน…');
    try { await recover($('recovery-username').value, $('recovery-code').value, $('recovery-password').value); $('recovery-code').value = ''; $('recovery-password').value = ''; message('recovery-message', 'ตั้งรหัสผ่านใหม่แล้ว กลับไปเข้าสู่ AWH ได้'); }
    catch (error) { message('recovery-message', error instanceof Error ? error.message : 'กู้คืนการเข้าถึงไม่สำเร็จ'); }
  });

  $('reset-password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.resetToken) { message('reset-message', 'กรุณาเปิดลิงก์กู้คืนจาก AWH Desktop ที่เชื่อถือได้ก่อน'); return; }
    if ($('reset-password').value !== $('reset-password-confirm').value) { message('reset-message', 'กรุณายืนยันรหัสผ่านใหม่ให้ตรงกัน'); return; }
    message('reset-message', 'กำลังบันทึกรหัสผ่านใหม่…'); $('reset-password-form').querySelector('button[type="submit"]').disabled = true;
    try {
      await resetPassword(state.resetToken, $('reset-password').value);
      state.resetToken = null; $('reset-password').value = ''; $('reset-password-confirm').value = ''; $('reset-password-form').hidden = true;
      message('reset-message', 'ตั้งรหัสผ่านใหม่แล้ว ลิงก์นี้ใช้ซ้ำไม่ได้ กลับไปเข้าสู่ AWH ด้วยรหัสผ่านใหม่ได้เลย');
    } catch (error) { message('reset-message', error instanceof Error ? error.message : 'ลิงก์ตั้งรหัสผ่านไม่ถูกต้องหรือหมดอายุ'); }
    finally { $('reset-password-form').querySelector('button[type="submit"]').disabled = false; }
  });

  $('logout-button').addEventListener('click', async () => { await logout().catch(() => undefined); window.location.reload(); });

  void loadPublicDesktopRelease();
  loadWebData().then(async (data) => { render(data); if (window.location.hash === '#awh-recovery' || window.location.hash.startsWith('#awh-reset=')) openPasswordRecovery(); if (data?.control?.authenticated) { await refreshConversation(); try { state.productSettings = (await loadProductSettings()).settings; applyProductSettings(); } catch {} state.conversationTimer = window.setInterval(() => { if (!document.hidden && state.selectedConversationId) void loadConversation(state.selectedConversationId).then((value) => { state.conversation = value; renderWorkspace(); }).catch(() => undefined); }, 2000); state.refreshTimer = window.setInterval(() => { if (!document.hidden) void refreshWorkspace(false); }, 15_000); } }).catch(() => render({ product: { shortName: 'AWH' }, control: { authenticated: false, available: false, error: 'AWH ยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง' } }));
})();
