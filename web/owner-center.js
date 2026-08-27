(() => {
  const SHEET_ID = 'dashboard-owner-command-center';
  const LAUNCH_ID = 'dashboard-owner-center-open';
  const $ = (id) => document.getElementById(id);

  const GROUPS = Object.freeze([
    { title: 'งานและความต่อเนื่อง', items: [
      ['projects', '◫', 'Projects', 'โปรเจกต์ บริบท และ Source of Truth'],
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
    ] },
    { title: 'ระบบและการขยาย', items: [
      ['system', '⚙', 'System', 'สุขภาพระบบ Runtime และ Database Studio'],
      ['database', '▦', 'Database Studio', 'ตรวจข้อมูล โครงสร้าง และ migration แบบปลอดภัย'],
      ['automations', '↯', 'Automations', 'งานตามเวลาและเงื่อนไข', 'กำลังพัฒนา'],
      ['runtime', '⌘', 'Runtime / lnwjud', 'Capability Fabric และรายละเอียดการทำงานขั้นสูง', 'Advanced'],
    ] },
  ]);

  function openSettings(tab) {
    $('account-open')?.click();
    window.setTimeout(() => {
      const target = document.querySelector(`[data-settings-tab="${tab}"]`);
      if (target instanceof HTMLButtonElement && !target.hidden) target.click();
    }, 0);
  }

  function leaveDashboardForWork() {
    document.body.classList.remove('product-dashboard-active');
    const dashboard = $('product-dashboard');
    if (dashboard) dashboard.hidden = true;
    $('goal-input')?.focus();
  }

  function closeCenter() {
    const sheet = $(SHEET_ID);
    if (sheet) sheet.hidden = true;
  }

  function runAction(action) {
    if (action === 'automations') return;
    closeCenter();
    if (action === 'projects') { $('project-open')?.click(); return; }
    if (action === 'multi-chat') { $('conversation-open')?.click(); return; }
    if (action === 'tasks' || action === 'approvals') { leaveDashboardForWork(); return; }
    if (action === 'memory') { openSettings('data'); return; }
    if (action === 'ai') { openSettings('ai'); return; }
    if (action === 'devices') { openSettings('devices'); return; }
    if (action === 'people') { openSettings('people'); return; }
    if (action === 'security') { openSettings('account'); return; }
    if (action === 'system' || action === 'runtime') { openSettings('system'); return; }
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

  function mount() {
    const owner = $('dashboard-owner-center');
    if (!(owner instanceof HTMLElement) || $(SHEET_ID)) return false;
    const heading = owner.querySelector('.awh-section-heading');
    const launch = document.createElement('button');
    launch.id = LAUNCH_ID;
    launch.type = 'button';
    launch.className = 'awh-owner-center-launch';
    launch.textContent = 'เปิด Owner Center';
    launch.addEventListener('click', () => { const sheet = $(SHEET_ID); if (sheet) { sheet.hidden = false; refreshSummary(); } });
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
    card.append(head, summary, body); sheet.append(backdrop, card); document.body.append(sheet); refreshSummary();
    return true;
  }

  function start() {
    if (mount()) return;
    const observer = new MutationObserver(() => { if (mount()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
