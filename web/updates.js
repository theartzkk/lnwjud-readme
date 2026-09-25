import {
  createBayRemoteInstallRelay, decideApproval, loadAuthSession, loadBayRemoteUpdateStatus, loadUpdateCenter,
  managedSiteAction, relayBayRemoteCommand, requestAssessmentRelease, requestCoreRelease, stepUp,
} from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';

const $=(id)=>document.getElementById(id);
let center=null;
let bayLive=null;
let refreshing=false;
let stepUpResolver=null;
let confirmResolver=null;
let attentionOnly=false;
let refreshTimer=null;
let localOperation=null;
let filterMode='ALL';
let searchTerm='';
let staticMetadata=null;

const stateLabel=(state)=>({
  CURRENT:'ล่าสุดแล้ว',UPDATE_AVAILABLE:'พร้อมอัปเดต',WAITING_FOR_APPROVAL:'รอยืนยัน',UPDATING:'กำลังอัปเดต',
  BLOCKED:'ต้องตรวจสอบ',SOURCE_READY:'Source พร้อม',REMOTE_CHECK_REQUIRED:'กำลังตรวจ',
  DELEGATED:'จัดการผ่านระบบเดิม',INTERNAL_MANAGED:'จัดการภายใน',UNREGISTERED:'ยังไม่ลงทะเบียน',
  BASELINE_REQUIRED:'ต้องผูก Production',MIGRATION_REQUIRED:'ต้องย้ายระบบ Deploy',
})[state]||state||'กำลังตรวจ';

const adapterLabel=(value)=>({
  CORE_RELEASE:'AWH Core Release',MANAGED_HOSTING:'Managed Hosting',BAY_UPDATE_CENTER:'BAY Update Center',
  LEARNLAB_RELEASE:'LearnLab Release',ASSESSMENT_RELEASE:'Assessment Release',LEGACY_DEPLOY:'Legacy deploy',
  SOURCE_ONLY:'Source only',UNREGISTERED:'ยังไม่ลงทะเบียน',AGENT_MANAGED:'AWH Agent',
})[value]||value||'—';
const activityLabel=(value)=>({
  ONLINE:'ออนไลน์',BUSY:'กำลังทำงาน',STALE:'ข้อมูลเก่า',OFFLINE:'ออฟไลน์',IDLE:'พร้อม',
})[String(value||'').toUpperCase()]||value||'ไม่ทราบสถานะ';

const hash=(value)=>typeof value==='string'&&/^[0-9a-f]{40}$/i.test(value);
const short=(value)=>hash(value)?value.slice(0,12):value||'—';
const message=(text)=>{$('updates-message').textContent=text;};

const friendly=(error)=>{
  const code=String(error?.code||'').toUpperCase();
  return ({
    STEP_UP_REQUIRED:'ต้องยืนยันสิทธิ์เจ้าของระบบก่อนติดตั้ง',
    STEP_UP_CANCELLED:'ยกเลิกการยืนยันสิทธิ์แล้ว',
    CORE_RELEASE_CONFLICT:'มีการอัปเดต AWH อื่นกำลังทำอยู่ ระบบจะไม่สร้างงานซ้ำ',
    CORE_RELEASE_TARGET_MOVED:'มีรุ่นใหม่กว่าเข้ามาแล้ว ระบบยกเลิกรุ่นเก่าอย่างปลอดภัย กรุณาตรวจอีกครั้ง',
    LEARNLAB_RELEASE_TARGET_MOVED:'LearnLab มีรุ่นใหม่กว่าเข้ามาแล้ว กรุณาตรวจอีกครั้ง',
    ASSESSMENT_RELEASE_CONFLICT:'มีการอัปเดต Assessment อื่นกำลังทำอยู่ ระบบจะไม่สร้างงานซ้ำ',
    ASSESSMENT_RELEASE_TARGET_MOVED:'Assessment มี candidate ใหม่กว่า ระบบหยุดรุ่นเก่าอย่างปลอดภัย',
    ASSESSMENT_RELEASE_NOT_READY:'Assessment ยังไม่พร้อมอัปเดต',
    PROJECT_SOURCE_NOT_READY:'Source ของระบบนี้ยังไม่พร้อมติดตั้ง',
    BAY_UPDATE_NOT_GREEN:'BAY รุ่นล่าสุดยังไม่ผ่านการตรวจ release',
    BAY_UPDATE_TARGET_MOVED:'BAY มีรุ่นใหม่กว่าเข้ามาก่อนติดตั้ง กรุณาตรวจอีกครั้ง',
    BAY_INSTALL_OUTCOME_UNKNOWN:'การเชื่อมต่อขาดหลังส่งคำสั่ง ระบบจะตรวจสถานะก่อนและจะไม่ติดตั้งซ้ำ',
    BAY_TRANSPORT_UNAVAILABLE:'ยังติดต่อ BAY Update Center ไม่ได้',
    BAY_COMMAND_REJECTED:'BAY ปฏิเสธคำขออย่างปลอดภัย กรุณาตรวจสถานะ',
  })[code]||error?.message||'ยังทำรายการนี้ไม่ได้';
};

