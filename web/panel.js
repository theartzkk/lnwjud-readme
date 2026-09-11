import { requireOwnerSession, loadInfrastructure, listManagedSites, loadProviderStatus, loadBayRemoteUpdateStatus, createBayRemoteInstallRelay, relayBayRemoteCommand } from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';

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
let bayControlState=null;
let bayActionBusy=false;
let bayPendingRelease=null;
let bayVerifiedRelease=null;
const pause=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const shortSha=(value)=>typeof value==='string'&&/^[0-9a-f]{40}$/i.test(value)?value.slice(0,9):'—';

function bayStep(key,state,note){
  const node=document.querySelector('[data-bay-step="'+key+'"]');if(!node)return;
  node.classList.remove('is-good','is-active','is-bad');
  if(state)node.classList.add('is-'+state);
  const noteNode=$('cp-bay-'+key+'-note');if(noteNode&&note)noteNode.textContent=note;
}
function bayMessage(text,state=''){
  const node=$('cp-bay-message');if(!node)return;
  node.className='cp-bay-message'+(state?' is-'+state:'');node.textContent=text;
}
function setBayOverall(text,state=''){
  const node=$('cp-bay-overall');if(!node)return;
  node.className='cp-bay-state'+(state?' is-'+state:'');node.textContent=text;
}
function setBayButton({disabled,label,note}){
  const button=$('cp-bay-update-button');if(!button)return;
  button.disabled=Boolean(disabled)||bayActionBusy;
  const strong=button.querySelector('strong'),small=button.querySelector('small');
  if(strong)strong.textContent=label;if(small)small.textContent=note;
}
function findBayPackage(production){
  const current=String(production?.currentVersion||'');
  const packages=Array.isArray(production?.packages)?production.packages:[];
  return packages.find(item=>item?.installable===true&&item?.fromVersion===current&&typeof item?.version==='string'&&typeof item?.sourceSha==='string'&&/^[0-9a-f]{40}$/i.test(item.sourceSha)&&/^[0-9a-f]{64}$/i.test(item?.packageSha256||''))||null;
}
function renderBayState(control,production,error=null){
  bayControlState={control,production,error};
  if(error||!production){
    const absent=error?.code==='BAY_BRIDGE_NOT_INSTALLED';
    $('cp-bay-current-version').textContent='ยังยืนยันไม่ได้';
    $('cp-bay-current-sha').textContent='รอสถานะจาก BAY';
    $('cp-bay-latest-version').textContent='—';
    $('cp-bay-latest-sha').textContent='รอข้อมูล Update Inbox';
    bayStep('source',control?'good':'bad',control?'AWH ลงนามคำขอแล้ว':'ยังลงนามคำขอไม่ได้');
    for(const step of ['package','backup','install','verify'])bayStep(step,'','ยังไม่ตรวจ');
    setBayOverall(absent?'ยังไม่มี bridge':'ยังยืนยันสถานะไม่ได้','warn');
    setBayButton({disabled:true,label:absent?'ติดตั้ง bridge ผ่าน Update Center':'รอยืนยันสถานะ BAY',note:'ยังไม่มีการติดตั้งหรือเปลี่ยนข้อมูล'});
    bayMessage(absent?'BAY ยืนยันว่าไม่มี bridge ให้ใช้แพ็กเกจที่ผ่านการตรวจจาก Update Center ตามรุ่น Production จริง':error instanceof Error?error.message:'ยังอ่านสถานะ BAY ไม่สำเร็จ กรุณาลองตรวจใหม่','warn');
    return;
  }

  const current=String(production.currentVersion||'—');
  const deployed=String(production.deployedSha||'');
  const pkg=findBayPackage(production);
  const targetVersion=pkg?.version||current;
  const targetSha=pkg?.sourceSha||deployed;
  const preflight=production?.preflight?.ready===true&&!production?.maintenance?.active;
  const sourceKnown=production?.deployedRepository==='theartzkk/bay-excuse-x'&&/^[0-9a-f]{40}$/i.test(deployed);
  if(bayPendingRelease&&current===bayPendingRelease.version&&deployed===bayPendingRelease.sha){
    bayVerifiedRelease=bayPendingRelease;bayPendingRelease=null;
  }
  const releaseVerified=Boolean(bayVerifiedRelease&&current===bayVerifiedRelease.version&&deployed===bayVerifiedRelease.sha);
  const releasePending=Boolean(bayPendingRelease&&!releaseVerified);

  $('cp-bay-current-version').textContent=current;
  $('cp-bay-current-sha').textContent=deployed?'Production · '+shortSha(deployed):'Production baseline';
  $('cp-bay-latest-version').textContent=targetVersion;
  $('cp-bay-latest-sha').textContent=targetSha?(pkg?'Verified Inbox · ':'Production · ')+shortSha(targetSha):'Update Inbox';

  bayStep('source',sourceKnown?'good':'bad',sourceKnown?'Exact source known':'Source ไม่ครบ');
  bayStep('package',pkg?'good':'',pkg?'Inbox + checksum ผ่าน':'ยังไม่มีแพ็กเกจที่ติดตั้งได้');
  bayStep('backup',preflight?'good':'bad',preflight?'พร้อมสร้างอัตโนมัติ':production?.maintenance?.active?'Maintenance Lock':'Preflight ไม่ผ่าน');
  bayStep('install',releaseVerified?'good':pkg?'':'good',releaseVerified?'ติดตั้งแล้ว':pkg?'PackageManager':'รุ่นปัจจุบัน');
  bayStep('verify',releaseVerified?'good':'',releaseVerified?'exact SHA':'รอ Post-check การติดตั้ง');

  if(!sourceKnown){
    setBayOverall('Source ต้องตรวจ','bad');
    setBayButton({disabled:true,label:'ยังอัปเดตไม่ได้',note:'Production source lineage ไม่สมบูรณ์'});
    bayMessage('BAY ปฏิเสธการอัปเดตจนกว่าจะยืนยัน source lineage ได้','bad');return;
  }
  if(releasePending){
    bayStep('package','good','คำสั่งถูกส่งแล้ว');
    bayStep('backup','active','BAY กำลังดำเนินการ');
    bayStep('install','active','ห้ามส่งซ้ำ');
    bayStep('verify','active','ติดตาม STATUS เท่านั้น');
    setBayOverall('กำลังรอยืนยันผล','warn');
    setBayButton({disabled:true,label:'กำลังติดตาม BAY',note:'ไม่ส่ง INSTALL ซ้ำจนกว่าจะทราบผล'});
    bayMessage('คำสั่ง INSTALL ถูกส่งแล้ว แต่ผลสุดท้ายยังไม่ยืนยัน AWH จะอ่าน STATUS ต่อเท่านั้นเพื่อป้องกันการติดตั้งซ้ำ','warn');return;
  }
  if(!preflight){
    setBayOverall('Production ต้องตรวจ','bad');
    setBayButton({disabled:true,label:'Production ยังไม่พร้อมอัปเดต',note:production?.maintenance?.active?'มี Maintenance Lock':'Preflight ไม่ผ่าน'});
    bayMessage('BAY safety preflight ยังไม่พร้อม จึงไม่อนุญาตให้ติดตั้ง','bad');return;
  }
  if(!pkg){
    if(releaseVerified){
      setBayOverall('ยืนยันแล้ว','');
      setBayButton({disabled:true,label:'BAY '+current,note:'ติดตั้งและยืนยัน exact SHA แล้ว'});
      bayMessage('✅ BAY Production ติดตั้งสำเร็จและยืนยัน exact SHA แล้ว','good');return;
    }
    setBayOverall('ยังไม่มีแพ็กเกจใหม่','');
    setBayButton({disabled:true,label:'BAY '+current,note:'ไม่มีแพ็กเกจใหม่ที่ผ่าน Update Inbox'});
    bayMessage('อ่านรุ่นที่ติดตั้งได้แล้ว · ยังไม่มีแพ็กเกจที่ติดตั้งได้ใน Update Inbox สถานะนี้ไม่ได้ยืนยันว่าเท่ากับ Source ล่าสุด');return;
  }
  setBayOverall('พร้อมอัปเดต','');
  setBayButton({disabled:false,label:'อัปเดตเป็น '+pkg.version,note:'Backup → Install → Verify อัตโนมัติ'});
  bayMessage('พร้อมแล้ว · แพ็กเกจผ่าน CI, checksum และ lineage ของ BAY Update Inbox แล้ว');
}

