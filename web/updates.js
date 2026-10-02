import {
  cancelTask, createBayRemoteInstallRelay, loadAuthSession, loadBayRemoteUpdateStatus, loadUpdateCenter,
  managedSiteAction, relayBayRemoteCommand, requestAssessmentRelease, requestCoreRelease, requestLearnLabRelease, requestPlatformRelease, subscribeUpdateCenterLive,
} from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';

const $=(id)=>document.getElementById(id);
let center=null;
let bayLive=null;
let refreshing=false;
let attentionOnly=false;
let refreshTimer=null;
let localOperation=null;
let filterMode='ALL';
let searchTerm='';
let stopLiveUpdates=null;
let liveConnected=false;
let liveUpdatedAt=0;
let lastLiveUiSignature='';
let actionInFlight=false;
const targetFeedback=new Map();
const OWNER_OPERATION_STORAGE_KEY='awh-update-center-owner-operation-v1';
const OWNER_COMMAND_RECONCILE_MS=120000;
const QUEUED_RELEASE_TASK_STATES=new Set(['QUEUED','WAITING_FOR_WORKER','WAITING_FOR_CAPABILITY']);
const itemQueued=(item)=>item?.state==='UPDATING'&&QUEUED_RELEASE_TASK_STATES.has(String(item?.taskState||'').toUpperCase());
function readPinnedOperation(){
  try{
    const value=JSON.parse(sessionStorage.getItem(OWNER_OPERATION_STORAGE_KEY)||'null');
    if(!value||typeof value!=='object'||typeof value.key!=='string'||!Number.isFinite(Number(value.acceptedAt)))return null;
    if(Date.now()-Number(value.acceptedAt)>OWNER_COMMAND_RECONCILE_MS)return null;
    return value;
  }catch{return null;}
}
let pinnedOperation=readPinnedOperation();
function persistPinnedOperation(){
  try{if(pinnedOperation)sessionStorage.setItem(OWNER_OPERATION_STORAGE_KEY,JSON.stringify(pinnedOperation));else sessionStorage.removeItem(OWNER_OPERATION_STORAGE_KEY);}catch{}
}
function pinnedFor(item){
  return Boolean(pinnedOperation&&item?.key===pinnedOperation.key&&Date.now()-Number(pinnedOperation.acceptedAt||0)<=OWNER_COMMAND_RECONCILE_MS);
}
function ownerActionLocked(targetKey){
  if(actionInFlight||pinnedOperation)return true;
  const active=primaryItems().filter((item)=>['UPDATING','WAITING_FOR_APPROVAL'].includes(item.state));
  if(!active.length)return false;
  return active.some((item)=>item.key!==targetKey||item.state==='UPDATING');
}
function pinAcceptedOperation(item,name,request,progress,messageText){
  const target=String(item?.candidate||item?.candidateReleaseSha||item?.release?.sourceSha||item?.release?.version||'');
  pinnedOperation={key:item.key,name,target:target||null,taskId:request?.taskId||null,executionId:request?.executionId||null,acceptedAt:Date.now()};
  persistPinnedOperation();
  localOperation={key:item.key,name,progress,message:messageText};
  targetFeedback.set(item.key,{text:'รับคำสั่งแล้ว · ไม่ต้องกดซ้ำ ระบบจะทำต่อและตรวจผลให้อัตโนมัติ',tone:'info'});
}
function reconcilePinnedOperation(){
  if(!pinnedOperation)return;
  const item=primaryItems().find((row)=>row.key===pinnedOperation.key);
  if(!item)return;
  const target=String(pinnedOperation.target||'');
  const currentValues=[item.current,item.currentSourceRevision,item.trackSourceSha].filter((value)=>typeof value==='string').map(String);
  if(item.state==='CURRENT'&&(!target||currentValues.includes(target)||!item.candidate)){
    targetFeedback.set(item.key,{text:'อัปเดตสำเร็จ · ตรวจ Production แล้ว',tone:'good'});
    pinnedOperation=null;persistPinnedOperation();localOperation=null;return;
  }
  if(['UPDATING','WAITING_FOR_APPROVAL'].includes(item.state)){
    localOperation={key:item.key,name:pinnedOperation.name||item.name,progress:Math.max(8,Number(item?.progressEvent?.progress??item?.progress??8)),message:ownerProgressMessage(item,item.progressEvent,item.state==='WAITING_FOR_APPROVAL')};
    return;
  }
  if(item.state==='BLOCKED'){
    targetFeedback.set(item.key,{text:'รอบล่าสุดหยุดที่จุดปลอดภัย · Production เดิมยังอยู่ กรุณาดูเหตุผลก่อนลองใหม่',tone:'bad'});
    pinnedOperation=null;persistPinnedOperation();localOperation=null;return;
  }
  const age=Date.now()-Number(pinnedOperation.acceptedAt||0);
  if(age<OWNER_COMMAND_RECONCILE_MS){
    localOperation={key:item.key,name:pinnedOperation.name||item.name,progress:8,message:'รับคำสั่งแล้ว · กำลังยืนยันสถานะจาก release controller · ไม่ต้องกดซ้ำ'};
    return;
  }
  targetFeedback.set(item.key,{text:'การทำงานรอบก่อนสิ้นสุดแล้ว แต่ยังมีรุ่นรออัปเดต · ตรวจรายละเอียดก่อนกดใหม่',tone:'info'});
  pinnedOperation=null;persistPinnedOperation();localOperation=null;
}

const stateLabel=(state)=>({
  CURRENT:'ล่าสุดแล้ว',UPDATE_AVAILABLE:'พร้อมอัปเดต',WAITING_FOR_APPROVAL:'พร้อมทำงานเดิมต่อ',UPDATING:'กำลังอัปเดต',
  BLOCKED:'ต้องตรวจสอบ',SOURCE_READY:'มีรุ่นรอเตรียม',REMOTE_CHECK_REQUIRED:'กำลังตรวจ',
  DELEGATED:'ดูแลโดยระบบหลัก',INTERNAL_MANAGED:'ดูแลอัตโนมัติ',UNREGISTERED:'ยังไม่พร้อมใช้งาน',
  BASELINE_REQUIRED:'ต้องตั้งค่าครั้งแรก',MIGRATION_REQUIRED:'ต้องปรับระบบอัปเดต',
})[state]||state||'กำลังตรวจ';

const adapterLabel=(value)=>({
  PLATFORM_RELEASE:'VPS Platform',CORE_RELEASE:'AWH Core Release',MANAGED_HOSTING:'Managed Hosting',BAY_UPDATE_CENTER:'BAY Update Center',
  LEARNLAB_RELEASE:'LearnLab Release',ASSESSMENT_RELEASE:'Assessment Release',LEGACY_DEPLOY:'Legacy deploy',
  SOURCE_ONLY:'Source only',UNREGISTERED:'ยังไม่ลงทะเบียน',AGENT_MANAGED:'AWH Agent',
})[value]||value||'—';
const activityLabel=(value)=>({
  ONLINE:'ออนไลน์',BUSY:'กำลังทำงาน',STALE:'ข้อมูลเก่า',OFFLINE:'ออฟไลน์',IDLE:'พร้อม',
})[String(value||'').toUpperCase()]||value||'ไม่ทราบสถานะ';

const hash=(value)=>typeof value==='string'&&/^[0-9a-f]{40}$/i.test(value);
const short=(value)=>hash(value)?value.slice(0,12):value||'—';
const message=(text,tone='info')=>{const host=$('updates-message');host.textContent=text;host.dataset.tone=tone;};

const friendly=(error)=>{
  const code=String(error?.code||'').toUpperCase();
  return ({
    STEP_UP_REQUIRED:'ต้องยืนยันสิทธิ์เจ้าของระบบก่อนทำรายการนี้',
    STEP_UP_CANCELLED:'ยกเลิกการยืนยันสิทธิ์แล้ว',
    CORE_RELEASE_CONFLICT:'มีการอัปเดต AWH อื่นกำลังทำอยู่ ระบบจะไม่สร้างงานซ้ำ',
    CORE_RELEASE_NOT_READY:'AWH ยังไม่พร้อมอัปเดต เพราะ release authority ยังไม่พร้อม',
    CORE_RELEASE_TARGET_MOVED:'มีรุ่นใหม่กว่าเข้ามาแล้ว ระบบยกเลิกรุ่นเก่าอย่างปลอดภัย กรุณาตรวจอีกครั้ง',
    PLATFORM_RELEASE_NOT_READY:'VPS Platform release authority ยังไม่พร้อม',
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
    TASK_NOT_CANCELLABLE:'งานเริ่มขั้นติดตั้งแล้ว จึงหยุดกลางทางไม่ได้ ระบบจะทำให้ถึงจุดตรวจสอบที่ปลอดภัย',
    TASK_CANCEL_RACE:'งานเริ่มขั้นถัดไปพอดี จึงหยุดกลางทางไม่ได้ ระบบจะติดตามต่ออย่างปลอดภัย',
  })[code]||error?.message||'ยังทำรายการนี้ไม่ได้';
};

