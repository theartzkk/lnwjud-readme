(() => {
  const NAV_ID='awh-mobile-home-nav'; const $=(id)=>document.getElementById(id); const after=(fn)=>window.setTimeout(fn,40);
  function visible(node){return node instanceof HTMLElement&&!node.hidden;}
  function decorate(dashboard){
    const hero=dashboard.querySelector('.awh-home-hero'); if(!(hero instanceof HTMLElement)||hero.dataset.awhFinalPolish==='1')return; hero.dataset.awhFinalPolish='1';
    const kicker=hero.querySelector('.awh-home-kicker'); const copy=hero.querySelector(':scope > p');
    if(kicker)kicker.textContent='ART’S WORKSPACE HUB'; if(copy)copy.textContent='บอกสิ่งที่ต้องการเป็นภาษาปกติ หรือแนบไฟล์มาได้เลย AWH จะเลือกวิธีทำให้เอง';
    const actions=hero.querySelector('.awh-command-actions'); if(actions instanceof HTMLElement&&!$('dashboard-attach-shortcut')){
      const attach=document.createElement('button'); attach.id='dashboard-attach-shortcut'; attach.type='button'; attach.className='awh-command-attach'; attach.setAttribute('aria-label','แนบไฟล์'); attach.innerHTML='<span aria-hidden="true">＋</span><strong>แนบไฟล์</strong>';
      attach.addEventListener('click',()=>{openWork();after(()=>$('attachment-open')?.click());}); actions.prepend(attach);
    }
  }
  function labelSections(dashboard){
    const tools=dashboard.querySelector('.awh-tool-grid')?.closest('.awh-home-section'); const files=$('dashboard-artifacts')?.closest('.awh-home-section'); const work=dashboard.querySelector('.awh-home-overview');
    if(tools instanceof HTMLElement)tools.id||='awh-home-tools'; if(files instanceof HTMLElement)files.id||='awh-home-files'; if(work instanceof HTMLElement)work.id||='awh-home-work';
  }
  function item(icon,label,action){const b=document.createElement('button');b.type='button';b.className='awh-mobile-nav-item';b.dataset.homeNav=action;b.innerHTML=`<span aria-hidden="true">${icon}</span><strong>${label}</strong>`;return b;}
  function mountNav(){
    if($(NAV_ID))return; const nav=document.createElement('nav');nav.id=NAV_ID;nav.className='awh-mobile-home-nav';nav.setAttribute('aria-label','เมนูหลัก AWH');
    const home=item('⌂','หน้าแรก','home'),work=item('✦','งาน','work'),files=item('▣','ไฟล์','files'),more=item('•••','เพิ่มเติม','more');home.classList.add('is-active');
    home.addEventListener('click',()=>returnHome()); work.addEventListener('click',()=>openWork()); files.addEventListener('click',()=>{returnHome();after(()=>$('awh-home-files')?.scrollIntoView({behavior:'smooth',block:'start'}));});
    more.addEventListener('click',()=>{returnHome();after(()=>{const launch=$('dashboard-owner-center-open');if(visible(launch))launch.click();else $('account-open')?.click();});}); nav.append(home,work,files,more);document.body.append(nav);
  }
  function mount(){const dashboard=$('product-dashboard');if(!(dashboard instanceof HTMLElement))return false;decorate(dashboard);labelSections(dashboard);mountNav();document.body.classList.add('awh-final-home-polish');return true;}
  function start(){if(mount())return;const observer=new MutationObserver(()=>{if(mount())observer.disconnect();});observer.observe(document.documentElement,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
