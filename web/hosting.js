import { bindManagedSiteDomain, createManagedSite, listManagedSites, loadAuthSession, loadControlData, managedSiteAction } from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';

const $=(id)=>document.getElementById(id);
const CANONICAL_DOMAIN='kruart.online';
let control=null;
let sites=[];
let policies={};
let dnsPlan=null;
let ecosystem=null;
let pendingConfirm=null;
let hostingRefreshInFlight=null;
let liveRefreshTimer=null;

const statusLabel=(state)=>({
  READY:'พร้อมใช้งาน',
  PROVISIONING:'กำลังเตรียม',
  QUEUED:'กำลังรอ',
  FAILED:'ต้องตรวจสอบ',
  DISABLED:'หยุดเผยแพร่',
  DRAFT:'รอไฟล์เว็บไซต์',
})[state]||'กำลังตรวจสอบ';

const runtimeLabel=(value)=>({AUTO:'อัตโนมัติ',PHP:'PHP',NODE:'Node',STATIC:'เว็บไซต์แบบไฟล์'})[value]||value||'—';

function slugify(value){
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);
}

function desiredHost(slug){
  return slug?`${slug}.${CANONICAL_DOMAIN}`:`ชื่อเว็บ.${CANONICAL_DOMAIN}`;
}

function renderUrlPreview(){
  const slug=$('site-slug').value.trim();
  $('site-url-preview').textContent=`https://${desiredHost(slug)}`;
}

function friendlyError(error,fallback='ยังทำรายการนี้ไม่ได้ ลองอีกครั้งในอีกสักครู่'){
  const code=String(error?.code||'').toUpperCase();
  const messages={
    PROJECT_SOURCE_NOT_READY:'ยังไม่พบแหล่งเว็บไซต์ที่พร้อมใช้ ตั้งค่าแหล่งเว็บไซต์ก่อน แล้ว AWH จะทำต่อให้',
    DOMAIN_DNS_NOT_READY:'ชื่อเว็บยังเชื่อมมาไม่ถึง AWH ระบบจะตรวจอีกครั้งเมื่อการตั้งค่าชื่อเว็บพร้อม',
    DOMAIN_BINDING_NOT_READY:'ชื่อเว็บยังไม่พร้อมเชื่อม ลองตรวจอีกครั้งในอีกสักครู่',
    DOMAIN_ROUTE_CONFLICT:'ชื่อเว็บนี้มีการตั้งค่าเดิมที่ต้องตรวจสอบก่อนใช้งาน',
    DOMAIN_UNAVAILABLE:'ชื่อเว็บนี้ถูกใช้กับเว็บไซต์อื่นแล้ว',
    DOMAIN_NOT_MANAGED:'ชื่อนี้อยู่นอกพื้นที่เว็บที่ AWH ดูแล',
    DOMAIN_INVALID:'รูปแบบชื่อเว็บไม่ถูกต้อง',
    HOSTING_SITE_NOT_READY:'รอให้เว็บไซต์พร้อมก่อน แล้วจึงเชื่อมชื่อเว็บได้',
    HOSTING_CAPACITY_FULL:'พื้นที่สำหรับเว็บไซต์เต็มชั่วคราว กรุณาตรวจระบบก่อนเพิ่มเว็บใหม่',
    SITE_SLUG_UNAVAILABLE:'ชื่อสำหรับลิงก์นี้ถูกใช้แล้ว ลองใช้ชื่ออื่น',
    SITE_NOT_FOUND:'ไม่พบเว็บไซต์นี้ หรือคุณไม่มีสิทธิ์เข้าถึง',
    STEP_UP_REQUIRED:'รายการนี้ต้องยืนยันสิทธิ์เพิ่มเติมก่อน',
    CSRF_REJECTED:'การเข้าสู่ระบบหมดอายุ กำลังเชื่อมต่อใหม่',
    UNAUTHORIZED:'กรุณาเข้าสู่ระบบอีกครั้ง',
    FORBIDDEN:'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้',
  };
  if(code&&messages[code])return messages[code];
  return fallback;
}