function itemNeedsAttention(item){
  return item.state!=='CURRENT'&&item.state!=='INTERNAL_MANAGED';
}

const AWH_LINE_PROJECT_ID='124ae148-3ed1-4e45-8f50-75ff45a39e5c';
const AWH_LINE_SITE_ID='ed911e13-ccfa-44d9-8214-6425cb252240';
const lineOaGroupContract={
  name:'LINE OA',
  targets:[
    {itemKey:'awh-line-gateway',releaseTrack:'awh-line-gateway'},
    {itemKey:'bay-excuse-line-oa',releaseTrack:'line-oa'},
  ],
  approvalMode:'SIGNED_IN_OWNER',
  orchestration:'SEQUENTIAL_VERIFY_EACH',
  failurePolicy:'STOP_ON_TARGET_FAILURE',
  historyScope:'PER_TARGET',
  rollbackScope:'PER_TARGET',
  forbiddenImplicitTargets:['awh','vps-platform','bay-excuse-x'],
};

function normalizeUpdateCenter(snapshot){
  if(!snapshot||!Array.isArray(snapshot.items))return snapshot;
  snapshot.releaseGroups={...(snapshot.releaseGroups||{}),'line-oa':snapshot.releaseGroups?.['line-oa']||lineOaGroupContract};
  for(const item of snapshot.items){
    const awhLine=String(item?.projectId||'')===AWH_LINE_PROJECT_ID||String(item?.siteId||'')===AWH_LINE_SITE_ID;
    if(awhLine){
      item.key='awh-line-gateway';
      item.name='AWH LINE OA / KRUART LINE Gateway';
      item.kind='INTEGRATION';
      item.group='line-oa';
      item.releaseTrack='awh-line-gateway';
      item.sourceAuthority='AWH_VAULT';
      item.domain='line.kruart.online';
      item.healthPath='/healthz';
      item.webhookPath='/webhook';
      item.secretScope='KRUART_LINE_GATEWAY';
      item.currentSourceRevision=item.currentSourceRevision||item.current||null;
      item.candidateSourceRevision=item.candidateSourceRevision||item.candidate||null;
      item.history=Array.isArray(item.history)?item.history:[];
      item.historyAuthority=item.historyAuthority||'MANAGED_HOSTING';
      continue;
    }
    if(String(item?.releaseTrack||'')==='line-oa'||String(item?.key||'')==='line-oa'){
      item.key='bay-excuse-line-oa';
      item.name='BAY Excuse LINE OA';
      item.kind='INTEGRATION';
      item.group='line-oa';
      item.visibility='PRIMARY';
      item.releaseTrack='line-oa';
      item.sourceAuthority=item.sourceAuthority||'BAY_UPDATE_INBOX';
      item.secretScope=item.secretScope||'BAY_EXCUSE_LINE_OA';
      item.history=Array.isArray(item.history)?item.history:[];
      item.historyAuthority=item.historyAuthority||'BAY_UPDATE_CENTER:line-oa';
      continue;
    }
    if(String(item?.releaseTrack||'')==='cooperative-center'||String(item?.key||'')==='bay-cooperative'){
      item.key='bay-cooperative';
      item.name='ศูนย์งานสหกรณ์โรงเรียน';
      item.kind='PRODUCT';
      item.visibility='PRIMARY';
      item.releaseTrack='cooperative-center';
      item.sourceReleaseTrack='bay-cooperative';
      item.sourceAuthority=item.sourceAuthority||'BAY_UPDATE_INBOX';
      item.history=Array.isArray(item.history)?item.history:[];
      item.historyAuthority=item.historyAuthority||'BAY_UPDATE_CENTER:cooperative-center';
      continue;
    }
    if(String(item?.releaseTrack||'')==='pp-center'||String(item?.key||'')==='bay-pp'){
      item.key='bay-pp';
      item.name='ศูนย์ ปพ.';
      item.kind='PRODUCT';
      item.visibility='PRIMARY';
      item.releaseTrack='pp-center';
      item.sourceReleaseTrack='bay-pp';
      item.sourceAuthority=item.sourceAuthority||'BAY_UPDATE_INBOX';
      item.history=Array.isArray(item.history)?item.history:[];
      item.historyAuthority=item.historyAuthority||'BAY_UPDATE_CENTER:pp-center';
      continue;
    }
    if(String(item?.key||'')==='vps-platform'||String(item?.releaseTrack||'')==='vps-platform'){
      item.key='vps-platform';
      item.name='VPS Platform';
      item.kind='PLATFORM';
      item.visibility='PRIMARY';
    }
  }
  if(!snapshot.items.some((item)=>String(item?.key||'')==='vps-platform')){
    snapshot.items.unshift({
      key:'vps-platform',projectId:null,name:'VPS Platform',kind:'PLATFORM',adapter:'PLATFORM_RELEASE',
      visibility:'PRIMARY',releaseTrack:'vps-platform',state:'BLOCKED',current:null,candidate:null,
      approvalRequired:true,actionable:false,
      reason:'VPS Platform release authority ยังไม่ถูกส่งมาจาก Control runtime รุ่นนี้ จึงปิดการอัปเดตแบบ fail-closed',
    });
  }
  return snapshot;
}

