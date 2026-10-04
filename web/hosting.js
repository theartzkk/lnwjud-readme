import { bindManagedSiteDomain, createManagedSite, listManagedSites, loadAuthSession, loadControlData, loadOwnerSelfServiceStatus, managedSiteAction, observeHostingSite } from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';

const $=(id)=>document.getElementById(id);
const CANONICAL_DOMAIN='kruart.online';
let control=null;
let sites=[];
let inventory=[];
let inventoryMeta=null;
let domains=[];
let projectsWithoutHosting=[];
let inventoryFilter='ALL';
let inventoryQuery='';
let dnsPlan=null;
let reliability=null;
let ecosystem=null;
let ownerHealth=null;
let hostingRefreshInFlight=null;
let liveRefreshTimer=null;

const statusLabel=(state)=>({
  READY:'พร้อมใช้งาน',
  PROVISIONING:'กำลังเตรียม',
  QUEUED:'กำลังรอ',
  FAILED:'ต้องตรวจสอบ',
  DISABLED:'เก็บเข้าคลัง',
  DRAFT:'รอไฟล์เว็บไซต์',
  DEGRADED:'ต้องตรวจสอบ',
  ROUTED:'ตรวจพบเส้นทาง',
  OBSERVED:'เชื่อมกับ Project แล้ว',
  ALIAS:'ชื่อทางเข้า',
})[state]||'กำลังตรวจสอบ';

const runtimeLabel=(value)=>({AUTO:'อัตโนมัติ',PHP:'PHP',NODE:'Node',STATIC:'เว็บไซต์แบบไฟล์',SERVICE:'บริการเว็บ',REDIRECT:'Redirect',UNKNOWN:'ยังไม่ระบุ'})[value]||value||'—';
const ownershipLabel=(value)=>({MANAGED:'AWH Managed',ADOPTED:'เชื่อมกับ Project แล้ว',DISCOVERED:'ตรวจพบจากเซิร์ฟเวอร์',ALIAS:'ชื่อทางเข้า / Redirect'})[value]||'ตรวจพบ';
const routeLabel=(value)=>({STATIC:'Static',PHP:'PHP',PROXY:'Reverse proxy',REDIRECT:'Redirect',UNKNOWN:'ยังไม่ระบุ'})[value]||value||'—';
const environmentLabel=(value)=>({PRODUCTION:'ใช้งานจริง',STAGING:'ทดสอบ',PREVIEW:'ตัวอย่าง'})[value]||value||'—';
const httpStateLabel=(value)=>({HEALTHY:'HTTP ตอบปกติ',REACHABLE:'เข้าถึงได้',DOWN:'HTTP ไม่ผ่าน',UNKNOWN:'ยังตรวจไม่ได้',SKIPPED_ARCHIVED:'เก็บเข้าคลัง'})[value]||'ยังตรวจไม่ได้';
const dnsStateLabel=(value)=>({MATCHED:'DNS ตรง',MISSING:'DNS ไม่พบ',DIFFERENT_TARGET:'DNS ชี้คนละปลายทาง',UNKNOWN:'DNS ยังยืนยันไม่ได้'})[value]||'DNS ยังยืนยันไม่ได้';
function reliabilityMap(kind){const rows=Array.isArray(reliability?.[kind])?reliability[kind]:[];return new Map(rows.filter((row)=>row&&row.host).map((row)=>[String(row.host).toLowerCase(),row]));}

function slugify(value){
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);
}

function desiredHost(slug,environment='PRODUCTION'){
  if(!slug)return `ชื่อเว็บ.${CANONICAL_DOMAIN}`;
  const env=String(environment||'PRODUCTION').toUpperCase();
  const suffix=env==='STAGING'?'-staging':env==='PREVIEW'?'-preview':'';
  return `${slug}${suffix}.${CANONICAL_DOMAIN}`;
}