function reportError(error){
  try{console.warn('[AWH Hosting]',error?.code||'',error?.message||error);}catch{}
}

async function mutate(action,retried=false){
  try{return await action();}
  catch(error){
    if(error?.code==='CSRF_REJECTED'&&!retried){
      await loadAuthSession();
      return mutate(action,true);
    }
    throw error;
  }
}

function policy(action){
  return policies[`hosting.site.${action}`]||{risk:'MEDIUM',confirmationRequired:true,stepUpRequired:false};
}

function confirmationCopy(site,action){
  return ({
    deploy:`อัปเดต “${site.name}” เป็นไฟล์รุ่นล่าสุด โดย AWH จะเก็บรุ่นเดิมไว้เผื่อย้อนกลับ`,
    rollback:`กลับ “${site.name}” ไปใช้เวอร์ชันก่อนหน้า โดยไม่ลบข้อมูลของเว็บไซต์`,
    disable:`หยุดเผยแพร่ “${site.name}” ชั่วคราว โดยยังเก็บไฟล์ ข้อมูล และประวัติไว้`,
    bind_domain:`เชื่อม https://${desiredHost(site.slug||'')} กับ “${site.name}” และเปิดการเชื่อมต่อที่ปลอดภัยเมื่อพร้อม`,
  })[action]||`ดำเนินการกับ “${site.name}”`;
}

function confirmationTitle(action){
  return ({
    rollback:'กลับไปเวอร์ชันก่อน?',
    disable:'หยุดเผยแพร่เว็บไซต์?',
    bind_domain:'เชื่อมชื่อเว็บนี้?',
    deploy:'อัปเดตเว็บไซต์?',
  })[action]||'ยืนยันรายการ';
}

function confirmAction(site,action,handler){
  const rule=policy(action);
  if(!rule.confirmationRequired)return mutate(handler);
  if(liveRefreshTimer){clearTimeout(liveRefreshTimer);liveRefreshTimer=null;}
  return new Promise((resolve,reject)=>{
    pendingConfirm={handler,resolve,reject};
    $('hosting-confirm-title').textContent=confirmationTitle(action);
    $('hosting-confirm-copy').textContent=confirmationCopy(site,action);
    $('hosting-confirm-message').textContent='';
    $('hosting-confirm').hidden=false;
    setTimeout(()=>$('hosting-confirm-submit').focus(),0);
  });
}

function renderEcosystem(){
  const host=$('hosting-ecosystem');
  if(!host)return;
  host.replaceChildren();
  const operator=ecosystem?.operator||{};
  const tasks=ecosystem?.tasks||{};
  const tls=ecosystem?.tls||{};
  const renewal=tls.renewal||{};
  const renewalValue=tls.mode!=='LETS_ENCRYPT'?'ตรวจอัตโนมัติ':renewal.state==='READY'?'ต่ออายุอัตโนมัติพร้อม':operator.state==='ONLINE'?'ต้องตรวจการต่ออายุ':'รอตรวจระบบต่ออายุ';
  const renewalNote=renewal.state==='READY'?'ใบรับรองจะต่ออายุอัตโนมัติ และระบบตรวจซ้ำทุกไม่กี่นาที':tls.mode==='LETS_ENCRYPT'?'เปิด HTTPS หลังชื่อเว็บและเว็บไซต์ตรวจผ่าน · ระบบต่ออายุยังไม่ยืนยัน':'ตรวจสถานะ HTTPS อัตโนมัติ';
  const cards=[
    ['ระบบเบื้องหลัง',operator.state==='ONLINE'?'พร้อมทำงาน':'กำลังรอ',operator.state==='ONLINE'?`ความสามารถพร้อม ${operator.freshCapabilities||0}/${operator.requiredCapabilities||0}`:'งานใหม่จะรอไว้และทำต่อเมื่อระบบกลับมาพร้อม'],
    ['การเชื่อมชื่อเว็บ',dnsPlan?.automatic?'อัตโนมัติ':'ตั้งค่าตามคำแนะนำ',dnsPlan?.target?`ปลายทาง ${dnsPlan.target}`:'จะแสดงค่าที่ต้องใช้เมื่อจำเป็น'],
    ['HTTPS และการต่ออายุ',renewalValue,renewalNote],
    ['งานเบื้องหลัง',`${tasks.running||0} กำลังทำ · ${tasks.waiting||0} กำลังรอ`,`${tasks.queued||0} เข้าคิว · ${tasks.failed||0} ต้องตรวจสอบ`],
  ];
  for(const [label,value,note] of cards){
    const card=document.createElement('div');
    card.className='ecosystem-card';
    const small=document.createElement('span');small.textContent=label;
    const strong=document.createElement('strong');strong.textContent=value;
    const detail=document.createElement('small');detail.textContent=note;
    card.append(small,strong,detail);
    host.append(card);
  }
}

