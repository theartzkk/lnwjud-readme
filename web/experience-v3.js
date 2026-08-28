(() => {
  const $ = (id) => document.getElementById(id);
  const delay = (fn, ms = 60) => window.setTimeout(fn, ms);
  function home(){ $('dashboard-home-button')?.click(); delay(() => window.scrollTo({top:0,behavior:'smooth'})); }
  function mountWorkBar(){
    const heading=document.querySelector('.workspace-heading'); if(!(heading instanceof HTMLElement)||heading.dataset.v3==='1')return;
    heading.dataset.v3='1';
    const brand=document.createElement('div'); brand.className='awh-v3-work-brand';
    const homeButton=document.createElement('button'); homeButton.type='button'; homeButton.className='awh-v3-home'; homeButton.setAttribute('aria-label','กลับหน้าแรก'); homeButton.innerHTML='<span>A</span>';
    homeButton.addEventListener('click',home); brand.append(homeButton);
    const actions=document.createElement('div'); actions.className='awh-v3-work-actions';
    const chat=document.createElement('button'); chat.type='button'; chat.className='awh-v3-top-action'; chat.textContent='แชท'; chat.addEventListener('click',()=>$('conversation-open')?.click());
    const account=document.createElement('button'); account.type='button'; account.className='awh-v3-top-action'; account.textContent='บัญชี'; account.addEventListener('click',()=>$('account-open')?.click());
    actions.append(chat,account); heading.prepend(brand); heading.append(actions);
  }
  function collapseCancelledRepeats(){
    const rows=[...document.querySelectorAll('#work-thread .assistant-turn')]; let previous=''; let leader=null; let count=1;
    for(const row of rows){
      if(!(row instanceof HTMLElement))continue; row.hidden=false;
      const chip=row.querySelector('.state-chip')?.textContent?.trim()||''; const text=row.querySelector('.task-summary')?.textContent?.trim()||'';
      const key=chip.includes('ยกเลิก')?`${chip}|${text}`:'';
      if(key&&key===previous&&leader){ row.hidden=true; count+=1; let badge=leader.querySelector('.awh-v3-repeat'); if(!(badge instanceof HTMLElement)){badge=document.createElement('span');badge.className='awh-v3-repeat';leader.querySelector('.task-meta')?.append(badge);} badge.textContent=`ซ้ำ ${count} รายการ`; }
      else { previous=key; leader=key?row:null; count=1; }
    }
  }
  function syncNav(){
    const nav=$('awh-mobile-home-nav'); if(!(nav instanceof HTMLElement))return;
    const onHome=document.body.classList.contains('product-dashboard-active');
    for(const button of nav.querySelectorAll('.awh-mobile-nav-item')){
      const label=button.querySelector('strong')?.textContent?.trim()||'';
      button.classList.toggle('is-active',onHome?label==='หน้าแรก':label==='แชท');
    }
  }
  function preferHomeOnEntry(){
    if(document.body.dataset.awhV3Entry==='1')return;
    const workspace=$('workspace-view'), dashboard=$('product-dashboard'), button=$('dashboard-home-button');
    if(!(workspace instanceof HTMLElement)||workspace.hidden||!(dashboard instanceof HTMLElement)||!(button instanceof HTMLElement))return;
    document.body.dataset.awhV3Entry='1';
    if(!document.body.classList.contains('product-dashboard-active')) home();
  }
  function decorate(){
    document.body.classList.add('awh-experience-v3'); mountWorkBar(); syncNav(); collapseCancelledRepeats(); preferHomeOnEntry();
  }
  function start(){
    decorate();
    const observer=new MutationObserver(()=>decorate());
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});
    window.setTimeout(decorate,120); window.setTimeout(decorate,500);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