function itemNeedsAttention(item){
  return item.state!=='CURRENT'&&item.state!=='INTERNAL_MANAGED';
}
function applyStaticMetadata(){
  if(!center||!staticMetadata)return;
  if(!Array.isArray(center.roadmap)||center.roadmap.length===0)center.roadmap=Array.isArray(staticMetadata.comingNext)?staticMetadata.comingNext:[];
  if(!Array.isArray(center.history)||center.history.length===0)center.history=Array.isArray(staticMetadata.history)?staticMetadata.history:[];
  const awh=(center.items||[]).find((item)=>item.key==='awh-core'||item.adapter==='CORE_RELEASE');
  if(awh){
    if(!awh.releaseNotes&&staticMetadata.releaseNotes)awh.releaseNotes=staticMetadata.releaseNotes;
    if((!Array.isArray(awh.knownIssues)||awh.knownIssues.length===0)&&Array.isArray(staticMetadata.knownIssues))awh.knownIssues=staticMetadata.knownIssues;
  }
}
async function loadStaticMetadata(){
  if(staticMetadata)return staticMetadata;
  try{
    const response=await fetch('./update-center-metadata.json',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)return null;
    const data=await response.json();
    if(data?.schemaVersion!==1)return null;
    staticMetadata=data;return data;
  }catch{return null;}
}
function runtimeState(){
  if(center?.runtime?.state)return center.runtime.state;
  const awh=(center?.items||[]).find((item)=>item.key==='awh-core');
  return awh?.runtimeState||'UNKNOWN';
}

function renderRuntimeHealth(){
  const state=runtimeState();
  const host=$('runtime-health');
  host.dataset.state=state;
  if(state==='COHERENT'){
    $('runtime-health-title').textContent='Runtime สอดคล้องกัน';
    $('runtime-health-detail').textContent='Control, Web และ Enrollment อยู่ใน release lineage เดียวกัน';
  }else if(state==='SPLIT'){
    $('runtime-health-title').textContent='พบส่วนระบบอยู่คนละรุ่น';
    $('runtime-health-detail').textContent='AWH ตรวจพบ split-version และจะ reconcile ผ่าน release controller โดยไม่ให้ผู้ใช้จัดการ component เอง';
  }else{
    $('runtime-health-title').textContent='กำลังตรวจรายละเอียดรุ่น';
    $('runtime-health-detail').textContent='ระบบยังใช้งานได้ตามปกติ และจะอัปเดตรายละเอียดรุ่นให้อัตโนมัติเมื่อข้อมูลพร้อม';
  }
}

const pct=(value)=>typeof value==='number'&&Number.isFinite(value)?Math.round(value*10)/10:null;
const sizeText=(bytes)=>{
  if(!Number.isFinite(bytes)||bytes<0)return '—';
  const gib=bytes/(1024**3);
  return (gib>=10?gib.toFixed(0):gib.toFixed(1))+' GB';
};
function runnerWorker(){
  const desired=String(center?.infrastructure?.releaseRunner?.desiredName||'awh-build-01').toLowerCase();
  const agent=(center?.items||[]).find((item)=>item.adapter==='AGENT_MANAGED');
  const workers=Array.isArray(agent?.devices)?agent.devices:[];
  return workers.find((worker)=>{
    const text=[worker?.displayName,worker?.name,worker?.deviceName,worker?.executorId,worker?.deviceId].filter(Boolean).join(' ').toLowerCase();
    return text.includes(desired)||text.includes('release runner')||text.includes('build runner');
  })||null;
}
function renderReleaseInfrastructure(){
  const chip=$('release-infrastructure-state');
  if(!chip)return;
  const telemetry=center?.infrastructure?.telemetry;
  const server=telemetry?.server;
  const storage=server?.storage;
  const memory=server?.memory;
  const cpu=server?.cpu;
  const telemetryReady=telemetry?.state==='READY'&&server;
  const used=pct(storage?.usedPercent);
  const free=Number(storage?.availableBytes??storage?.freeBytes);
  const storageBlocked=(used!==null&&used>=90)||(Number.isFinite(free)&&free<3*1024**3);
  const storageWarn=!storageBlocked&&used!==null&&used>=80;
  const authority=center?.infrastructure?.executionAuthority||{};
  const activeMutations=Number(authority.activeMutationCount||0);
  const waitingMutations=Number(authority.waitingMutationCount||0);
  const runner=runnerWorker();
  const runnerOnline=runner&&['ONLINE','IDLE','BUSY','READY'].includes(String(runner.activity||runner.state||'').toUpperCase());

  $('production-vps-name').textContent=server?.host?.name||'bay-core-01';
  $('production-vps-state').textContent=telemetryReady?'Production telemetry สดและอ่านจาก authority กลาง':telemetry?.state==='STALE'?'Telemetry เก่า — ยังไม่ใช้เป็นหลักฐานปล่อยรุ่น':'ยังยืนยัน Production telemetry ไม่ได้';
  $('production-storage').textContent='Disk '+(used===null?'—':used+'%')+(Number.isFinite(free)?' · เหลือ '+sizeText(free):'');
  $('production-memory').textContent='RAM '+(pct(memory?.usedPercent)===null?'—':pct(memory?.usedPercent)+'%');
  $('production-cpu').textContent='CPU '+(pct(cpu?.usedPercent)===null?'—':pct(cpu?.usedPercent)+'%');
  const productionCard=document.querySelector('.infrastructure-card[data-role="production"]');
  productionCard.dataset.state=telemetryReady?(storageBlocked?'BLOCKED':storageWarn?'WARN':'READY'):'UNKNOWN';

  if(runner){
    $('release-runner-name').textContent=runner.displayName||runner.name||'awh-build-01';
    $('release-runner-state').textContent=runnerOnline?'เชื่อมแล้ว — พร้อมรับงาน Build/QA ตาม capability ที่ลงทะเบียน':'ลงทะเบียนแล้วแต่ยังไม่พร้อมรับงาน';
    $('release-runner-platform').textContent=[runner.platform,runner.arch].filter(Boolean).join('/')||'Runner';
    $('release-runner-activity').textContent='สถานะ '+activityLabel(runner.activity||runner.state);
  }else{
    $('release-runner-name').textContent='awh-build-01';
    $('release-runner-state').textContent='ยังไม่ได้เชื่อม — Production ยังรับ Build/QA ชั่วคราวจนกว่าจะเพิ่ม Runner';
    $('release-runner-platform').textContent='เป้าหมาย Linux x64 · 4 vCPU / 8 GB / 80–100 GB';
    $('release-runner-activity').textContent='สถานะ แผนขยายระบบ';
  }
  document.querySelector('.infrastructure-card[data-role="runner"]').dataset.state=runnerOnline?'READY':runner?'WARN':'PLANNED';

  const releaseReady=telemetryReady&&!storageBlocked&&activeMutations===0;
  $('release-capacity-state').textContent=storageBlocked
    ?'พื้นที่ Production ต่ำกว่า release headroom — ห้ามเริ่มงานหนักจนกว่าจะ reclaim หรือย้าย Build/QA ออก'
    :activeMutations>0
      ?'มี mutation กำลังทำงาน ระบบจะ serialize deploy และไม่เปิด writer ซ้ำ'
      :storageWarn
        ?'ปล่อยรุ่นได้แบบระวัง แต่ควรย้าย Build/QA ไป Release Runner เพื่อลด disk pressure'
        :'พร้อมรับ release ตาม exact-SHA และ single-writer policy';
  $('release-capacity-storage').textContent='Headroom '+(Number.isFinite(free)?sizeText(free):'—');
  $('release-capacity-mutations').textContent='Writer '+activeMutations+(waitingMutations>0?' · รอ '+waitingMutations:'');
  document.querySelector('.infrastructure-card[data-role="release"]').dataset.state=storageBlocked?'BLOCKED':releaseReady?'READY':'WARN';

  chip.dataset.state=storageBlocked?'BLOCKED':(!telemetryReady||storageWarn||!runnerOnline?'WARN':'READY');
  chip.textContent=storageBlocked?'ยังไม่พร้อมปล่อยรุ่น':(!telemetryReady?'กำลังยืนยัน Infrastructure':(!runnerOnline?'Production พร้อม · Runner ยังไม่เชื่อม':storageWarn?'พร้อมแบบมีคำเตือน':'พร้อม'));
}