function renderProjects(){
  const select=$('site-project');
  select.replaceChildren();
  for(const project of control?.projects||[]){
    const option=document.createElement('option');
    option.value=project.projectId;
    option.textContent=project.name;
    select.append(option);
  }
  if(!select.childElementCount){
    const option=document.createElement('option');
    option.value='';
    option.textContent='ยังไม่มีโปรเจกต์ที่ใช้ได้';
    select.append(option);
  }
}

function button(text,className,site,action){
  const node=document.createElement('button');
  node.type='button';
  node.className=className;
  node.textContent=text;
  node.addEventListener('click',async()=>{
    node.disabled=true;
    try{
      await confirmAction(site,action,()=>managedSiteAction(site.siteId,action));
      await refresh();
    }catch(error){
      reportError(error);
      $('hosting-message').textContent=friendlyError(error);
    }finally{node.disabled=false;}
  });
  return node;
}

function statusChip(text){
  const span=document.createElement('span');
  span.textContent=text;
  return span;
}

function dnsInstruction(host){
  if(!dnsPlan?.target)return `ชื่อเว็บ: สร้าง A record ของ ${host} ให้ชี้มายังเซิร์ฟเวอร์ AWH`;
  return `DNS · A · ${host} → ${dnsPlan.target}`;
}

function sourceInstruction(site){
  const source=site.source||{};
  if(source.ready)return null;
  if(source.blockerCode==='PROJECT_SOURCE_NOT_READY'||site.state==='DRAFT'){
    return source.syncState==='STALE'
      ?'มีไฟล์เว็บไซต์รุ่นใหม่ที่ยังไม่พร้อมใช้ AWH จะทำต่อเมื่อรุ่นนั้นพร้อม'
      :'ยังไม่พบแหล่งเว็บไซต์ที่พร้อมใช้ ตั้งค่าแหล่งเว็บไซต์ก่อน แล้ว AWH จะทำต่อให้';
  }
  if(source.syncState&&source.syncState!=='SYNCED')return 'ไฟล์เว็บไซต์ยังเตรียมไม่เสร็จ AWH จะตรวจต่อให้อัตโนมัติ';
  return null;
}

function humanEvent(site){
  const event=site.lastEvent||{};
  return ({
    SITE_CREATED:'รับคำขอแล้ว กำลังเตรียมเว็บไซต์',
    SITE_READY:'เว็บไซต์พร้อมใช้งานแล้ว',
    DOMAIN_REQUESTED:'กำลังเชื่อมชื่อเว็บ',
    DOMAIN_ACTIVE:'ชื่อเว็บพร้อมใช้งานแล้ว',
    DEPLOY_REQUESTED:'กำลังอัปเดตเว็บไซต์',
    ROLLBACK_REQUESTED:'กำลังกลับไปเวอร์ชันก่อน',
    ROLLBACK_COMPLETED:'กลับไปเวอร์ชันก่อนเรียบร้อย',
    DISABLE_REQUESTED:'กำลังหยุดเผยแพร่',
    SITE_DISABLED:'หยุดเผยแพร่แล้ว',
    LEGACY_ROUTE_ADOPTED:'ย้ายชื่อเว็บเดิมเข้าระบบแล้ว',
  })[event.name]||null;
}