const updateGroupMeta={
  'core-control':{label:'แกนระบบและโครงสร้าง',description:'AWH, AWH Agent และ VPS Platform'},
  'line-oa':{label:'LINE OA',description:'สองระบบอิสระ · AWH Owner Chat และ BAY Excuse สำหรับโรงเรียน'},
  'school-systems':{label:'ระบบงานโรงเรียน',description:'BAY และระบบงานภายในโรงเรียน'},
  'channels-public':{label:'ช่องทางและเว็บไซต์',description:'เว็บไซต์และช่องทางสาธารณะอื่น'},
};
function updateGroup(item){
  if(typeof item?.group==='string'&&updateGroupMeta[item.group])return item.group;
  const key=String(item?.key||'').toLowerCase();
  const kind=String(item?.kind||'').toUpperCase();
  if(['vps-platform','awh-core','awh-agent'].includes(key)||['PLATFORM','CORE','AGENT'].includes(kind))return 'core-control';
  if(['awh-line-gateway','bay-excuse-line-oa'].includes(key))return 'line-oa';
  if(['INTEGRATION','HOSTING'].includes(kind))return 'channels-public';
  return 'school-systems';
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
  // Never turn stale/checking telemetry into a hard owner-facing storage failure.
  // A blocking storage verdict is valid only when the live Production telemetry is READY.
  const storageBlocked=Boolean(telemetryReady)&&((used!==null&&used>=90)||(Number.isFinite(free)&&free<3*1024**3));
  const storageWarn=Boolean(telemetryReady)&&!storageBlocked&&used!==null&&used>=80;
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
  $('release-capacity-state').textContent=!telemetryReady
    ?'กำลังยืนยัน Production telemetry · ยังไม่สรุปเป็นปัญหาและจะตรวจซ้ำอัตโนมัติ'
    :storageBlocked
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

function itemVisibility(item){
  return item?.visibility==='ADVANCED'?'ADVANCED':'PRIMARY';
}
function primaryItems(){
  return (center?.items||[]).filter((item)=>itemVisibility(item)==='PRIMARY');
}

function summary(){
  const counts={current:0,update:0,progress:0,queue:0,attention:0};
  for(const item of primaryItems()){
    if(pinnedFor(item)){counts.progress++;continue;}
    if(['CURRENT','INTERNAL_MANAGED'].includes(item.state))counts.current++;
    else if(item.state==='UPDATE_AVAILABLE')counts.update++;
    else if(['WAITING_FOR_APPROVAL','UPDATING'].includes(item.state)){counts.progress++;if(itemQueued(item))counts.queue++;}
    else counts.attention++;
  }
  $('summary-current').textContent=String(counts.current);
  $('summary-update').textContent=String(counts.update);
  $('summary-progress').textContent=String(counts.progress);
  $('summary-attention').textContent=String(counts.attention);
  const overall=$('updates-overall');
  const running=Math.max(0,counts.progress-counts.queue);
  if(runtimeState()==='SPLIT'){
    overall.textContent='ต้องปรับ Runtime ให้ตรงกัน';overall.dataset.tone='warn';
  }else if(running>0){
    overall.textContent=counts.queue>0?'กำลังดำเนินการ · รอคิว '+counts.queue:'กำลังดำเนินการ';overall.dataset.tone='warn';
  }else if(counts.queue>0){
    overall.textContent='รอคิว '+counts.queue+' รายการ';overall.dataset.tone='warn';
  }else if(counts.update>0){
    overall.textContent=counts.update+' รายการพร้อมอัปเดต';overall.dataset.tone='good';
  }else if(counts.attention>0){
    overall.textContent='มีรายการต้องตรวจ';overall.dataset.tone='warn';
  }else{
    overall.textContent='ระบบเป็นปัจจุบัน';overall.dataset.tone='good';
  }
}

function releaseText(item){
  if(pinnedFor(item))return 'รับคำสั่งแล้ว · กำลังยืนยันสถานะล่าสุด';
  if(item.current&&item.candidate&&!hash(item.current)&&!hash(item.candidate)&&item.current!==item.candidate)return item.current+' → '+item.candidate;
  if(item.state==='CURRENT'&&item.current&&!hash(item.current))return 'รุ่น '+item.current;
  if(item.state==='UPDATE_AVAILABLE')return 'มีรุ่นใหม่พร้อมติดตั้ง';
  if(itemQueued(item))return 'รับคำสั่งแล้ว · รอคิวอัปเดต';
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
  if(item.releaseTrack)values.push('track '+item.releaseTrack);
  if(item.sourceAuthority)values.push('source '+item.sourceAuthority);
  if(item.currentReleaseId)values.push('release '+item.currentReleaseId);
  if(item.runtimeState)values.push('runtime '+item.runtimeState);
  if(item.rollbackReleaseId)values.push('rollback '+item.rollbackReleaseId);
  if(item.domain)values.push('domain '+item.domain);
  if(item.webhookPath)values.push('webhook '+item.webhookPath);
  if(item.secretScope)values.push('secret scope '+item.secretScope);
  if(item.trackSourceSha)values.push('source sha '+short(item.trackSourceSha));
  if(item.trackInherited)values.push('track state inherited');
  details.append(summary,meta(...values));
  if(item.runtimeComponents&&typeof item.runtimeComponents==='object'){
    const componentValues=Object.entries(item.runtimeComponents).map(([key,value])=>value?key+' '+String(value):null);
    details.append(meta(...componentValues));
  }
  return details;
}

function paintTargetFeedback(targetKey){
  if(!targetKey)return;
  const stored=targetFeedback.get(targetKey);if(!stored)return;
  const hosts=[];
  for(const card of [...document.querySelectorAll('.update-card')].filter((card)=>card.dataset.key===targetKey)){
    const actions=card.querySelector('.update-actions');if(actions)hosts.push(actions);
  }
  if(targetKey==='group-line-oa'){
    const groupActions=document.querySelector('.update-group[data-group="line-oa"] .update-group-head-actions');if(groupActions)hosts.push(groupActions);
  }
  for(const actions of hosts){
    let feedback=actions.querySelector('.update-action-feedback');
    if(!feedback){feedback=document.createElement('div');feedback.className='update-action-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');actions.prepend(feedback);}
    feedback.dataset.tone=stored.tone;feedback.textContent=stored.text;
  }
}
function actionFeedback(button,text,tone='info',targetKey=null){
  const key=targetKey||button?.dataset?.targetKey||null;
  if(key)targetFeedback.set(key,{text,tone});
  const actions=button?.closest?.('.update-actions');
  if(actions){
    let feedback=actions.querySelector('.update-action-feedback');
    if(!feedback){feedback=document.createElement('div');feedback.className='update-action-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');actions.prepend(feedback);}
    feedback.dataset.tone=tone;feedback.textContent=text;
  }
  paintTargetFeedback(key);
}
function actionErrorText(error,button){
  const code=String(error?.code||'').toUpperCase();
  if(code==='CORE_RELEASE_NOT_READY'){
    const platform=(center?.items||[]).find((item)=>item.adapter==='PLATFORM_RELEASE');
    return 'AWH ยังอัปเดตไม่ได้ · '+ownerFacingReason(platform);
  }
  return friendly(error);
}
function actionButton(text,handler,className='primary-button',targetKey=null,successText='รับคำสั่งแล้ว · ไม่ต้องกดซ้ำ ระบบจะทำต่อและตรวจผลให้อัตโนมัติ',allowDuringOperation=false){
  const button=document.createElement('button');button.type='button';button.className=className;button.textContent=text;if(targetKey)button.dataset.targetKey=targetKey;
  if(!allowDuringOperation&&ownerActionLocked(targetKey)){button.disabled=true;button.title='มีงานอัปเดตกำลังดำเนินการ · ระบบจะเปิดปุ่มให้อัตโนมัติเมื่อถึงจุดปลอดภัย';}
  button.addEventListener('click',async()=>{
    if(!allowDuringOperation&&ownerActionLocked(targetKey)){actionFeedback(button,'มีงานอัปเดตกำลังดำเนินการ · ไม่ต้องกดซ้ำ ระบบจะทำต่อเอง','info',targetKey);return;}
    const initialText=button.textContent;
    actionInFlight=true;button.disabled=true;button.dataset.busy='true';button.setAttribute('aria-busy','true');button.textContent='กำลังรับคำสั่ง…';
    actionFeedback(button,'กำลังตรวจความพร้อมและตรึงรุ่นที่จะอัปเดต','info',targetKey);
    try{await handler();actionFeedback(button,successText,'good',targetKey);}
    catch(error){
      pinnedOperation=null;persistPinnedOperation();localOperation=null;const text=actionErrorText(error,button);message(text,'bad');actionFeedback(button,text,'bad',targetKey);syncLiveStream();renderProgress();
    }
    finally{
      actionInFlight=false;button.removeAttribute('data-busy');button.removeAttribute('aria-busy');button.textContent=initialText;
      button.disabled=!allowDuringOperation&&ownerActionLocked(targetKey);
    }
  });
  return button;
}
function ownerFacingReason(item){
  if(!item)return 'ระบบที่เกี่ยวข้องยังไม่พร้อม';
  if(pinnedFor(item))return 'รับคำสั่งแล้ว · ระบบกำลังทำต่อและตรวจผลให้อัตโนมัติ ไม่ต้องกดซ้ำ';
  const reason=String(item.reason||'').trim();
  if(itemQueued(item))return 'รับคำสั่งแล้ว · อยู่ในคิวและจะเริ่มอัตโนมัติเมื่อ writer ว่าง';
  if(item.state==='CURRENT')return 'ระบบนี้เป็นรุ่นล่าสุด';
  if(item.state==='UPDATE_AVAILABLE')return 'มีรุ่นใหม่พร้อมอัปเดต';
  if(item.state==='UPDATING')return 'ระบบกำลังอัปเดตและตรวจสอบผล';
  if(item.state==='WAITING_FOR_APPROVAL')return 'พบงานอัปเดตเดิมที่ยังไม่เริ่ม Production · กดทำต่อได้โดยไม่สร้างงานซ้ำ';
  if(item.state==='REMOTE_CHECK_REQUIRED')return 'กำลังตรวจสถานะล่าสุด';
  if(item.state==='INTERNAL_MANAGED')return 'ระบบนี้ดูแลการอัปเดตให้อัตโนมัติ';
  if(/storage/i.test(reason))return 'พื้นที่สำหรับอัปเดตยังไม่เพียงพอ ระบบจะไม่เริ่มจนกว่าจะปลอดภัย';
  if(/worker|release controller|authority|lease|mutation|candidate|source sha|exact[- ]sha/i.test(reason))return 'ระบบกำลังตรวจความพร้อมของเส้นทางอัปเดต';
  return reason||'กำลังตรวจความพร้อม';
}
function ownerProgressMessage(item,event,waiting){
  if(waiting)return 'พร้อมแล้ว · รอการยืนยันก่อนเริ่มขั้นติดตั้ง';
  const state=String(item?.taskState||event?.state||'').toUpperCase();
  const progress=Math.max(0,Math.min(100,Number(event?.progress??item?.progress??localOperation?.progress??0)));
  const raw=String(event?.message||'').trim();
  if(raw&&!/worker|release controller|authority|lease|mutation|candidate|source sha|exact[- ]sha/i.test(raw))return raw;
  if(state==='RUNNING'){
    if(progress<23)return 'กำลังเตรียมเครื่องมือและตรวจรุ่นที่อนุมัติ';
    if(progress<55)return 'กำลังตรวจ QA สำรองข้อมูล และเตรียม rollback ก่อนติดตั้ง';
    if(progress<60)return 'สำรองข้อมูลพร้อมแล้ว · กำลังเริ่มติดตั้ง';
    if(progress<74)return 'กำลังตรวจ dependency, migration และเตรียม Runtime';
    if(progress<88)return 'กำลังเปิดใช้ Runtime และหน้าเว็บรุ่นใหม่';
    if(progress<99)return 'กำลัง Verify Production และตรวจการทำงานรอบสุดท้าย';
    return 'ตรวจรอบสุดท้ายผ่านแล้ว · กำลังปิด release';
  }
  const mapped={QUEUED:'รับคำสั่งแล้ว · กำลังเข้าคิว',WAITING_FOR_WORKER:'รับคำสั่งแล้ว · กำลังรอคิวอัปเดต',PREPARING:'กำลังตรวจความพร้อมและเตรียมการ',QA:'กำลังตรวจ QA และความพร้อมก่อนติดตั้ง',VERIFYING:'กำลัง Verify Production และยืนยันผลลัพธ์',RECOVERING:'กำลังทำต่อจากจุดที่ปลอดภัย'}[state];
  return mapped||localOperation?.message||'กำลังดำเนินการและตรวจผล';
}
function reconcileTargetFeedback(item){
  if(!item?.key||!targetFeedback.has(item.key))return;
  if(item.state==='UPDATE_AVAILABLE'&&item.actionable===true&&!item.taskId&&!item.approvalId){targetFeedback.delete(item.key);return;}
  if(item.state==='CURRENT')targetFeedback.set(item.key,{text:'อัปเดตสำเร็จ · เป็นรุ่นล่าสุด',tone:'good'});
  else if(itemQueued(item))targetFeedback.set(item.key,{text:'รับคำสั่งแล้ว · รอคิวอัปเดต'+(item.canCancel===true?' · ยกเลิกได้':''),tone:'info'});
  else if(item.state==='UPDATING')targetFeedback.set(item.key,{text:ownerProgressMessage(item,item.progressEvent,false)+(item.canCancel===true?' · ยกเลิกได้':''),tone:'info'});
  else if(item.state==='WAITING_FOR_APPROVAL')targetFeedback.set(item.key,{text:'พบงานเดิมที่ปลอดภัย · กดทำต่อโดยไม่สร้าง release ซ้ำ'+(item.canCancel===true?' · ยกเลิกได้':''),tone:'info'});
}
async function cancelUpdate(item){
  if(!item?.taskId||item.canCancel!==true)throw Object.assign(new Error('งานเริ่มขั้นที่หยุดไม่ได้แล้ว'),{code:'TASK_NOT_CANCELLABLE'});
  await cancelTask(item.taskId);
  localOperation=null;
  message('ยกเลิก '+item.name+' แล้ว · ยังไม่มีการหยุด Production กลางขั้นติดตั้ง','good');
  await refresh();
}


