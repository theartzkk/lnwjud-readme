import { requireOwnerSession, loadInfrastructureSummary, loadUpdateCenter, listManagedSites, loadProviderStatus, updateProviderPolicy, listPeople, listAccountRequests, reviewAccountRequest, revokePerson } from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';

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
const shortSha=(value)=>typeof value==='string'&&/^[0-9a-f]{40}$/i.test(value)?value.slice(0,9):'—';
const updateStateLabel=(state)=>({
  CURRENT:'ล่าสุด',INTERNAL_MANAGED:'ล่าสุด',UPDATE_AVAILABLE:'พร้อมอัปเดต',WAITING_FOR_APPROVAL:'รอยืนยัน',UPDATING:'กำลังอัปเดต',
  BLOCKED:'ต้องตรวจ',SOURCE_READY:'Source พร้อม',REMOTE_CHECK_REQUIRED:'กำลังตรวจ',BASELINE_REQUIRED:'ต้องผูก Production',MIGRATION_REQUIRED:'ต้องย้าย Deploy',UNREGISTERED:'ยังไม่ลงทะเบียน',
})[String(state||'')]||String(state||'ต้องตรวจ');

function renderUpdateSummary(snapshot,error=null){
  const status=$('cp-update-status'),meta=$('cp-update-meta'),host=$('cp-update-items');
  if(!status||!meta||!host)return;
  if(error||!snapshot){
    status.textContent='ยังตรวจไม่สำเร็จ';status.className='is-bad';meta.textContent=error instanceof Error?error.message:'ยังอ่านสถานะ Update Center ไม่ได้';
    for(const id of ['cp-update-current','cp-update-ready','cp-update-progress','cp-update-attention'])$(id).textContent='—';
    empty(host,'เปิดศูนย์อัปเดตเพื่อตรวจรายละเอียดล่าสุด');
    return;
  }
  const items=(Array.isArray(snapshot.items)?snapshot.items:[]).filter((item)=>item?.visibility!=='ADVANCED');
  const counts={current:0,ready:0,progress:0,attention:0};
  for(const item of items){
    const state=String(item?.state||'');
    if(['CURRENT','INTERNAL_MANAGED'].includes(state))counts.current++;
    else if(state==='UPDATE_AVAILABLE')counts.ready++;
    else if(['UPDATING','WAITING_FOR_APPROVAL'].includes(state))counts.progress++;
    else counts.attention++;
  }
  $('cp-update-current').textContent=String(counts.current);
  $('cp-update-ready').textContent=String(counts.ready);
  $('cp-update-progress').textContent=String(counts.progress);
  $('cp-update-attention').textContent=String(counts.attention);
  status.className='';
  if(counts.progress>0){status.textContent='กำลังอัปเดต '+counts.progress+' ระบบ';status.classList.add('is-warn');}
  else if(counts.ready>0){status.textContent='มี '+counts.ready+' รายการพร้อมอัปเดต';status.classList.add('is-warn');}
  else if(counts.attention>0){status.textContent='มี '+counts.attention+' รายการต้องตรวจ';status.classList.add('is-warn');}
  else{status.textContent='ทุกระบบเป็นรุ่นล่าสุด';status.classList.add('is-good');}
  const generated=Date.parse(snapshot.generatedAt||'');
  meta.textContent=items.length+' ระบบ'+(Number.isFinite(generated)?' · ตรวจล่าสุด '+new Date(generated).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}):'')+' · รายละเอียดอยู่ใน Update Center';
  host.replaceChildren();
  const rank={BLOCKED:0,WAITING_FOR_APPROVAL:1,UPDATING:2,UPDATE_AVAILABLE:3,SOURCE_READY:4,BASELINE_REQUIRED:5,MIGRATION_REQUIRED:6,UNREGISTERED:7,REMOTE_CHECK_REQUIRED:8};
  const attentionItems=items.filter((item)=>!['CURRENT','INTERNAL_MANAGED'].includes(String(item?.state||'')))
    .sort((a,b)=>(rank[String(a?.state||'')]??99)-(rank[String(b?.state||'')]??99))
    .slice(0,3);
  if(!attentionItems.length){host.append(row('ทุกระบบที่แสดง','ไม่มีรายการที่ต้องจัดการตอนนี้','พร้อม','READY'));return;}
  for(const item of attentionItems){
    const progress=Number(item?.progress);
    const detail=(item?.reason||'ดูรายละเอียดใน Update Center')+(Number.isFinite(progress)&&progress>0?' · '+Math.round(progress)+'%':'');
    const tone=String(item?.state)==='BLOCKED'?'CRITICAL':'WARNING';
    host.append(row(String(item?.name||'ระบบ'),detail,updateStateLabel(item?.state),tone));
  }
}