function domainButton(site){
  const node=document.createElement('button');
  node.type='button';
  node.className='primary-button';
  node.textContent=site.domainState==='REQUESTED'?'กำลังเชื่อมชื่อเว็บ':'เชื่อมชื่อเว็บ';
  node.disabled=site.domainState==='REQUESTED';
  if(!node.disabled)node.addEventListener('click',async()=>{
    node.disabled=true;
    try{
      const result=await confirmAction(site,'bind_domain',()=>bindManagedSiteDomain(site.siteId,desiredHost(site.slug||'')));
      const plan=result?.dnsPlan;
      $('hosting-message').textContent=plan?.target
        ?'รับคำขอแล้ว หากผู้ให้บริการชื่อเว็บต้องตั้งค่าเอง ให้เปิด “รายละเอียดทางเทคนิค” เพื่อดูค่าที่ต้องใช้'
        :'รับคำขอแล้ว AWH จะเชื่อมชื่อเว็บและตรวจความพร้อมต่อให้อัตโนมัติ';
      await refresh();
    }catch(error){
      reportError(error);
      $('hosting-message').textContent=friendlyError(error,'ยังเชื่อมชื่อเว็บไม่ได้ ลองตรวจอีกครั้งในอีกสักครู่');
    }finally{node.disabled=false;}
  });
  return node;
}