const noteGroups=[
  ['features','ฟังก์ชันใหม่','✨'],
  ['improvements','ปรับปรุง','⚡'],
  ['fixes','แก้ปัญหา','🔧'],
];

function releaseNoteCount(notes){
  const summary=notes?.summary||{};
  return noteGroups.reduce((total,[key])=>total+(Array.isArray(summary[key])?summary[key].length:0),0);
}

function renderReleaseNotes(item,host){
  const notes=item?.releaseNotes;
  if(!notes||typeof notes!=='object')return;
  const count=releaseNoteCount(notes);
  const internal=Array.isArray(notes?.summary?.internal)?notes.summary.internal:[];
  const issues=Array.isArray(item.knownIssues)?item.knownIssues:(Array.isArray(notes.knownIssues)?notes.knownIssues:[]);
  if(count===0&&internal.length===0&&issues.length===0&&notes?.source==='ROADMAP_FALLBACK')return;
  const details=document.createElement('details');details.className='release-notes';
  if(['UPDATE_AVAILABLE','WAITING_FOR_APPROVAL'].includes(item.state))details.open=true;
  const summaryEl=document.createElement('summary');
  summaryEl.textContent=count>0?'มีอะไรเปลี่ยนในรุ่นนี้ · '+count+' รายการ':(notes.ownerSummary||'รายละเอียดรุ่นนี้');
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
  if(internal.length){
    if(count===0){
      const p=document.createElement('p');p.className='release-internal-note';p.textContent=notes.ownerSummary||'ไม่มีการเปลี่ยนแปลงที่ผู้ใช้เห็น';body.append(p);
    }
    const technical=document.createElement('details');technical.className='release-internal';
    const technicalSummary=document.createElement('summary');technicalSummary.textContent='รายละเอียดงานภายใน · '+internal.length+' รายการ';
    const ul=document.createElement('ul');for(const value of internal){const li=document.createElement('li');li.textContent=String(value);ul.append(li);}
    technical.append(technicalSummary,ul);body.append(technical);
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
    small.textContent=notes.changedFileCountMode==='SEGMENT_TOUCHES'?'สรุปจาก exact source '+Number(notes.promotionCount||0)+' ช่วง · '+Number(notes.changedFileCount)+' รายการเปลี่ยนไฟล์ · รายละเอียด commit อยู่ใน Diagnostics':'สรุปจาก exact source '+Number(notes.changedFileCount)+' ไฟล์ · รายละเอียด commit อยู่ใน Diagnostics';
    body.append(small);
  }
  details.append(body);host.append(details);
}