async function loadUpdateSummary(){
  try{renderUpdateSummary(await loadUpdateCenter());}
  catch(error){renderUpdateSummary(null,error);}
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
  const deployment=data?.deployment||{};
  $('cp-release').textContent='Control '+(deployment.controlReleaseId||'—')+' · Web '+(deployment.webReleaseId||'—')+' · '+(deployment.sourceState==='MATCHED'?'Control/Web SHA '+shortSha(deployment.controlSourceSha)+' ตรงกัน':'ยังยืนยัน Control/Web source ไม่ได้');
  const overall=$('cp-overall'),warnings=[];
  if(deployment.sourceState!=='MATCHED')warnings.push('Source');
  if(!server||!db.state||!backup.state)warnings.push('ข้อมูลไม่ครบ');
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
function renderAgentControl(data){
  const workers=Array.isArray(data?.workers)?data.workers:[];
  const readyWorkers=workers.filter(worker=>['READY','WORKING'].includes(String(worker?.state||'')));
  const workingWorkers=workers.filter(worker=>String(worker?.state||'')==='WORKING');
  const fabric=data?.capabilityFabric||{};
  const capabilities=Array.isArray(fabric.capabilities)?fabric.capabilities:[];
  const providers=Array.isArray(fabric.providers)?fabric.providers:[];
  const counts=fabric.summary||{};
  const readyCapabilityCount=Number(counts.ready||capabilities.filter(item=>item?.state==='READY').length||0);
  const cloudReadyCount=Number(counts.cloudReady||0);
  const queue=data?.queue||{};

  if($('cp-agent-online'))$('cp-agent-online').textContent=readyWorkers.length+'/'+workers.length;
  if($('cp-agent-capabilities'))$('cp-agent-capabilities').textContent=String(readyCapabilityCount);
  if($('cp-agent-cloud'))$('cp-agent-cloud').textContent=String(cloudReadyCount);
  if($('cp-agent-queue'))$('cp-agent-queue').textContent=String(Number(queue.activeTaskCount||0));
  if($('cp-agent-queue-note'))$('cp-agent-queue-note').textContent=Number(queue.waitingCapabilityCount||0)+' งานรอ capability';
  if($('cp-agent-summary'))$('cp-agent-summary').textContent=readyWorkers.length+' พร้อม · '+workingWorkers.length+' กำลังทำงาน · '+workers.length+' เครื่องทั้งหมด';
  if($('cp-agent-tools'))$('cp-agent-tools').textContent=readyWorkers.length+'/'+workers.length+' เครื่องพร้อม · '+readyCapabilityCount+' capabilities';

  const deviceState=$('cp-agent-device-state');
  if(deviceState){deviceState.className='cp-chip '+(workers.length&&readyWorkers.length===workers.length?'good':readyWorkers.length?'warn':'bad');deviceState.textContent=workers.length?readyWorkers.length+'/'+workers.length+' พร้อม':'ไม่มี Agent';}
  const deviceHost=$('cp-agent-device-list');
  if(deviceHost){
    deviceHost.replaceChildren();
    for(const worker of workers){
      const tools=Array.isArray(worker.detectedTools)?worker.detectedTools:[];
      const platform=[worker.platform,worker.arch].filter(Boolean).join(' · ');
      const version=worker.appVersion?'Agent '+worker.appVersion:'';
      const toolText=tools.length?tools.slice(0,6).join(' · '):'ยังไม่รายงานเครื่องมือ';
      const detail=[platform,version,toolText,worker.lastSeenAt?('ล่าสุด '+date(worker.lastSeenAt)):''].filter(Boolean).join(' · ');
      const label=worker.state==='WORKING'?'กำลังทำงาน':worker.state==='READY'?'พร้อม':worker.state==='STALE'?'ขาด heartbeat':'ออฟไลน์';
      deviceHost.append(row(worker.displayName||'AWH Agent',detail,label,worker.state||'UNKNOWN'));
    }
    if(!workers.length)empty(deviceHost,'ยังไม่มี AWH Agent ที่ลงทะเบียนกับ Control Plane');
  }

  const capabilityState=$('cp-agent-capability-state');
  if(capabilityState){capabilityState.className='cp-chip '+(readyCapabilityCount>0?'good':'warn');capabilityState.textContent=readyCapabilityCount+' พร้อม';}
  const capabilityHost=$('cp-agent-capability-list');
  if(capabilityHost){
    capabilityHost.replaceChildren();
    const ordered=[...capabilities].sort((a,b)=>(a?.state==='READY'?0:1)-(b?.state==='READY'?0:1));
    for(const item of ordered.slice(0,18)) capabilityHost.append(row(item.displayName||item.capability,item.description||item.capability,item.state||'UNKNOWN',item.state||'UNKNOWN'));
    if(!capabilities.length)empty(capabilityHost,'Capability Registry ยังไม่มี snapshot ที่พร้อมแสดง');
  }

  const providerHost=$('cp-agent-provider-list');
  if(providerHost){
    providerHost.replaceChildren();
    for(const item of providers){
      const expiry=item.expiresAt?' · หมดอายุ '+date(item.expiresAt):'';
      const detail=(item.kind||'PROVIDER')+' · '+(item.availabilityMode||'UNKNOWN')+' · '+Number(item.capabilityCount||0)+' capabilities · ตรวจ '+date(item.observedAt)+expiry;
      providerHost.append(row(item.displayName||item.providerId,detail,item.availabilityMode||'READY','READY'));
    }
    if(!providers.length)empty(providerHost,'ยังไม่มี provider health ที่สดพอ');
  }
}

function renderSites(sitesData){
  const sites=Array.isArray(sitesData?.sites)?sitesData.sites:[],ready=sites.filter(s=>s.state==='READY').length;
  $('cp-sites').textContent=sites.length?ready+'/'+sites.length+' sites ready':'ยังไม่มี Managed Site';
}
let cpProvider=null;
const MICRO_BAHT=1000000;
function renderProvider(providerData){
  const provider=providerData?.provider||providerData||{};cpProvider=provider;
  $('cp-ai').textContent=provider.state==='READY'?'AI พร้อม · Auto routing':provider.state||'ยังไม่พร้อม';
  const budget=provider.budget||{};
  if($('cp-ai-enabled'))$('cp-ai-enabled').checked=provider.enabled===true;
  if($('cp-ai-budget'))$('cp-ai-budget').value=(Number.isInteger(budget.monthlyMicrounits)?budget.monthlyMicrounits/MICRO_BAHT:0).toFixed(2);
  if($('cp-ai-warning'))$('cp-ai-warning').value=(Number.isInteger(budget.warningMicrounits)?budget.warningMicrounits/MICRO_BAHT:0).toFixed(2);
  if($('cp-ai-routing'))$('cp-ai-routing').value=['SAVER','BALANCED','QUALITY'].includes(provider.routingStrategy)?provider.routingStrategy:'BALANCED';
  if($('cp-ai-status'))$('cp-ai-status').textContent=provider.available===true?'พร้อมใช้งาน':provider.keyConfigured===true?'เชื่อม API แล้ว':'ยังไม่ได้เชื่อม API';
}
function moneyMicros(id){
  const value=Number.parseFloat($(id)?.value||'0');
  if(!Number.isFinite(value)||value<0)throw new Error('กรอกจำนวนเงินให้ถูกต้อง');
  const result=Math.round(value*MICRO_BAHT);if(!Number.isSafeInteger(result))throw new Error('จำนวนเงินมากเกินไป');return result;
}
function personRoleLabel(role){return ({OWNER:'เจ้าของ',ADMIN:'ผู้ดูแลแพลตฟอร์ม',STAFF:'สมาชิก',VIEWER:'ดูอย่างเดียว'})[role]||role||'สมาชิก';}
async function loadPeopleAccess(){
  const [peopleData,requestData]=await Promise.all([listPeople(),listAccountRequests()]);
  const people=Array.isArray(peopleData?.people)?peopleData.people:[];
  const requests=Array.isArray(requestData?.requests)?requestData.requests.filter(item=>item?.state==='PENDING'):[];
  if($('cp-people-summary'))$('cp-people-summary').textContent=people.length+' บัญชี · '+requests.length+' คำขอรอ';
  const peopleHost=$('cp-people-list');if(peopleHost){peopleHost.replaceChildren();for(const person of people){
    const item=row(person.displayName||person.username,'@'+(person.username||'—')+' · '+(person.status==='ACTIVE'?'ใช้งานอยู่':'ปิดใช้งาน'),personRoleLabel(person.role),person.status==='ACTIVE'?'READY':'');
    if(person.status==='ACTIVE'&&person.role!=='OWNER'){
      const button=document.createElement('button');button.type='button';button.className='cp-mini-action';button.textContent='ปิดบัญชี';
      button.addEventListener('click',async()=>{if(!confirm('ปิดบัญชี “'+(person.displayName||person.username)+'” ใช่หรือไม่?'))return;button.disabled=true;try{await revokePerson(person.userId);await loadPeopleAccess();}catch(error){$('cp-person-message').textContent=error instanceof Error?error.message:'ยังปิดบัญชีไม่ได้';button.disabled=false;}});
      item.append(button);
    }
    peopleHost.append(item);
  }if(!people.length)empty(peopleHost,'ยังไม่มีบัญชีอื่น');}
  const requestHost=$('cp-request-list');if(requestHost){requestHost.replaceChildren();for(const request of requests){
    const detail='@'+(request.username||'—')+(request.requestedArea?' · '+request.requestedArea:'');
    const item=row(request.displayName||request.username,detail,'รออนุมัติ','WARNING');
    const actions=document.createElement('div');actions.className='cp-inline-actions';
    const approve=document.createElement('button');approve.type='button';approve.className='cp-mini-action';approve.textContent='อนุมัติ';
    const reject=document.createElement('button');reject.type='button';reject.className='cp-mini-action';reject.textContent='ไม่อนุมัติ';
    approve.addEventListener('click',async()=>{approve.disabled=reject.disabled=true;try{await reviewAccountRequest(request.requestId,'APPROVE','STAFF',[]);await loadPeopleAccess();}catch(error){$('cp-person-message').textContent=error instanceof Error?error.message:'ยังอนุมัติไม่ได้';approve.disabled=reject.disabled=false;}});
    reject.addEventListener('click',async()=>{approve.disabled=reject.disabled=true;try{await reviewAccountRequest(request.requestId,'REJECT','VIEWER',[]);await loadPeopleAccess();}catch(error){$('cp-person-message').textContent=error instanceof Error?error.message:'ยังปฏิเสธคำขอไม่ได้';approve.disabled=reject.disabled=false;}});
    actions.append(approve,reject);item.append(actions);requestHost.append(item);
  }if(!requests.length)empty(requestHost,'ไม่มีคำขอค้าง');}
}
async function renderExternalCapabilities(){
  const host=$('cp-external-capabilities');if(!host)return;
  try{
    const response=await fetch('./external-capabilities.json?release=__AWH_WEB_RELEASE_ID__',{cache:'no-store'});
    if(!response.ok)throw new Error('External capability registry unavailable');
    const data=await response.json();
    if(data?.schemaVersion!==1||data?.registryId!=='awh.external-capabilities.v1'||data?.controlPlaneAuthority!=='AWH'||!Array.isArray(data.entries))throw new Error('External capability registry invalid');
    host.replaceChildren();
    for(const item of data.entries){
      const short=typeof item.revision==='string'?item.revision.slice(0,9):'—';
      const local=item.integrationMode==='OPTIONAL_LOCAL_ADAPTER';
      const detail=(local?'Optional local adapter':'Reference only')+' · '+item.repository+' @ '+short+' · '+item.license;
      host.append(row(item.displayName,detail,local?'Adapter':'Reference','AVAILABLE'));
    }
    if(!data.entries.length)empty(host,'ยังไม่มี external capability ที่ลงทะเบียน');
  }catch(error){empty(host,error instanceof Error?error.message:'โหลด external capabilities ไม่สำเร็จ');}
}
function filterMenus(query){
  const q=String(query||'').trim().toLowerCase();
  for(const node of document.querySelectorAll('[data-cp-keywords]')){
    const text=(node.textContent+' '+(node.dataset.cpKeywords||'')).toLowerCase();node.hidden=Boolean(q)&&!text.includes(q);
  }
  const navAdvanced=document.querySelector('.cp-nav-advanced');
  if(navAdvanced instanceof HTMLDetailsElement) navAdvanced.open=Boolean(q)&&[...navAdvanced.querySelectorAll('[data-cp-keywords]')].some(node=>!node.hidden);
}
function revealHashTarget(hash){
  const id=String(hash||'').replace(/^#/,'');if(!id)return;
  const target=document.getElementById(id);if(!target)return;
  for(let details=target.closest('details');details instanceof HTMLDetailsElement;details=details.parentElement?.closest('details')) details.open=true;
}
function installUi(){
  const search=$('cp-search');search?.addEventListener('input',()=>filterMenus(search.value));
  window.addEventListener('keydown',(event)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();search?.focus();search?.select();}});
  $('cp-menu')?.addEventListener('click',()=>document.body.classList.toggle('cp-menu-open'));
  document.addEventListener('click',(event)=>{
    const anchor=event.target instanceof Element?event.target.closest('a[href^="#"]'):null;
    if(anchor instanceof HTMLAnchorElement) revealHashTarget(anchor.getAttribute('href')||'');
    if(window.innerWidth<=840&&document.body.classList.contains('cp-menu-open')&&event.target instanceof HTMLAnchorElement)document.body.classList.remove('cp-menu-open');
  });
  window.addEventListener('hashchange',()=>revealHashTarget(window.location.hash));
  if(window.location.hash)queueMicrotask(()=>revealHashTarget(window.location.hash));
  $('cp-refresh')?.addEventListener('click',()=>void load());
  $('cp-ai-form')?.addEventListener('submit',async(event)=>{
    event.preventDefault();const button=event.currentTarget.querySelector('button[type="submit"]');if(button)button.disabled=true;
    if($('cp-ai-message'))$('cp-ai-message').textContent='กำลังบันทึก…';
    try{
      const models=cpProvider?.models||{fast:'gpt-5.6-luna',balanced:'gpt-5.6-terra',strong:'gpt-5.6-sol'};
      const result=await updateProviderPolicy({enabled:$('cp-ai-enabled')?.checked===true,modelFast:models.fast,modelBalanced:models.balanced,modelStrong:models.strong,monthlyBudgetMicrounits:moneyMicros('cp-ai-budget'),warningMicrounits:moneyMicros('cp-ai-warning'),routingStrategy:$('cp-ai-routing')?.value||'BALANCED',pricingMode:'CATALOG',serviceTier:'DEFAULT'});
      renderProvider(result.provider||result);if($('cp-ai-message'))$('cp-ai-message').textContent='บันทึกนโยบาย AI แล้ว';
    }catch(error){if($('cp-ai-message'))$('cp-ai-message').textContent=error instanceof Error?error.message:'ยังบันทึก AI ไม่ได้';}
    finally{if(button)button.disabled=false;}
  });

}
async function load(){
  const refresh=$('cp-refresh');if(refresh)refresh.disabled=true;
  $('cp-attention')?.replaceChildren();if($('cp-attention-wrap'))$('cp-attention-wrap').hidden=true;
  $('cp-updated').textContent='กำลังโหลดข้อมูลสำคัญ…';
  const started=performance.now();
  try{
    const session=await requireOwnerSession();
    if(!session){location.assign('./');return;}
    const data=await loadInfrastructureSummary();
    renderServer(data);renderDomains(data);renderRecovery(data);renderServices(data);renderEcosystem(data);renderAgentControl(data);
    $('cp-updated').textContent='ตรวจข้อมูลแล้ว · '+Math.max(1,Math.round(performance.now()-started))+' ms';
    void loadUpdateSummary();
    void renderExternalCapabilities();

    Promise.allSettled([listManagedSites(),loadProviderStatus(),loadPeopleAccess()]).then((secondary)=>{
      if(secondary[0].status==='fulfilled')renderSites(secondary[0].value);
      if(secondary[1].status==='fulfilled')renderProvider(secondary[1].value);
    });
  }catch(error){
    const overall=$('cp-overall');overall.className='cp-overall bad';overall.textContent='ศูนย์ดูแลระบบต้องตรวจ';
    attention('ยังโหลดศูนย์ดูแลระบบไม่ครบ',error instanceof Error?error.message:'Unknown error','CRITICAL');$('cp-updated').textContent='โหลดข้อมูลไม่สำเร็จ';
  }finally{if(refresh)refresh.disabled=false;}
}
installUi();void load();