function summary(){
  const counts={current:0,update:0,progress:0,attention:0};
  for(const item of center?.items||[]){
    if(['CURRENT','INTERNAL_MANAGED'].includes(item.state))counts.current++;
    else if(item.state==='UPDATE_AVAILABLE')counts.update++;
    else if(['WAITING_FOR_APPROVAL','UPDATING'].includes(item.state))counts.progress++;
    else counts.attention++;
  }
  $('summary-current').textContent=String(counts.current);
  $('summary-update').textContent=String(counts.update);
  $('summary-progress').textContent=String(counts.progress);
  $('summary-attention').textContent=String(counts.attention);
  const actionable=(center?.items||[]).some((item)=>item.actionable===true||item.state==='WAITING_FOR_APPROVAL');
  $('update-all').disabled=!actionable||refreshing;
  const overall=$('updates-overall');
  if(runtimeState()==='SPLIT'){
    overall.textContent='ต้องปรับ Runtime ให้ตรงกัน';overall.dataset.tone='warn';
  }else if(counts.progress>0){
    overall.textContent='กำลังดำเนินการ';overall.dataset.tone='warn';
  }else if(counts.update>0){
    overall.textContent=counts.update+' รายการพร้อมอัปเดต';overall.dataset.tone='good';
  }else if(counts.attention>0){
    overall.textContent='มีรายการต้องตรวจ';overall.dataset.tone='warn';
  }else{
    overall.textContent='ระบบเป็นปัจจุบัน';overall.dataset.tone='good';
  }
}

function releaseText(item){
  if(item.current&&item.candidate&&!hash(item.current)&&!hash(item.candidate)&&item.current!==item.candidate)return item.current+' → '+item.candidate;
  if(item.state==='CURRENT'&&item.current&&!hash(item.current))return 'รุ่น '+item.current;
  if(item.state==='UPDATE_AVAILABLE')return 'มีรุ่นใหม่พร้อมติดตั้ง';
  if(item.state==='UPDATING')return 'ระบบกำลังติดตั้งและตรวจสอบ';
  if(item.state==='WAITING_FOR_APPROVAL')return 'พร้อมติดตั้งหลังยืนยัน';
  return '';
}