function renderSites(){
  const host=$('site-list');
  host.replaceChildren();
  const ready=sites.filter((site)=>site.state==='READY').length;
  $('hosting-summary').textContent=sites.length?`${ready} พร้อมใช้ · ${sites.length} เว็บไซต์`:'ยังไม่มีเว็บไซต์';

  for(const site of sites){
    const card=document.createElement('article');
    card.className='site-card';

    const head=document.createElement('div');
    head.className='site-head';
    const title=document.createElement('h3');title.textContent=site.name;
    const state=document.createElement('span');state.className='site-state';state.textContent=statusLabel(site.state);
    head.append(title,state);
    card.append(head);

    const desired=document.createElement('div');
    desired.className='site-url';
    const currentHost=site.domainHost||desiredHost(site.slug||'');
    const domainLabel=site.domainState==='ACTIVE'
      ?'ชื่อเว็บพร้อมใช้'
      :site.domainState==='REQUESTED'
        ?'กำลังเชื่อมชื่อเว็บ'
        :site.domainState==='FAILED'
          ?'ชื่อเว็บต้องตรวจสอบ'
          :'ชื่อเว็บที่ต้องการ';
    desired.textContent=`${domainLabel} · https://${currentHost}`;
    card.append(desired);
    if(site.domainState==='ACTIVE'){
      const tlsNote=document.createElement('div');
      tlsNote.className='site-event';
      tlsNote.textContent=ecosystem?.tls?.renewal?.state==='READY'?'HTTPS · ต่ออายุอัตโนมัติพร้อม':'HTTPS · ตรวจระบบต่ออายุ';
      card.append(tlsNote);
    }

    if(site.source?.ready!==true){
      const source=document.createElement('div');
      source.className='site-source-action';
      const text=document.createElement('span');
      text.textContent='ยังไม่พบแหล่งเว็บไซต์ที่พร้อมใช้';
      const link=document.createElement('a');
      link.href=`./owner-center.html?project=${encodeURIComponent(site.projectId)}#source`;
      link.textContent='ตั้งค่าแหล่งเว็บไซต์';
      link.className='secondary-button';
      source.append(text,link);
      card.append(source);
    }

    const sourceNote=sourceInstruction(site);
    const eventNote=humanEvent(site);
    if(sourceNote){
      const note=document.createElement('div');note.className='site-event';note.textContent=sourceNote;card.append(note);
    }else if(eventNote){
      const note=document.createElement('div');note.className='site-event';note.textContent=eventNote;card.append(note);
    }

    if(site.url){
      const link=document.createElement('a');
      link.className='site-url';
      link.href=site.url;
      link.target='_blank';
      link.rel='noopener noreferrer';
      link.textContent='เปิดเว็บไซต์ ↗';
      card.append(link);
    }else{
      const copy=document.createElement('div');
      copy.className='site-url';
      copy.textContent=site.state==='FAILED'?'ยังเปิดเว็บไม่ได้ — ตรวจรายการที่ต้องทำด้านบน':'กำลังเตรียมลิงก์สำหรับเปิดเว็บ';
      card.append(copy);
    }

    const actions=document.createElement('div');
    actions.className='site-actions';
    if(site.state==='READY'&&site.domainState!=='ACTIVE')actions.append(domainButton(site));
    if(site.state!=='DISABLED'&&site.source?.ready===true)actions.append(button('อัปเดตเว็บไซต์','secondary-button',site,'deploy'));
    if(site.rollbackReleaseId&&site.state!=='DISABLED')actions.append(button('กลับไปเวอร์ชันก่อน','secondary-button',site,'rollback'));
    if(site.state!=='DISABLED')actions.append(button('หยุดเผยแพร่','danger-button',site,'disable'));
    card.append(actions);

    const tech=document.createElement('details');
    tech.className='site-tech';
    const techSummary=document.createElement('summary');
    techSummary.textContent='รายละเอียดทางเทคนิค';
    const meta=document.createElement('div');
    meta.className='site-meta';
    meta.append(
      statusChip(`โปรเจกต์: ${site.projectName||'—'}`),
      statusChip(`ระบบ: ${runtimeLabel(site.runtimeType)}${site.runtimeVersion?` ${site.runtimeVersion}`:''}`),
      statusChip(`ฐานข้อมูล: ${site.databaseMode||'อัตโนมัติ'}`),
      statusChip(site.backupEnabled?'สำรองข้อมูล: เปิด':'สำรองข้อมูล: ปิด'),
      statusChip(site.source?.ready?'ไฟล์ต้นทาง: พร้อม':`ไฟล์ต้นทาง: ${site.source?.syncState||'ยังไม่มี'}`),
    );
    if(site.port)meta.append(statusChip(`พอร์ตภายใน: ${site.port}`));
    if(site.domainState==='REQUESTED'){
      const dns=document.createElement('div');
      dns.className='site-url';
      dns.textContent=dnsInstruction(currentHost);
      tech.append(techSummary,meta,dns);
    }else tech.append(techSummary,meta);
    card.append(tech);
    host.append(card);
  }

  if(!host.childElementCount){
    const empty=document.createElement('div');
    empty.className='site-empty';
    empty.textContent='ยังไม่มีเว็บไซต์ เริ่มจากช่อง “เพิ่มเว็บไซต์” ด้านบนได้เลย';
    host.append(empty);
  }
}

function needsLiveRefresh(){
  const tasks=ecosystem?.tasks||{};
  return sites.some((site)=>['QUEUED','PROVISIONING'].includes(site.state)||site.domainState==='REQUESTED')
    ||Number(tasks.running||0)>0
    ||Number(tasks.queued||0)>0
    ||Number(tasks.waiting||0)>0;
}

function scheduleLiveRefresh(delay=12000){
  if(liveRefreshTimer)clearTimeout(liveRefreshTimer);
  liveRefreshTimer=null;
  if(document.hidden||pendingConfirm||!needsLiveRefresh())return;
  liveRefreshTimer=setTimeout(()=>void refreshHostingData(true),delay);
}

