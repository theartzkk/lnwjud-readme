import { loadControlData, loadInfrastructure, listManagedSites, loadProviderStatus } from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';

const $=(id)=>document.getElementById(id);
const bytes=(value)=>{const n=Number(value||0);if(!Number.isFinite(n)||n<1)return '—';if(n<1024**2)return Math.round(n/1024)+' KB';if(n<1024**3)return (n/1024**2).toFixed(1)+' MB';return (n/1024**3).toFixed(1)+' GB';};
const percent=(value)=>Number.isFinite(Number(value))?Number(value).toFixed(Number(value)%1?1:0)+'%':'—';
const date=(value)=>{const t=Date.parse(value||'');return Number.isFinite(t)?new Date(t).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'}):'—';};
const good=(state)=>['ACTIVE','READY','HEALTHY','VERIFIED','AVAILABLE','PASS','PRODUCTION','ONLINE'].includes(String(state||'').toUpperCase());
const bad=(state)=>['FAILED','CRITICAL','INVALID','UNAVAILABLE','DOWN','ERROR'].includes(String(state||'').toUpperCase());

function row(title,detail,label,state=''){
  const item=document.createElement('div');item.className='cp-row';
  const copy=document.createElement('span');copy.className='cp-row-copy';
  const strong=document.createElement('strong');strong.textContent=title;
  const small=document.createElement('small');small.textContent=detail;
  const chip=document.createElement('span');chip.className='cp-chip '+(good(state)?'good':bad(state)?'bad':state?'warn':'');chip.textContent=label||state||'—';
  copy.append(strong,small);item.append(copy,chip);return item;
}
function empty(host,text){host.replaceChildren();const n=document.createElement('div');n.className='cp-empty';n.textContent=text;host.append(n);}
function attention(title,detail,state='WARNING'){
  const wrap=$('cp-attention-wrap'),host=$('cp-attention');if(!wrap||!host)return;
  wrap.hidden=false;host.append(row(title,detail,state,state));
}
function renderServer(data){
  const server=data?.telemetry?.server||null,storage=data?.storage||server?.storage||{},backup=data?.backup||{},db=data?.database||{};
  if(server){
    $('cp-cpu').textContent=percent(server.cpu?.usedPercent);$('cp-load').textContent='Load '+(server.cpu?.load1??'—');
    $('cp-memory').textContent=percent(server.memory?.usedPercent);$('cp-memory-free').textContent='ว่าง '+bytes(server.memory?.availableBytes);
    $('cp-storage').textContent=percent(storage.usedPercent??server.storage?.usedPercent);$('cp-storage-free').textContent='ว่าง '+bytes(storage.freeBytes??server.storage?.freeBytes);
  }
  const latest=backup.latest;
  $('cp-backup').textContent=backup.state==='VERIFIED'?'Verified':backup.state||'—';
  $('cp-backup-time').textContent=latest?'ล่าสุด '+date(latest.verifiedAt):'ยังไม่มีข้อมูล';
  $('cp-backup-card').textContent=latest?(backup.state||'—')+' · '+date(latest.verifiedAt):(backup.state||'ยังไม่มีข้อมูล');
  $('cp-db').textContent='Schema '+(db.schemaVersion??'—')+' · '+(db.state||'UNKNOWN');
  $('cp-release').textContent='Release '+(data?.deployment?.controlReleaseId||data?.deployment?.releaseId||'—');
  const overall=$('cp-overall'),warnings=[];
  if(db.state&&db.state!=='HEALTHY')warnings.push('Database');
  if(backup.state&&backup.state!=='VERIFIED')warnings.push('Backup');
  if(['WARNING','CRITICAL'].includes(String(storage.state||'')))warnings.push('Storage');
  if(data?.telemetry?.state&&data.telemetry.state!=='READY')warnings.push('Telemetry');
  overall.className='cp-overall '+(warnings.length?(String(storage.state)==='CRITICAL'?'bad':'warn'):'good');
  overall.textContent=warnings.length?warnings.length+' รายการต้องดู':'ระบบหลักปกติ';
  if(db.state&&db.state!=='HEALTHY')attention('Database ต้องตรวจสอบ','Schema '+(db.schemaVersion??'—')+' · '+db.state,'WARNING');
  if(backup.state&&backup.state!=='VERIFIED')attention('Backup ยังไม่ Verified',backup.state,'WARNING');
  if(backup.freshness?.state==='STALE')attention('Backup ล่าสุดเก่าเกินกำหนด','ตรวจ scheduler และพื้นที่ดิสก์','WARNING');
  if(['WARNING','CRITICAL'].includes(String(storage.state||'')))attention('พื้นที่ VPS เหลือน้อย',percent(storage.usedPercent)+' ใช้งาน · ว่าง '+bytes(storage.freeBytes),storage.state);
}
function renderDomains(data){
  const host=$('cp-domain-list');host.replaceChildren();
  const domains=Array.isArray(data?.telemetry?.server?.domains)?data.telemetry.server.domains:[];
  $('cp-domains-count').textContent=domains.length?domains.length+' โดเมนที่ตรวจพบ':'ยังไม่พบข้อมูลโดเมน';
  if(!domains.length){empty(host,'ยังไม่มี domain telemetry');return;}
  for(const domain of domains.slice(0,8)){
    let detail=domain.tls?'HTTPS เปิดอยู่':'ยังไม่มี HTTPS';
    if(Number.isInteger(domain.certificateDaysRemaining))detail+=' · SSL เหลือ '+domain.certificateDaysRemaining+' วัน';
    host.append(row(domain.name,detail,domain.tls?'HTTPS':'HTTP',domain.tls?'ACTIVE':'WARNING'));
    if(!domain.tls)attention('โดเมนยังไม่มี HTTPS',domain.name,'WARNING');
    else if(Number.isInteger(domain.certificateDaysRemaining)&&domain.certificateDaysRemaining<21)attention('SSL ใกล้หมดอายุ',domain.name+' · '+domain.certificateDaysRemaining+' วัน','WARNING');
  }
}
function renderRecovery(data){
  const host=$('cp-recovery-list');host.replaceChildren();
  const db=data?.database||{},backup=data?.backup||{},storage=data?.storage||{},drill=data?.ecosystemHealth?.recoveryDrill||{};
  host.append(row('Database Integrity','Schema '+(db.schemaVersion??'—'),db.state||'UNKNOWN',db.state));
  host.append(row('Verified Backup',backup.latest?bytes(backup.latest.sizeBytes)+' · '+date(backup.latest.verifiedAt):'ยังไม่มีรายการ',backup.state||'UNKNOWN',backup.state));
  host.append(row('Restore Drill',drill.state==='PASS'?'ผ่านล่าสุด '+date(drill.verifiedAt):'ยังไม่มีหลักฐานล่าสุด',drill.state||'NOT_RUN',drill.state));
  host.append(row('Storage Guard',percent(storage.usedPercent)+' ใช้งาน · ว่าง '+bytes(storage.freeBytes),storage.state||'UNKNOWN',storage.state));
}
function renderServices(data){
  const host=$('cp-service-list');host.replaceChildren();
  const services=Array.isArray(data?.telemetry?.server?.services)?data.telemetry.server.services:[];
  $('cp-services').textContent=services.length?services.filter(s=>s.state==='ACTIVE').length+'/'+services.length+' services active':'ยังไม่มี telemetry';
  if(!services.length){empty(host,'ยังไม่มี service telemetry');return;}
  for(const service of services.slice(0,8)){
    const active=service.state==='ACTIVE';
    host.append(row(service.label||service.key,(active?'กำลังทำงาน':'สถานะ '+service.state)+' · '+(service.startup||'—'),active?'Online':service.state,service.state));
    if(['nginx','php-fpm','native-executor'].includes(service.key)&&!active)attention((service.label||service.key)+' ต้องตรวจสอบ',service.state,'CRITICAL');
  }
  const security=data?.telemetry?.server?.security||{};
  $('cp-security').textContent='Fail2ban '+(security.fail2ban||'—')+' · Updates '+(security.automaticUpdates||'—');
}
function renderEcosystem(data){
  const host=$('cp-ecosystem-list');host.replaceChildren();
  const services=data?.ecosystemHealth?.current?.bay?.services;
  if(!Array.isArray(services)||!services.length){empty(host,'กำลังรอ Ecosystem Health snapshot');return;}
  const labels={awh:'AWH Control Plane',bay:'BAY EXCUSE X',learnlab:'BAY LearnLab',website:'เว็บไซต์โรงเรียน'};
  for(const service of services){
    const detail=service.detail||'HTTP '+(service.http??'—')+' · '+(service.latencyMs??'—')+' ms';
    host.append(row(labels[service.id]||service.name||service.id,detail,service.ok?'Online':'ต้องตรวจ',service.ok?'READY':'FAILED'));
    if(service.critical&&service.ok!==true)attention((labels[service.id]||service.name||service.id)+' ผิดปกติ',detail,'CRITICAL');
  }
}
function renderSites(sitesData){
  const sites=Array.isArray(sitesData?.sites)?sitesData.sites:[],ready=sites.filter(s=>s.state==='READY').length;
  $('cp-sites').textContent=sites.length?ready+'/'+sites.length+' sites ready':'ยังไม่มี Managed Site';
}
function renderProvider(providerData){const provider=providerData?.provider||{};$('cp-ai').textContent=provider.state==='READY'?'AI พร้อม · Auto routing':provider.state||'ยังไม่พร้อม';}
function filterMenus(query){
  const q=String(query||'').trim().toLowerCase();
  for(const node of document.querySelectorAll('[data-cp-keywords]')){
    const text=(node.textContent+' '+(node.dataset.cpKeywords||'')).toLowerCase();node.hidden=Boolean(q)&&!text.includes(q);
  }
}
function installUi(){
  const search=$('cp-search');search?.addEventListener('input',()=>filterMenus(search.value));
  window.addEventListener('keydown',(event)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();search?.focus();search?.select();}});
  $('cp-menu')?.addEventListener('click',()=>document.body.classList.toggle('cp-menu-open'));
  document.addEventListener('click',(event)=>{if(window.innerWidth<=840&&document.body.classList.contains('cp-menu-open')&&event.target instanceof HTMLAnchorElement)document.body.classList.remove('cp-menu-open');});
  $('cp-refresh')?.addEventListener('click',()=>void load());
}
async function load(){
  const refresh=$('cp-refresh');if(refresh)refresh.disabled=true;
  $('cp-attention')?.replaceChildren();if($('cp-attention-wrap'))$('cp-attention-wrap').hidden=true;
  try{
    const control=await loadControlData();if(control.role!=='OWNER'){location.assign('./');return;}
    const results=await Promise.allSettled([loadInfrastructure(),listManagedSites(),loadProviderStatus()]);
    if(results[0].status!=='fulfilled')throw results[0].reason;
    const data=results[0].value;renderServer(data);renderDomains(data);renderRecovery(data);renderServices(data);renderEcosystem(data);
    if(results[1].status==='fulfilled')renderSites(results[1].value);
    if(results[2].status==='fulfilled')renderProvider(results[2].value);
    $('cp-updated').textContent='อัปเดต '+date(data?.telemetry?.generatedAt||new Date().toISOString());
  }catch(error){
    const overall=$('cp-overall');overall.className='cp-overall bad';overall.textContent='Control Panel ต้องตรวจ';
    attention('ยังโหลด Control Panel ไม่ครบ',error instanceof Error?error.message:'Unknown error','CRITICAL');$('cp-updated').textContent='โหลดข้อมูลไม่สำเร็จ';
  }finally{if(refresh)refresh.disabled=false;}
}
installUi();void load();
