import { requireOwnerSession, loadInfrastructureSummary, loadInfrastructure, loadUpdateCenter, loadControlData, listManagedSites, loadProviderStatus, updateProviderPolicy, listPeople, listAccountRequests, reviewAccountRequest, revokePerson, updatePersonAccess, cancelTask, decideApproval, revokeDevice, managedSiteAction, loadCoreReleaseStatus, requestCoreRelease } from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';

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
function attention(title,detail,state='WARNING',action=null){
  const wrap=$('cp-attention-wrap'),host=$('cp-attention');if(!wrap||!host)return;
  wrap.hidden=false;
  const item=row(title,detail,state,state);
  if(action?.href&&action?.label){
    const link=document.createElement('a');link.className='cp-row-action';link.href=action.href;link.textContent=action.label;item.append(link);
  }
  host.append(item);
}
function healthTone(state){
  const value=String(state||'UNKNOWN').toUpperCase();
  if(['READY','ACTIVE','HEALTHY','VERIFIED','PASS','MATCHED','ONLINE','NORMAL'].includes(value))return 'good';
  if(['FAILED','CRITICAL','DOWN','ERROR','INVALID'].includes(value))return 'bad';
  return 'warn';
}
function healthItem(key,title,detail,state,actionLabel,href){
  const item=document.createElement('article');item.className='cp-health-item '+healthTone(state);item.dataset.healthKey=key;item.setAttribute('role','listitem');
  const stateWrap=document.createElement('span');stateWrap.className='cp-health-state';
  const dot=document.createElement('i');dot.setAttribute('aria-hidden','true');
  const chip=document.createElement('b');chip.textContent=String(state||'UNKNOWN').replaceAll('_',' ');
  stateWrap.append(dot,chip);
  const copy=document.createElement('span');copy.className='cp-health-copy';
  const strong=document.createElement('strong');strong.textContent=title;
  const small=document.createElement('small');small.textContent=detail||'กำลังตรวจข้อมูล';
  copy.append(strong,small);
  const action=document.createElement('a');action.className='cp-health-action';action.href=href;action.textContent=actionLabel;
  item.append(stateWrap,copy,action);return item;
}
function renderHealthMatrix(data){
  const host=$('cp-health-matrix');if(!host)return;
  const server=data?.telemetry?.server||{},storage=data?.storage||server?.storage||{},db=data?.database||{},backup=data?.backup||{},deployment=data?.deployment||{};
  const services=Array.isArray(server?.services)?server.services:[];
  const criticalServices=services.filter(item=>['nginx','php-fpm','native-executor'].includes(item?.key));
  const servicesReady=criticalServices.length>0&&criticalServices.every(item=>item?.state==='ACTIVE');
  const workers=Array.isArray(data?.workers)?data.workers:[];
  const workerReady=workers.filter(item=>['READY','WORKING'].includes(String(item?.state||''))).length;
  const domains=Array.isArray(server?.domains)?server.domains:[];
  const domainReady=domains.length>0&&domains.every(item=>item?.tls===true);
  const runtimeState=deployment.sourceState==='MATCHED'?'MATCHED':deployment.sourceState||'UNKNOWN';
  const storageState=storage.state||((Number(storage.usedPercent)>=90)?'CRITICAL':Number(storage.usedPercent)>=80?'WARNING':'NORMAL');
  const dbState=db.state||'UNKNOWN';
  const backupState=backup.state||'UNKNOWN';
  const serviceState=servicesReady?'READY':criticalServices.length?'WARNING':'UNKNOWN';
  const deviceState=workers.length?(workerReady===workers.length?'READY':workerReady?'WARNING':'OFFLINE'):'UNKNOWN';
  const domainState=domains.length?(domainReady?'READY':'WARNING'):'UNKNOWN';
  const rows=[
    healthItem('runtime','AWH Runtime',deployment.controlReleaseId?('Control '+deployment.controlReleaseId+' · Source '+shortSha(deployment.controlSourceSha)):'ยังยืนยัน runtime ไม่ครบ',runtimeState,'ดูรุ่นระบบ','./updates.html'),
    healthItem('storage','VPS / Storage',percent(storage.usedPercent)+' ใช้งาน · ว่าง '+bytes(storage.freeBytes),storageState,'ดูเซิร์ฟเวอร์','./infrastructure.html'),
    healthItem('database','Database','Schema '+(db.schemaVersion??'—')+' · '+dbState,dbState,'เปิด Database Studio','./database.html'),
    healthItem('backup','Backup & Recovery',backup.latest?('ล่าสุด '+date(backup.latest.verifiedAt)+' · '+bytes(backup.latest.sizeBytes)):'ยังไม่มีหลักฐาน backup ล่าสุด',backupState,'ดูการกู้คืน','#backup'),
    healthItem('services','Core Services',criticalServices.length?criticalServices.filter(item=>item.state==='ACTIVE').length+'/'+criticalServices.length+' บริการหลักพร้อม':'ยังไม่มี service telemetry',serviceState,'ดูบริการ','./infrastructure.html'),
    healthItem('devices','AWH Devices',workers.length?workerReady+'/'+workers.length+' เครื่องพร้อม':'ยังไม่มี Agent ที่รายงานสถานะ',deviceState,'ดูอุปกรณ์','#awh-agent'),
    healthItem('domains','Web / SSL',domains.length?domains.length+' โดเมน · '+domains.filter(item=>item.tls).length+' เปิด HTTPS':'ยังไม่มี domain telemetry',domainState,'ดูเว็บไซต์','./hosting.html'),
  ];
  host.replaceChildren(...rows);
  const badCount=rows.filter(item=>item.classList.contains('bad')).length;
  const warnCount=rows.filter(item=>item.classList.contains('warn')).length;
  const summary=$('cp-health-summary');
  if(summary)summary.textContent=badCount?badCount+' รายการผิดปกติ · '+warnCount+' รายการควรดู':warnCount?warnCount+' รายการควรดู · ที่เหลือปกติ':'ระบบหลักปกติทั้งหมด';
}
function renderCommandCenter(data){
  const server=data?.telemetry?.server||{},storage=data?.storage||server?.storage||{},deployment=data?.deployment||{},queue=data?.queue||{};
  const workers=Array.isArray(data?.workers)?data.workers:[];
  const readyWorkers=workers.filter(worker=>['READY','WORKING'].includes(String(worker?.state||''))).length;
  const attentionCount=document.querySelectorAll('#cp-attention .cp-row').length;
  const activeTasks=Number(queue.activeTaskCount||0);
  const summary=$('cp-command-summary'),note=$('cp-command-note');
  if(summary)summary.textContent=attentionCount?attentionCount+' เรื่องควรจัดการ':'ระบบพร้อมใช้งาน';
  if(note){
    const source=deployment.sourceState==='MATCHED'?'รุ่นระบบตรงกัน':'กำลังตรวจรุ่นระบบ';
    const disk=Number(storage.freeBytes)>0?'พื้นที่ว่าง '+bytes(storage.freeBytes):'กำลังตรวจพื้นที่';
    note.textContent=source+' · '+activeTasks+' งานกำลังทำ · '+disk;
  }
  if($('cp-command-attention-count'))$('cp-command-attention-count').textContent=attentionCount?String(attentionCount):'0';
  if($('cp-command-attention-note'))$('cp-command-attention-note').textContent=attentionCount?'เปิดดูและจัดการด้านล่าง':'ไม่มีเรื่องเร่งด่วน';
  if($('cp-command-running'))$('cp-command-running').textContent=String(activeTasks);
  if($('cp-command-devices'))$('cp-command-devices').textContent=readyWorkers+'/'+workers.length;
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

async function loadInfrastructureCompat(){
  try{return await loadInfrastructureSummary();}
  catch{return loadInfrastructure();}
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
  if(db.state&&db.state!=='HEALTHY')attention('Database ต้องตรวจสอบ','Schema '+(db.schemaVersion??'—')+' · '+db.state,'WARNING',{label:'เปิด Database Studio',href:'./database.html'});
  if(backup.state&&backup.state!=='VERIFIED')attention('Backup ยังไม่ Verified',backup.state,'WARNING',{label:'ดูการกู้คืน',href:'#backup'});
  if(backup.freshness?.state==='STALE')attention('Backup ล่าสุดเก่าเกินกำหนด','ตรวจ scheduler และพื้นที่ดิสก์','WARNING',{label:'ดูการกู้คืน',href:'#backup'});
  if(['WARNING','CRITICAL'].includes(String(storage.state||'')))attention('พื้นที่ VPS เหลือน้อย',percent(storage.usedPercent)+' ใช้งาน · ว่าง '+bytes(storage.freeBytes),storage.state,{label:'ดูพื้นที่',href:'./infrastructure.html'});
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

let cpControlData=null;
let cpSitesData=null;
let cpCoreRelease=null;

function setControlMessage(text,tone=''){
  const node=$('cp-control-message');if(!node)return;
  node.className=tone?'is-'+tone:'';node.textContent=text;
}
function makeControlButton(label,run,{tone='',confirmText=null,busyLabel='กำลังทำ…'}={}){
  const button=document.createElement('button');button.type='button';button.className='cp-control-action'+(tone?' '+tone:'');button.textContent=label;
  button.addEventListener('click',async()=>{
    if(confirmText&&!confirm(confirmText))return;
    const before=button.textContent;button.disabled=true;button.textContent=busyLabel;setControlMessage(busyLabel,'warn');
    try{await run();setControlMessage('ดำเนินการแล้ว กำลังอัปเดตสถานะ','good');await load();}
    catch(error){setControlMessage(error instanceof Error?error.message:'ดำเนินการไม่สำเร็จ','bad');button.disabled=false;button.textContent=before;}
  });
  return button;
}
function taskStateLabel(state){
  return ({QUEUED:'อยู่ในคิว',WAITING_FOR_WORKER:'รออุปกรณ์',WAITING_FOR_APPROVAL:'รอยืนยัน',RUNNING:'กำลังทำ',VERIFYING:'กำลังตรวจ',RECOVERING:'กำลังกู้ต่อ',COMPLETED:'เสร็จ',FAILED:'ล้มเหลว',CANCELLED:'ยกเลิกแล้ว'})[String(state||'')]||String(state||'—');
}
function renderLiveTasks(control){
  cpControlData=control;
  const host=$('cp-live-tasks');if(!host)return;
  const tasks=Array.isArray(control?.tasks)?control.tasks:[];
  const active=tasks.filter(task=>!['COMPLETED','FAILED','CANCELLED'].includes(String(task?.state||''))).slice(0,8);
  host.replaceChildren();
  if($('cp-command-running'))$('cp-command-running').textContent=String(active.length);
  if(!active.length){empty(host,'ไม่มีงานที่กำลังทำหรือรออยู่');return;}
  for(const task of active){
    const detail=[task.projectName,task.lastEvent?.message,Number.isFinite(Number(task.progress))?Math.round(Number(task.progress))+'%':null].filter(Boolean).join(' · ');
    const item=row(task.goal||'งาน AWH',detail,taskStateLabel(task.state),task.state);
    if(task.canCancel===true){
      const actions=document.createElement('span');actions.className='cp-control-actions';
      actions.append(makeControlButton('ยกเลิก',()=>cancelTask(task.taskId),{tone:'warn',confirmText:'ยกเลิกงาน “'+String(task.goal||'งานนี้')+'” ใช่หรือไม่?',busyLabel:'กำลังยกเลิก…'}));
      item.append(actions);
    }
    host.append(item);
  }
}
function approvalLabel(action){
  return ({'deployment.approve':'อนุมัติการปล่อยรุ่น','project.revision.promote':'อนุมัติ Source revision'})[String(action||'')]||'อนุมัติการดำเนินการ';
}
function renderLiveApprovals(control){
  const host=$('cp-live-approvals');if(!host)return;
  const approvals=Array.isArray(control?.approvals)?control.approvals.filter(item=>item?.status==='PENDING'):[];
  const tasks=new Map((Array.isArray(control?.tasks)?control.tasks:[]).map(task=>[task.taskId,task]));
  host.replaceChildren();
  const systemAttention=document.querySelectorAll('#cp-attention .cp-row').length;
  if($('cp-command-attention-count'))$('cp-command-attention-count').textContent=String(systemAttention+approvals.length);
  if($('cp-command-attention-note'))$('cp-command-attention-note').textContent=(systemAttention+approvals.length)?(approvals.length?approvals.length+' รายการรอการตัดสินใจ':'เปิดดูและจัดการด้านล่าง'):'ไม่มีเรื่องเร่งด่วน';
  if(!approvals.length){empty(host,'ไม่มีรายการรออนุมัติ');return;}
  for(const approval of approvals.slice(0,8)){
    const task=tasks.get(approval.taskId);
    const item=row(task?.goal||approvalLabel(approval.action),'หมดอายุ '+date(approval.expiresAt),'รอยืนยัน','WAITING_FOR_APPROVAL');
    const actions=document.createElement('span');actions.className='cp-control-actions';
    actions.append(
      makeControlButton('อนุมัติ',()=>decideApproval(approval.approvalId,'approve'),{confirmText:'อนุมัติรายการนี้ใช่หรือไม่?',busyLabel:'กำลังอนุมัติ…'}),
      makeControlButton('ไม่อนุมัติ',()=>decideApproval(approval.approvalId,'reject'),{tone:'danger',confirmText:'ปฏิเสธรายการนี้ใช่หรือไม่?',busyLabel:'กำลังปฏิเสธ…'})
    );
    item.append(actions);host.append(item);
  }
}
function renderLiveSites(sitesData){
  cpSitesData=sitesData;
  const host=$('cp-live-sites');if(!host)return;
  const sites=Array.isArray(sitesData?.sites)?sitesData.sites:[];
  host.replaceChildren();
  if(!sites.length){empty(host,'ยังไม่มี Managed Site');return;}
  for(const site of sites.slice(0,8)){
    const detail=[site.url||site.domainHost,site.taskState?('งาน '+taskStateLabel(site.taskState)):null].filter(Boolean).join(' · ')||'Managed Hosting';
    const item=row(site.name||site.slug,detail,site.state||'UNKNOWN',site.state);
    const actions=document.createElement('span');actions.className='cp-control-actions';
    actions.append(makeControlButton('Deploy',()=>managedSiteAction(site.siteId,'deploy'),{confirmText:'Deploy เว็บไซต์ “'+String(site.name||site.slug)+'” ตอนนี้ใช่หรือไม่?',busyLabel:'กำลัง Deploy…'}));
    if(site.rollbackReleaseId)actions.append(makeControlButton('Rollback',()=>managedSiteAction(site.siteId,'rollback'),{tone:'warn',confirmText:'Rollback เว็บไซต์ “'+String(site.name||site.slug)+'” ไป release ก่อนหน้าใช่หรือไม่?',busyLabel:'กำลัง Rollback…'}));
    if(site.state!=='DISABLED')actions.append(makeControlButton('ปิด',()=>managedSiteAction(site.siteId,'disable'),{tone:'danger',confirmText:'ปิดเว็บไซต์ “'+String(site.name||site.slug)+'” ใช่หรือไม่? ผู้ใช้จะเข้าใช้งานไม่ได้จนกว่าจะ Deploy ใหม่',busyLabel:'กำลังปิด…'}));
    item.append(actions);host.append(item);
  }
}
function renderLiveDevices(control){
  const host=$('cp-live-devices');if(!host)return;
  const workers=Array.isArray(control?.workers)?control.workers:[];
  host.replaceChildren();
  if(!workers.length){empty(host,'ยังไม่มีอุปกรณ์ที่เชื่อมกับ AWH');return;}
  for(const worker of workers.slice(0,10)){
    const detail=[worker.platform,worker.appVersion?('Agent '+worker.appVersion):null,worker.lastSeenAt?('ล่าสุด '+date(worker.lastSeenAt)):null].filter(Boolean).join(' · ');
    const item=row(worker.displayName||'AWH Agent',detail,worker.state==='WORKING'?'กำลังทำงาน':worker.state==='READY'?'พร้อม':worker.state||'OFFLINE',worker.state);
    if(worker.state!=='WORKING'){
      const actions=document.createElement('span');actions.className='cp-control-actions';
      actions.append(makeControlButton('ยกเลิกการเชื่อมต่อ',()=>revokeDevice(worker.deviceId),{tone:'danger',confirmText:'ยกเลิกการเชื่อมต่อ “'+String(worker.displayName||'อุปกรณ์นี้')+'” ใช่หรือไม่? ต้องเชื่อมใหม่ก่อนใช้งานครั้งถัดไป',busyLabel:'กำลังยกเลิก…'}));
      item.append(actions);
    }
    host.append(item);
  }
}
function renderCoreReleaseControl(status){
  cpCoreRelease=status;
  const button=$('cp-core-release-button'),message=$('cp-core-release-state');if(!button||!message)return;
  const target=status?.sourcePromotion?.sha||null;
  const runtime=status?.runtimeProductionSha||null;
  const releases=Array.isArray(status?.releases)?status.releases:[];
  const active=releases.find(item=>!['COMPLETED','FAILED','CANCELLED'].includes(String(item?.taskState||'')));
  button.disabled=true;button.dataset.releaseSha='';
  if(active){
    button.textContent='AWH กำลังอัปเดต '+Math.max(0,Math.min(100,Number(active.progress||0)))+'%';
    message.textContent=active.resultSummary||'Release controller กำลังทำงาน';return;
  }
  if(!target){button.textContent='ยังไม่มีรุ่นพร้อมอัปเดต';message.textContent=status?.releaseBlocker||'ยังไม่พบ canonical release target';return;}
  if(runtime&&target===runtime){button.textContent='AWH เป็นรุ่นล่าสุด';message.textContent='Production ตรงกับ canonical '+shortSha(target);return;}
  if(status?.releaseDetailsReady===false){button.textContent='รุ่นนี้ยังปล่อยไม่ได้';message.textContent=status?.releaseBlocker||'Release details ยังไม่พร้อม';return;}
  button.disabled=false;button.dataset.releaseSha=target;button.textContent='อัปเดต AWH → '+shortSha(target);
  message.textContent='Production '+shortSha(runtime)+' · รุ่นพร้อม '+shortSha(target)+' · ใช้ Core Release authority เดิม';
}

function renderSites(sitesData){
  const sites=Array.isArray(sitesData?.sites)?sitesData.sites:[],ready=sites.filter(s=>s.state==='READY').length;
  $('cp-sites').textContent=sites.length?ready+'/'+sites.length+' เว็บไซต์พร้อม':'ยังไม่มี Managed Site';
  if($('cp-command-sites'))$('cp-command-sites').textContent=sites.length?ready+'/'+sites.length:'0';
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
      const actions=document.createElement('div');actions.className='cp-inline-actions';
      const role=document.createElement('select');role.className='cp-role-select';role.setAttribute('aria-label','บทบาทของ '+(person.displayName||person.username));
      for(const value of ['ADMIN','STAFF','VIEWER']){const option=document.createElement('option');option.value=value;option.textContent=personRoleLabel(value);option.selected=value===person.role;role.append(option);}
      const save=document.createElement('button');save.type='button';save.className='cp-mini-action';save.textContent='บันทึกสิทธิ์';
      save.addEventListener('click',async()=>{save.disabled=role.disabled=true;try{await updatePersonAccess(person.userId,role.value,Array.isArray(person.projectIds)?person.projectIds:[]);$('cp-person-message').textContent='เปลี่ยนสิทธิ์แล้ว ผู้ใช้นี้ต้องเข้าสู่ระบบใหม่';await loadPeopleAccess();}catch(error){$('cp-person-message').textContent=error instanceof Error?error.message:'ยังเปลี่ยนสิทธิ์ไม่ได้';save.disabled=role.disabled=false;}});
      const button=document.createElement('button');button.type='button';button.className='cp-mini-action';button.textContent='ปิดบัญชี';
      button.addEventListener('click',async()=>{if(!confirm('ปิดบัญชี “'+(person.displayName||person.username)+'” ใช่หรือไม่?'))return;button.disabled=role.disabled=save.disabled=true;try{await revokePerson(person.userId);await loadPeopleAccess();}catch(error){$('cp-person-message').textContent=error instanceof Error?error.message:'ยังปิดบัญชีไม่ได้';button.disabled=role.disabled=save.disabled=false;}});
      actions.append(role,save,button);item.append(actions);
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
  $('cp-core-release-button')?.addEventListener('click',async(event)=>{
    const button=event.currentTarget;
    const sha=button instanceof HTMLButtonElement?button.dataset.releaseSha||'':'';
    if(!/^[0-9a-f]{40}$/i.test(sha))return;
    if(!confirm('อัปเดต AWH Production เป็น '+shortSha(sha)+' ตอนนี้ใช่หรือไม่?'))return;
    button.disabled=true;const before=button.textContent;button.textContent='กำลังส่งคำขออัปเดต…';
    try{
      const result=await requestCoreRelease(sha,false);
      setControlMessage('ส่งคำขออัปเดต AWH แล้ว','good');
      if($('cp-core-release-state'))$('cp-core-release-state').textContent='Release controller รับงานแล้ว · '+taskStateLabel(result.state);
      await load();
    }catch(error){
      const message=error instanceof Error?error.message:'ยังเริ่มอัปเดต AWH ไม่ได้';
      setControlMessage(message,'bad');if($('cp-core-release-state'))$('cp-core-release-state').textContent=message;
      button.disabled=false;button.textContent=before;
    }
  });
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
    void loadUpdateSummary();
    const data=await loadInfrastructureCompat();
    renderServer(data);renderHealthMatrix(data);renderDomains(data);renderRecovery(data);renderServices(data);renderEcosystem(data);renderAgentControl(data);renderCommandCenter(data);
    $('cp-updated').textContent='ตรวจข้อมูลแล้ว · '+Math.max(1,Math.round(performance.now()-started))+' ms';
    void renderExternalCapabilities();

    Promise.allSettled([listManagedSites(),loadProviderStatus(),loadPeopleAccess(),loadControlData(),loadCoreReleaseStatus()]).then((secondary)=>{
      if(secondary[0].status==='fulfilled'){renderSites(secondary[0].value);renderLiveSites(secondary[0].value);}
      else if($('cp-live-sites'))empty($('cp-live-sites'),'ยังโหลด Managed Sites ไม่สำเร็จ');
      if(secondary[1].status==='fulfilled')renderProvider(secondary[1].value);
      if(secondary[3].status==='fulfilled'){renderLiveTasks(secondary[3].value);renderLiveApprovals(secondary[3].value);renderLiveDevices(secondary[3].value);}
      else{
        for(const id of ['cp-live-tasks','cp-live-approvals','cp-live-devices'])if($(id))empty($(id),'ยังโหลด Control Plane ไม่สำเร็จ');
      }
      if(secondary[4].status==='fulfilled')renderCoreReleaseControl(secondary[4].value);
      else if($('cp-core-release-state'))$('cp-core-release-state').textContent='ยังโหลดสถานะ Core Release ไม่สำเร็จ';
    });
  }catch(error){
    const overall=$('cp-overall');overall.className='cp-overall bad';overall.textContent='ศูนย์ดูแลระบบต้องตรวจ';
    attention('ยังโหลดศูนย์ดูแลระบบไม่ครบ',error instanceof Error?error.message:'Unknown error','CRITICAL');$('cp-updated').textContent='โหลดข้อมูลไม่สำเร็จ';
  }finally{if(refresh)refresh.disabled=false;}
}
installUi();void load();