function renderTargetHistory(item,host){
  if(updateGroup(item)!=='line-oa')return;
  const details=document.createElement('details');details.className='target-history';
  const summary=document.createElement('summary');summary.textContent='ประวัติของ '+item.name;
  const body=document.createElement('div');body.className='target-history-body';
  const rows=Array.isArray(item.history)?item.history:[];
  if(rows.length){
    for(const row of rows.slice(0,6)){
      const entry=document.createElement('div');entry.className='target-history-row';
      const strong=document.createElement('strong');strong.textContent=String(row.releaseId||row.version||row.state||'release');
      const small=document.createElement('small');
      const when=row.activatedAt||row.createdAt||row.updatedAt;
      small.textContent=[String(row.state||''),when?new Date(when).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'}):''].filter(Boolean).join(' · ');
      entry.append(strong,small);body.append(entry);
    }
  }else{
    const p=document.createElement('p');
    p.textContent='ประวัติของ target นี้แยกจาก LINE OA อีกตัว และอ่านจาก '+String(item.historyAuthority||'release authority ของระบบนี้')+' เท่านั้น';
    body.append(p);
  }
  details.append(summary,body);host.append(details);
}

function itemVisible(item){
  const visibility=itemVisibility(item);
  if(filterMode==='ADVANCED'){
    if(visibility!=='ADVANCED')return false;
  }else if(visibility==='ADVANCED')return false;
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

function renderHistory(){
  const host=$('release-history-list');if(!host)return;
  host.replaceChildren();
  const allRows=Array.isArray(center?.history)?center.history:[];
  const rows=allRows.slice(0,6);
  const summary=$('release-history-summary');
  if(summary)summary.textContent=allRows.length?'ล่าสุด '+Math.min(allRows.length,6)+' รายการ':'ยังไม่มีประวัติ';
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
  reconcileTargetFeedback(item);
  const card=document.createElement('article');card.className='update-card';card.dataset.key=item.key;
  card.dataset.attention=String(itemNeedsAttention(item));

  const main=document.createElement('div');main.className='update-card-main';
  const title=document.createElement('div');title.className='update-title';
  const h3=document.createElement('h3');h3.textContent=item.name;
  const chip=document.createElement('span');chip.className='update-chip';chip.dataset.state=pinnedFor(item)?'UPDATING':(itemQueued(item)?'QUEUED':item.state);chip.textContent=pinnedFor(item)?'รับคำสั่งแล้ว':(itemQueued(item)?'รอคิว':stateLabel(item.state));
  title.append(h3,chip);main.append(title);
  const version=releaseText(item);
  if(version){const line=document.createElement('div');line.className='update-version';line.textContent=version;main.append(line);}
  if(item.key==='awh-line-gateway'||item.key==='bay-excuse-line-oa'){
    const role=document.createElement('p');role.className='update-target-role';
    role.textContent=item.key==='awh-line-gateway'
      ?'Owner Chat · line.kruart.online · Webhook /webhook'
      :'ครู · ผู้ปกครอง · Parent Connect · Rich Menu · LIFF · สหกรณ์';
    main.append(role);
  }
  const reason=document.createElement('p');reason.className='update-reason';reason.textContent=ownerFacingReason(item);main.append(reason);
  if(item.runtimeState==='SPLIT'){
    const warn=document.createElement('div');warn.className='runtime-warning';
    warn.textContent='ตรวจพบ Runtime คนละรุ่น ระบบจะจัดการ reconciliation ผ่าน release เดียว ไม่ต้องอัปเดต component แยกเอง';
    main.append(warn);
  }
  renderReleaseNotes(item,main);
  renderDevices(item,main);
  renderTargetHistory(item,main);
  main.append(technicalDetails(item));
  const actions=document.createElement('div');actions.className='update-actions';
  if(item.adapter==='PLATFORM_RELEASE'&&item.state==='UPDATE_AVAILABLE'&&item.candidate)actions.append(actionButton('อัปเดต VPS',()=>updatePlatform(item),'primary-button',item.key));
  else if(item.adapter==='PLATFORM_RELEASE'&&item.state==='WAITING_FOR_APPROVAL'&&item.candidate)actions.append(actionButton('ทำต่อ VPS Platform',()=>updatePlatform(item),'primary-button',item.key));
  else if(item.adapter==='CORE_RELEASE'&&item.state==='UPDATE_AVAILABLE'&&item.candidate)actions.append(actionButton(item.runtimeState==='SPLIT'?'ปรับ Runtime และอัปเดต':'อัปเดต AWH',()=>updateAwh(item),'primary-button',item.key));
  else if(item.adapter==='CORE_RELEASE'&&item.state==='WAITING_FOR_APPROVAL'&&item.candidate)actions.append(actionButton('ทำต่อ AWH',()=>updateAwh(item),'primary-button',item.key));
  else if(item.adapter==='LEARNLAB_RELEASE'&&item.state==='WAITING_FOR_APPROVAL'&&item.candidateReleaseSha&&item.candidateVersion)actions.append(actionButton('ทำต่อ LearnLab',()=>resumeLearnLab(item),'primary-button',item.key));
  else if(item.adapter==='ASSESSMENT_RELEASE'&&item.state==='UPDATE_AVAILABLE'&&item.candidate&&item.candidateVersion)actions.append(actionButton('อัปเดต Assessment',()=>updateAssessment(item),'primary-button',item.key));
  else if(item.adapter==='ASSESSMENT_RELEASE'&&item.state==='WAITING_FOR_APPROVAL'&&item.candidate&&item.candidateVersion)actions.append(actionButton('ทำต่อ Assessment',()=>updateAssessment(item),'primary-button',item.key));
  else if(item.adapter==='MANAGED_HOSTING'&&item.state==='UPDATE_AVAILABLE'&&item.siteId)actions.append(actionButton('อัปเดต',()=>updateHosting(item),'primary-button',item.key));
  else if(item.adapter==='BAY_UPDATE_CENTER'&&item.state==='UPDATE_AVAILABLE'&&item.release)actions.append(actionButton('อัปเดต '+item.name,()=>updateBay(item),'primary-button',item.key));
  if(item.canCancel===true&&item.taskId)actions.append(actionButton('ยกเลิก',()=>cancelUpdate(item),'secondary-button',item.key,'ยกเลิกงานแล้ว · ยังไม่มีการเปลี่ยน Production',true));
  const storedFeedback=targetFeedback.get(item.key);if(storedFeedback){const feedback=document.createElement('div');feedback.className='update-action-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');feedback.dataset.tone=storedFeedback.tone;feedback.textContent=storedFeedback.text;actions.prepend(feedback);}
  if(item.url){const link=document.createElement('a');link.className='secondary-button';link.href=item.url;link.target='_blank';link.rel='noopener';link.textContent='เปิดระบบ';actions.append(link);}
  card.append(main,actions);return card;
}

const updateStatePriority=(item)=>{
  const state=String(item?.state||'');
  if(state==='WAITING_FOR_APPROVAL')return 0;
  if(state==='UPDATING')return 1;
  if(state==='UPDATE_AVAILABLE')return 2;
  if(state==='CURRENT')return 3;
  if(state==='INTERNAL_MANAGED')return 4;
  if(state==='SOURCE_READY')return 5;
  if(state==='REMOTE_CHECK_REQUIRED')return 6;
  return 7;
};
const coreTargetPriority=(item)=>{
  if(item?.adapter==='CORE_RELEASE')return 0;
  if(item?.adapter==='PLATFORM_RELEASE')return 1;
  if(item?.adapter==='AGENT_MANAGED')return 2;
  return 3;
};
function orderedRows(rows,groupKey){
  return [...rows].sort((a,b)=>{
    const stateDelta=updateStatePriority(a)-updateStatePriority(b);
    if(stateDelta!==0)return stateDelta;
    if(groupKey==='core-control'){
      const coreDelta=coreTargetPriority(a)-coreTargetPriority(b);
      if(coreDelta!==0)return coreDelta;
    }
    return String(a?.name||'').localeCompare(String(b?.name||''),'th');
  });
}
function reconcileRecoveredActionMessage(){
  const host=$('updates-message');
  const awh=primaryItems().find((item)=>item.adapter==='CORE_RELEASE');
  const text=String(host?.textContent||'').trim();
  const stale=text==='AWH ไม่สามารถดำเนินการได้ในขณะนี้'||text.startsWith('AWH ยังอัปเดตไม่ได้');
  if(stale&&awh?.state==='UPDATE_AVAILABLE'&&awh?.candidate){
    message('AWH พร้อมอัปเดตแล้ว · กด “อัปเดต AWH” ที่การ์ดแรกด้านล่าง','good');
  }
}

function render(){
  const host=$('update-list');host.replaceChildren();
  const visible=(center?.items||[]).filter(itemVisible);
  for(const groupKey of ['core-control','line-oa','school-systems','channels-public']){
    const rows=orderedRows(visible.filter((item)=>updateGroup(item)===groupKey),groupKey);
    if(!rows.length)continue;
    const section=document.createElement('section');section.className='update-group';section.dataset.group=groupKey;if(groupKey==='line-oa')section.id='line-oa';
    const head=document.createElement('div');head.className='update-group-head';
    const title=document.createElement('div');
    const h2=document.createElement('h2');h2.textContent=updateGroupMeta[groupKey].label;
    const p=document.createElement('p');p.textContent=updateGroupMeta[groupKey].description;
    title.append(h2,p);
    const headActions=document.createElement('div');headActions.className='update-group-head-actions';
    const count=document.createElement('span');count.className='update-group-count';count.textContent=rows.length+' ระบบ';
    headActions.append(count);
    if(groupKey==='line-oa'){
      const exactKeys=new Set(rows.map((item)=>item.key));
      const exactTargets=exactKeys.has('awh-line-gateway')&&exactKeys.has('bay-excuse-line-oa')&&rows.length===2;
      const safeStates=exactTargets&&rows.every((item)=>item.state==='CURRENT'||(item.state==='UPDATE_AVAILABLE'&&item.actionable===true));
      const hasUpdate=rows.some((item)=>item.state==='UPDATE_AVAILABLE'&&item.actionable===true);
      const button=actionButton('อัปเดต LINE OA ทั้งชุด',updateLineOaBundle,'secondary-button update-group-action','group-line-oa');
      button.disabled=!safeStates||!hasUpdate||refreshing;
      button.title=exactTargets?'ยืนยัน Owner ครั้งเดียว แล้วอัปเดตและ verify สอง target ทีละตัว':'รอให้ LINE OA ครบสอง release targets';
      headActions.append(button);
      const groupFeedback=targetFeedback.get('group-line-oa');
      if(groupFeedback){const feedback=document.createElement('div');feedback.className='update-action-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');feedback.dataset.tone=groupFeedback.tone;feedback.textContent=groupFeedback.text;headActions.prepend(feedback);}
    }
    head.append(title,headActions);
    const list=document.createElement('div');list.className='update-group-list';
    for(const item of rows)list.append(renderCard(item));
    section.append(head,list);host.append(section);
  }
  if(!host.childElementCount){const empty=document.createElement('div');empty.className='update-empty';empty.textContent='ไม่พบระบบตามตัวกรองนี้';host.append(empty);}
  renderRuntimeHealth();renderReleaseInfrastructure();renderHistory();summary();renderProgress();
}

function relativeLiveTime(value){
  const at=Date.parse(value||'');if(!Number.isFinite(at))return 'ยังไม่มี event ล่าสุด';
  const seconds=Math.max(0,Math.round((Date.now()-at)/1000));
  if(seconds<2)return 'อัปเดตเมื่อสักครู่';
  if(seconds<60)return 'อัปเดตเมื่อ '+seconds+' วินาทีที่แล้ว';
  return 'อัปเดตเมื่อ '+Math.max(1,Math.round(seconds/60))+' นาทีที่แล้ว';
}

function progressEventFresh(event,maxAgeMs=20000){
  const at=Date.parse(event?.occurredAt||'');
  return Number.isFinite(at)&&(Date.now()-at)>=0&&(Date.now()-at)<=maxAgeMs;
}

function hasActiveUpdate(){
  return Boolean(localOperation)||Boolean(pinnedOperation)||primaryItems().some((item)=>['UPDATING','WAITING_FOR_APPROVAL'].includes(item.state));
}

function stopLiveStream(){
  if(stopLiveUpdates){stopLiveUpdates();stopLiveUpdates=null;}
  liveConnected=false;
}

function liveUiSignature(snapshot){
  const items=Array.isArray(snapshot?.items)?snapshot.items:[];
  return JSON.stringify(items.map((item)=>[
    item?.key||null,item?.state||null,item?.current||null,item?.candidate||null,item?.taskId||null,item?.taskState||null,item?.canCancel===true,
    Number(item?.progress??0),item?.progressEvent?.state||null,item?.progressEvent?.progress??null,item?.progressEvent?.message||null,
  ]));
}

