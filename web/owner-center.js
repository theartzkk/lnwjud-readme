(() => {
  const SHEET_ID = 'dashboard-owner-command-center';
  const SOURCE_SHEET_ID = 'dashboard-owner-source-center';
  const LAUNCH_ID = 'dashboard-owner-center-open';
  const PREVIEW_CLASS = 'awh-teacher-preview';
  const PREVIEW_BAR_ID = 'awh-teacher-preview-bar';
  const $ = (id) => document.getElementById(id);
  let sourceApiPromise = null;

  const GROUPS = Object.freeze([
    { title: 'งานและความต่อเนื่อง', items: [
      ['teacher-preview', '◉', 'ดูในมุมครู', 'Preview หน้าแรกแบบที่ครูเห็น โดยไม่เปลี่ยนสิทธิ์จริง', 'Preview'],
      ['projects', '◫', 'Projects', 'โปรเจกต์ บริบท และ Source of Truth'],
      ['source-authority', '⌘', 'Source Authority', 'GitHub canonical source, exact SHA, Project Vault และ AiPASS DOCX', 'Owner'],
      ['multi-chat', '☰', 'Multi Chat', 'การสนทนาที่แยกตามโปรเจกต์'],
      ['tasks', '↻', 'Tasks & Executions', 'งานที่กำลังทำ ประวัติ และผลลัพธ์'],
      ['memory', '◎', 'Memory', 'ความจำและข้อมูลที่ใช้ทำงานต่อ'],
      ['approvals', '✓', 'Approvals', 'รายการสำคัญที่รอการอนุมัติ'],
    ] },
    { title: 'คน AI และอุปกรณ์', items: [
      ['ai', '✦', 'AI & Costs', 'Providers การเลือกโมเดล งบ และค่าใช้จ่าย'],
      ['devices', '◇', 'Devices & Workers', 'Mac Windows และความสามารถของ Worker'],
      ['people', '♙', 'Users & Roles', 'ผู้ร่วมงาน สิทธิ์ และการเข้าถึงโปรเจกต์'],
      ['security', '⌾', 'Security', 'บัญชี session การกู้คืน และความปลอดภัย'],
      ['trust', '◎', 'Trust Center', 'หลักฐาน AI, Approvals, Artifacts, Undo และความปลอดภัย'],
    ] },
    { title: 'ระบบและการขยาย', items: [
      ['infrastructure', '⌘', 'Infrastructure', 'VPS, Services, Domains, SSL, Backup และ Deployments'],
      ['database', '▦', 'Database Studio', 'ตรวจข้อมูล โครงสร้าง และ migration แบบปลอดภัย'],
      ['product-review', '◈', 'Product Review', 'ตรวจระบบและหน้าจอบน Cloud แล้วรับ Review Pack กลับเข้า AWH', 'Cloud'],
      ['automations', '↯', 'Automations', 'งานตามเวลาและเงื่อนไข', 'กำลังพัฒนา'],
      ['runtime', '⌘', 'Runtime / lnwjud', 'Capability Fabric และรายละเอียดการทำงานขั้นสูง', 'Advanced'],
    ] },
  ]);

  function openSettings(tab) {
    $('account-open')?.click();
    window.setTimeout(() => {
      const target = document.querySelector(`[data-settings-tab="${tab}"]`);
      if (target instanceof HTMLButtonElement && !target.hidden) { target.click(); target.focus(); }
    }, 0);
  }

  function closeCenter(options = {}) {
    const sheet = $(SHEET_ID);
    if (sheet) closeAwhDialog(sheet, options);
  }

  function closeSourceCenter(options = {}) {
    const sheet = $(SOURCE_SHEET_ID);
    if (sheet) closeAwhDialog(sheet, options);
  }

  function sourceApi() {
    sourceApiPromise ||= import('./control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__');
    return sourceApiPromise;
  }

  function sourceMessage(value = '') {
    const node = $('owner-source-message');
    if (node) node.textContent = value;
  }

  function sourceValue(value, fallback = '—') {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  function sourceRevision(value) {
    const revision = sourceValue(value);
    return revision === '—' ? revision : revision.slice(0, 12);
  }

  function sourceSnapshot(value) {
    const snapshot = sourceValue(value);
    return snapshot === '—' ? snapshot : snapshot.slice(0, 8);
  }

  function appendSourceDetail(host, label, value, tone = 'neutral') {
    const row = document.createElement('div');
    row.className = 'session-item awh-source-detail';
    row.dataset.tone = tone;
    const copy = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = label;
    const detail = document.createElement('small'); detail.textContent = value;
    copy.append(title, detail); row.append(copy); host.append(row);
  }

  function renderSourceState(state) {
    const host = $('owner-source-state');
    if (!(host instanceof HTMLElement)) return;
    host.replaceChildren();
    const connected = state.state !== 'NOT_CONFIGURED' && typeof state.repository === 'string' && state.repository.trim() !== '';
    appendSourceDetail(
      host,
      connected ? 'GitHub Source · เชื่อมแล้ว ✓' : 'GitHub Source · ยังไม่ได้เชื่อม',
      connected ? `${state.repository}${state.ref ? ` · ${state.ref}` : ''}` : 'เชื่อม repository ที่เป็น Source of Truth ของโปรเจกต์นี้หนึ่งครั้ง',
      connected ? 'ready' : 'muted',
    );
    appendSourceDetail(
      host,
      'Source ล่าสุด',
      typeof state.canonicalRevision === 'string' && /^[0-9a-f]{40}$/i.test(state.canonicalRevision)
        ? `${sourceRevision(state.canonicalRevision)} · ยืนยันจาก GitHub`
        : 'ยังยืนยัน revision ล่าสุดไม่ได้',
      typeof state.canonicalRevision === 'string' ? 'ready' : 'attention',
    );
    appendSourceDetail(
      host,
      'Canonical cache สำหรับ AI / AiPASS',
      state.canonicalVaultReady === true
        ? `พร้อม ✓ · snapshot ${sourceSnapshot(state.canonicalVaultRevisionId)}`
        : connected ? 'จะสร้างและตรวจ exact snapshot อัตโนมัติเมื่อเตรียม AiPASS' : 'รอเชื่อม GitHub Source',
      state.canonicalVaultReady === true ? 'ready' : 'muted',
    );
    const vault = state.vault && typeof state.vault === 'object' ? state.vault : {};
    const active = sourceValue(vault.activeRevisionId, '');
    let working = 'ยังไม่มี Working Vault';
    let workingTone = 'muted';
    if (active) {
      if (state.canonicalVaultReady === true && active === state.canonicalVaultRevisionId) {
        working = `ตรงกับ canonical cache ✓ · snapshot ${sourceSnapshot(active)}`;
        workingTone = 'ready';
      } else if (vault.syncState === 'STALE') {
        working = `มี working snapshot แยกจาก GitHub · ระบบจะไม่ทับอัตโนมัติ · ${sourceSnapshot(active)}`;
        workingTone = 'attention';
      } else {
        working = `พร้อมใช้งาน · snapshot ${sourceSnapshot(active)}`;
        workingTone = 'ready';
      }
    }
    appendSourceDetail(host, 'Working files', working, workingTone);

    const repository = $('owner-source-repository');
    const ref = $('owner-source-ref');
    if (repository instanceof HTMLInputElement) repository.value = state.repository || '';
    if (ref instanceof HTMLInputElement) ref.value = state.ref || '';
    const clear = $('owner-source-clear');
    if (clear instanceof HTMLButtonElement) clear.hidden = state.state === 'NOT_CONFIGURED';
    const bind = $('owner-source-bind');
    if (bind instanceof HTMLButtonElement) bind.textContent = state.state === 'NOT_CONFIGURED' ? 'เชื่อม GitHub' : 'อัปเดต Source';
    const aipass = $('owner-source-aipass');
    if (aipass instanceof HTMLButtonElement) {
      const ready = connected && typeof state.canonicalRevision === 'string' && /^[0-9a-f]{40}$/i.test(state.canonicalRevision);
      aipass.disabled = !ready;
      aipass.textContent = state.canonicalVaultReady === true ? 'สร้างชุดตรวจ AiPASS ใหม่' : 'สร้างชุดตรวจ AiPASS';
      aipass.title = ready ? 'สร้าง DOCX เป็น Batch จาก exact canonical Source ที่ยืนยันแล้ว' : 'เชื่อม canonical GitHub Source ให้สำเร็จก่อน';
    }
  }

  async function refreshSourceState() {
    const select = $('owner-source-project');
    if (!(select instanceof HTMLSelectElement) || !select.value) return;
    sourceMessage('กำลังยืนยัน Source จากระบบกลาง…');
    const api = await sourceApi();
    const state = await api.loadProjectSourceAuthority(select.value);
    renderSourceState(state);
    sourceMessage('ยืนยัน Source ล่าสุดแล้ว');
  }

  async function loadSourceProjects() {
    const select = $('owner-source-project');
    if (!(select instanceof HTMLSelectElement)) return;
    sourceMessage('กำลังโหลดโปรเจกต์…');
    const api = await sourceApi();
    const control = await api.loadControlData();
    if (control.role !== 'OWNER') throw new Error('Source Authority ใช้ได้เฉพาะ Owner');
    const previous = select.value;
    const activeName = $('selected-project-name')?.textContent?.trim() || '';
    select.replaceChildren();
    for (const project of control.projects) {
      const option = document.createElement('option');
      option.value = project.projectId; option.textContent = project.name; select.append(option);
    }
    const preferred = control.projects.find((project) => project.projectId === previous)
      || control.projects.find((project) => project.name === activeName)
      || control.projects[0];
    select.value = preferred?.projectId || '';
    if (!select.value) { sourceMessage('ยังไม่มีโปรเจกต์ให้กำหนด Source'); $('owner-source-state')?.replaceChildren(); return; }
    await refreshSourceState();
  }

  async function bindSource(event) {
    event.preventDefault();
    const select = $('owner-source-project');
    const repository = $('owner-source-repository');
    const ref = $('owner-source-ref');
    if (!(select instanceof HTMLSelectElement) || !(repository instanceof HTMLInputElement) || !(ref instanceof HTMLInputElement)) return;
    const repo = repository.value.trim();
    const branch = ref.value.trim();
    if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)) { sourceMessage('Repository ต้องอยู่ในรูป owner/repository'); repository.focus(); return; }
    if (branch && (!/^[A-Za-z0-9._\/-]{1,160}$/.test(branch) || branch.includes('..'))) { sourceMessage('Git ref ไม่ถูกต้อง'); ref.focus(); return; }
    sourceMessage('กำลังเชื่อม canonical GitHub source…');
    const api = await sourceApi();
    const state = await api.updateProjectSourceAuthority({ projectId: select.value, action: 'BIND', repository: repo, ref: branch || null });
    renderSourceState(state);
    sourceMessage('เชื่อม canonical Source แล้ว');
  }

  async function clearSource() {
    const select = $('owner-source-project');
    if (!(select instanceof HTMLSelectElement) || !select.value) return;
    if (!window.confirm('ล้าง canonical Source ของโปรเจกต์นี้? Project Vault และประวัติเดิมจะไม่ถูกลบ')) return;
    sourceMessage('กำลังล้าง Source binding…');
    const api = await sourceApi();
    const state = await api.updateProjectSourceAuthority({ projectId: select.value, action: 'CLEAR' });
    renderSourceState(state);
    sourceMessage('ล้าง Source binding แล้ว โดยไม่ลบ Vault history');
  }

  async function prepareAiPassReview() {
    const select = $('owner-source-project');
    const button = $('owner-source-aipass');
    if (!(select instanceof HTMLSelectElement) || !select.value) return;
    if (button instanceof HTMLButtonElement) button.disabled = true;
    sourceMessage('กำลังสร้าง DOCX จาก exact canonical Source และตรวจขนาดทุก Batch…');
    try {
      const api = await sourceApi();
      const result = await api.createAiPassProjectExport(select.value);
      const downloadUrl = result?.artifact?.downloadUrl;
      if (typeof downloadUrl !== 'string') throw new Error('AWH ไม่พบไฟล์ AiPASS ที่ตรวจแล้ว');
      const target = new URL(downloadUrl, window.location.origin);
      if (target.origin !== window.location.origin || !/^\/api\/v1\/control\/artifacts\/[0-9a-f-]{36}\/download$/i.test(target.pathname)) throw new Error('เส้นทางไฟล์ AiPASS ไม่ถูกต้อง');
      target.search = '';
      target.searchParams.set('aipass', 'page');
      sourceMessage('เตรียม DOCX เรียบร้อย กำลังเปิดรายการ Batch…');
      window.location.assign(`${target.pathname}${target.search}`);
    } finally {
      if (button instanceof HTMLButtonElement && document.contains(button)) button.disabled = false;
    }
  }

  function ensureSourceCenter() {
    const existing = $(SOURCE_SHEET_ID);
    if (existing) return existing;
    const sheet = document.createElement('section');
    sheet.id = SOURCE_SHEET_ID;
    sheet.className = 'awh-owner-command-center';
    sheet.hidden = true;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'owner-source-title');
    const backdrop = document.createElement('button');
    backdrop.type = 'button'; backdrop.className = 'awh-owner-command-backdrop'; backdrop.setAttribute('aria-label', 'ปิด Source Authority'); backdrop.addEventListener('click', closeSourceCenter);
    const card = document.createElement('div'); card.className = 'awh-owner-command-card';
    const head = document.createElement('header'); head.className = 'awh-owner-command-head';
    head.innerHTML = '<div><span>SOURCE & AIPASS</span><h2 id="owner-source-title">Source และชุดตรวจ AiPASS</h2><p>เชื่อม GitHub หนึ่งครั้ง แล้ว AWH จะยืนยัน Source ล่าสุดและเตรียม DOCX ที่ปลอดภัยให้เป็น Batch</p></div>';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'awh-secondary-action'; close.textContent = 'ปิด'; close.addEventListener('click', closeSourceCenter); head.append(close);
    const body = document.createElement('div'); body.className = 'awh-owner-command-body';
    const form = document.createElement('form'); form.id = 'owner-source-form'; form.className = 'compact-form';
    const projectLabel = document.createElement('label'); projectLabel.htmlFor = 'owner-source-project'; projectLabel.textContent = 'โปรเจกต์';
    const project = document.createElement('select'); project.id = 'owner-source-project'; project.addEventListener('change', () => { void refreshSourceState().catch((error) => sourceMessage(error?.message || 'ตรวจ Source ไม่สำเร็จ')); });
    const state = document.createElement('div'); state.id = 'owner-source-state'; state.className = 'session-list'; state.setAttribute('aria-live', 'polite');
    const repositoryLabel = document.createElement('label'); repositoryLabel.htmlFor = 'owner-source-repository'; repositoryLabel.textContent = 'GitHub repository (owner/repository)';
    const repository = document.createElement('input'); repository.id = 'owner-source-repository'; repository.maxLength = 201; repository.autocomplete = 'off'; repository.placeholder = 'owner/repository';
    const refLabel = document.createElement('label'); refLabel.htmlFor = 'owner-source-ref'; refLabel.textContent = 'Branch / Git ref';
    const ref = document.createElement('input'); ref.id = 'owner-source-ref'; ref.maxLength = 160; ref.autocomplete = 'off'; ref.placeholder = 'เช่น main หรือ awh/api-independence';
    const note = document.createElement('p'); note.className = 'muted'; note.textContent = 'Working files และประวัติ Project Vault จะไม่ถูก GitHub ทับอัตโนมัติ · AiPASS ใช้เฉพาะ DOCX ที่ AWH แบ่งและตรวจให้เป็น Batch';
    const actions = document.createElement('div'); actions.className = 'form-actions';
    const bind = document.createElement('button'); bind.id = 'owner-source-bind'; bind.type = 'submit'; bind.className = 'secondary-button'; bind.textContent = 'เชื่อม GitHub';
    const refresh = document.createElement('button'); refresh.id = 'owner-source-refresh'; refresh.type = 'button'; refresh.className = 'text-button'; refresh.textContent = 'รีเฟรชสถานะ'; refresh.addEventListener('click', () => { void refreshSourceState().catch((error) => sourceMessage(error?.message || 'ตรวจ Source ไม่สำเร็จ')); });
    const aipass = document.createElement('button'); aipass.id = 'owner-source-aipass'; aipass.type = 'button'; aipass.className = 'secondary-button'; aipass.textContent = 'สร้างชุดตรวจ AiPASS'; aipass.disabled = true; aipass.addEventListener('click', () => { void prepareAiPassReview().catch((error) => sourceMessage(error?.message || 'เตรียมไฟล์ AiPASS ไม่สำเร็จ')); });
    const clear = document.createElement('button'); clear.id = 'owner-source-clear'; clear.type = 'button'; clear.className = 'text-button'; clear.textContent = 'ล้าง Source binding'; clear.hidden = true; clear.addEventListener('click', () => { void clearSource().catch((error) => sourceMessage(error?.message || 'ล้าง Source ไม่สำเร็จ')); });
    actions.append(bind, refresh, aipass, clear);
    const message = document.createElement('p'); message.id = 'owner-source-message'; message.className = 'form-message'; message.setAttribute('role', 'status');
    form.append(projectLabel, project, state, repositoryLabel, repository, refLabel, ref, note, actions, message);
    form.addEventListener('submit', (event) => { void bindSource(event).catch((error) => sourceMessage(error?.message || 'เชื่อม Source ไม่สำเร็จ')); });
    body.append(form); card.append(head, body); sheet.append(backdrop, card); document.body.append(sheet); return sheet;
  }

  async function openSourceCenter() {
    closeCenter({ history: false });
    const sheet = ensureSourceCenter();
    openAwhDialog(sheet);
    try { await loadSourceProjects(); }
    catch (error) { sourceMessage(error?.message || 'เปิด Source Authority ไม่สำเร็จ'); }
  }

  function exitTeacherPreview() {
    document.body.classList.remove(PREVIEW_CLASS);
    $(PREVIEW_BAR_ID)?.remove();
  }

  function enterTeacherPreview() {
    closeCenter({ history: false });
    document.body.classList.add(PREVIEW_CLASS);
    if (!$(PREVIEW_BAR_ID)) {
      const bar = document.createElement('aside');
      bar.id = PREVIEW_BAR_ID;
      bar.className = 'awh-teacher-preview-bar';
      bar.setAttribute('role', 'status');
      const copy = document.createElement('span');
      const title = document.createElement('strong'); title.textContent = 'กำลังดูมุมครู';
      const detail = document.createElement('small'); detail.textContent = 'Preview หน้าแรกเท่านั้น · สิทธิ์ Owner ไม่เปลี่ยน';
      copy.append(title, detail);
      const back = document.createElement('button');
      back.type = 'button'; back.className = 'awh-command-send'; back.textContent = 'กลับ Owner'; back.addEventListener('click', exitTeacherPreview);
      bar.append(copy, back); document.body.append(bar);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function runAction(action) {
    if (action === 'automations') return;
    if (action === 'teacher-preview') { enterTeacherPreview(); return; }
    if (action === 'source-authority') { void openSourceCenter(); return; }
    closeCenter({ history: false });
    if (action === 'projects') { $('project-open')?.click(); return; }
    if (action === 'multi-chat') { $('conversation-open')?.click(); return; }
    if (action === 'tasks') { $('dashboard-open-tasks')?.click(); return; }
    if (action === 'approvals') { $('dashboard-pulse-attention-card')?.click(); return; }
    if (action === 'memory') { openSettings('data'); return; }
    if (action === 'ai') { openSettings('ai'); return; }
    if (action === 'devices') { openSettings('devices'); return; }
    if (action === 'people') { openSettings('people'); return; }
    if (action === 'security') { openSettings('account'); return; }
    if (action === 'trust') { window.location.assign('./trust.html'); return; }
    if (action === 'infrastructure') { window.location.assign('./infrastructure.html'); return; }
    if (action === 'runtime') { openSettings('system'); return; }
    if (action === 'product-review') { window.location.assign('./review.html'); return; }
    if (action === 'database') window.location.assign('./database.html');
  }

  function createItem([action, icon, title, copy, badge = '']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'awh-owner-command-item';
    button.dataset.ownerAction = action;
    if (action === 'automations') button.disabled = true;
    const mark = document.createElement('span'); mark.className = 'awh-owner-command-icon'; mark.textContent = icon;
    const text = document.createElement('span'); text.className = 'awh-owner-command-copy';
    const name = document.createElement('strong'); name.textContent = title;
    const detail = document.createElement('small'); detail.textContent = copy;
    text.append(name, detail);
    button.append(mark, text);
    if (badge) { const chip = document.createElement('span'); chip.className = 'awh-owner-command-badge'; chip.textContent = badge; button.append(chip); }
    button.addEventListener('click', () => runAction(action));
    return button;
  }

  function refreshSummary() {
    const server = $('owner-command-server');
    const approvals = $('owner-command-approvals');
    const workerSummary = $('worker-summary')?.textContent?.replace(/\s+/g, ' ').trim();
    const approvalBanner = $('dashboard-approval-banner');
    if (server) server.textContent = workerSummary || 'AWH Server · พร้อมทำงาน';
    if (approvals) approvals.textContent = approvalBanner && !approvalBanner.hidden ? approvalBanner.textContent?.replace(/\s+/g, ' ').trim() || 'มีรายการรออนุมัติ' : 'ไม่มีรายการอนุมัติค้าง';
  }

  function installPreviewReset() {
    if (document.body.dataset.awhTeacherPreviewReset === '1') return;
    const workspace = $('workspace-view');
    if (!(workspace instanceof HTMLElement)) return;
    document.body.dataset.awhTeacherPreviewReset = '1';
    const resetIfSignedOut = () => { if (workspace.hidden) exitTeacherPreview(); };
    new MutationObserver(resetIfSignedOut).observe(workspace, { attributes: true, attributeFilter: ['hidden'] });
    resetIfSignedOut();
  }

  function mount() {
    const owner = $('dashboard-owner-center');
    if (!(owner instanceof HTMLElement) || $(SHEET_ID)) return false;
    const heading = owner.querySelector('.awh-section-heading');
    const launch = document.createElement('button');
    launch.id = LAUNCH_ID;
    launch.type = 'button';
    launch.className = 'awh-owner-center-launch';
    launch.textContent = 'เปิด Owner Center';
    launch.addEventListener('click', () => { const sheet = $(SHEET_ID); if (sheet) { openAwhDialog(sheet); refreshSummary(); } });
    heading?.append(launch);

    const sheet = document.createElement('section');
    sheet.id = SHEET_ID;
    sheet.className = 'awh-owner-command-center';
    sheet.hidden = true;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'owner-command-title');
    const backdrop = document.createElement('button');
    backdrop.type = 'button'; backdrop.className = 'awh-owner-command-backdrop'; backdrop.setAttribute('aria-label', 'ปิด Owner Center'); backdrop.addEventListener('click', closeCenter);
    const card = document.createElement('div'); card.className = 'awh-owner-command-card';
    const head = document.createElement('header'); head.className = 'awh-owner-command-head';
    head.innerHTML = '<div><span>OWNER CONTROL CENTER</span><h2 id="owner-command-title">ควบคุม AWH จากที่เดียว</h2><p>หน้าแรกยังเรียบง่าย ส่วนรายละเอียดผู้ดูแลอยู่ที่นี่</p></div>';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'awh-secondary-action'; close.textContent = 'ปิด'; close.addEventListener('click', closeCenter); head.append(close);
    const summary = document.createElement('div'); summary.className = 'awh-owner-command-summary'; summary.innerHTML = '<span id="owner-command-server">AWH Server · พร้อมทำงาน</span><span id="owner-command-approvals">กำลังตรวจรายการอนุมัติ</span>';
    const body = document.createElement('div'); body.className = 'awh-owner-command-body';
    for (const group of GROUPS) {
      const section = document.createElement('section'); section.className = 'awh-owner-command-group';
      const title = document.createElement('h3'); title.textContent = group.title;
      const grid = document.createElement('div'); grid.className = 'awh-owner-command-grid';
      for (const item of group.items) grid.append(createItem(item));
      section.append(title, grid); body.append(section);
    }
    card.append(head, summary, body); sheet.append(backdrop, card); document.body.append(sheet); refreshSummary(); installPreviewReset();
    return true;
  }

  function start() {
    installPreviewReset();
    if (mount()) return;
    const observer = new MutationObserver(() => { installPreviewReset(); if (mount()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
