import { loadWebData } from './hub-read-adapter.js?release=__AWH_WEB_RELEASE_ID__';
import {
  cancelTask, changePassword, changeUsername, createConversation, createMemory, createProject, createRecoveryCodes, decideApproval,
  exportWorkspace, invitePerson, listAuthSessions, listPeople, loadAuthProfile, loadControlData, loadConversation,
  loadConversations, loadCurrentContext, loadMemory, loadMemoryImportReport, loadOwnerSelfServiceStatus,
  loadProductSettings, loadProviderProjectRouting, loadProviderStatus, loadSystemReadiness, loadWorkspaceContinuity, login, logout,
  recover, resetPassword, resetProductSetting, revokeAuthSession, revokePerson, saveCurrentContext, stepUp, submitWorkMessage,
  testProviderConnection, updateAuthProfile, updateConversation, updateMemory, updatePersonAccess, updateProductSetting,
  updateProviderCredential, updateProviderPolicy, updateProviderProjectRouting, uploadConversationAttachments,
} from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';

(() => {
  const $ = (id) => document.getElementById(id);
  const MAX_ATTACHMENT_BYTES = 60 * 1024 * 1024;
  const MICRO_BAHT = 1000000;
  const state = { control: null, selectedProjectId: null, selectedConversationId: null, conversations: [], conversation: null, conversationAvailable: false, workspaceContinuity: null, productSettings: null, provider: null, profile: null, ownerStatus: null, providerRouting: null, systemReadiness: null, people: [], memory: [], memoryImport: null, pendingAttachments: [], refreshTimer: null, conversationTimer: null, resetToken: null };
  const taskLabels = {
    QUEUED: 'กำลังจัดการต่อบน AWH', WAITING_FOR_WORKER: 'กำลังจัดการต่อบน AWH', PREPARING: 'กำลังเตรียมงาน', RUNNING: 'กำลังทำงาน',
    QA: 'กำลังตรวจคุณภาพ', WAITING_FOR_APPROVAL: 'รอการอนุมัติ', COMPLETED: 'เสร็จแล้ว',
    FAILED: 'ต้องตรวจสอบ', CANCELLED: 'ยกเลิกแล้ว',
  };

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => undefined);

  function message(id, value = '') { const node = $(id); if (node) node.textContent = value; }
  function show(id) { $(id).hidden = false; }
  function hide(id) { $(id).hidden = true; }
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
  function stateText(task) {
    const providerState = ({
      PROVIDER_UNAVAILABLE: 'AI ยังตอบไม่ได้ในขณะนี้ · งานยังถูกเก็บไว้',
      PROVIDER_RATE_LIMITED: 'OpenAI จำกัดการเรียกใช้ชั่วคราว · งานยังถูกเก็บไว้',
      PROVIDER_QUOTA_EXHAUSTED: 'โควตาหรือวงเงิน OpenAI ยังไม่พร้อม · งานยังถูกเก็บไว้',
      BUDGET_EXHAUSTED: 'งบ AI ของ AWH ถึงขีดจำกัด · งานยังถูกเก็บไว้',
      PROVIDER_AUTH_FAILED: 'การเชื่อมต่อ OpenAI ถูกปฏิเสธ',
      PROVIDER_PERMISSION_DENIED: 'OpenAI ยังไม่อนุญาตคำขอนี้',
      PROVIDER_MODEL_UNAVAILABLE: 'โมเดล AI ที่ตั้งไว้ยังใช้ไม่ได้',
      PROVIDER_REQUEST_INVALID: 'คำขอ AI ไม่ถูกต้อง · งานไม่ได้ถูกอ้างว่าเสร็จแล้ว',
    })[task?.failureCode];
    return providerState || taskLabels[task?.state] || 'กำลังอัปเดต';
  }
  function stateClass(task) { return task?.state === 'COMPLETED' ? 'completed' : task?.state === 'FAILED' ? 'failed' : task?.state === 'WAITING_FOR_APPROVAL' ? 'approval' : ''; }
  function progressText(task) {
    const raw = typeof task?.lastEvent?.message === 'string' ? task.lastEvent.message.trim() : '';
    if (/[ก-๙]/u.test(raw)) return raw;
    return task?.execution?.executorKind === 'VPS' && task?.state === 'RUNNING' ? 'AWH กำลังทำงานบนระบบกลาง' : stateText(task);
  }

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
    const budget = provider.budget || {}; const rates = provider.rates || {}; const credential = provider.credential || {}; message('provider-status', provider.available ? `AI เดือนนี้ ${baht(budget.usedMicrounits)} จาก ${baht(budget.monthlyMicrounits)} · เหลือ ${baht(budget.remainingMicrounits)}` : (provider.keyConfigured ? `เชื่อม provider แล้ว · ทดสอบล่าสุด ${credential.lastTestStatus === 'PASS' ? 'ผ่าน' : credential.lastTestStatus === 'FAILED' ? 'ไม่ผ่าน' : 'ยังไม่ทดสอบ'}` : 'ยังไม่ได้เชื่อม API key ที่เก็บอย่างปลอดภัย'));
    $('provider-budget').value = (Number.isInteger(budget.monthlyMicrounits) ? budget.monthlyMicrounits / MICRO_BAHT : 0).toFixed(2); $('provider-warning').value = (Number.isInteger(budget.warningMicrounits) ? budget.warningMicrounits / MICRO_BAHT : 0).toFixed(2); $('provider-input-rate').value = (Number.isInteger(rates.inputMicrounitsPerMillion) ? rates.inputMicrounitsPerMillion / MICRO_BAHT : 0).toFixed(6); $('provider-output-rate').value = (Number.isInteger(rates.outputMicrounitsPerMillion) ? rates.outputMicrounitsPerMillion / MICRO_BAHT : 0).toFixed(6); $('provider-enabled').checked = provider.enabled === true;
    const models = provider.models || {}; for (const [id, value] of [['provider-model-fast', models.fast], ['provider-model-balanced', models.balanced], ['provider-model-strong', models.strong]]) if ($(id) && typeof value === 'string') $(id).value = value;
    if ($('provider-project-routing')) $('provider-project-routing').value = state.providerRouting?.routingMode || 'AUTO';
    const usage = $('provider-usage'); if (usage) { usage.replaceChildren(); const rows = Array.isArray(provider.usageByProject) ? provider.usageByProject : []; for (const row of rows) { const item = document.createElement('li'); item.textContent = `${row.projectName || 'Project'} · ${baht(row.estimatedMicrounits || 0)}`; usage.append(item); } if (!usage.childElementCount) usage.textContent = 'ยังไม่มีการใช้งานที่คิดค่าใช้จ่าย'; }
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
    models.innerHTML = '<summary>โมเดล การกำหนดโปรเจกต์ และค่าใช้จ่ายขั้นสูง</summary><div class="advanced-ai-fields"><label for="provider-model-fast">โมเดลเร็ว</label><input id="provider-model-fast" maxlength="120" autocomplete="off" /><label for="provider-model-balanced">โมเดลสมดุล</label><input id="provider-model-balanced" maxlength="120" autocomplete="off" /><label for="provider-model-strong">โมเดลละเอียด</label><input id="provider-model-strong" maxlength="120" autocomplete="off" /><ul id="provider-usage" class="session-list"></ul></div>';
    const enabled = $('provider-enabled');
    const enabledRow = enabled?.closest('label');
    if (!enabledRow || enabledRow.parentElement !== policy) throw new Error('AWH provider settings surface is unavailable');
    policy.insertBefore(models, enabledRow);
    const section = document.createElement('section'); section.className = 'account-form'; section.id = 'provider-credential-settings';
    section.innerHTML = '<h3>การเชื่อมต่อ AI</h3><p class="muted">API key จะถูกส่งครั้งเดียวผ่าน HTTPS และเก็บเฉพาะฝั่ง server; AWH จะไม่แสดงหรือส่งคืน key นี้</p><form id="provider-credential-form" class="compact-form"><label for="provider-api-key">OpenAI API key</label><input id="provider-api-key" type="password" maxlength="512" autocomplete="off" spellcheck="false" /><div class="form-actions"><button class="secondary-button" type="submit">บันทึกหรือแทนที่ key</button><button id="provider-credential-remove" class="text-button" type="button">ลบ key</button><button id="provider-connection-test" class="text-button" type="button">ทดสอบการเชื่อมต่อ</button></div></form><form id="provider-project-routing-form" class="compact-form"><label for="provider-project-routing">AI สำหรับโปรเจกต์ที่เลือก</label><select id="provider-project-routing"><option value="AUTO">Auto (ตามค่า AWH)</option><option value="FAST">เร็ว</option><option value="BALANCED">สมดุล</option><option value="STRONG">ละเอียด</option></select><button class="secondary-button" type="submit">บันทึกการเลือกของโปรเจกต์</button></form><p id="provider-credential-message" class="form-message" role="status"></p>';
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

  function workerStateLabel(worker) { return worker.state === 'READY' ? 'พร้อมทำงาน' : worker.state === 'WORKING' ? 'กำลังทำงาน' : 'ออฟไลน์'; }
  async function loadDesktopRelease() {
    const list = $('desktop-release-list'); if (!list) return;
    try {
      const response = await fetch('./release.json', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('release metadata unavailable');
      const manifest = await response.json();
      if (!manifest || typeof manifest.releaseId !== 'string' || !Array.isArray(manifest.files)) throw new Error('release metadata invalid');
      const files = new Map(manifest.files.filter((entry) => entry && typeof entry.path === 'string' && typeof entry.sha256 === 'string' && Number.isSafeInteger(entry.sizeBytes)).map((entry) => [entry.path, entry]));
      const packages = [['downloads/AWH-macOS-x64.zip', 'macOS Intel'], ['downloads/AWH-Windows-x64.zip', 'Windows x64']].filter(([path]) => files.has(path));
      list.replaceChildren();
      if (!packages.length) throw new Error('verified desktop packages unavailable');
      message('desktop-release-status', `release ${manifest.releaseId} · เลือก installer ที่ตรวจสอบ checksum แล้ว`);
      for (const [path, , platform] of [['downloads/AWH-macOS-x64.zip', 'macOS Intel', 'mac'], ['downloads/AWH-Windows-x64.zip', 'Windows x64', 'windows']]) {
        const link = document.querySelector(`[data-desktop-package="${platform}"]`); if (link && files.has(path)) { link.href = `./${path}`; link.dataset.release = manifest.releaseId; }
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
    const ai = provider.available ? 'พร้อมใช้งาน · Auto' : provider.keyConfigured ? `เชื่อมแล้ว · ${credential.lastTestStatus === 'PASS' ? 'ตรวจสอบผ่าน' : 'รอทดสอบ'}` : 'ยังไม่เชื่อม API key';
    message('settings-ai-summary', ai);
    message('settings-device-summary', workers.length ? `${workers.filter((worker) => worker.state === 'READY' || worker.state === 'WORKING').length} เครื่องพร้อมทำงาน` : 'ยังไม่มี AWH Desktop ที่พร้อมทำงาน');
    const list = $('settings-worker-list'); if (list) {
      list.replaceChildren();
      for (const worker of workers) { const item = document.createElement('div'); item.className = 'session-item'; const name = document.createElement('strong'); name.textContent = worker.displayName || 'AWH Desktop'; const detail = document.createElement('span'); detail.textContent = `${workerStateLabel(worker)} · รองรับ ${worker.boundProjectCount || 0} โปรเจกต์`; item.append(name, detail); list.append(item); }
      if (!list.childElementCount) list.textContent = 'ยังไม่มี Desktop ที่เข้าถึง source ของโปรเจกต์ได้';
    }
    const online = workers.filter((worker) => worker?.online || ['READY', 'WORKING', 'ONLINE'].includes(worker?.state)).length;
    message('settings-worker-message', online > 0 ? `มีอุปกรณ์ทำงานพร้อมรับงาน ${online} เครื่อง` : 'เปิด AWH Desktop บนอุปกรณ์ที่ผูกกับโปรเจกต์เพื่อรับงานที่ต้องใช้เครื่องมือท้องถิ่น');
    void loadDesktopRelease();
    const readiness = state.systemReadiness;
    if (readiness) {
      const checks = readiness.checks || {};
      const waiting = Number.isInteger(checks.waitingCapabilityCount) && checks.waitingCapabilityCount > 0 ? ` · มีงานรอความสามารถ ${checks.waitingCapabilityCount} งาน` : '';
      message('system-check-message', readiness.state === 'READY' ? 'AWH พร้อมทำงาน' : readiness.state === 'PARTIALLY_READY' ? `AWH พร้อมบางส่วน${waiting}` : 'AWH ต้องตรวจสอบบางรายการก่อนเริ่มงาน');
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

  function workerSummary(workers) {
    const source = Array.isArray(workers) ? workers : [];
    const working = source.filter((worker) => worker.state === 'WORKING');
    const ready = source.filter((worker) => worker.state === 'READY');
    if (working.length) return `${working.length} อุปกรณ์กำลังทำงาน`;
    if (ready.length) return `${ready.length} อุปกรณ์พร้อมทำงาน`;
    return 'ยังไม่มีอุปกรณ์ทำงานออนไลน์ — งานจะรออย่างปลอดภัย';
  }

  function continuitySummary(workspace) {
    if (!workspace) return '';
    if (workspace.syncStatus === 'SYNCED') return ' · งานล่าสุดพร้อมทำต่อบนอุปกรณ์ที่เชื่อถือได้';
    if (workspace.syncStatus === 'HANDOFF_REQUIRED') return ' · งานกำลังอยู่บนอุปกรณ์อื่น';
    if (workspace.syncStatus === 'SOURCE_OFFLINE') return ' · อุปกรณ์เดิมออฟไลน์ แต่มี checkpoint ล่าสุด';
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

  function renderThread(conversation, approvals) {
    const thread = $('work-thread'); thread.replaceChildren();
    const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
    const taskById = new Map((conversation?.tasks || []).map((task) => [task.taskId, task]));
    const artifactsByTask = new Map();
    for (const artifact of conversation?.artifacts || []) {
      if (!artifact?.taskId) continue;
      const list = artifactsByTask.get(artifact.taskId) || []; list.push(artifact); artifactsByTask.set(artifact.taskId, list);
    }
    const attachmentsByMessage = new Map();
    for (const attachment of conversation?.attachments || []) { if (!attachment?.messageId) continue; const list = attachmentsByMessage.get(attachment.messageId) || []; list.push(attachment); attachmentsByMessage.set(attachment.messageId, list); }
    $('empty-work').hidden = messages.length > 0 || !state.selectedProjectId;
    for (const turn of messages) {
      const task = turn.taskId ? taskById.get(turn.taskId) : null;
      const row = document.createElement('li'); row.className = `task-turn ${turn.kind === 'user' ? 'user-turn' : 'assistant-turn'}`;
      const body = document.createElement('p'); body.className = turn.kind === 'user' ? 'task-goal' : 'task-summary'; body.textContent = turn.body;
      if (turn.kind === 'user') { row.append(body); const attachments = renderMessageAttachments(attachmentsByMessage.get(turn.messageId)); if (attachments) row.append(attachments); thread.append(row); continue; }
      const response = document.createElement('div'); response.className = 'task-response';
      const meta = document.createElement('div'); meta.className = 'task-meta';
      const chip = document.createElement('span'); chip.className = `state-chip ${stateClass(task)}`.trim();
      chip.textContent = turn.kind === 'approval' ? 'ต้องอนุมัติ' : turn.kind === 'result' ? 'เสร็จแล้ว' : turn.kind === 'failure' ? 'ต้องตรวจสอบ' : task ? stateText(task) : 'AWH';
      const time = document.createElement('span'); time.textContent = date(turn.createdAt);
      meta.append(chip, time); response.append(meta, body);
      if (task && !['COMPLETED','FAILED','CANCELLED'].includes(task.state)) {
        const progressRow = document.createElement('div'); progressRow.className = 'task-progress-row';
        const bar = document.createElement('progress'); bar.max = 100; bar.value = Number.isInteger(task.progress) ? task.progress : 0; bar.setAttribute('aria-label', progressText(task));
        const text = document.createElement('span'); text.textContent = progressText(task); progressRow.append(bar, text); response.append(progressRow);
      }
      if (task) {
        const actions = renderApproval(task, approvals) || renderCancellation(task); if (actions) response.append(actions);
        const artifacts = artifactsByTask.get(task.taskId) || [];
        if (artifacts.length) { const list = document.createElement('ul'); list.className = 'artifact-links'; for (const artifact of artifacts) { const item = document.createElement('li'); if (typeof artifact.downloadUrl === 'string' && /^\/api\/v1\/control\/artifacts\/[0-9a-f-]{36}\/download$/i.test(artifact.downloadUrl)) { const link = document.createElement('a'); link.href = artifact.downloadUrl; link.textContent = `↳ ดาวน์โหลด ${artifact.name || 'ไฟล์ผลลัพธ์'}`; item.append(link); } else item.textContent = `↳ ${artifact.name || 'ไฟล์ผลลัพธ์'}`; list.append(item); } response.append(list); }
      }
      row.append(response); thread.append(row);
    }
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
    if (!projects.some((project) => project.projectId === state.selectedProjectId)) state.selectedProjectId = projects[0]?.projectId || null;
    const project = selectedProject();
    message('selected-project-name', project?.name || 'ยังไม่มีโปรเจกต์');
    message('selected-conversation-name', state.conversation?.conversation?.title || 'Work');
    message('worker-summary', workerSummary(control.workers));
    message('work-context', project ? (project.memoryReady ? `บริบทและงานจะถูกผูกกับโปรเจกต์นี้${continuitySummary(state.workspaceContinuity)}` : 'AWH จะรักษาขอบเขตของโปรเจกต์นี้ไว้ขณะ worker ตรวจ context') : 'เพิ่มโปรเจกต์จาก AWH Desktop เพื่อเริ่มงาน');
    message('advanced-status', `${workerSummary(control.workers)} · งานและผลลัพธ์แสดงเฉพาะตามสิทธิ์ของบัญชีคุณ`);
    const workReady = project !== null && state.conversationAvailable;
    $('goal-submit').disabled = !workReady;
    $('goal-input').disabled = !workReady;
    $('attachment-open').disabled = !workReady;
    $('attachment-input').disabled = !workReady;
    $('goal-input').placeholder = !project ? 'เลือกหรือเพิ่มโปรเจกต์ก่อน' : workReady ? 'พิมพ์สิ่งที่อยากให้ AWH ช่วย…' : 'กำลังเปิด Work อย่างปลอดภัย…';
    renderProjectSheet(projects);
    renderConversationSheet();
    renderThread(state.conversation, state.conversation?.approvals || control.approvals);
  }

  function render(data) {
    setSurface(data);
    state.control = data?.control || { authenticated: false, available: false, error: 'AWH ยังไม่พร้อมใช้งาน' };
    const authenticated = state.control.authenticated === true;
    $('sign-in-view').hidden = authenticated;
    $('workspace-view').hidden = !authenticated;
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
    try { state.control = await loadControlData(); renderWorkspace(); await refreshConversation(); if (showBusy) message('goal-message', ''); }
    catch (error) { message('goal-message', error instanceof Error ? error.message : 'AWH ไม่สามารถรีเฟรชข้อมูลได้'); }
  }

  const settingsSections = ['start', 'ai', 'account', 'devices', 'data', 'people'];
  function showSettingsSection(section = 'start') {
    const selected = settingsSections.includes(section) ? section : 'start';
    for (const name of settingsSections) {
      const panel = $(`settings-panel-${name}`); if (panel) panel.hidden = name !== selected;
    }
    document.querySelectorAll('[data-settings-tab]').forEach((button) => {
      const active = button.dataset.settingsTab === selected;
      button.classList.toggle('active', active); button.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }
  function configureSettingsVisibility() {
    const owner = isOwner();
    for (const section of ['ai', 'devices', 'data', 'people']) {
      const button = document.querySelector(`.settings-tab[data-settings-tab="${section}"]`);
      if (button) button.hidden = !owner;
    }
    const people = document.querySelector('.owner-settings-tab'); if (people) people.hidden = !owner;
    if (!owner && !['start', 'account'].includes(document.querySelector('.settings-tab.active')?.dataset.settingsTab || '')) showSettingsSection('account');
  }
  function openSheet(id) { show(id); }
  function closeSheet(id) { hide(id); }
  function openPasswordRecovery() {
    let token = null;
    if (window.location.hash.startsWith('#awh-reset=')) {
      try { const candidate = decodeURIComponent(window.location.hash.slice('#awh-reset='.length)); if (/^[A-Za-z0-9_-]{43}$/.test(candidate)) token = candidate; } catch { token = null; }
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    state.resetToken = token;
    $('reset-password-form').hidden = token === null;
    message('reset-instructions', token ? 'ลิงก์นี้ใช้ได้ครั้งเดียวและจะหมดอายุในเวลาอันสั้น เลือกรหัสผ่านใหม่ที่คุณจำได้' : 'กด “ลืมรหัสผ่าน?” จากหน้าเข้าสู่ระบบ แล้วเปิดลิงก์กู้คืนจาก AWH Desktop ที่เชื่อถือได้ ลิงก์มีอายุสั้นและใช้ได้ครั้งเดียว');
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
      const project = selectedProject(); const requests = [loadProviderStatus(), listPeople(), loadAuthProfile(), loadOwnerSelfServiceStatus(), project ? loadProviderProjectRouting(project.projectId) : Promise.resolve(null)];
      const [providerResult, peopleResult, profileResult, ownerStatusResult, routingResult] = await Promise.allSettled(requests);
      if (providerResult.status === 'fulfilled') { state.provider = providerResult.value.provider; renderProvider(); }
      else message('provider-status', 'ยังโหลดสถานะ AI ไม่ได้ ลองรีเฟรชอีกครั้ง');
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
    event.preventDefault(); const goal = $('goal-input').value.trim(); const project = selectedProject();
    if (!project || !goal) { message('goal-message', 'เลือกโปรเจกต์และพิมพ์สิ่งที่อยากให้ AWH ช่วยก่อน'); return; }
    const conversationId = state.selectedConversationId;
    if (!conversationId) { message('goal-message', 'กำลังเตรียมการสนทนา กรุณาลองใหม่อีกครั้ง'); return; }
    const idempotencyKey = `web-${crypto.randomUUID()}`;
    const pending = [...state.pendingAttachments];
    const localMessageId = `local-${idempotencyKey}`;
    const localAttachments = pending.map((file, index) => ({ attachmentId: `local-${idempotencyKey}-${index}`, messageId: localMessageId, name: file.name, sizeBytes: file.size, pending: true }));
    state.conversation = { ...(state.conversation || {}), messages: [...(state.conversation?.messages || []), { messageId: localMessageId, taskId: null, kind: 'user', sequence: Number.MAX_SAFE_INTEGER - 1, body: goal, createdAt: new Date().toISOString() }, { messageId: `local-progress-${idempotencyKey}`, taskId: null, kind: 'progress', sequence: Number.MAX_SAFE_INTEGER, body: pending.length ? 'กำลังแนบไฟล์และบันทึกงาน…' : 'กำลังตรวจบริบทและบันทึกงาน…', createdAt: new Date().toISOString() }], tasks: state.conversation?.tasks || [], artifacts: state.conversation?.artifacts || [], attachments: [...(state.conversation?.attachments || []), ...localAttachments], approvals: state.conversation?.approvals || [] };
    renderWorkspace(); message('goal-message', ''); $('goal-submit').disabled = true; $('attachment-open').disabled = true;
    try {
      const uploaded = pending.length ? await uploadConversationAttachments(conversationId, pending) : [];
      await submitWorkMessage(project.projectId, conversationId, goal, uploaded.map((attachment) => attachment.attachmentId), idempotencyKey);
      $('goal-input').value = ''; state.pendingAttachments = []; renderPendingAttachments();
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
  $('account-open-inline').addEventListener('click', () => { void openAccount(); });
  $('system-check').addEventListener('click', async () => {
    if (!isOwner()) { message('system-check-message', 'เฉพาะเจ้าของ AWH เท่านั้นที่ตรวจความพร้อมของระบบได้'); return; }
    const button = $('system-check'); button.disabled = true; message('system-check-message', 'กำลังตรวจความพร้อม…');
    try { state.systemReadiness = await loadSystemReadiness(); renderSettingsOverview(); }
    catch (error) { message('system-check-message', error instanceof Error ? error.message : 'ยังตรวจความพร้อมของ AWH ไม่ได้'); }
    finally { button.disabled = false; }
  });
  document.querySelectorAll('[data-settings-tab]').forEach((button) => button.addEventListener('click', () => showSettingsSection(button.dataset.settingsTab)));
  $('recovery-open').addEventListener('click', openPasswordRecovery);
  document.querySelectorAll('[data-close-sheet]').forEach((button) => button.addEventListener('click', () => closeSheet(button.dataset.closeSheet)));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') document.querySelectorAll('.sheet:not([hidden])').forEach((sheet) => { sheet.hidden = true; }); });

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
      const models = state.provider?.models || { fast: 'gpt-5.4-mini', balanced: 'gpt-5.4', strong: 'gpt-5.4' };
      const result = await updateProviderPolicy({ enabled: $('provider-enabled').checked, modelFast: $('provider-model-fast')?.value.trim() || models.fast, modelBalanced: $('provider-model-balanced')?.value.trim() || models.balanced, modelStrong: $('provider-model-strong')?.value.trim() || models.strong, monthlyBudgetMicrounits: micros('provider-budget'), warningMicrounits: micros('provider-warning'), inputMicrounitsPerMillion: micros('provider-input-rate'), outputMicrounitsPerMillion: micros('provider-output-rate') });
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

  loadWebData().then(async (data) => { render(data); if (window.location.hash.startsWith('#awh-reset=')) openPasswordRecovery(); if (data?.control?.authenticated) { await refreshConversation(); try { state.productSettings = (await loadProductSettings()).settings; applyProductSettings(); } catch {} state.conversationTimer = window.setInterval(() => { if (!document.hidden && state.selectedConversationId && (state.conversation?.tasks || []).some((task) => !['COMPLETED','FAILED','CANCELLED'].includes(task.state))) void loadConversation(state.selectedConversationId).then((value) => { state.conversation = value; renderWorkspace(); }).catch(() => undefined); }, 2500); state.refreshTimer = window.setInterval(() => { if (!document.hidden) void refreshWorkspace(false); }, 15_000); } }).catch(() => render({ product: { shortName: 'AWH' }, control: { authenticated: false, available: false, error: 'AWH ยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง' } }));
})();