async function refreshHostingData(background=false){
  if(hostingRefreshInFlight)return hostingRefreshInFlight;
  hostingRefreshInFlight=(async()=>{
    try{
      const result=await listManagedSites();
      sites=Array.isArray(result.sites)?result.sites:[];
      policies=result.policy&&typeof result.policy==='object'?result.policy:{};
      dnsPlan=result.dns&&typeof result.dns==='object'?result.dns:null;
      ecosystem=result.ecosystem&&typeof result.ecosystem==='object'?result.ecosystem:null;
      renderEcosystem();
      renderSites();
      $('hosting-state').textContent='พร้อมใช้งาน';
    }catch(error){
      reportError(error);
      if(!background){
        $('hosting-state').textContent='ต้องตรวจสอบ';
        $('hosting-message').textContent=friendlyError(error,'ยังโหลดข้อมูลเว็บไซต์ไม่ได้ ลองกด “ตรวจอีกครั้ง”');
      }
    }finally{
      hostingRefreshInFlight=null;
      scheduleLiveRefresh();
    }
  })();
  return hostingRefreshInFlight;
}

async function refresh(){
  try{
    control=await loadControlData();
    if(control.role!=='OWNER')throw Object.assign(new Error('role denied'),{code:'FORBIDDEN'});
    renderProjects();
    await refreshHostingData(false);
  }catch(error){
    reportError(error);
    $('hosting-state').textContent='ต้องตรวจสอบ';
    $('hosting-message').textContent=friendlyError(error,'ยังโหลดหน้าเว็บของฉันไม่ได้ ลองกด “ตรวจอีกครั้ง”');
  }
}

$('site-name').addEventListener('input',()=>{
  if(!$('site-slug').dataset.edited)$('site-slug').value=slugify($('site-name').value);
  renderUrlPreview();
});

$('site-slug').addEventListener('input',()=>{
  $('site-slug').dataset.edited='1';
  $('site-slug').value=slugify($('site-slug').value);
  renderUrlPreview();
});

$('hosting-create-form').addEventListener('submit',async(event)=>{
  event.preventDefault();
  const submit=event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled=true;
  $('hosting-message').textContent='กำลังสร้างเว็บไซต์…';
  try{
    await mutate(()=>createManagedSite({
      name:$('site-name').value.trim(),
      slug:$('site-slug').value.trim(),
      projectId:$('site-project').value,
      runtimeType:$('site-runtime').value,
      databaseMode:$('site-database').value,
      backupEnabled:$('site-backup').checked,
    }));
    event.currentTarget.reset();
    $('site-backup').checked=true;
    $('site-slug').dataset.edited='';
    renderUrlPreview();
    $('hosting-message').textContent='สร้างเว็บไซต์แล้ว AWH จะเตรียมไฟล์ ลิงก์ และการเชื่อมต่อให้ตามลำดับ';
    await refresh();
  }catch(error){
    reportError(error);
    $('hosting-message').textContent=friendlyError(error,'ยังสร้างเว็บไซต์ไม่ได้ ตรวจข้อมูลที่กรอกแล้วลองอีกครั้ง');
  }finally{submit.disabled=false;}
});

$('hosting-confirm-submit').addEventListener('click',async()=>{
  if(!pendingConfirm)return;
  const current=pendingConfirm;
  const submit=$('hosting-confirm-submit');
  submit.disabled=true;
  $('hosting-confirm-message').textContent='กำลังดำเนินการ…';
  try{
    const result=await mutate(current.handler);
    pendingConfirm=null;
    $('hosting-confirm').hidden=true;
    current.resolve(result);
  }catch(error){
    reportError(error);
    $('hosting-confirm-message').textContent=friendlyError(error);
  }finally{submit.disabled=false;}
});

$('hosting-confirm-cancel').addEventListener('click',()=>{
  if(pendingConfirm){
    pendingConfirm.reject(Object.assign(new Error('cancelled'),{code:'USER_CANCELLED'}));
    pendingConfirm=null;
  }
  $('hosting-confirm').hidden=true;
  scheduleLiveRefresh(800);
});

$('hosting-refresh').addEventListener('click',()=>void refresh());
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&liveRefreshTimer){clearTimeout(liveRefreshTimer);liveRefreshTimer=null;}
  else if(!document.hidden)scheduleLiveRefresh(800);
});

renderUrlPreview();
void refresh();