function meta(...values){
  const host=document.createElement('div');host.className='update-meta';
  for(const value of values.filter(Boolean)){const span=document.createElement('span');span.textContent=value;host.append(span);}
  return host;
}
function technicalDetails(item){
  const details=document.createElement('details');details.className='update-technical';
  const summary=document.createElement('summary');summary.textContent='รายละเอียดทางเทคนิค';
  const values=[adapterLabel(item.adapter),item.current?'current '+short(item.current):null,item.candidate?'candidate '+short(item.candidate):null];
  if(item.runtimeState)values.push('runtime '+item.runtimeState);
  if(item.rollbackReleaseId)values.push('rollback '+item.rollbackReleaseId);
  details.append(summary,meta(...values));
  if(item.runtimeComponents&&typeof item.runtimeComponents==='object'){
    const componentValues=Object.entries(item.runtimeComponents).map(([key,value])=>value?key+' '+String(value):null);
    details.append(meta(...componentValues));
  }
  return details;
}

function actionButton(text,handler,className='primary-button'){
  const button=document.createElement('button');button.type='button';button.className=className;button.textContent=text;
  button.addEventListener('click',async()=>{
    button.disabled=true;
    try{await handler();}
    catch(error){message(friendly(error));}
    finally{button.disabled=false;}
  });
  return button;
}


const noteGroups=[
  ['features','ฟังก์ชันใหม่','✨'],
  ['improvements','ปรับปรุง','⚡'],
  ['fixes','แก้ปัญหา','🔧'],
  ['internal','ระบบภายใน','🛡️'],
];

function releaseNoteCount(notes){
  const summary=notes?.summary||{};
  return noteGroups.reduce((total,[key])=>total+(Array.isArray(summary[key])?summary[key].length:0),0);
}

function renderReleaseNotes(item,host){
  const notes=item?.releaseNotes;
  if(!notes||typeof notes!=='object')return;
  const count=releaseNoteCount(notes);
  const issues=Array.isArray(item.knownIssues)?item.knownIssues:(Array.isArray(notes.knownIssues)?notes.knownIssues:[]);
  if(count===0&&issues.length===0&&notes?.source==='ROADMAP_FALLBACK')return;
  const details=document.createElement('details');details.className='release-notes';
  if(['UPDATE_AVAILABLE','WAITING_FOR_APPROVAL'].includes(item.state))details.open=true;
  const summaryEl=document.createElement('summary');
  summaryEl.textContent=count>0?'มีอะไรเปลี่ยนในรุ่นนี้ · '+count+' รายการ':'รายละเอียดรุ่นนี้';
  details.append(summaryEl);
  const body=document.createElement('div');body.className='release-notes-body';
  for(const [key,label,icon] of noteGroups){
    const rows=Array.isArray(notes?.summary?.[key])?notes.summary[key]:[];
    if(!rows.length)continue;
    const group=document.createElement('section');group.className='release-note-group';
    const h=document.createElement('h4');h.textContent=icon+' '+label;
    const ul=document.createElement('ul');
    for(const row of rows){const li=document.createElement('li');li.textContent=String(row);ul.append(li);}
    group.append(h,ul);body.append(group);
  }
  const impact=notes?.impact;
  if(impact&&typeof impact==='object'){
    const box=document.createElement('section');box.className='release-impact';
    const h=document.createElement('h4');h.textContent='ผลกระทบก่อนอัปเดต';
    const chips=[];
    chips.push(impact.plannedDowntime===false?'ไม่มี downtime ที่วางแผนไว้':'ตรวจช่วงหยุดบริการ');
    if(impact.databaseMigration==='AUTOMATIC')chips.push('ย้ายฐานข้อมูลให้อัตโนมัติ');
    if(impact.serviceReload==='AUTOMATIC')chips.push('Reload service ให้อัตโนมัติ');
    if(impact.appRestart==='MAY_BE_REQUIRED')chips.push('AWH Agent อาจต้องเปิดใหม่');
    if(impact.signIn==='MAY_BE_REQUIRED')chips.push('อาจต้องลงชื่อเข้าใช้อีกครั้ง');
    const row=document.createElement('div');row.className='impact-chips';
    for(const text of chips){const span=document.createElement('span');span.textContent=text;row.append(span);}
    box.append(h,row);body.append(box);
  }
  if(issues.length){
    const box=document.createElement('section');box.className='known-issues';
    const h=document.createElement('h4');h.textContent='สิ่งที่ควรรู้';
    const ul=document.createElement('ul');
    for(const value of issues){const li=document.createElement('li');li.textContent=String(value);ul.append(li);}
    box.append(h,ul);body.append(box);
  }
  if(Number(notes.changedFileCount)>0){
    const small=document.createElement('p');small.className='release-note-foot';
    small.textContent='สรุปจาก exact source '+Number(notes.changedFileCount)+' ไฟล์ · รายละเอียด commit อยู่ใน Diagnostics';
    body.append(small);
  }
  details.append(body);host.append(details);
}

function itemVisible(item){
  if(attentionOnly&&!itemNeedsAttention(item))return false;
  if(searchTerm){
    const hay=[item.name,item.kind,item.adapter,item.reason].filter(Boolean).join(' ').toLocaleLowerCase('th');
    if(!hay.includes(searchTerm))return false;
  }
  if(filterMode==='UPDATE'&&!['UPDATE_AVAILABLE','WAITING_FOR_APPROVAL'].includes(item.state))return false;
  if(filterMode==='PROGRESS'&&!['UPDATING','WAITING_FOR_APPROVAL'].includes(item.state))return false;
  if(filterMode==='ATTENTION'&&!itemNeedsAttention(item))return false;
  return true;
}

