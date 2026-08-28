(() => {
  const $ = (id) => document.getElementById(id);
  const after = (fn) => window.setTimeout(fn, 50);
  const tapTool = (label) => {
    const cards = [...document.querySelectorAll('.awh-tool-card')];
    const target = cards.find((card) => card.querySelector('strong')?.textContent?.trim() === label);
    if (target instanceof HTMLButtonElement && !target.disabled) target.click();
  };
  function addWelcome(dashboard) {
    if ($('awh-v2-welcome')) return;
    const welcome = document.createElement('div');
    welcome.id = 'awh-v2-welcome'; welcome.className = 'awh-v2-welcome';
    welcome.innerHTML = '<div class="awh-v2-welcome-copy"><small>ART’S WORKSPACE HUB</small><strong>Workspace ของคุณ</strong></div><span class="awh-v2-cloud">Cloud พร้อมใช้งาน</span>';
    dashboard.prepend(welcome);
  }
  function addPrompts(hero) {
    if ($('awh-v2-prompts')) return;
    const host = document.createElement('div'); host.id = 'awh-v2-prompts'; host.className = 'awh-v2-prompts';
    const choices = [
      ['↻ งานล่าสุด', () => $('dashboard-continue-work')?.click()],
      ['☰ Multi Chat', () => $('dashboard-open-chats')?.click()],
      ['▤ สร้างเอกสาร', () => tapTool('สร้างเอกสาร')],
      ['PDF จัดการ PDF', () => tapTool('จัดการ PDF')],
      ['QR สร้าง QR', () => tapTool('สร้าง QR')],
    ];
    for (const [label, action] of choices) { const button = document.createElement('button'); button.type='button'; button.className='awh-v2-prompt'; button.textContent=label; button.addEventListener('click', action); host.append(button); }
    hero.append(host);
  }
  function upgradeNav() {
    const nav = $('awh-mobile-home-nav'); if (!nav || nav.dataset.v2 === '1') return;
    nav.dataset.v2 = '1'; nav.replaceChildren();
    const item = (icon, label, active, action) => { const b=document.createElement('button'); b.type='button'; b.className='awh-mobile-nav-item'+(active?' is-active':''); b.innerHTML=`<span aria-hidden="true">${icon}</span><strong>${label}</strong>`; b.addEventListener('click',action); return b; };
    nav.append(
      item('⌂','หน้าแรก',true,()=>{ $('dashboard-home-button')?.click(); after(()=>window.scrollTo({top:0,behavior:'smooth'})); }),
      item('✦','AI',false,()=>tapTool('AI ช่วยงาน')),
      item('☰','แชท',false,()=>$('dashboard-open-chats')?.click()),
      item('▦','เครื่องมือ',false,()=>{ $('dashboard-home-button')?.click(); after(()=>$('awh-home-tools')?.scrollIntoView({behavior:'smooth',block:'start'})); }),
      item('•••','เพิ่มเติม',false,()=>{ const open=$('dashboard-owner-center-open'); if(open instanceof HTMLElement && !open.hidden) open.click(); else $('account-open')?.click(); })
    );
  }
  function decorate() {
    const dashboard = $('product-dashboard'); if (!(dashboard instanceof HTMLElement)) return false;
    document.body.classList.add('awh-experience-v2');
    const hero = dashboard.querySelector('.awh-home-hero');
    if (hero instanceof HTMLElement) {
      const title=hero.querySelector('h1'); const copy=hero.querySelector(':scope > p'); const kicker=hero.querySelector('.awh-home-kicker');
      if (kicker) kicker.textContent='AWH · AI WORKSPACE';
      if (title) title.textContent='ทุกงาน เริ่มจากตรงนี้';
      if (copy) copy.textContent='คุยกับ AI · ทำเอกสาร · จัดการไฟล์ · ใช้เครื่องมือฟรี · ทำงานต่อจากทุกอุปกรณ์';
      addPrompts(hero);
    }
    addWelcome(dashboard); upgradeNav(); return true;
  }
  function start() {
    if (decorate()) return;
    const observer = new MutationObserver(() => { if (decorate()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true }); else start();
})();