function ensureLiveStream(){
  if(stopLiveUpdates||!hasActiveUpdate())return;
  stopLiveUpdates=subscribeUpdateCenterLive((snapshot)=>{
    const normalized=normalizeUpdateCenter(snapshot);
    const nextSignature=liveUiSignature(normalized);
    const changed=nextSignature!==lastLiveUiSignature;
    liveConnected=true;liveUpdatedAt=Date.now();center=normalized;lastLiveUiSignature=nextSignature;
    $('updates-freshness').textContent='สด · '+new Date(snapshot.generatedAt).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    reconcilePinnedOperation();
    if(!pinnedOperation&&!primaryItems().some((item)=>['UPDATING','WAITING_FOR_APPROVAL'].includes(item.state)))localOperation=null;
    if(changed)render();else renderProgress();
    scheduleRefresh();
  },()=>{
    liveConnected=false;
    scheduleRefresh();
  });
}

function syncLiveStream(){
  if(hasActiveUpdate())ensureLiveStream();else stopLiveStream();
}

function renderProgress(){
  const active=(center?.items||[]).filter((item)=>['UPDATING','WAITING_FOR_APPROVAL'].includes(item.state));
  const host=$('operation-progress');
  const queueHost=$('operation-queue');
  if(!active.length&&!localOperation){host.hidden=true;if(queueHost)queueHost.hidden=true;return;}
  host.hidden=false;
  const queued=active.filter(itemQueued);
  const item=active.find((row)=>row.state==='UPDATING'&&!itemQueued(row))
    ||active.find((row)=>row.state==='WAITING_FOR_APPROVAL')
    ||active[0];
  const waiting=item?.state==='WAITING_FOR_APPROVAL';
  const queuedOnly=itemQueued(item);
  const localForItem=!item||localOperation?.key===item?.key?localOperation:null;
  const progress=queuedOnly?0:Math.max(0,Math.min(100,Number(item?.progressEvent?.progress??item?.progress??(waiting?5:localForItem?.progress??15))));
  $('operation-progress-title').textContent=waiting?'รอยืนยันก่อนติดตั้ง':queuedOnly?('รอคิวอัปเดต '+(item?.name||localForItem?.name||'ระบบ')):('กำลังอัปเดต '+(item?.name||localForItem?.name||'ระบบ'));
  $('operation-progress-percent').textContent=queuedOnly?'รอคิว':Math.round(progress)+'%';
  $('operation-progress-bar').style.width=progress+'%';
  const event=item?.progressEvent||null;
  const eventFresh=liveConnected&&progressEventFresh(event);
  $('operation-progress-message').textContent=ownerProgressMessage(item,event,waiting);
  $('operation-progress-live').textContent=(eventFresh?'● สด · ':(liveConnected?'● เชื่อมต่ออยู่ · ':'สำรอง · '))+relativeLiveTime(event?.occurredAt||null);
  if(queueHost){
    const names=queued.map((row)=>row.name).filter(Boolean);
    queueHost.hidden=names.length===0;
    queueHost.textContent=names.length===0?'':'รอคิว '+names.length+' ระบบ · '+names.join(' · ');
  }
  host.dataset.active=!waiting&&!queuedOnly&&progress<100?'true':'false';
  host.dataset.live=eventFresh?'true':'false';
  const thresholds=[22,54,84,98,100];
  [...$('operation-steps').children].forEach((step,index)=>{
    const previous=index===0?0:thresholds[index-1];
    step.dataset.status=progress>=thresholds[index]?'done':(progress>=previous?'active':'pending');
  });
}

async function updatePlatform(item){
  localOperation={key:item.key,name:'VPS Platform',progress:6,message:'กำลังตรึงรุ่น VPS Platform ที่เลือกและตรวจความพร้อม'};
  const request=await requestPlatformRelease(item.candidate,false);
  pinAcceptedOperation(item,'VPS Platform',request,8,'รับคำสั่งแล้ว · ระบบกำลังตรวจความพร้อม สำรอง ติดตั้ง และ Verify · ไม่ต้องกดซ้ำ');
  message('VPS Platform รับคำสั่งแล้ว · ระบบจะทำต่อและตรวจผลให้อัตโนมัติ ไม่ต้องกดซ้ำ');
  await refresh();
}

async function updateAwh(item){
  const split=item.runtimeState==='SPLIT';
  const detail=split
    ?'ตรวจพบ component บางส่วนอยู่คนละรุ่น ระบบจะใช้ release ล่าสุดเพื่อปรับ Runtime ให้สอดคล้อง แล้วจึง Verify ทั้งชุด'
    :'ระบบจะตรวจทุก gate สำรองข้อมูล ติดตั้ง และ Verify ก่อนเปลี่ยน Production';
  localOperation={key:item.key,name:'AWH',progress:6,message:'กำลังตรึงรุ่น AWH ที่เลือกและตรวจความพร้อม'};
  const request=await requestCoreRelease(item.candidate,false);
  pinAcceptedOperation(item,'AWH',request,8,'รับคำสั่งแล้ว · ระบบกำลังตรวจความพร้อม สำรอง ติดตั้ง และ Verify · ไม่ต้องกดซ้ำ');
  message('AWH รับคำสั่งแล้ว · ระบบจะทำต่อและตรวจผลให้อัตโนมัติ ไม่ต้องกดซ้ำ');
  await refresh();
}
async function resumeLearnLab(item){
  localOperation={key:item.key,name:'LearnLab',progress:6,message:'กำลังทำงานอัปเดตเดิมต่อโดยไม่สร้าง release ซ้ำ'};
  const request=await requestLearnLabRelease(item.candidateReleaseSha,item.candidateVersion);
  pinAcceptedOperation(item,'LearnLab',request,8,'รับคำสั่งแล้ว · กำลังทำงานเดิมต่อและตรวจผล · ไม่ต้องกดซ้ำ');
  message('LearnLab รับคำสั่งแล้ว · ระบบจะทำต่อและตรวจผลให้อัตโนมัติ ไม่ต้องกดซ้ำ');
  await refresh();
}

async function updateAssessment(item){
  const request=await requestAssessmentRelease(item.candidate,item.candidateVersion);
  pinAcceptedOperation(item,'Assessment',request,10,'รับคำสั่งแล้ว · กำลังเตรียม Staging และตรวจผล · ไม่ต้องกดซ้ำ');
  message('Assessment รับคำสั่งแล้ว · ระบบกำลังดำเนินการแบบ staging-first ไม่ต้องกดซ้ำ');
  await refresh();
}

async function updateHosting(item){
  const request=await managedSiteAction(item.siteId,'deploy');
  pinAcceptedOperation(item,item.name,request,8,'รับคำสั่งแล้ว · Managed Hosting กำลังติดตั้งและตรวจ health · ไม่ต้องกดซ้ำ');
  message(item.name+' รับคำสั่งแล้ว · ระบบจะติดตั้งและตรวจ health ให้อัตโนมัติ');
  await refresh();
}

async function updateBay(item){
  const release=item.release;if(!release)return;
  const relay=await createBayRemoteInstallRelay({targetVersion:release.version,targetSha:release.sourceSha,packageSha256:release.packageSha256});
  try{
    const request=await relayBayRemoteCommand(relay.endpoint,relay.relay);
    pinAcceptedOperation(item,item.name,request,8,'รับคำสั่งแล้ว · BAY กำลังติดตั้งและตรวจ version/source · ไม่ต้องกดซ้ำ');
    message(item.name+' รับคำสั่งติดตั้งแล้ว · ระบบกำลังตรวจสถานะใหม่ ไม่ต้องกดซ้ำ');
  }catch(error){
    if(error?.code==='BAY_INSTALL_OUTCOME_UNKNOWN'){
      pinnedOperation={key:item.key,name:item.name,target:String(item.candidate||release.version||''),taskId:null,executionId:null,acceptedAt:Date.now()};persistPinnedOperation();
      localOperation={key:item.key,name:item.name,progress:8,message:'ส่งคำสั่งแล้วแต่การเชื่อมต่อขาด · กำลังตรวจผลก่อน ห้ามติดตั้งซ้ำ'};
      message(friendly(error));await refreshBay();return;
    }
    throw error;
  }
  await refreshBay();
}

const bayCompatTargets=[
  {key:'bay-excuse-line-oa',name:'BAY Excuse LINE OA',kind:'INTEGRATION',group:'line-oa',releaseTrack:'line-oa',sourceReleaseTrack:'line-oa',secretScope:'BAY_EXCUSE_LINE_OA'},
  {key:'bay-cooperative',name:'ศูนย์งานสหกรณ์โรงเรียน',kind:'PRODUCT',group:null,releaseTrack:'cooperative-center',sourceReleaseTrack:'bay-cooperative',secretScope:null},
  {key:'bay-pp',name:'ศูนย์ ปพ.',kind:'PRODUCT',group:null,releaseTrack:'pp-center',sourceReleaseTrack:'bay-pp',secretScope:null},
];