function renderRoadmap(){
  const host=$('coming-next-list');if(!host)return;
  host.replaceChildren();
  const rows=Array.isArray(center?.roadmap)?center.roadmap:[];
  if(!rows.length){const empty=document.createElement('div');empty.className='update-empty';empty.textContent='ยังไม่มีแผนรุ่นถัดไปที่ประกาศ';host.append(empty);return;}
  const statusLabel={PLANNED:'วางแผน',IN_PROGRESS:'กำลังพัฒนา',REVIEW:'กำลังตรวจ'};
  for(const row of rows){
    const card=document.createElement('article');card.className='roadmap-card';
    const head=document.createElement('div');head.className='roadmap-head';
    const h=document.createElement('h3');h.textContent=row.title||'รุ่นถัดไป';
    const chip=document.createElement('span');chip.className='roadmap-status';chip.dataset.state=String(row.status||'PLANNED');chip.textContent=statusLabel[row.status]||'วางแผน';
    head.append(h,chip);card.append(head);
    if(Array.isArray(row.items)&&row.items.length){const ul=document.createElement('ul');for(const value of row.items){const li=document.createElement('li');li.textContent=String(value);ul.append(li);}card.append(ul);}
    host.append(card);
  }
}

function renderHistory(){
  const host=$('release-history-list');if(!host)return;
  host.replaceChildren();
  const rows=Array.isArray(center?.history)?center.history:[];
  if(!rows.length){const empty=document.createElement('div');empty.className='update-empty';empty.textContent='ยังไม่มีประวัติที่แสดงได้';host.append(empty);return;}
  const state={COMPLETED:'ติดตั้งสำเร็จ',FAILED:'ไม่สำเร็จ',CANCELLED:'ถูกแทน/ยกเลิก'};
  for(const row of rows){
    const item=document.createElement('article');item.className='history-row';item.dataset.state=String(row.state||'');
    const dot=document.createElement('span');dot.className='history-dot';
    const copy=document.createElement('div');const strong=document.createElement('strong');strong.textContent=state[row.state]||String(row.state||'ประวัติ');
    const meta=document.createElement('span');
    const date=row.updatedAt?new Date(row.updatedAt).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'}):'';
    meta.textContent=[row.releaseSha?short(row.releaseSha):null,date].filter(Boolean).join(' · ');
    copy.append(strong,meta);
    if(row.resultSummary){const p=document.createElement('p');p.textContent=String(row.resultSummary);copy.append(p);}
    item.append(dot,copy);host.append(item);
  }
}

function renderDevices(item,host){
  if(!Array.isArray(item.devices)||item.devices.length===0)return;
  const online=item.devices.filter((device)=>['ONLINE','IDLE','BUSY'].includes(String(device.activity||'').toUpperCase())).length;
  const details=document.createElement('details');details.className='device-summary';
  const summary=document.createElement('summary');summary.textContent='อุปกรณ์ '+online+'/'+item.devices.length+' ออนไลน์';
  const list=document.createElement('div');list.className='device-list';
  for(const device of item.devices){
    const row=document.createElement('div');row.className='device-row';
    const name=document.createElement('span');name.textContent=device.displayName+' · '+device.platform+'/'+device.arch;
    const status=document.createElement('span');status.textContent=(device.appVersion||'ไม่ทราบรุ่น')+' · '+activityLabel(device.activity);
    row.append(name,status);list.append(row);
  }
  details.append(summary,list);host.append(details);
}

function renderCard(item){
  const card=document.createElement('article');card.className='update-card';card.dataset.key=item.key;
  card.dataset.attention=String(itemNeedsAttention(item));

  const main=document.createElement('div');main.className='update-card-main';
  const title=document.createElement('div');title.className='update-title';
  const h3=document.createElement('h3');h3.textContent=item.name;
  const chip=document.createElement('span');chip.className='update-chip';chip.dataset.state=item.state;chip.textContent=stateLabel(item.state);
  title.append(h3,chip);main.append(title);
  const version=releaseText(item);
  if(version){const line=document.createElement('div');line.className='update-version';line.textContent=version;main.append(line);}
  const reason=document.createElement('p');reason.className='update-reason';reason.textContent=item.reason||'กำลังตรวจ';main.append(reason);
  if(item.runtimeState==='SPLIT'){
    const warn=document.createElement('div');warn.className='runtime-warning';
    warn.textContent='ตรวจพบ Runtime คนละรุ่น ระบบจะจัดการ reconciliation ผ่าน release เดียว ไม่ต้องอัปเดต component แยกเอง';
    main.append(warn);
  }
  renderReleaseNotes(item,main);
  renderDevices(item,main);
  main.append(technicalDetails(item));
  const actions=document.createElement('div');actions.className='update-actions';
  if(item.adapter==='CORE_RELEASE'&&item.state==='UPDATE_AVAILABLE'&&item.candidate)actions.append(actionButton(item.runtimeState==='SPLIT'?'ปรับ Runtime และอัปเดต':'อัปเดต AWH',()=>updateAwh(item)));
  else if(item.adapter==='CORE_RELEASE'&&item.state==='WAITING_FOR_APPROVAL'&&item.approvalId)actions.append(actionButton('ยืนยันและอัปเดต',()=>approveAwh(item)));
  else if(item.adapter==='LEARNLAB_RELEASE'&&item.state==='WAITING_FOR_APPROVAL'&&item.approvalId)actions.append(actionButton('ยืนยัน LearnLab',()=>approveLearnLab(item)));
  else if(item.adapter==='ASSESSMENT_RELEASE'&&item.state==='UPDATE_AVAILABLE'&&item.candidate&&item.candidateVersion)actions.append(actionButton('อัปเดต Assessment',()=>updateAssessment(item)));
  else if(item.adapter==='ASSESSMENT_RELEASE'&&item.state==='WAITING_FOR_APPROVAL'&&item.approvalId)actions.append(actionButton('ยืนยัน Assessment',()=>approveAssessment(item)));
  else if(item.adapter==='MANAGED_HOSTING'&&item.state==='UPDATE_AVAILABLE'&&item.siteId)actions.append(actionButton('อัปเดต',()=>updateHosting(item)));
  else if(item.adapter==='BAY_UPDATE_CENTER'&&item.state==='UPDATE_AVAILABLE'&&item.release)actions.append(actionButton('อัปเดต BAY',()=>updateBay(item)));
  if(item.url){const link=document.createElement('a');link.className='secondary-button';link.href=item.url;link.target='_blank';link.rel='noopener';link.textContent='เปิดระบบ';actions.append(link);}
  card.append(main,actions);return card;
}