function renderUrlPreview(){
  const slug=$('site-slug').value.trim();
  const environment=$('site-environment')?.value||'PRODUCTION';
  $('site-url-preview').textContent=`https://${desiredHost(slug,environment)}`;
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
    HOSTING_DISCOVERY_NOT_FOUND:'ยังไม่พบเส้นทางเว็บนี้จากเซิร์ฟเวอร์จริง กดตรวจอีกครั้งแล้วลองใหม่',
    HOSTING_ADOPTION_ALIAS_TARGET_REQUIRED:'ชื่อนี้เป็น Redirect ให้เชื่อมเว็บไซต์ปลายทางแทน',
    HOSTING_ADOPTION_CONFLICT:'เว็บไซต์นี้เชื่อมกับ Project อื่นอยู่ ยกเลิกการเชื่อมเดิมก่อน',
    HOSTING_ALREADY_MANAGED:'เว็บไซต์นี้อยู่ภายใต้ Managed Hosting แล้ว ไม่ต้อง Adopt ซ้ำ',
    HOSTING_ADOPTION_FAILED:'ยังบันทึกการเชื่อม Project ไม่สำเร็จ ลองอีกครั้ง',
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

function runAction(handler){
  return mutate(handler);
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

function renderOnboarding(){
  const panel=$('unhosted-panel'),host=$('unhosted-projects');
  if(!panel||!host)return;
  host.replaceChildren();
  panel.hidden=projectsWithoutHosting.length===0;
  for(const project of projectsWithoutHosting){
    const row=document.createElement('article');row.className='onboarding-row';
    const copy=document.createElement('div');
    const strong=document.createElement('strong');strong.textContent=project.name||'Project';
    const small=document.createElement('small');small.textContent=(project.type||'general')+' · ยังไม่มีเว็บไซต์หรือการเชื่อม Hosting';
    copy.append(strong,small);
    const action=document.createElement('button');action.type='button';action.className='secondary-button';action.textContent='เริ่ม Hosting';
    action.addEventListener('click',()=>{
      const select=$('site-project');if(select)select.value=project.projectId;
      const panel=$('create-panel');if(panel){panel.open=true;panel.scrollIntoView({behavior:'smooth',block:'start'});}
      $('site-name')?.focus();
    });
    row.append(copy,action);host.append(row);
  }
}

function button(text,className,site,action){
  const node=document.createElement('button');
  node.type='button';
  node.className=className;
  node.textContent=text;
  node.addEventListener('click',async()=>{
    if(action==='disable'&&!window.confirm('เก็บเว็บไซต์นี้เข้าคลัง?\n\nAWH จะปิด public route และ runtime แต่ยังเก็บ release, database และข้อมูลไว้ สามารถเผยแพร่ใหม่ได้ภายหลัง และจะยังไม่ลบถาวร'))return;
    node.disabled=true;
    try{
      await runAction(()=>managedSiteAction(site.siteId,action));
      $('hosting-message').textContent=action==='disable'?'ส่งคำขอเก็บเข้าคลังแล้ว · AWH จะรักษา release และข้อมูลไว้':action==='deploy'&&site.state==='DISABLED'?'กำลังเปิดเผยแพร่จาก Source ล่าสุด':'รับคำขอแล้ว';
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

function siteSourceReady(site){return site.source?.ready===true;}

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
    DISABLE_REQUESTED:'กำลังเก็บเว็บไซต์เข้าคลัง',
    SITE_DISABLED:'เก็บเข้าคลังแล้ว · route ปิด แต่ release และข้อมูลยังอยู่',
    LEGACY_ROUTE_ADOPTED:'ย้ายชื่อเว็บเดิมเข้าระบบแล้ว',
  })[event.name]||null;
}

function adoptionPanel(item){
  if(!item?.primaryHost||!['DISCOVERED','ADOPTED'].includes(item.ownership))return null;
  const wrap=document.createElement('div');wrap.className='site-adoption';
  const copy=document.createElement('div');copy.className='site-adoption-copy';
  const strong=document.createElement('strong');
  const small=document.createElement('small');
  copy.append(strong,small);wrap.append(copy);
  if(item.ownership==='ADOPTED'){
    strong.textContent='เชื่อมกับ '+(item.projectName||'Project')+' แล้ว';
    small.textContent='โหมด Observe-only · AWH อ่านสถานะได้ แต่ยังไม่แก้ Nginx หรือไฟล์ Production';
    const release=document.createElement('button');release.type='button';release.className='secondary-button';release.textContent='ยกเลิกการเชื่อม';
    release.addEventListener('click',async()=>{
      release.disabled=true;
      try{await runAction(()=>observeHostingSite(item.primaryHost,item.projectId,'RELEASE'));$('hosting-message').textContent='ยกเลิกการเชื่อม Project แล้ว โดยเว็บไซต์ Production ไม่ถูกเปลี่ยน';await refreshHostingData(false);}
      catch(error){reportError(error);$('hosting-message').textContent=friendlyError(error);}
      finally{release.disabled=false;}
    });
    wrap.append(release);return wrap;
  }
  strong.textContent='รับเว็บเดิมเข้าศูนย์ Hosting';
  small.textContent='ขั้นแรกเป็น Observe-only เท่านั้น ไม่มีการย้ายไฟล์ เปลี่ยน route หรือ restart เว็บ';
  const controls=document.createElement('div');controls.className='site-adoption-controls';
  const select=document.createElement('select');select.setAttribute('aria-label','เลือก Project สำหรับ '+item.primaryHost);
  for(const project of control?.projects||[]){const option=document.createElement('option');option.value=project.projectId;option.textContent=project.name;select.append(option);}
  if(!select.childElementCount){const option=document.createElement('option');option.value='';option.textContent='ยังไม่มี Project';select.append(option);}
  const adopt=document.createElement('button');adopt.type='button';adopt.className='primary-button';adopt.textContent='เชื่อมกับ Project';adopt.disabled=!select.value;
  select.addEventListener('change',()=>{adopt.disabled=!select.value;});
  adopt.addEventListener('click',async()=>{
    if(!select.value)return;adopt.disabled=true;
    try{await runAction(()=>observeHostingSite(item.primaryHost,select.value,'ADOPT'));$('hosting-message').textContent='เชื่อมเว็บเดิมกับ Project แบบอ่านอย่างเดียวแล้ว · Production ไม่ถูกเปลี่ยน';await refreshHostingData(false);}
    catch(error){reportError(error);$('hosting-message').textContent=friendlyError(error);}
    finally{adopt.disabled=!select.value;}
  });
  controls.append(select,adopt);wrap.append(controls);return wrap;
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
      const result=await runAction(()=>bindManagedSiteDomain(site.siteId,desiredHost(site.slug||'',site.environment||'PRODUCTION')));
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

function formatBytes(value){
  const bytes=Number(value);if(!Number.isFinite(bytes)||bytes<0)return '—';
  if(bytes>=1073741824)return (bytes/1073741824).toFixed(bytes>=10737418240?0:1)+' GB';
  if(bytes>=1048576)return (bytes/1048576).toFixed(0)+' MB';
  return Math.round(bytes/1024)+' KB';
}

function renderHostingSummary(){
  const meta=inventoryMeta||{};
  const total=inventory.length||sites.length;
  const managed=Number(meta.managedCount??sites.length);
  const adopted=Number(meta.adoptedCount||0);
  const discovered=Number(meta.discoveredCount||0);
  const aliases=Number(meta.aliasCount||0);
  $('hosting-summary').textContent=total?(total+' รายการ · '+managed+' Managed · '+adopted+' เชื่อม Project'):'ยังไม่พบเว็บไซต์';
  const host=$('hosting-kpis');
  host.replaceChildren();
  const cards=[
    ['เว็บไซต์/เส้นทาง',String(total),'รวมรายการที่พบจากเซิร์ฟเวอร์'],
    ['AWH Managed',String(managed),'มี deploy / rollback authority'],
    ['เชื่อม Project แล้ว',String(adopted),'Observe-only · ไม่เปลี่ยน route หรือไฟล์'],
    ['เว็บเดิมที่ยังไม่เชื่อม',String(discovered),'ตรวจพบจริงจากเซิร์ฟเวอร์'],
    ['ชื่อทางเข้า',String(aliases),'alias หรือ redirect ที่มีอยู่จริง'],
    ['Project ยังไม่มี Hosting',String(projectsWithoutHosting.length),'พร้อมสร้างเว็บใหม่หรือเชื่อมเว็บเดิม'],
    ['พื้นที่ว่าง',formatBytes(meta.storageAvailableBytes),Number.isFinite(Number(meta.storageUsedPercent))?('ใช้ไป '+Number(meta.storageUsedPercent).toFixed(0)+'% ของ VPS'):'กำลังรอสถานะพื้นที่'],
  ];
  for(const [label,value,note] of cards){
    const card=document.createElement('div');card.className='hosting-kpi';
    const small=document.createElement('span');small.textContent=label;
    const strong=document.createElement('strong');strong.textContent=value;
    const detail=document.createElement('small');detail.textContent=note;
    card.append(small,strong,detail);host.append(card);
  }
  const freshness=$('inventory-freshness');
  if(freshness){
    const state=String(meta.state||'UNAVAILABLE');
    const at=meta.generatedAt?new Date(meta.generatedAt):null;
    freshness.textContent=state==='READY'&&at&&!Number.isNaN(at.valueOf())
      ?('ตรวจล่าสุด '+at.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}))
      :state==='STALE'?'ข้อมูลจากเซิร์ฟเวอร์เก่ากว่าปกติ':'กำลังรอข้อมูลจากเซิร์ฟเวอร์';
  }
}

function renderDomains(){
  const host=$('domain-list');if(!host)return;host.replaceChildren();
  const dnsByHost=reliabilityMap('dns');
  for(const domain of domains){
    if(!domain||!domain.host)continue;
    const dns=dnsByHost.get(String(domain.host).toLowerCase())||null;
    const row=document.createElement('article');row.className='domain-row';
    const main=document.createElement('div');main.className='domain-main';
    const name=document.createElement('strong');name.textContent=domain.host;
    const detail=document.createElement('small');
    const ownership=ownershipLabel(domain.ownership);
    const tlsText=domain.tls?('HTTPS'+(Number.isInteger(domain.certificateDaysRemaining)?(' · เหลือ '+domain.certificateDaysRemaining+' วัน'):'')):'ยังไม่ยืนยัน HTTPS';
    detail.textContent=ownership+' · '+tlsText+' · '+dnsStateLabel(dns?.state);
    main.append(name,detail);
    const chips=document.createElement('div');chips.className='domain-chips';
    const tls=document.createElement('span');tls.className='tls-chip '+(domain.tls?'ok':'attention');tls.textContent=domain.tls?'HTTPS':'HTTP';
    const dnsChip=document.createElement('span');dnsChip.className='tls-chip '+(dns?.state==='MATCHED'?'ok':dns?.state==='UNKNOWN'?'neutral':'attention');dnsChip.textContent=dnsStateLabel(dns?.state);
    chips.append(tls,dnsChip);row.append(main,chips);host.append(row);
  }
  if(!host.childElementCount){const empty=document.createElement('div');empty.className='site-empty';empty.textContent='ยังไม่พบข้อมูลโดเมนจากเซิร์ฟเวอร์';host.append(empty);}
}

function renderReliabilityAlerts(){
  const panel=$('hosting-alert-panel');const host=$('hosting-alerts');if(!panel||!host)return;host.replaceChildren();
  const alerts=Array.isArray(reliability?.alerts)?reliability.alerts:[];
  panel.hidden=alerts.length===0;
  for(const alert of alerts){
    const row=document.createElement('article');row.className='reliability-alert';row.dataset.severity=String(alert.severity||'WARNING').toLowerCase();
    const icon=document.createElement('span');icon.className='reliability-alert-icon';icon.textContent=alert.severity==='CRITICAL'?'!':'•';icon.setAttribute('aria-hidden','true');
    const copy=document.createElement('div');const title=document.createElement('strong');title.textContent=alert.title||'Hosting ต้องตรวจสอบ';const detail=document.createElement('small');detail.textContent=alert.detail||'มีหลักฐานที่ควรตรวจสอบ';copy.append(title,detail);
    const source=document.createElement('em');source.textContent=alert.source==='HISTORY'?'ยืนยันจากหลายรอบ':alert.source==='RECOVERY'?'Recovery':'โครงสร้าง';
    row.append(icon,copy,source);host.append(row);
  }
}

function renderRecovery(){
  const host=$('hosting-recovery');if(!host)return;host.replaceChildren();
  const meta=inventoryMeta||{};const backup=ownerHealth?.backup||{};const latest=backup.latest||null;
  const managed=Number(meta.managedCount||0);
  const policyCount=inventory.filter((site)=>site.ownership==='MANAGED'&&site.backupEnabled===true).length;
  const secretConfigured=inventory.filter((site)=>site.ownership==='MANAGED'&&site.secretsConfigured===true).length;
  const secretKnown=inventory.filter((site)=>site.ownership==='MANAGED'&&site.secretsState==='READY').length;
  const backupValue=backup.state==='VERIFIED'?'ยืนยันแล้ว':backup.state==='MISSING'?'ยังไม่มี Backup ที่ยืนยัน':backup.state==='NOT_CONFIGURED'?'ยังไม่ได้ตั้งค่า':'ต้องตรวจสอบ';
  const backupNote=backup.state==='VERIFIED'&&latest
    ?((backup.freshness?.state==='FRESH'?'สดใหม่':backup.freshness?.state==='STALE'?'เก่ากว่าปกติ':'ตรวจอายุไม่ได้')+' · '+formatBytes(latest.sizeBytes)+(latest.verifiedAt?' · '+new Date(latest.verifiedAt).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'}):''))
    :'สถานะนี้เป็น Backup ของ AWH/VPS ที่ตรวจยืนยันแล้ว ไม่ใช่แค่ checkbox ของเว็บไซต์';
  const drill=reliability?.recoveryDrill||{};const drillDate=drill.verifiedAt?new Date(drill.verifiedAt):null;
  const drillValue=drill.state==='PASS'?'กู้คืนทดสอบผ่าน':drill.state==='FAILED'?'กู้คืนทดสอบไม่ผ่าน':drill.state==='INVALID'?'หลักฐานไม่สมบูรณ์':'ยังไม่เคยยืนยัน';
  const drillNote=drill.state==='PASS'?(drillDate&&!Number.isNaN(drillDate.valueOf())?('ตรวจล่าสุด '+drillDate.toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'})):'มีหลักฐาน restore drill'):'Backup จะยังไม่ถือว่ากู้คืนได้จริงจนกว่า restore drill จะผ่าน';
  const summary=reliability?.summary||{};
  const rows=[
    ['Backup ที่ยืนยัน',backupValue,backupNote,backup.state==='VERIFIED'?'ok':'attention'],
    ['Restore drill',drillValue,drillNote,drill.state==='PASS'?'ok':'attention'],
    ['HTTP probe',String(summary.httpReachable??'—')+'/'+String(summary.probeTargetCount??'—')+' เข้าถึงได้','ตรวจแบบ bounded เมื่อเปิด/รีเฟรชหน้า · HTTP สะดุดครั้งเดียวไม่สร้าง incident',Number(summary.httpDown||0)>0?'attention':'ok'],
    ['DNS reconcile',String(summary.dnsMatched??'—')+' ตรง',Number(summary.dnsAttention||0)>0?(String(summary.dnsAttention)+' รายการชี้ผิดหรือหาไม่พบ'):'เทียบกับ public target ของ AWH',Number(summary.dnsAttention||0)>0?'attention':'ok'],
    ['นโยบาย Backup',policyCount+'/'+managed+' Managed sites','บอกว่าเว็บใดเปิดนโยบายสำรองข้อมูล · ไม่ถือว่า restore point มีอยู่จนกว่าจะยืนยันจริง','neutral'],
    ['พื้นที่ VPS',formatBytes(meta.storageAvailableBytes)+' ว่าง',Number.isFinite(Number(meta.storageUsedPercent))?('ใช้ไป '+Number(meta.storageUsedPercent).toFixed(1)+'%'):'กำลังตรวจพื้นที่',Number(meta.storageUsedPercent)>=90?'attention':'ok'],
    ['Managed ports',String(meta.managedPortRemaining??'—')+' ว่าง','ใช้ '+String(meta.managedPortUsed??'—')+'/'+String(meta.managedPortTotal??'—')+' ใน pool ที่ AWH จัดการ','neutral'],
    ['Route / HTTPS',(Number(meta.unroutedManagedCount||0)+Number(meta.tlsAttentionCount||0))===0?'ปกติ':'มีรายการต้องดู','Managed ไม่พบ route '+Number(meta.unroutedManagedCount||0)+' · HTTPS ต้องดู '+Number(meta.tlsAttentionCount||0),(Number(meta.unroutedManagedCount||0)+Number(meta.tlsAttentionCount||0))===0?'ok':'attention'],
    ['Secrets',secretKnown===managed?(secretConfigured+'/'+managed+' ตั้งค่าแล้ว'):'ตรวจได้ '+secretKnown+'/'+managed,'แสดงเฉพาะสถานะการตั้งค่า · ไม่ส่งค่า secret มาที่หน้าเว็บ','neutral'],
  ];
  for(const [label,value,note,state] of rows){
    const card=document.createElement('article');card.className='recovery-card';card.dataset.state=state;
    const small=document.createElement('span');small.textContent=label;
    const strong=document.createElement('strong');strong.textContent=value;
    const detail=document.createElement('small');detail.textContent=note;
    card.append(small,strong,detail);host.append(card);
  }
}

function renderTopology(){
  const host=$('hosting-topology');if(!host)return;host.replaceChildren();
  const rows=[...inventory].sort((a,b)=>String(a.primaryHost||'').localeCompare(String(b.primaryHost||'')));
  for(const item of rows){
    const row=document.createElement('article');row.className='topology-row';
    const name=document.createElement('strong');name.textContent=item.primaryHost||item.name||'เว็บไซต์';
    const flow=document.createElement('div');flow.className='topology-flow';
    const steps=[
      item.tls?'HTTPS':'HTTP',
      'Nginx',
      routeLabel(item.routeType),
      runtimeLabel(item.runtimeType),
      item.projectName||ownershipLabel(item.ownership),
    ];
    for(const step of steps){const chip=document.createElement('span');chip.textContent=step;flow.append(chip);}
    if(item.redirectHost){const target=document.createElement('small');target.textContent='ส่งต่อ → '+item.redirectHost;row.append(name,flow,target);}
    else row.append(name,flow);
    host.append(row);
  }
  if(!host.childElementCount){const empty=document.createElement('div');empty.className='site-empty';empty.textContent='ยังไม่มีเส้นทางเว็บไซต์ให้แสดง';host.append(empty);}
}

function inventoryMatches(item){
  if(inventoryFilter!=='ALL'&&item.ownership!==inventoryFilter)return false;
  if(!inventoryQuery)return true;
  const fullHosts=[item.primaryHost,...(Array.isArray(item.hosts)?item.hosts:[])].filter(Boolean).map((value)=>String(value).toLowerCase());
  const suffix='.'+CANONICAL_DOMAIN;
  const shortHosts=fullHosts.map((host)=>host.endsWith(suffix)?host.slice(0,-suffix.length):host);
  const name=String(item.name||'').toLowerCase();
  const searchableName=fullHosts.includes(name)?(name.endsWith(suffix)?name.slice(0,-suffix.length):name):name;
  const hostTerms=inventoryQuery.includes('.')?fullHosts:shortHosts;
  const hay=[searchableName,item.projectName,item.routeType,item.runtimeType,...hostTerms].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(inventoryQuery);
}

function renderSites(){
  const host=$('site-list');host.replaceChildren();
  const source=inventory.length?inventory:sites.map((site)=>({
    inventoryId:'managed-'+site.siteId,ownership:'MANAGED',managedSiteId:site.siteId,projectId:site.projectId,projectName:site.projectName,
    name:site.name,primaryHost:site.domainHost||site.primaryHost||desiredHost(site.slug||'',site.environment||'PRODUCTION'),hosts:[site.domainHost||site.primaryHost||desiredHost(site.slug||'',site.environment||'PRODUCTION')],
    environment:site.environment||'PRODUCTION',state:site.state,routeDetected:false,routeType:site.runtimeType==='NODE'?'PROXY':site.runtimeType,
    runtimeType:site.runtimeType,upstreamPort:site.port||null,tls:site.domainState==='ACTIVE',url:site.url,source:site.source,
    backupEnabled:site.backupEnabled,currentReleaseId:site.currentReleaseId,rollbackReleaseId:site.rollbackReleaseId,lastEvent:site.lastEvent,
  }));
  const managedById=new Map(sites.map((site)=>[site.siteId,site]));
  const httpByHost=reliabilityMap('http');const dnsByHost=reliabilityMap('dns');
  const rows=source.filter(inventoryMatches);

  for(const item of rows){
    const managed=item.managedSiteId?managedById.get(item.managedSiteId):null;
    const card=document.createElement('article');card.className='site-card ownership-'+String(item.ownership||'DISCOVERED').toLowerCase();

    const head=document.createElement('div');head.className='site-head';
    const titleWrap=document.createElement('div');titleWrap.className='site-title-wrap';
    const title=document.createElement('h3');title.textContent=item.name||item.primaryHost||'เว็บไซต์';
    const hostName=document.createElement('a');hostName.className='site-url';hostName.href=item.url||((item.tls===false?'http':'https')+'://'+item.primaryHost+'/');hostName.target='_blank';hostName.rel='noopener noreferrer';hostName.textContent=item.primaryHost||'—';
    titleWrap.append(title,hostName);
    const state=document.createElement('span');state.className='site-state';state.dataset.kind=item.ownership||'DISCOVERED';
    const liveOnline=item.liveState==='ONLINE';
    state.dataset.state=liveOnline?'READY':(item.state||'UNKNOWN');
    state.textContent=item.ownership==='MANAGED'?(liveOnline?'เส้นทางพร้อม':statusLabel(item.state)):ownershipLabel(item.ownership);
    head.append(titleWrap,state);card.append(head);

    const strip=document.createElement('div');strip.className='site-health-strip';
    const publicHost=String(item.liveHost||item.primaryHost||'').toLowerCase();const http=httpByHost.get(publicHost)||httpByHost.get(String(item.primaryHost||'').toLowerCase())||null;const dns=dnsByHost.get(String(item.primaryHost||'').toLowerCase())||null;
    const chips=[
      [item.liveState==='ONLINE'?'เส้นทางพร้อม':item.liveState==='ROUTED'?'มี route':'ยังไม่พบ route',item.liveState==='ONLINE'?'ok':item.liveState==='ROUTED'?'neutral':'attention'],
      [item.tls?'HTTPS':'HTTP',item.tls?'ok':'attention'],
      [routeLabel(item.routeType),'neutral'],
      [environmentLabel(item.environment),'neutral'],
    ];
    if(http)chips.push([httpStateLabel(http.state)+(Number.isInteger(http.httpStatus)?(' '+http.httpStatus):'')+(Number.isInteger(http.latencyMs)?(' · '+http.latencyMs+' ms'):''),http.state==='HEALTHY'?'ok':http.state==='REACHABLE'||http.state==='SKIPPED_ARCHIVED'?'neutral':'attention']);
    if(dns)chips.push([dnsStateLabel(dns.state),dns.state==='MATCHED'?'ok':dns.state==='UNKNOWN'?'neutral':'attention']);
    if(Number.isInteger(item.certificateDaysRemaining))chips.push(['SSL '+item.certificateDaysRemaining+' วัน',item.certificateDaysRemaining<21?'attention':'ok']);
    for(const [label,kind] of chips){const chip=document.createElement('span');chip.className='health-chip '+kind;chip.textContent=label;strip.append(chip);}
    card.append(strip);

    const note=document.createElement('div');note.className='site-event';
    if(item.ownership==='DISCOVERED')note.textContent='ตรวจพบจาก Nginx · AWH แสดงข้อมูลแบบอ่านอย่างเดียวและยังไม่เปลี่ยนเว็บนี้';
    else if(item.ownership==='ADOPTED')note.textContent='เชื่อมกับ '+(item.projectName||'Project')+' แบบ Observe-only · เว็บจริงยังใช้ route และไฟล์เดิมทั้งหมด';
    else if(item.ownership==='ALIAS')note.textContent=item.redirectHost?('ชื่อทางเข้าเดิม · ส่งต่อไป '+item.redirectHost):'ชื่อทางเข้า/Redirect ที่ตรวจพบจาก Nginx';
    else if(managed&&item.liveState==='ONLINE'&&['FAILED','DEGRADED'].includes(String(item.managementState||item.state)))note.textContent='เส้นทาง Production ยังพร้อม · เฉพาะสถานะการจัดการ AWH ต้องตรวจสอบก่อน Deploy ใหม่';
    else{
      const sourceNote=sourceInstruction(managed||item);const eventNote=humanEvent(managed||item);
      note.textContent=sourceNote||eventNote||(item.routeDetected?'เส้นทางเว็บถูกตรวจพบในเซิร์ฟเวอร์':'AWH กำลังตรวจเส้นทางเว็บ');
    }
    card.append(note);
    const adoption=adoptionPanel(item);if(adoption)card.append(adoption);

    if(managed&&managed.source?.ready!==true){
      const sourceAction=document.createElement('div');sourceAction.className='site-source-action';
      const text=document.createElement('span');text.textContent='ยังไม่พบแหล่งเว็บไซต์ที่พร้อมใช้';
      const link=document.createElement('a');link.href='./owner-center.html?project='+encodeURIComponent(managed.projectId)+'#source';link.textContent='ตั้งค่าแหล่งเว็บไซต์';link.className='secondary-button';
      sourceAction.append(text,link);card.append(sourceAction);
    }

    if(managed){
      const actions=document.createElement('div');actions.className='site-actions';
      if(managed.state==='READY'&&managed.domainState!=='ACTIVE')actions.append(domainButton(managed));
      if(managed.state==='DISABLED'&&siteSourceReady(managed))actions.append(button('เปิดเผยแพร่อีกครั้ง','primary-button',managed,'deploy'));
      else if(managed.state!=='DISABLED'&&siteSourceReady(managed))actions.append(button('อัปเดตเว็บไซต์','secondary-button',managed,'deploy'));
      if(managed.rollbackReleaseId&&managed.state!=='DISABLED')actions.append(button('กลับไปเวอร์ชันก่อน','secondary-button',managed,'rollback'));
      if(managed.state!=='DISABLED')actions.append(button('เก็บเข้าคลัง','danger-button',managed,'disable'));
      if(actions.childElementCount)card.append(actions);
    }

    const tech=document.createElement('details');tech.className='site-tech';
    const summary=document.createElement('summary');summary.textContent='รายละเอียดเว็บไซต์';
    const meta=document.createElement('div');meta.className='site-meta';
    meta.append(statusChip('การดูแล: '+ownershipLabel(item.ownership)),statusChip('เส้นทางจริง: '+(item.liveState==='ONLINE'?'พร้อม + HTTPS':item.liveState==='ROUTED'?'มี route':'ยังไม่พบ route')),statusChip('ระบบ: '+runtimeLabel(item.runtimeType)),statusChip('เส้นทาง: '+routeLabel(item.routeType)),statusChip('สภาพแวดล้อม: '+environmentLabel(item.environment)));
    if(item.ownership==='MANAGED'&&item.managementState)meta.append(statusChip('Managed state: '+statusLabel(item.managementState)));
    if(item.lifecycle?.state==='ARCHIVED')meta.append(statusChip('Lifecycle: Archived · เก็บ release/data ไว้ · ลบถาวรปิดอยู่'));
    else if(item.ownership==='MANAGED')meta.append(statusChip('Lifecycle: Active · ลบถาวรปิดอยู่'));
    if(item.liveHost&&item.liveHost!==item.primaryHost)meta.append(statusChip('ปลายทางจริง: '+item.liveHost));
    if(item.projectName)meta.append(statusChip('โปรเจกต์: '+item.projectName));
    if(item.upstreamPort)meta.append(statusChip('พอร์ตภายใน: '+item.upstreamPort));
    if(item.configName)meta.append(statusChip('Nginx: '+item.configName));
    if(item.rootClass==='AWH_SITE_ROOT')meta.append(statusChip('พื้นที่ไฟล์: AWH Site'));
    else if(item.rootClass==='WEB_ROOT')meta.append(statusChip('พื้นที่ไฟล์: เว็บเดิม'));
    if(item.databaseMode)meta.append(statusChip('ฐานข้อมูล: '+item.databaseMode+(item.databaseState?(' · '+item.databaseState):'')));
    meta.append(statusChip('นโยบาย Backup: '+(item.backupEnabled?'เปิด':'ปิด')));
    if(item.secretsState==='READY')meta.append(statusChip('Secrets: '+(item.secretsConfigured?'ตั้งค่าแล้ว':'ยังไม่มี')));
    else if(item.ownership==='MANAGED')meta.append(statusChip('Secrets: ตรวจไม่ได้'));
    if(item.rollbackReleaseId)meta.append(statusChip('จุดย้อนรุ่น: พร้อม'));
    if(siteSourceReady(item))meta.append(statusChip('ไฟล์ต้นทาง: พร้อม'));
    if(item.source?.revisionId)meta.append(statusChip('Source: '+String(item.source.revisionId).slice(0,12)));
    if(item.currentReleaseId)meta.append(statusChip('รุ่นปัจจุบัน: '+String(item.currentReleaseId).slice(0,18)));
    tech.append(summary,meta);
    const history=Array.isArray(item.recentEvents)?item.recentEvents.slice(0,6):[];
    if(history.length){
      const log=document.createElement('div');log.className='site-event-log';
      const logTitle=document.createElement('strong');logTitle.textContent='ประวัติล่าสุด';log.append(logTitle);
      for(const event of history){
        const row=document.createElement('div');row.className='site-event-row';
        const text=document.createElement('span');text.textContent=event.message||humanEvent({lastEvent:{name:event.name}})||event.name||'เหตุการณ์เว็บไซต์';
        const at=document.createElement('time');const date=event.at?new Date(event.at):null;at.textContent=date&&!Number.isNaN(date.valueOf())?date.toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'}):'—';
        row.append(text,at);log.append(row);
      }
      tech.append(log);
    }
    card.append(tech);host.append(card);
  }

  if(!host.childElementCount){const empty=document.createElement('div');empty.className='site-empty';empty.textContent='ไม่พบเว็บไซต์ตามตัวกรองนี้';host.append(empty);}
  renderHostingSummary();
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
  if(document.hidden||!needsLiveRefresh())return;
  liveRefreshTimer=setTimeout(()=>void refreshHostingData(true),delay);
}

async function refreshHostingData(background=false){
  if(hostingRefreshInFlight)return hostingRefreshInFlight;
  hostingRefreshInFlight=(async()=>{
    try{
      const [result,health]=await Promise.all([
        listManagedSites(),
        (!background||ownerHealth===null)?loadOwnerSelfServiceStatus().catch(()=>null):Promise.resolve(ownerHealth),
      ]);
      if(health&&typeof health==='object')ownerHealth=health;
      sites=Array.isArray(result.sites)?result.sites:[];
      inventory=Array.isArray(result.inventory)?result.inventory:[];
      inventoryMeta=result.inventoryMeta&&typeof result.inventoryMeta==='object'?result.inventoryMeta:null;
      projectsWithoutHosting=Array.isArray(result.projectsWithoutHosting)?result.projectsWithoutHosting:[];
      domains=Array.isArray(result.domains)?result.domains:[];
      dnsPlan=result.dns&&typeof result.dns==='object'?result.dns:null;
      reliability=result.reliability&&typeof result.reliability==='object'?result.reliability:null;
      ecosystem=result.ecosystem&&typeof result.ecosystem==='object'?result.ecosystem:null;
      renderEcosystem();
      renderOnboarding();
      renderSites();
      renderDomains();
      renderReliabilityAlerts();
      renderRecovery();
      renderTopology();
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

$('inventory-search').addEventListener('input',(event)=>{inventoryQuery=String(event.currentTarget.value||'').trim().toLowerCase();renderSites();});
$('inventory-filter').addEventListener('change',(event)=>{inventoryFilter=String(event.currentTarget.value||'ALL');renderSites();});

$('site-name').addEventListener('input',()=>{
  if(!$('site-slug').dataset.edited)$('site-slug').value=slugify($('site-name').value);
  renderUrlPreview();
});

$('site-slug').addEventListener('input',()=>{
  $('site-slug').dataset.edited='1';
  $('site-slug').value=slugify($('site-slug').value);
  renderUrlPreview();
});
$('site-environment').addEventListener('change',renderUrlPreview);

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
      environment:$('site-environment').value,
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

$('hosting-refresh').addEventListener('click',()=>void refresh());
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&liveRefreshTimer){clearTimeout(liveRefreshTimer);liveRefreshTimer=null;}
  else if(!document.hidden)scheduleLiveRefresh(800);
});

renderUrlPreview();
void refresh();