function ensureBayTrackTargets(tracks){
  const bayCore=(center?.items||[]).find((item)=>item.adapter==='BAY_UPDATE_CENTER');
  if(!bayCore)return [];
  const ensured=[];
  for(const definition of bayCompatTargets){
    let item=(center?.items||[]).find((row)=>row.key===definition.key);
    const trackState=tracks?.[definition.releaseTrack];
    if(!item){
      item={
        key:definition.key,
        projectId:bayCore.projectId||null,
        name:definition.name,
        kind:definition.kind,
        adapter:'BAY_UPDATE_CENTER',
        group:definition.group,
        visibility:'PRIMARY',
        releaseTrack:definition.releaseTrack,
        sourceReleaseTrack:definition.sourceReleaseTrack,
        sourceAuthority:'BAY_UPDATE_INBOX',
        secretScope:definition.secretScope,
        state:trackState&&typeof trackState==='object'?'REMOTE_CHECK_REQUIRED':'BLOCKED',
        current:null,
        candidate:null,
        approvalRequired:false,
        actionable:false,
        history:[],
        historyAuthority:'BAY_UPDATE_CENTER:'+definition.releaseTrack,
        reason:trackState&&typeof trackState==='object'
          ?'กำลังตรวจ release track '+definition.releaseTrack+' ของ BAY Excuse'
          :'BAY runtime รุ่นนี้ยังไม่ประกาศ release track '+definition.releaseTrack+' จึงปิดการอัปเดตแบบ fail-closed',
      };
      center.items.push(item);
    }else{
      item.name=definition.name;
      item.kind=definition.kind;
      item.group=definition.group;
      item.visibility='PRIMARY';
      item.releaseTrack=definition.releaseTrack;
      item.sourceReleaseTrack=definition.sourceReleaseTrack;
      item.sourceAuthority=item.sourceAuthority||'BAY_UPDATE_INBOX';
      item.secretScope=definition.secretScope;
      item.history=Array.isArray(item.history)?item.history:[];
      item.historyAuthority=item.historyAuthority||('BAY_UPDATE_CENTER:'+definition.releaseTrack);
    }
    ensured.push(item);
  }
  return ensured;
}

async function refreshBay(){
  const initialItems=(center?.items||[]).filter((row)=>row.adapter==='BAY_UPDATE_CENTER');if(!initialItems.length)return;
  let items=initialItems;
  try{
    const bridge=await loadBayRemoteUpdateStatus();
    bayLive=await relayBayRemoteCommand(bridge.endpoint,bridge.statusRelay);
    const packages=Array.isArray(bayLive.packages)?bayLive.packages:[];
    const tracks=bayLive.releaseTracks&&typeof bayLive.releaseTracks==='object'?bayLive.releaseTracks:{};
    ensureBayTrackTargets(tracks);
    items=(center?.items||[]).filter((row)=>row.adapter==='BAY_UPDATE_CENTER');
    const preflightReady=bayLive.preflight?.ready===true;
    for(const item of items){
      const track=String(item.releaseTrack||'bay-excuse-core');
      const trackState=tracks[track]&&typeof tracks[track]==='object'?tracks[track]:null;
      if(!trackState&&track!=='bay-excuse-core'){
        item.current=null;item.release=null;item.candidate=null;item.trackSourceSha=null;item.trackInherited=false;
        item.actionable=false;item.state='BLOCKED';
        item.reason='BAY runtime รุ่นนี้ยังไม่ประกาศ release track '+track+' จึงยังไม่อนุญาตให้อัปเดต target นี้';
        continue;
      }
      const current=trackState?.currentVersion||(track==='bay-excuse-core'?bayLive.currentVersion:null);
      const release=packages.find((row)=>row?.installable===true&&String(row.releaseTrack||'bay-excuse-core')===track&&['ready','READY'].includes(String(row.state||row.version_state||'')));
      item.current=current||null;item.release=release||null;item.candidate=release?.version||null;
      item.trackSourceSha=trackState?.sourceSha||null;
      item.trackInherited=trackState?.inherited===true;
      item.actionable=Boolean(release)&&preflightReady;
      item.state=item.actionable?'UPDATE_AVAILABLE':(preflightReady?'CURRENT':'BLOCKED');
      item.reason=item.actionable
        ?'มีแพ็กเกจ '+item.name+' ใหม่ที่ผ่านการตรวจและพร้อมติดตั้งแยกจากระบบอื่น'
        :(item.state==='CURRENT'?item.name+' เป็นรุ่นล่าสุดใน release track ของตัวเอง':item.name+' preflight ยังไม่พร้อม');
    }
  }catch(error){
    for(const item of items){item.state='BLOCKED';item.actionable=false;item.reason=friendly(error);}
  }
  render();
}

const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

function lineOaTargets(){
  const group=center?.releaseGroups?.['line-oa'];
  const contractTargets=Array.isArray(group?.targets)?group.targets:[];
  const exactContract=group?.approvalMode==='SIGNED_IN_OWNER'
    &&group?.orchestration==='SEQUENTIAL_VERIFY_EACH'
    &&group?.historyScope==='PER_TARGET'
    &&group?.rollbackScope==='PER_TARGET'
    &&contractTargets.length===2
    &&contractTargets.some((row)=>row?.itemKey==='awh-line-gateway'&&row?.releaseTrack==='awh-line-gateway')
    &&contractTargets.some((row)=>row?.itemKey==='bay-excuse-line-oa'&&row?.releaseTrack==='line-oa');
  if(!exactContract)throw Object.assign(new Error('LINE OA orchestration contract ไม่พร้อม'),{code:'LINE_OA_BOUNDARY_INVALID'});
  const awh=(center?.items||[]).find((item)=>item.key==='awh-line-gateway')||null;
  const bay=(center?.items||[]).find((item)=>item.key==='bay-excuse-line-oa')||null;
  if(!awh||!bay)throw Object.assign(new Error('LINE OA targets ยังไม่ครบสองระบบ'),{code:'LINE_OA_TARGETS_INCOMPLETE'});
  if(awh.adapter!=='MANAGED_HOSTING'||awh.releaseTrack!=='awh-line-gateway'||bay.adapter!=='BAY_UPDATE_CENTER'||bay.releaseTrack!=='line-oa'){
    throw Object.assign(new Error('LINE OA release boundary ไม่ตรงกับ registry'),{code:'LINE_OA_BOUNDARY_INVALID'});
  }
  return {awh,bay};
}

async function waitForAwhLineGateway(targetRevision,previousReleaseId){
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    const snapshot=normalizeUpdateCenter(await loadUpdateCenter());
    center=snapshot;
    const item=(snapshot.items||[]).find((row)=>row.key==='awh-line-gateway');
    if(!item)throw Object.assign(new Error('AWH LINE Gateway หายจาก Update Center'),{code:'LINE_OA_TARGETS_INCOMPLETE'});
    const hostingState=String(item.hostingState||'').toUpperCase();
    const eventState=String(item.lastEvent?.state||'').toUpperCase();
    if(item.state==='BLOCKED'||['FAILED','ERROR','DISABLED'].includes(hostingState)||eventState==='FAILED'){
      throw Object.assign(new Error(item.lastEvent?.message||item.reason||'AWH LINE Gateway verify ไม่ผ่าน'),{code:'LINE_OA_AWH_VERIFY_FAILED'});
    }
    const revision=String(item.currentSourceRevision||'');
    const releaseChanged=!previousReleaseId||!item.currentReleaseId||String(item.currentReleaseId)!==String(previousReleaseId);
    if(item.state==='CURRENT'&&revision===targetRevision&&releaseChanged){render();return item;}
    localOperation={key:'awh-line-gateway',name:'LINE OA · AWH Gateway',progress:35,message:'ติดตั้ง AWH LINE Gateway แล้ว กำลัง verify release ของ target นี้'};
    render();
    await sleep(1500);
  }
  throw Object.assign(new Error('AWH LINE Gateway ยังยืนยัน release ใหม่ไม่ได้ภายในเวลาที่กำหนด'),{code:'LINE_OA_AWH_VERIFY_TIMEOUT'});
}

async function bayLineStatus(){
  const bridge=await loadBayRemoteUpdateStatus();
  return relayBayRemoteCommand(bridge.endpoint,bridge.statusRelay);
}