function render(){
  const host=$('update-list');host.replaceChildren();
  for(const item of center?.items||[])if(itemVisible(item))host.append(renderCard(item));
  if(!host.childElementCount){const empty=document.createElement('div');empty.className='update-empty';empty.textContent='ไม่พบระบบตามตัวกรองนี้';host.append(empty);}
  renderRuntimeHealth();renderReleaseInfrastructure();renderRoadmap();renderHistory();summary();renderProgress();
}

function renderProgress(){
  const active=(center?.items||[]).filter((item)=>['UPDATING','WAITING_FOR_APPROVAL'].includes(item.state));
  const host=$('operation-progress');
  if(!active.length&&!localOperation){host.hidden=true;return;}
  host.hidden=false;
  const item=active[0];
  const waiting=item?.state==='WAITING_FOR_APPROVAL';
  const progress=Math.max(0,Math.min(100,Number(item?.progress??(waiting?5:localOperation?.progress??15))));
  $('operation-progress-title').textContent=waiting?'รอยืนยันก่อนติดตั้ง':('กำลังอัปเดต '+(item?.name||localOperation?.name||'ระบบ'));
  $('operation-progress-percent').textContent=Math.round(progress)+'%';
  $('operation-progress-bar').style.width=progress+'%';
  $('operation-progress-message').textContent=waiting?'ระบบพร้อมแล้วและจะเริ่มติดตั้งหลังยืนยันสิทธิ์':(item?.progressMessage||localOperation?.message||'กำลังติดตามสถานะจาก release controller');
  const thresholds=[10,28,58,86,100];
  [...$('operation-steps').children].forEach((step,index)=>{
    step.dataset.status=progress>=thresholds[index]?'done':(progress>=Math.max(0,thresholds[index]-25)?'active':'pending');
  });
}

function askConfirm(title,text,submitLabel='ยืนยัน'){
  $('confirm-title').textContent=title;$('confirm-message').textContent=text;$('confirm-submit').textContent=submitLabel;
  $('confirm-dialog').hidden=false;
  return new Promise((resolve)=>{confirmResolver=resolve;});
}

function askStepUp(){
  $('step-up').hidden=false;$('step-up-password').value='';$('step-up-message').textContent='';
  setTimeout(()=>$('step-up-password').focus(),0);
  return new Promise((resolve,reject)=>{stepUpResolver={resolve,reject};});
}

async function privileged(action){
  try{return await action();}
  catch(error){
    if(error?.code!=='STEP_UP_REQUIRED')throw error;
    const password=await askStepUp();
    await stepUp(password);
    return action();
  }
}
async function approveAwh(item){
  if(!await askConfirm('ยืนยันการอัปเดต AWH','ระบบจะสำรอง ติดตั้ง ตรวจสอบ และย้อนกลับให้อัตโนมัติหาก verification ไม่ผ่าน','อัปเดต'))return;
  await decideApproval(item.approvalId,'approve');
  localOperation={name:'AWH',progress:10,message:'อนุมัติแล้ว กำลังรอ release controller'};
  message('ยืนยันแล้ว ระบบกำลังดำเนินการอัปเดต AWH อย่างปลอดภัย');
  await refresh();
}

async function approveLearnLab(item){
  if(!await askConfirm('ยืนยันการอัปเดต LearnLab','ระบบจะใช้ typed release boundary และ rollback เดิมของ LearnLab','อัปเดต'))return;
  await decideApproval(item.approvalId,'approve');
  localOperation={name:'LearnLab',progress:10,message:'อนุมัติแล้ว กำลังเริ่ม release'};
  await refresh();
}