async function loadBayControl(){
  try{
    setBayOverall('กำลังตรวจ','loading');
    const control=await loadBayRemoteUpdateStatus();
    let production=null,error=null;
    try{production=await relayBayRemoteCommand(control.endpoint,control.statusRelay);}catch(err){error=err;}
    renderBayState(control,production,error);return bayControlState;
  }catch(error){
    renderBayState(null,null,error);setBayOverall('โหลดไม่สำเร็จ','bad');
    bayMessage(error instanceof Error?error.message:'โหลด BAY Remote Update ไม่สำเร็จ','bad');return bayControlState;
  }
}

async function updateBayProduction(){
  if(bayActionBusy)return;
  bayActionBusy=true;
  try{
    let state=await loadBayControl();
    if(!state?.control||!state?.production)throw new Error('ยังอ่านสถานะ BAY ไม่สำเร็จ จึงไม่เริ่มอัปเดต');
    let pkg=findBayPackage(state.production);
    if(!pkg){
      setBayOverall('กำลังรอ CI','warn');bayStep('package','active','Auto-stage');
      bayMessage('กำลังรอ GitHub CI ส่ง release ที่ตรวจแล้วเข้า BAY Update Inbox…','warn');
      for(let i=0;i<24&&!pkg;i++){
        await pause(5000);
        state=await loadBayControl();
        pkg=findBayPackage(state?.production);
      }
      if(!pkg)throw new Error('ยังไม่มีแพ็กเกจใหม่ใน BAY Update Inbox');
    }

    const expectedVersion=pkg.version,expectedSha=pkg.sourceSha;
    bayStep('backup','active','กำลังสร้าง');
    bayStep('install','active','PackageManager');
    bayStep('verify','','รอ Post-check');
    setBayOverall('กำลังอัปเดต','warn');
    bayMessage('BAY กำลัง Backup → Install → Migration → Smoke Test โปรดเปิดหน้านี้ไว้จนเสร็จ','warn');

    const relay=await createBayRemoteInstallRelay({targetVersion:expectedVersion,targetSha:expectedSha,packageSha256:pkg.packageSha256});
    bayPendingRelease={version:expectedVersion,sha:expectedSha};
    let result=null;
    try{
      result=await relayBayRemoteCommand(relay.endpoint,relay.relay);
      if(!['INSTALLED','CURRENT'].includes(result.state))throw new Error('BAY ไม่ยืนยันผลการติดตั้ง');
    }catch(error){
      if(error?.code!=='BAY_INSTALL_OUTCOME_UNKNOWN'){bayPendingRelease=null;throw error;}
      setBayOverall('คำสั่งถูกส่งแล้ว','warn');
      bayMessage(error.message,'warn');
    }

    bayStep('backup',result?.backup?'good':'active',result?.backup?'สร้างแล้ว':'รอ STATUS');
    bayStep('install',result?'good':'active',result?'ติดตั้งแล้ว':'ผลยังไม่ยืนยัน');
    bayStep('verify','active','กำลังยืนยัน exact SHA');
    let confirmed=false;
    for(let i=0;i<36&&!confirmed;i++){
      await pause(i===0?1200:5000);
      state=await loadBayControl();
      confirmed=state?.production?.currentVersion===expectedVersion&&state?.production?.deployedSha===expectedSha;
      if(!confirmed){
        bayStep('verify','active','ติดตาม STATUS '+(i+1)+'/36');
        setBayOverall('กำลังรอยืนยันผล','warn');
        bayMessage('INSTALL อาจยังทำงานอยู่ AWH จะไม่ส่งคำสั่งซ้ำและกำลังติดตามสถานะจาก BAY','warn');
      }
    }
    if(!confirmed){
      setBayOverall('ยังยืนยันผลไม่ได้','warn');
      setBayButton({disabled:true,label:'ห้ามส่ง INSTALL ซ้ำ',note:'ตรวจสถานะใน BAY Update Center ก่อนดำเนินการต่อ'});
      bayMessage('ยังไม่พบ exact SHA ที่คาดไว้หลังติดตามสถานะ คำสั่งเดิมอาจยังทำงานอยู่ จึงหยุดโดยไม่ส่ง INSTALL ซ้ำ','warn');return;
    }
    bayVerifiedRelease={version:expectedVersion,sha:expectedSha};bayPendingRelease=null;
    bayStep('backup','good',result?.backup?'สร้างแล้ว':'BAY ยืนยันสถานะแล้ว');
    bayStep('install','good','ติดตั้งแล้ว');
    bayStep('verify','good','exact SHA');
    setBayOverall('สำเร็จ','');
    bayMessage('✅ อัปเดต BAY Production สำเร็จและยืนยัน exact SHA แล้ว','good');
  }catch(error){
    setBayOverall('หยุดอย่างปลอดภัย','bad');
    bayMessage(error instanceof Error?error.message:'BAY Remote Update ไม่สำเร็จ','bad');
  }finally{
    bayActionBusy=false;
    await loadBayControl();
  }
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
  $('cp-bay-recheck')?.addEventListener('click',()=>void loadBayControl());
  $('cp-bay-update-button')?.addEventListener('click',()=>void updateBayProduction());
}
async function load(){
  const refresh=$('cp-refresh');if(refresh)refresh.disabled=true;
  $('cp-attention')?.replaceChildren();if($('cp-attention-wrap'))$('cp-attention-wrap').hidden=true;
  $('cp-updated').textContent='กำลังโหลดข้อมูลสำคัญ…';
  const started=performance.now();
  try{
    const session=await requireOwnerSession();
    if(!session){location.assign('./');return;}
    const data=await loadInfrastructure();
    renderServer(data);renderDomains(data);renderRecovery(data);renderServices(data);renderEcosystem(data);
    $('cp-updated').textContent='ตรวจข้อมูลแล้ว · '+Math.max(1,Math.round(performance.now()-started))+' ms';
    void loadBayControl();

    Promise.allSettled([listManagedSites(),loadProviderStatus()]).then((secondary)=>{
      if(secondary[0].status==='fulfilled')renderSites(secondary[0].value);
      if(secondary[1].status==='fulfilled')renderProvider(secondary[1].value);
    });
  }catch(error){
    const overall=$('cp-overall');overall.className='cp-overall bad';overall.textContent='Control Panel ต้องตรวจ';
    attention('ยังโหลด Control Panel ไม่ครบ',error instanceof Error?error.message:'Unknown error','CRITICAL');$('cp-updated').textContent='โหลดข้อมูลไม่สำเร็จ';
  }finally{if(refresh)refresh.disabled=false;}
}
installUi();void load();