async function waitForBayLineOa(target){
  const deadline=Date.now()+180000;
  while(Date.now()<deadline){
    const status=await bayLineStatus();
    const track=status?.releaseTracks?.['line-oa'];
    const version=String(track?.currentVersion||'');
    const sourceSha=String(track?.sourceSha||'').toLowerCase();
    if(version===target.version&&sourceSha===String(target.sourceSha||'').toLowerCase()){
      bayLive=status;
      localOperation={key:'bay-excuse-line-oa',name:'LINE OA · BAY Excuse',progress:92,message:'BAY Excuse LINE OA verify ผ่านแล้ว'};
      await refreshBay();
      return track;
    }
    if(status?.preflight?.ready===false)throw Object.assign(new Error('BAY Excuse LINE OA preflight ไม่พร้อมหลังติดตั้ง'),{code:'LINE_OA_BAY_VERIFY_FAILED'});
    localOperation={key:'bay-excuse-line-oa',name:'LINE OA · BAY Excuse',progress:78,message:'กำลัง verify version และ source SHA ของ BAY Excuse LINE OA'};
    renderProgress();
    await sleep(2000);
  }
  throw Object.assign(new Error('BAY Excuse LINE OA ยังยืนยัน version/source ไม่ได้ภายในเวลาที่กำหนด'),{code:'LINE_OA_BAY_VERIFY_TIMEOUT'});
}

async function updateLineOaBundle(){
  const {awh,bay}=lineOaTargets();
  if(['UPDATING','WAITING_FOR_APPROVAL'].includes(awh.state)||['UPDATING','WAITING_FOR_APPROVAL'].includes(bay.state)){
    throw Object.assign(new Error('มี LINE OA target กำลังอัปเดตอยู่แล้ว'),{code:'LINE_OA_UPDATE_IN_PROGRESS'});
  }
  const awhNeedsUpdate=awh.state==='UPDATE_AVAILABLE'&&awh.actionable===true;
  const bayNeedsUpdate=bay.state==='UPDATE_AVAILABLE'&&bay.actionable===true&&bay.release;
  if(!awhNeedsUpdate&&!bayNeedsUpdate){message('LINE OA ทั้งสอง target เป็นรุ่นล่าสุดแล้ว');return;}
  const confirmed=window.confirm('อัปเดต LINE OA ทั้งชุดเฉพาะ 2 target นี้หรือไม่? ระบบจะอัปเดตและ verify ทีละตัว โดยไม่แตะ AWH Core, VPS Platform หรือ BAY Excuse Core');
  if(!confirmed)return;

  let awhVerified=!awhNeedsUpdate;
  try{
    localOperation={key:null,name:'LINE OA ทั้งชุด',progress:8,message:'เริ่มสอง release targets แบบแยก lifecycle'};
    renderProgress();

    if(awhNeedsUpdate){
      const targetRevision=String(awh.candidateSourceRevision||'');
      if(!/^[0-9a-f-]{36}$/i.test(targetRevision))throw Object.assign(new Error('AWH LINE Gateway candidate revision ไม่ถูกต้อง'),{code:'LINE_OA_BOUNDARY_INVALID'});
      const previousReleaseId=awh.currentReleaseId||null;
      localOperation={key:'awh-line-gateway',name:'LINE OA · AWH Gateway',progress:18,message:'กำลังอัปเดต AWH LINE Gateway ผ่าน Managed Hosting เท่านั้น'};
      renderProgress();
      await managedSiteAction(awh.siteId,'deploy');
      await waitForAwhLineGateway(targetRevision,previousReleaseId);
      awhVerified=true;
    }

    await refresh();
    await refreshBay();
    const currentBay=(center?.items||[]).find((item)=>item.key==='bay-excuse-line-oa');
    const bayTarget=currentBay?.release;
    if(currentBay?.state==='UPDATE_AVAILABLE'&&currentBay.actionable===true&&bayTarget){
      if(String(currentBay.releaseTrack)!=='line-oa')throw Object.assign(new Error('BAY LINE package ไม่อยู่ track line-oa'),{code:'LINE_OA_BOUNDARY_INVALID'});
      localOperation={key:'bay-excuse-line-oa',name:'LINE OA · BAY Excuse',progress:58,message:'AWH LINE verify ผ่านแล้ว · กำลังอัปเดต BAY Excuse LINE OA เท่านั้น'};
      renderProgress();
      const relay=await createBayRemoteInstallRelay({targetVersion:bayTarget.version,targetSha:bayTarget.sourceSha,packageSha256:bayTarget.packageSha256});
      try{await relayBayRemoteCommand(relay.endpoint,relay.relay);}
      catch(error){if(error?.code!=='BAY_INSTALL_OUTCOME_UNKNOWN')throw error;}
      await waitForBayLineOa(bayTarget);
    }

    localOperation={key:null,name:'LINE OA ทั้งชุด',progress:100,message:'ตรวจครบแล้ว · สอง target ยังคงมี version/history/rollback แยกจากกัน'};
    message('LINE OA ทั้งชุดตรวจเสร็จแล้ว — แต่ละ target ถูกอัปเดตและ verify แยกกัน');
    await refresh();
  }catch(error){
    localOperation=null;
    try{await refresh();await refreshBay();}catch{}
    const prefix=awhVerified?'หยุดที่ target ถัดไป — AWH LINE ที่ verify แล้วคง release ของตัวเองไว้ · ':'หยุดก่อนเริ่ม target ถัดไป — ';
    throw Object.assign(new Error(prefix+(error?.message||'LINE OA update ไม่ผ่าน')),{code:error?.code||'LINE_OA_GROUP_FAILED'});
  }finally{
    localOperation=null;
    renderProgress();
  }
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

function scheduleRefresh(){
  clearTimeout(refreshTimer);
  const active=hasActiveUpdate()||primaryItems().some((item)=>item.state==='REMOTE_CHECK_REQUIRED');
  syncLiveStream();
  const delay=active?(liveConnected?45000:12000):90000;
  refreshTimer=setTimeout(()=>{if(!document.hidden)void refresh();},delay);
}
async function refresh(options={}){
  if(refreshing)return;
  const manual=options?.manual===true;const initial=options?.initial===true;
  refreshing=true;$('updates-refresh').disabled=true;
  if(!center||manual||initial)$('updates-freshness').textContent=manual?'กำลังตรวจสถานะล่าสุด…':'กำลังตรวจทุกระบบ…';
  try{
    await loadAuthSession();
    center=normalizeUpdateCenter(await loadUpdateCenter());
    lastLiveUiSignature=liveUiSignature(center);
    reconcilePinnedOperation();
    $('updates-freshness').textContent='ตรวจล่าสุด '+new Date(center.generatedAt).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
    render();
    await Promise.allSettled([refreshBay(),refreshAgent()]);
    reconcilePinnedOperation();
    if(!pinnedOperation&&!primaryItems().some((item)=>['UPDATING','WAITING_FOR_APPROVAL'].includes(item.state)))localOperation=null;
    reconcileRecoveredActionMessage();
  }catch(error){
    if(center){
      message('การตรวจรอบล่าสุดขัดข้องชั่วคราว · กำลังใช้สถานะล่าสุดที่ยืนยันได้ และจะลองใหม่อัตโนมัติ','info');
      $('updates-freshness').textContent='ใช้สถานะล่าสุด · จะตรวจใหม่อัตโนมัติ';
    }else{
      message(friendly(error));$('updates-overall').textContent='ตรวจไม่สำเร็จ';$('updates-overall').dataset.tone='bad';
    }
  }finally{
    refreshing=false;$('updates-refresh').disabled=false;summary();renderProgress();scheduleRefresh();
  }
}

function syncStickyOffset(){
  const header=document.querySelector('.updates-header');
  if(!header)return;
  document.documentElement.style.setProperty('--updates-header-height',Math.ceil(header.getBoundingClientRect().height)+'px');
}
window.addEventListener('resize',syncStickyOffset,{passive:true});
window.addEventListener('orientationchange',()=>setTimeout(syncStickyOffset,0));
syncStickyOffset();

$('updates-refresh').addEventListener('click',()=>void refresh({manual:true}));
$('show-attention').addEventListener('click',()=>{
  attentionOnly=!attentionOnly;
  $('show-attention').textContent=attentionOnly?'แสดงทุกระบบ':'แสดงเฉพาะที่ต้องจัดการ';
  render();
});
$('runtime-health-details').addEventListener('click',()=>{
  $('advanced-diagnostics').open=true;
  $('advanced-diagnostics').scrollIntoView({behavior:'smooth',block:'start'});
});
$('update-search').addEventListener('input',(event)=>{
  searchTerm=String(event.target.value||'').trim().toLocaleLowerCase('th');render();
});
document.querySelectorAll('.filter-chip').forEach((button)=>button.addEventListener('click',()=>{
  filterMode=button.dataset.filter||'ALL';
  document.querySelectorAll('.filter-chip').forEach((chip)=>chip.classList.toggle('is-active',chip===button));
  render();
}));
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopLiveStream();return;}void refresh();});
window.__AWH_UPDATE_CENTER_BOOT_OK__=true;
try{sessionStorage.removeItem('awh-update-center-boot-__AWH_WEB_RELEASE_ID__');}catch{}
void refresh({initial:true});