async function updateAwh(item){
  const split=item.runtimeState==='SPLIT';
  const detail=split
    ?'ตรวจพบ component บางส่วนอยู่คนละรุ่น ระบบจะใช้ release ล่าสุดเพื่อปรับ Runtime ให้สอดคล้อง แล้วจึง Verify ทั้งชุด'
    :'ระบบจะตรวจทุก gate สำรองข้อมูล ติดตั้ง และ Verify ก่อนเปลี่ยน Production';
  if(!await askConfirm(split?'ปรับ Runtime และอัปเดต AWH':'อัปเดต AWH',detail,'เริ่มอัปเดต'))return;
  localOperation={name:'AWH',progress:6,message:'กำลังสร้างคำขอ release จากรุ่นล่าสุด'};
  const request=await privileged(()=>requestCoreRelease(item.candidate,false));
  if(request?.approvalId)await decideApproval(request.approvalId,'approve');
  message('AWH รับคำสั่งแล้ว กำลังตรวจความพร้อม สำรอง ติดตั้ง และ Verify');
  await refresh();
}
async function approveAssessment(item){
  if(!await askConfirm('ยืนยันการอัปเดต Assessment','ระบบจะ Backup → Staging → Verify → Production และ rollback อัตโนมัติเมื่อจำเป็น','อัปเดต'))return;
  await decideApproval(item.approvalId,'approve');
  localOperation={name:'Assessment',progress:10,message:'อนุมัติแล้ว กำลังเริ่ม release'};
  await refresh();
}

async function updateAssessment(item){
  if(!await askConfirm('อัปเดต BAY Assessment','ระบบจะทดสอบ candidate ใน Staging ก่อน Production','เริ่มอัปเดต'))return;
  const request=await privileged(()=>requestAssessmentRelease(item.candidate,item.candidateVersion));
  if(request?.approvalId)await decideApproval(request.approvalId,'approve');
  localOperation={name:'Assessment',progress:10,message:'กำลังเตรียม Staging'};
  message('Assessment รับคำสั่งแล้ว กำลังดำเนินการแบบ staging-first');
  await refresh();
}

async function updateHosting(item){
  if(!await askConfirm('อัปเดต '+item.name,'ระบบจะเผยแพร่ Project Vault revision ล่าสุดและเก็บรุ่นปัจจุบันไว้เป็น rollback point','อัปเดต'))return;
  await managedSiteAction(item.siteId,'deploy');
  message('ส่ง '+item.name+' เข้าสู่ Managed Hosting แล้ว');
  await refresh();
}

async function updateBay(item,askConfirmation=true){
  const release=item.release;if(!release)return;
  if(askConfirmation&&!await askConfirm('อัปเดต BAY EXCUSE X','ติดตั้ง '+release.version+' ผ่าน BAY PackageManager ที่ตรวจ checksum และ source แล้ว','อัปเดต'))return;
  const relay=await createBayRemoteInstallRelay({targetVersion:release.version,targetSha:release.sourceSha,packageSha256:release.packageSha256});
  try{
    await relayBayRemoteCommand(relay.endpoint,relay.relay);
    message('BAY รับคำสั่งติดตั้งแล้ว กำลังตรวจสถานะใหม่');
  }catch(error){
    if(error?.code==='BAY_INSTALL_OUTCOME_UNKNOWN'){message(friendly(error));await refreshBay();return;}
    throw error;
  }
  await refreshBay();
}

async function refreshBay(){
  const item=(center?.items||[]).find((row)=>row.adapter==='BAY_UPDATE_CENTER');if(!item)return;
  try{
    const bridge=await loadBayRemoteUpdateStatus();
    bayLive=await relayBayRemoteCommand(bridge.endpoint,bridge.statusRelay);
    const release=(bayLive.packages||[]).find((row)=>row?.installable===true&&['ready','READY'].includes(String(row.state||row.version_state||'')));
    item.current=bayLive.currentVersion||null;item.release=release||null;item.candidate=release?.version||null;
    item.actionable=Boolean(release)&&bayLive.preflight?.ready===true;
    item.state=item.actionable?'UPDATE_AVAILABLE':(bayLive.preflight?.ready===true?'CURRENT':'BLOCKED');
    item.reason=item.actionable?'มีแพ็กเกจใหม่ที่ผ่านการตรวจและพร้อมติดตั้ง':(item.state==='CURRENT'?'BAY เป็นรุ่นล่าสุดแล้ว':'BAY preflight ยังไม่พร้อม');
  }catch(error){item.state='BLOCKED';item.actionable=false;item.reason=friendly(error);}
  render();
}

async function refreshAgent(){
  const item=(center?.items||[]).find((row)=>row.adapter==='AGENT_MANAGED');if(!item)return;
  try{
    const response=await fetch('./release.json',{credentials:'same-origin',cache:'no-store'});if(!response.ok)return;
    const release=await response.json();
    const packages=Array.isArray(release.desktopReleases)?release.desktopReleases:[];
    const versions=[...new Set(packages.map((row)=>row?.productVersion).filter((v)=>typeof v==='string'&&v))];
    item.candidate=versions.length===1?versions[0]:(versions.length?versions.join(' / '):null);
    item.reason=packages.length?'พบ package ที่ตรวจสอบแล้ว '+packages.length+' แพลตฟอร์ม · Web/PWA อัปเดตอัตโนมัติ':'Web/PWA อัปเดตอัตโนมัติ · ยังไม่มี native package ที่ยืนยันได้';
  }catch{}
  render();
}
async function updateAll(){
  const ready=(center?.items||[]).filter((item)=>item.state==='UPDATE_AVAILABLE'&&item.actionable===true);
  const pending=(center?.items||[]).filter((item)=>item.state==='WAITING_FOR_APPROVAL'&&item.approvalId);
  if(!ready.length&&!pending.length)return;
  if(!await askConfirm('อัปเดตทั้งหมดอย่างปลอดภัย','ดำเนินการ '+(ready.length+pending.length)+' รายการที่พร้อม ระบบจะข้ามรายการ Blocked และใช้ Backup/Verify/Rollback ของแต่ละระบบ','อัปเดตทั้งหมด'))return;
  $('update-all').disabled=true;localOperation={name:'หลายระบบ',progress:5,message:'กำลังจัดลำดับ dependency และส่งงานไปยัง release authority'};
  try{
    for(const item of ready.filter((row)=>row.adapter==='MANAGED_HOSTING'))await managedSiteAction(item.siteId,'deploy');
    for(const item of ready.filter((row)=>row.adapter==='BAY_UPDATE_CENTER'&&row.release))await updateBay(item,false);
    for(const item of pending.filter((row)=>['CORE_RELEASE','LEARNLAB_RELEASE','ASSESSMENT_RELEASE'].includes(row.adapter)))await decideApproval(item.approvalId,'approve');
    for(const item of ready.filter((row)=>row.adapter==='CORE_RELEASE')){
      const request=await privileged(()=>requestCoreRelease(item.candidate,false));
      if(request?.approvalId)await decideApproval(request.approvalId,'approve');
    }
    for(const item of ready.filter((row)=>row.adapter==='ASSESSMENT_RELEASE'&&row.candidateVersion)){
      const request=await privileged(()=>requestAssessmentRelease(item.candidate,item.candidateVersion));
      if(request?.approvalId)await decideApproval(request.approvalId,'approve');
    }
    message('ส่งทุกรายการที่พร้อมเข้าสู่ release authority แล้ว ระบบจะติดตามต่ออัตโนมัติ');
  }finally{await refresh();}
}

function scheduleRefresh(){
  clearTimeout(refreshTimer);
  const active=(center?.items||[]).some((item)=>['UPDATING','WAITING_FOR_APPROVAL','REMOTE_CHECK_REQUIRED'].includes(item.state));
  refreshTimer=setTimeout(()=>{if(!document.hidden)void refresh();},active?5000:30000);
}
async function refresh(){
  if(refreshing)return;
  refreshing=true;$('updates-refresh').disabled=true;$('updates-freshness').textContent='กำลังตรวจทุกระบบ…';
  try{
    await loadAuthSession();
    const [liveCenter]=await Promise.all([loadUpdateCenter(),loadStaticMetadata()]);
    center=liveCenter;
    applyStaticMetadata();
    $('updates-freshness').textContent='ตรวจล่าสุด '+new Date(center.generatedAt).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
    render();
    await Promise.allSettled([refreshBay(),refreshAgent()]);
    if(!(center?.items||[]).some((item)=>['UPDATING','WAITING_FOR_APPROVAL'].includes(item.state)))localOperation=null;
  }catch(error){
    message(friendly(error));$('updates-overall').textContent='ตรวจไม่สำเร็จ';$('updates-overall').dataset.tone='bad';
  }finally{
    refreshing=false;$('updates-refresh').disabled=false;summary();renderProgress();scheduleRefresh();
  }
}

$('updates-refresh').addEventListener('click',refresh);
$('update-all').addEventListener('click',updateAll);
$('show-attention').addEventListener('click',()=>{
  attentionOnly=!attentionOnly;
  $('show-attention').textContent=attentionOnly?'แสดงทุกระบบ':'แสดงเฉพาะที่ต้องจัดการ';
  render();
});
$('runtime-health-details').addEventListener('click',()=>{
  $('advanced-diagnostics').open=true;
  $('advanced-diagnostics').scrollIntoView({behavior:'smooth',block:'start'});
});
$('confirm-cancel').addEventListener('click',()=>{
  if(confirmResolver){confirmResolver(false);confirmResolver=null;}
  $('confirm-dialog').hidden=true;
});
$('confirm-submit').addEventListener('click',()=>{
  if(confirmResolver){confirmResolver(true);confirmResolver=null;}
  $('confirm-dialog').hidden=true;
});
$('step-up-cancel').addEventListener('click',()=>{
  if(stepUpResolver){stepUpResolver.reject(Object.assign(new Error('ยกเลิกการยืนยันสิทธิ์'),{code:'STEP_UP_CANCELLED'}));stepUpResolver=null;}
  $('step-up').hidden=true;
});
$('step-up-submit').addEventListener('click',()=>{
  const value=$('step-up-password').value;
  if(!value){$('step-up-message').textContent='กรุณากรอกรหัสผ่าน';return;}
  if(stepUpResolver){stepUpResolver.resolve(value);stepUpResolver=null;}
  $('step-up').hidden=true;
});
$('step-up-password').addEventListener('keydown',(event)=>{if(event.key==='Enter')$('step-up-submit').click();});

$('update-search').addEventListener('input',(event)=>{
  searchTerm=String(event.target.value||'').trim().toLocaleLowerCase('th');render();
});
document.querySelectorAll('.filter-chip').forEach((button)=>button.addEventListener('click',()=>{
  filterMode=button.dataset.filter||'ALL';
  document.querySelectorAll('.filter-chip').forEach((chip)=>chip.classList.toggle('is-active',chip===button));
  render();
}));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
void refresh();
