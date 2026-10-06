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
let liveWatchdogTimer=null;
let lastLiveUiSignature='';
const LIVE_SIGNAL_STALE_MS=18000;
const LIVE_WATCHDOG_MS=5000;
const ACTIVE_REFRESH_MS=10000;
const IDLE_REFRESH_MS=60000;
const actionInFlightTargets=new Set();
const targetFeedback=new Map();
const OWNER_OPERATION_STORAGE_KEY='awh-update-center-owner-operations-v2';
const LEGACY_OWNER_OPERATION_STORAGE_KEY='awh-update-center-owner-operation-v1';
const OWNER_OPERATION_OUTCOME_PROBE_MS=30000;
const OWNER_OPERATION_MAX_AGE_MS=21600000;
const QUEUED_RELEASE_TASK_STATES=new Set(['QUEUED','WAITING_FOR_WORKER','WAITING_FOR_CAPABILITY']);
const itemQueued=(item)=>item?.state==='UPDATING'&&QUEUED_RELEASE_TASK_STATES.has(String(item?.taskState||'').toUpperCase());

function operationTarget(item){
  return String(item?.candidate||item?.candidateReleaseSha||item?.release?.sourceSha||item?.release?.version||'');
}
function readPinnedOperations(){
  const map=new Map();
  try{
    const raw=sessionStorage.getItem(OWNER_OPERATION_STORAGE_KEY);
    const parsed=raw?JSON.parse(raw):null;
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){
      for(const [key,value] of Object.entries(parsed)){
        if(!key||!value||typeof value!=='object'||!Number.isFinite(Number(value.acceptedAt)))continue;
        if(Date.now()-Number(value.acceptedAt)>OWNER_OPERATION_MAX_AGE_MS)continue;
        map.set(key,{...value,key});
      }
    }
    if(map.size===0){
      const legacyRaw=sessionStorage.getItem(LEGACY_OWNER_OPERATION_STORAGE_KEY);
      const legacy=legacyRaw?JSON.parse(legacyRaw):null;
      if(legacy&&typeof legacy==='object'&&typeof legacy.key==='string'&&Number.isFinite(Number(legacy.acceptedAt))&&Date.now()-Number(legacy.acceptedAt)<=OWNER_OPERATION_MAX_AGE_MS){
        map.set(legacy.key,{...legacy,status:'ACCEPTED'});
      }
      sessionStorage.removeItem(LEGACY_OWNER_OPERATION_STORAGE_KEY);
    }
  }catch{}
  return map;
}
let pinnedOperations=readPinnedOperations();
function persistPinnedOperations(){
  try{
    if(pinnedOperations.size===0){sessionStorage.removeItem(OWNER_OPERATION_STORAGE_KEY);return;}
    const value={};for(const [key,operation] of pinnedOperations)value[key]=operation;
    sessionStorage.setItem(OWNER_OPERATION_STORAGE_KEY,JSON.stringify(value));
  }catch{}
}
function syncPinnedOperationProjection(){
  if(!center)return;
  summary();renderNextAction();renderProgress();
}
function pinnedOperationFor(key){return typeof key==='string'?pinnedOperations.get(key)||null:null;}
function pinnedFor(item){return Boolean(pinnedOperationFor(item?.key));}
function clearPinnedOperation(key){
  if(typeof key!=='string'||!pinnedOperations.has(key))return;
  pinnedOperations.delete(key);persistPinnedOperations();
}
function activeServerItems(){return primaryItems().filter((item)=>['UPDATING','WAITING_FOR_APPROVAL'].includes(item.state));}
function operationWillQueue(targetKey){
  if(typeof targetKey!=='string'||targetKey==='')return false;
  if(activeServerItems().some((item)=>item.key!==targetKey&&item.state==='UPDATING'&&!itemQueued(item)))return true;
  for(const [key,operation] of pinnedOperations){
    if(key===targetKey)continue;
    if(['SUBMITTING','ACCEPTED','ACTIVE'].includes(String(operation?.status||'')))return true;
  }
  return false;
}
function ownerActionLocked(targetKey){
  if(typeof targetKey!=='string'||targetKey==='')return false;
  if(actionInFlightTargets.has(targetKey)||pinnedOperations.has(targetKey))return true;
  const same=primaryItems().find((item)=>item.key===targetKey);
  return Boolean(same&&['UPDATING','WAITING_FOR_APPROVAL'].includes(same.state));
}
function beginPinnedOperation(item,name,queuedHint=false){
  const key=String(item?.key||'');if(!key)return null;
  const existing=pinnedOperations.get(key);if(existing)return existing;
  const operation={key,name,target:operationTarget(item)||null,taskId:null,executionId:null,acceptedAt:Date.now(),status:queuedHint?'QUEUED':'SUBMITTING'};
  pinnedOperations.set(key,operation);persistPinnedOperations();
  if(!queuedHint)localOperation={key,name,progress:6,message:'กำลังส่งคำสั่งและตรึงรุ่นที่อนุมัติ'};
  targetFeedback.set(key,{text:queuedHint?'กำลังส่งคำขอเข้าคิว · รุ่นที่เลือกจะไม่ถูกสลับระหว่างรอ':'กำลังส่งคำสั่งและตรึงรุ่นที่อนุมัติ',tone:'info'});
  syncPinnedOperationProjection();
  return operation;
}
function pinAcceptedOperation(item,name,request,progress,messageText,queuedHint=false){
  const key=String(item?.key||'');if(!key)return false;
  const queued=queuedHint||QUEUED_RELEASE_TASK_STATES.has(String(request?.state||'').toUpperCase())&&operationWillQueue(key);
  const previous=pinnedOperations.get(key)||{};
  const operation={...previous,key,name,target:previous.target||operationTarget(item)||null,taskId:request?.taskId||previous.taskId||null,executionId:request?.executionId||previous.executionId||null,acceptedAt:Number(previous.acceptedAt||Date.now()),status:queued?'QUEUED':'ACCEPTED'};
  pinnedOperations.set(key,operation);persistPinnedOperations();
  if(!queued)localOperation={key,name,progress,message:messageText};
  targetFeedback.set(key,{text:queued?'รับคำสั่งแล้ว · รอคิว · จะเริ่มอัตโนมัติเมื่อรายการก่อนหน้าจบ':'เริ่มอัปเดตแล้ว · ระบบกำลังทำงานและตรวจผลให้อัตโนมัติ',tone:'info'});
  syncPinnedOperationProjection();
  return queued;
}
function markPinnedOutcomeUnknown(item,name){
  const key=String(item?.key||'');if(!key)return;
  const previous=pinnedOperations.get(key)||{key,name,target:operationTarget(item)||null,acceptedAt:Date.now()};
  pinnedOperations.set(key,{...previous,key,name,status:'OUTCOME_UNKNOWN',outcomeUnknownAt:Date.now()});persistPinnedOperations();
  targetFeedback.set(key,{text:'การตอบกลับขาดหายหลังส่งคำสั่ง · กำลังยืนยันงานเดิมให้อัตโนมัติ',tone:'info'});
  syncPinnedOperationProjection();
}
function queuedPinnedOperations(){return [...pinnedOperations.values()].filter((operation)=>operation?.status==='QUEUED');}
function reconcilePinnedOperations(){
  if(pinnedOperations.size===0)return;
  let changed=false;
  for(const [key,operation] of [...pinnedOperations]){
    const item=primaryItems().find((row)=>row.key===key);
    const age=Date.now()-Number(operation.acceptedAt||0);
    if(age>OWNER_OPERATION_MAX_AGE_MS){pinnedOperations.delete(key);changed=true;continue;}
    if(!item)continue;
    const serverTask=typeof item.taskId==='string'?item.taskId:null;
    const sameTask=!operation.taskId||!serverTask||operation.taskId===serverTask;
    if(['UPDATING','WAITING_FOR_APPROVAL'].includes(item.state)&&sameTask){
      const queued=itemQueued(item);
      operation.status=queued?'QUEUED':'ACTIVE';
      if(serverTask)operation.taskId=serverTask;
      pinnedOperations.set(key,operation);changed=true;
      targetFeedback.set(key,{text:queued?'รับคำสั่งแล้ว · รอคิว · จะเริ่มอัตโนมัติเมื่อรายการก่อนหน้าจบ':ownerProgressMessage(item,item.progressEvent,item.state==='WAITING_FOR_APPROVAL'),tone:'info'});
      if(!queued&&(!localOperation||localOperation.key===key))localOperation={key,name:operation.name||item.name,progress:Math.max(8,Number(item?.progressEvent?.progress??item?.progress??8)),message:ownerProgressMessage(item,item.progressEvent,item.state==='WAITING_FOR_APPROVAL')};
      continue;
    }
    if(item.state==='CURRENT'){
      targetFeedback.set(key,{text:'อัปเดตสำเร็จ · ตรวจ Production แล้ว',tone:'good'});
      pinnedOperations.delete(key);if(localOperation?.key===key)localOperation=null;changed=true;continue;
    }
    if(item.state==='BLOCKED'){
      targetFeedback.set(key,{text:'รอบล่าสุดหยุดอย่างปลอดภัย · รุ่นที่ใช้งานอยู่ยังคงเดิม กรุณาดูเหตุผลก่อนลองใหม่',tone:'bad'});
      pinnedOperations.delete(key);if(localOperation?.key===key)localOperation=null;changed=true;continue;
    }
    if(item.state==='UPDATE_AVAILABLE'&&!item.taskId&&!item.approvalId){
      const uncertain=operation.status==='OUTCOME_UNKNOWN'&&Date.now()-Number(operation.outcomeUnknownAt||operation.acceptedAt||0)<OWNER_OPERATION_OUTCOME_PROBE_MS;
      if(uncertain){targetFeedback.set(key,{text:'กำลังยืนยันคำสั่งล่าสุด · สถานะจะอัปเดตให้อัตโนมัติ',tone:'info'});continue;}
      targetFeedback.set(key,{text:operation.status==='OUTCOME_UNKNOWN'?'ไม่พบงานจากคำสั่งรอบก่อน · พร้อมให้ลองอีกครั้ง':'งานรอบก่อนสิ้นสุดแล้ว · มีรุ่นใหม่พร้อมอัปเดต',tone:'info'});
      pinnedOperations.delete(key);if(localOperation?.key===key)localOperation=null;changed=true;continue;
    }
  }
  if(changed)persistPinnedOperations();
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
let lastAnnouncement='';
function announce(text){
  const value=String(text||'').trim();if(!value||value===lastAnnouncement)return;
  lastAnnouncement=value;
  const host=$('update-announcer');if(!host)return;
  host.textContent='';
  window.setTimeout(()=>{host.textContent=value;},20);
}
const message=(text,tone='info')=>{const host=$('updates-message');host.textContent=text;host.dataset.tone=tone;announce(text);};

const friendly=(error)=>{
  const code=String(error?.code||'').toUpperCase();
  return ({
    STEP_UP_REQUIRED:'ต้องยืนยันสิทธิ์เจ้าของระบบก่อนทำรายการนี้',
    STEP_UP_CANCELLED:'ยกเลิกการยืนยันสิทธิ์แล้ว',
    CORE_RELEASE_CONFLICT:'AWH กำลังอัปเดตอยู่แล้ว · ระบบกำลังติดตามงานเดิมให้อัตโนมัติ',
    CORE_RELEASE_NOT_READY:'AWH ยังไม่พร้อมเริ่มอัปเดต · ระบบจะตรวจความพร้อมให้อัตโนมัติ',
    CORE_RELEASE_TARGET_MOVED:'มีรุ่นใหม่กว่าเข้ามาแล้ว ระบบยกเลิกรุ่นเก่าอย่างปลอดภัย กรุณาตรวจอีกครั้ง',
    PLATFORM_RELEASE_NOT_READY:'VPS Platform ยังไม่พร้อมเริ่มอัปเดต · ระบบจะตรวจความพร้อมให้อัตโนมัติ',
    LEARNLAB_RELEASE_TARGET_MOVED:'LearnLab มีรุ่นใหม่กว่าเข้ามาแล้ว กรุณาตรวจอีกครั้ง',
    ASSESSMENT_RELEASE_CONFLICT:'Assessment กำลังอัปเดตอยู่แล้ว · ระบบกำลังติดตามงานเดิมให้อัตโนมัติ',
    ASSESSMENT_RELEASE_TARGET_MOVED:'Assessment มี candidate ใหม่กว่า ระบบหยุดรุ่นเก่าอย่างปลอดภัย',
    ASSESSMENT_RELEASE_NOT_READY:'Assessment ยังไม่พร้อมอัปเดต',
    PROJECT_SOURCE_NOT_READY:'รุ่นของระบบนี้ยังไม่พร้อมติดตั้ง · ระบบจะตรวจใหม่ให้อัตโนมัติ',
    BAY_UPDATE_NOT_GREEN:'BAY รุ่นล่าสุดยังตรวจไม่ครบ จึงยังไม่เริ่มติดตั้ง',
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
function itemRequiresReview(item){
  return !['CURRENT','INTERNAL_MANAGED','UPDATE_AVAILABLE','WAITING_FOR_APPROVAL','UPDATING'].includes(String(item?.state||''));
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
    $('runtime-health-detail').textContent='หน้าเว็บ ระบบควบคุม และบริการที่เกี่ยวข้องใช้รุ่นที่สอดคล้องกัน';
  }else if(state==='SPLIT'){
    $('runtime-health-title').textContent='พบส่วนระบบอยู่คนละรุ่น';
    $('runtime-health-detail').textContent='ระบบจะจัดให้ส่วนต่าง ๆ กลับมาเป็นรุ่นเดียวกันผ่านการอัปเดตครั้งเดียว ไม่ต้องแยกอัปเดตเอง';
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
  // Mirror the canonical Storage Guard warning boundary so Owner UI never says
  // READY while the platform authority is already protecting headroom.
  const storageWarn=Boolean(telemetryReady)&&!storageBlocked&&((used!==null&&used>=75)||(Number.isFinite(free)&&free<16*1024**3));
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
    $('release-runner-state').textContent='ยังไม่ได้ติดตั้ง — ไม่จำเป็นต่อการใช้งานปัจจุบัน Production รับ Build/QA แบบจำกัดทรัพยากรได้';
    $('release-runner-platform').textContent='ตัวเลือกขยายระบบในอนาคต เมื่อ Build/QA เริ่มกระทบ Production';
    $('release-runner-activity').textContent='สถานะ Optional';
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
          ?'ปล่อยรุ่นได้แบบระวัง · Storage Guard และ cleanup จะ reclaim อัตโนมัติ โดยไม่ต้องมี Runner แยก'
          :'พร้อมรับ release ตาม exact-SHA และ resource-scoped single-writer policy';
  $('release-capacity-storage').textContent='Headroom '+(Number.isFinite(free)?sizeText(free):'—');
  $('release-capacity-mutations').textContent=activeMutations>0
    ?('Writer '+activeMutations+(waitingMutations>0?' · เก็บรอเงื่อนไข '+waitingMutations:''))
    :(waitingMutations>0?'Writer 0 · ไม่มี blocker · งานรอเงื่อนไข '+waitingMutations:'Writer 0 · ไม่มี blocker');
  document.querySelector('.infrastructure-card[data-role="release"]').dataset.state=storageBlocked?'BLOCKED':releaseReady?'READY':'WARN';

  chip.dataset.state=storageBlocked?'BLOCKED':(!telemetryReady||storageWarn?'WARN':'READY');
  chip.textContent=storageBlocked?'ยังไม่พร้อมปล่อยรุ่น':(!telemetryReady?'กำลังยืนยัน Infrastructure':storageWarn?'พร้อมแบบมีคำเตือน':'พร้อม');
}

function itemVisibility(item){
  return item?.visibility==='ADVANCED'?'ADVANCED':'PRIMARY';
}
function primaryItems(){
  return (center?.items||[]).filter((item)=>itemVisibility(item)==='PRIMARY');
}
function ownerFacingName(item){
  if(item?.adapter==='PLATFORM_RELEASE')return 'ระบบพื้นฐาน AWH';
  if(item?.adapter==='CORE_RELEASE')return 'AWH';
  return String(item?.name||'ระบบ');
}
function renderNextAction(){
  const host=$('updates-next'),title=$('updates-next-title'),detail=$('updates-next-detail'),action=$('updates-next-action');
  if(!host||!title||!detail||!(action instanceof HTMLAnchorElement))return;
  const items=primaryItems();
  const active=items.find((item)=>itemQueued(item)||item.state==='UPDATING'||pinnedFor(item));
  const waiting=items.find((item)=>item.state==='WAITING_FOR_APPROVAL');
  const update=items.find((item)=>item.state==='UPDATE_AVAILABLE'&&item.actionable!==false);
  const review=items.filter((item)=>itemRequiresReview(item));
  action.hidden=true;host.dataset.state='ready';
  if(active){
    title.textContent='ระบบกำลังทำงานต่อให้อยู่';
    detail.textContent=ownerFacingName(active)+' กำลังดำเนินการ · ระบบจะติดตามผลให้อัตโนมัติ';
    host.dataset.state='progress';return;
  }
  const next=waiting||update;
  if(next){
    title.textContent=waiting?'มีงานเดิมรอคุณทำต่อ':'มี 1 รายการให้คุณเลือกอัปเดต';
    detail.textContent=ownerFacingName(next)+(waiting?' พร้อมทำต่อจากงานเดิม':' พร้อมอัปเดตเมื่อคุณต้องการ');
    action.href='#update-card-'+safeDomId(next.key);action.textContent=waiting?'ไปทำต่อ':'ดูรายการนี้';action.hidden=false;
    host.dataset.state='action';return;
  }
  if(review.length){
    title.textContent='ตอนนี้ยังไม่ต้องกดอะไร';
    detail.textContent='AWH กำลังตรวจ '+review.length+' รายการที่ยังไม่พร้อมดำเนินการ และจะไม่ฝืนอัปเดต';
    host.dataset.state='checking';return;
  }
  title.textContent='ไม่ต้องทำอะไรตอนนี้';
  detail.textContent='ระบบที่พร้อมใช้งานเป็นรุ่นปัจจุบัน และไม่มีงานรอการตัดสินใจ';
}

function summary(){
  const counts={current:0,update:0,progress:0,queue:0,attention:0};
  for(const item of primaryItems()){
    if(pinnedFor(item)){counts.progress++;if(pinnedOperationFor(item.key)?.status==='QUEUED')counts.queue++;continue;}
    if(['CURRENT','INTERNAL_MANAGED'].includes(item.state))counts.current++;
    else if(item.state==='UPDATE_AVAILABLE')counts.update++;
    else if(['WAITING_FOR_APPROVAL','UPDATING'].includes(item.state)){counts.progress++;if(itemQueued(item))counts.queue++;}
    else if(itemRequiresReview(item))counts.attention++;
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
    overall.textContent=counts.queue>0?'กำลังดำเนินการ · รอคิว '+counts.queue:'กำลังดำเนินการ';overall.dataset.tone='info';
  }else if(counts.queue>0){
    overall.textContent='รอคิว '+counts.queue+' รายการ';overall.dataset.tone='info';
  }else if(counts.update>0){
    overall.textContent=counts.update+' รายการพร้อมอัปเดต';overall.dataset.tone='info';
  }else if(counts.attention>0){
    overall.textContent='มีรายการต้องตรวจ';overall.dataset.tone='warn';
  }else{
    overall.textContent='ระบบเป็นปัจจุบัน';overall.dataset.tone='good';
  }
  if(running>0)document.title='กำลังอัปเดต · AWH Update Center';
  else if(counts.queue>0)document.title='รอคิว '+counts.queue+' · AWH Update Center';
  else if(counts.update>0)document.title='มีอัปเดต '+counts.update+' · AWH Update Center';
  else if(counts.attention>0)document.title='มีรายการต้องตรวจ · AWH Update Center';
  else document.title='Update Center · KRUART AWH';
}

function releaseText(item){
  const pinned=pinnedOperationFor(item?.key);
  if(pinned?.status==='QUEUED')return 'รับคำสั่งแล้ว · รอคิว · รุ่นที่อนุมัติ '+short(pinned.target);
  if(pinned?.status==='OUTCOME_UNKNOWN')return 'ส่งคำสั่งแล้ว · กำลังยืนยันงานเดิม';
  if(pinned)return 'รับคำสั่งแล้ว · กำลังยืนยันสถานะล่าสุด';
  if(item?.activeReleaseSha&&itemQueued(item))return 'รอคิว · รุ่นที่อนุมัติ '+short(item.activeReleaseSha);
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
  const values=[adapterLabel(item.adapter),item.current?'current '+short(item.current):null,item.candidate?'candidate '+short(item.candidate):null,item.activeReleaseSha?'approved '+short(item.activeReleaseSha):null];
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

const TACTILE_SELECTOR='.primary-button,.secondary-button,.text-button,.filter-chip,.awh-back-link,.update-technical summary,.release-notes>summary,.target-history>summary,.updates-secondary-panel>summary,.infrastructure-details>summary';
function tactileControl(target){return target instanceof Element?target.closest(TACTILE_SELECTOR):null;}
function rippleControl(control,event){
  if(!(control instanceof HTMLElement)||control.matches(':disabled'))return;
  const previous=control.querySelector(':scope > .update-tap-ripple');if(previous)previous.remove();
  const rect=control.getBoundingClientRect();
  const ripple=document.createElement('span');ripple.className='update-tap-ripple';ripple.setAttribute('aria-hidden','true');
  const x=Number.isFinite(event?.clientX)&&event.clientX>0?event.clientX-rect.left:rect.width/2;
  const y=Number.isFinite(event?.clientY)&&event.clientY>0?event.clientY-rect.top:rect.height/2;
  ripple.style.left=Math.max(0,Math.min(rect.width,x))+'px';ripple.style.top=Math.max(0,Math.min(rect.height,y))+'px';
  control.append(ripple);window.setTimeout(()=>ripple.remove(),520);
}
function flashControlAck(control,text='✓',tone='good'){
  if(!(control instanceof HTMLElement))return;
  const previous=control.querySelector(':scope > .control-ack');if(previous)previous.remove();
  const ack=document.createElement('span');ack.className='control-ack';ack.dataset.tone=tone;ack.textContent=text;ack.setAttribute('aria-hidden','true');
  control.append(ack);window.setTimeout(()=>ack.remove(),980);
}
function pulseFeedbackCard(targetKey){
  if(!targetKey)return;
  for(const card of document.querySelectorAll('.update-card')){
    if(card.dataset.key!==targetKey)continue;
    card.dataset.feedbackPulse='true';window.setTimeout(()=>delete card.dataset.feedbackPulse,560);
  }
}
function installTactileFeedback(){
  document.addEventListener('pointerdown',(event)=>{
    const control=tactileControl(event.target);if(!control||control.matches(':disabled'))return;
    control.classList.add('is-pointer-down');rippleControl(control,event);
  },{capture:true,passive:true});
  const release=(event)=>{const control=tactileControl(event.target);if(control)control.classList.remove('is-pointer-down');};
  document.addEventListener('pointerup',release,{capture:true,passive:true});
  document.addEventListener('pointercancel',release,{capture:true,passive:true});
  document.addEventListener('pointerleave',release,{capture:true,passive:true});
  document.addEventListener('keydown',(event)=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    const control=tactileControl(event.target);if(!control||control.matches(':disabled'))return;
    rippleControl(control,{clientX:0,clientY:0});
  },true);
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
    if(!feedback){feedback=document.createElement('div');feedback.className='update-action-feedback';actions.prepend(feedback);}
    feedback.dataset.tone=stored.tone;feedback.textContent=stored.text;
  }
}
function actionFeedback(button,text,tone='info',targetKey=null){
  const key=targetKey||button?.dataset?.targetKey||null;
  if(key){targetFeedback.set(key,{text,tone});pulseFeedbackCard(key);}
  const actions=button?.closest?.('.update-actions');
  if(actions){
    let feedback=actions.querySelector('.update-action-feedback');
    if(!feedback){feedback=document.createElement('div');feedback.className='update-action-feedback';actions.prepend(feedback);}
    feedback.dataset.tone=tone;feedback.textContent=text;
  }
  paintTargetFeedback(key);announce(text);
}
function confirmUpdate({title='ยืนยันการอัปเดต',description='ตรวจรายการก่อนเริ่ม',confirmLabel='ยืนยันและอัปเดต'}={}){
  const dialog=$('update-confirm-dialog');
  if(!(dialog instanceof HTMLDialogElement)||typeof dialog.showModal!=='function'){announce('เบราว์เซอร์นี้ยังไม่รองรับหน้าต่างยืนยันการอัปเดต');return Promise.resolve(false);}
  $('update-confirm-title').textContent=title;$('update-confirm-description').textContent=description;$('update-confirm-submit').textContent=confirmLabel;
  dialog.returnValue='cancel';dialog.showModal();
  window.setTimeout(()=>$('update-confirm-cancel')?.focus(),0);
  return new Promise((resolve)=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));
}

function actionErrorTone(error){
  const code=String(error?.code||'').toUpperCase();
  return /(?:_CONFLICT|_NOT_READY|_QUEUE_FAILED|_TARGET_MOVED|_VERSION_STALE|_DETAILS_REQUIRED|_APPROVAL_EXPIRED)$/.test(code)?'info':'bad';
}
function actionErrorText(error,button){
  const code=String(error?.code||'').toUpperCase();
  if(code==='CORE_RELEASE_NOT_READY'){
    const platform=(center?.items||[]).find((item)=>item.adapter==='PLATFORM_RELEASE');
    return 'AWH ยังอัปเดตไม่ได้ · '+ownerFacingReason(platform);
  }
  const text=friendly(error);
  if(text==='AWH ไม่สามารถดำเนินการได้ในขณะนี้'){
    const key=String(button?.dataset?.targetKey||'');
    const item=(center?.items||[]).find((row)=>row?.key===key);
    const name=String(item?.name||'ระบบนี้');
    return name+' ยังไม่เริ่มอัปเดต · รุ่นที่ใช้งานอยู่ยังคงเดิม ระบบจะตรวจสถานะล่าสุดให้อัตโนมัติ';
  }
  return text;
}
function actionButton(text,handler,className='primary-button',targetKey=null,successText='เริ่มอัปเดตแล้ว · ระบบกำลังทำงานและตรวจผลให้อัตโนมัติ',allowDuringOperation=false){
  const button=document.createElement('button');button.type='button';button.className=className;button.textContent=text;if(targetKey)button.dataset.targetKey=targetKey;
  if(!allowDuringOperation&&ownerActionLocked(targetKey)){
    button.dataset.operationState='active';button.disabled=true;button.setAttribute('aria-busy','true');button.title='กำลังดำเนินการอยู่ · สถานะจะอัปเดตให้อัตโนมัติ';
    button.textContent='กำลังดำเนินการ…';
  }
  button.addEventListener('click',async()=>{
    const initialText=button.textContent;
    const queuedHint=operationWillQueue(targetKey);
    if(targetKey)actionInFlightTargets.add(targetKey);
    button.disabled=true;button.dataset.busy='true';button.dataset.operationState=queuedHint?'queueing':'starting';button.setAttribute('aria-busy','true');
    button.textContent=queuedHint?'กำลังเข้าคิว…':'กำลังเริ่มอัปเดต…';
    actionFeedback(button,queuedHint?'กำลังจัดคิวให้อัตโนมัติ · รุ่นที่เลือกถูกตรึงไว้แล้ว':'กำลังเตรียมการอัปเดต · ระบบกำลังตรวจความพร้อม','info',targetKey);
    try{
      const result=await handler();
      const feedback=typeof result?.feedback==='string'?result.feedback:successText;
      if(result?.cancelled===true){
        delete button.dataset.operationState;button.textContent=initialText;actionFeedback(button,feedback,'info',targetKey);flashControlAck(button,'ยังไม่เริ่ม','info');
      }else{
        button.dataset.operationState=result?.queued?'queued':'accepted';
        button.textContent=result?.queued?'✓ เข้าคิวแล้ว':'✓ เริ่มอัปเดตแล้ว';
        actionFeedback(button,feedback,result?.tone||'info',targetKey);flashControlAck(button,result?.queued?'✓ เข้าคิว':'✓ เริ่มแล้ว','info');
      }
    }
    catch(error){
      const outcomeUnknown=error?.outcomeUnknown===true||String(error?.code||'').toUpperCase()==='UPDATE_OUTCOME_UNKNOWN';
      if(outcomeUnknown){
        const text='ส่งคำสั่งแล้ว · กำลังยืนยันสถานะงานให้อัตโนมัติ';
        button.dataset.operationState='checking';button.textContent='กำลังยืนยันสถานะ…';
        message(text,'info');actionFeedback(button,text,'info',targetKey);flashControlAck(button,'กำลังตรวจ','info');void refresh();
      }else{
        clearPinnedOperation(targetKey);if(localOperation?.key===targetKey)localOperation=null;
        button.dataset.operationState='error';button.textContent='ตรวจสอบสถานะ';
        const text=actionErrorText(error,button);const tone=actionErrorTone(error);message(text,tone);actionFeedback(button,text,tone,targetKey);flashControlAck(button,tone==='bad'?'ตรวจสอบ':'กำลังซิงก์',tone);syncLiveStream();renderProgress();
      }
    }
    finally{
      if(targetKey)actionInFlightTargets.delete(targetKey);button.removeAttribute('data-busy');
      const locked=!allowDuringOperation&&ownerActionLocked(targetKey);
      if(locked){button.disabled=true;button.setAttribute('aria-busy','true');button.dataset.operationState=button.dataset.operationState||'active';}
      else{button.disabled=false;button.removeAttribute('aria-busy');delete button.dataset.operationState;button.textContent=initialText;}
    }
  });
  return button;
}
function ownerFacingReason(item){
  if(!item)return 'ระบบที่เกี่ยวข้องยังไม่พร้อม';
  if(item?.dispatcherState==='RECOVERING')return 'ตัวควบคุมการอัปเดตขาด heartbeat ชั่วคราว · ระบบกำลังกู้และจะทำต่องานเดิมอัตโนมัติ';
  const pinned=pinnedOperationFor(item?.key);
  if(pinned?.status==='QUEUED')return 'รับคำสั่งแล้ว · อยู่ในคิวและจะเริ่มอัตโนมัติเมื่อรายการก่อนหน้าจบ';
  if(pinned?.status==='OUTCOME_UNKNOWN')return 'ส่งคำสั่งแล้ว · กำลังยืนยันงานเดิมให้อัตโนมัติ';
  if(pinned)return 'เริ่มอัปเดตแล้ว · ระบบกำลังทำงานและตรวจผลให้อัตโนมัติ';
  const reason=String(item.reason||'').trim();
  if(itemQueued(item))return 'รับคำสั่งแล้ว · อยู่ในคิวและจะเริ่มอัตโนมัติเมื่อรายการก่อนหน้าจบ';
  if(item.state==='CURRENT')return 'ระบบนี้เป็นรุ่นล่าสุด';
  if(item.state==='UPDATE_AVAILABLE')return 'มีรุ่นใหม่พร้อมอัปเดต';
  if(item.state==='UPDATING')return 'ระบบกำลังอัปเดตและตรวจสอบผล';
  if(item.state==='WAITING_FOR_APPROVAL')return 'พบงานอัปเดตเดิมที่รอการอนุมัติ · เมื่ออนุมัติแล้วระบบจะทำต่ออัตโนมัติจากงานเดิม';
  if(item.state==='REMOTE_CHECK_REQUIRED')return 'กำลังตรวจสถานะล่าสุด';
  if(item.state==='INTERNAL_MANAGED')return 'ระบบนี้ดูแลการอัปเดตให้อัตโนมัติ';
  if(/storage/i.test(reason))return 'พื้นที่สำหรับอัปเดตยังไม่เพียงพอ ระบบจะไม่เริ่มจนกว่าจะปลอดภัย';
  if(/worker|release controller|authority|lease|mutation|candidate|source sha|exact[- ]sha/i.test(reason))return 'ระบบกำลังตรวจความพร้อมของเส้นทางอัปเดต';
  return reason||'กำลังตรวจความพร้อม';
}
function ownerStageElapsed(event){
  const started=Date.parse(String(event?.occurredAt||''));
  if(!Number.isFinite(started))return '';
  const minutes=Math.floor(Math.max(0,Date.now()-started)/60000);
  return minutes>=1?` · ขั้นนี้ ${minutes} นาที`:'';
}
function ownerProgressMessage(item,event,waiting){
  if(waiting)return 'รอการอนุมัติ · เมื่ออนุมัติแล้วระบบจะทำต่ออัตโนมัติจากงานเดิม';
  if(item?.dispatcherState==='RECOVERING')return 'ตัวควบคุมการอัปเดตขาด heartbeat ชั่วคราว · กำลังกู้และจะทำต่องานเดิมอัตโนมัติ';
  const state=String(event?.state||item?.taskState||'').toUpperCase();
  const raw=String(event?.message||'').trim();
  const elapsed=ownerStageElapsed(event);
  if(raw&&!/worker|release controller|authority|lease|mutation|candidate|source sha|exact[- ]sha/i.test(raw))return raw+elapsed;
  const mapped={
    QUEUED:'รับคำสั่งแล้ว · กำลังเข้าคิว',
    WAITING_FOR_WORKER:'รับคำสั่งแล้ว · อยู่ในคิวและจะเริ่มอัตโนมัติ',
    PREPARING:'กำลังตรวจความพร้อมและเตรียมการ',
    QA:'กำลังทดสอบความพร้อมก่อนติดตั้ง',
    RUNNING:'กำลังดำเนินการตามขั้นตอนที่บันทึกไว้',
    DEPLOYING:'กำลังติดตั้งรุ่นที่อนุมัติ',
    UPDATING:'กำลังอัปเดตจากงานเดิม',
    VERIFYING:'กำลังตรวจการทำงานของรุ่นใหม่และยืนยันผล',
    RECOVERING:'กำลังกู้และทำต่อจาก checkpoint เดิม'
  }[state];
  return (mapped||localOperation?.message||'กำลังดำเนินการจากสถานะจริงของระบบ')+elapsed;
}
function reconcileTargetFeedback(item){
  if(!item?.key||!targetFeedback.has(item.key))return;
  if(item.state==='UPDATE_AVAILABLE'&&item.actionable===true&&!item.taskId&&!item.approvalId){targetFeedback.delete(item.key);return;}
  if(item.state==='CURRENT')targetFeedback.set(item.key,{text:'อัปเดตสำเร็จ · เป็นรุ่นล่าสุด',tone:'good'});
  else if(itemQueued(item))targetFeedback.set(item.key,{text:item?.dispatcherState==='RECOVERING'?ownerProgressMessage(item,item.progressEvent,false):('รับคำสั่งแล้ว · รอคิวอัปเดต'+(item.canCancel===true?' · ยกเลิกได้':'')),tone:item?.dispatcherState==='RECOVERING'?'warn':'info'});
  else if(item.state==='UPDATING')targetFeedback.set(item.key,{text:ownerProgressMessage(item,item.progressEvent,false)+(item.canCancel===true?' · ยกเลิกได้':''),tone:'info'});
  else if(item.state==='WAITING_FOR_APPROVAL')targetFeedback.set(item.key,{text:'รอการอนุมัติ · เมื่ออนุมัติแล้วระบบจะทำต่ออัตโนมัติจากงานเดิม'+(item.canCancel===true?' · ยกเลิกได้':''),tone:'info'});
}
async function cancelUpdate(item){
  if(!item?.taskId||item.canCancel!==true)throw Object.assign(new Error('งานเริ่มขั้นที่หยุดไม่ได้แล้ว'),{code:'TASK_NOT_CANCELLABLE'});
  await cancelTask(item.taskId);
  localOperation=null;
  message('ยกเลิก '+item.name+' แล้ว · รุ่นที่ใช้งานอยู่ยังไม่เปลี่ยน','good');
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

function ownerReleaseNoteText(value){
  const raw=String(value||'').trim();
  const normalized=raw.replace(/^(?:fix|feat|chore|test|refactor)(?:\([^)]*\))?:\s*/i,'').trim();
  const known=new Map([
    ['make hosting identity etc bind writable','แก้สิทธิ์ระบบ Managed Hosting ให้จัดการบัญชีบริการได้อย่างเสถียร'],
    ['harden mobile command composer','ปรับช่องคำสั่งบนมือถือให้กดส่งและใช้งานกับคีย์บอร์ดได้เสถียรขึ้น'],
    ['guard provider bundle closure','เพิ่มการตรวจแพ็กเกจผู้ให้บริการก่อนเปิดใช้จริง'],
    ['validate closure deploy stages','เพิ่มการตรวจทุกขั้นของการติดตั้งก่อนปิดงาน'],
    ['reclaim merged durable worktrees','คืนพื้นที่จากชุดงานพัฒนาที่รวมเสร็จแล้วอัตโนมัติ'],
    ['harden permanent closure baseline','เสริม baseline สำหรับการปิดงานและบำรุงรักษาระยะยาว'],
    ['let pressure guard reclaim durable worktrees','ให้ Storage Guard คืนพื้นที่จากชุดงานที่ใช้เสร็จแล้วอัตโนมัติ'],
    ['add governed hatchet credential ingress','เพิ่มจุดเชื่อม Hatchet Cloud ใน AWH โดยเก็บ token แบบไม่แสดงกลับ'],
    ['fix-vps-platform-hide-hatchet-helper-output','ซ่อนรายละเอียดภายในของระบบพื้นฐานที่ผู้ใช้ไม่จำเป็นต้องเห็น'],
  ]);
  return known.get(normalized.toLowerCase())||normalized||raw;
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
  summaryEl.textContent=count>0?'มีอะไรเปลี่ยนในรุ่นนี้ · '+count+' รายการ':ownerReleaseNoteText(notes.ownerSummary||'รายละเอียดรุ่นนี้');
  details.append(summaryEl);
  const body=document.createElement('div');body.className='release-notes-body';
  for(const [key,label,icon] of noteGroups){
    const rows=Array.isArray(notes?.summary?.[key])?notes.summary[key]:[];
    if(!rows.length)continue;
    const group=document.createElement('section');group.className='release-note-group';
    const h=document.createElement('h4');h.textContent=icon+' '+label;
    const ul=document.createElement('ul');
    for(const row of rows){const li=document.createElement('li');li.textContent=ownerReleaseNoteText(row);ul.append(li);}
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
  if(filterMode==='ATTENTION'&&!itemRequiresReview(item))return false;
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
  const state={COMPLETED:'ติดตั้งสำเร็จ',FAILED:'ไม่สำเร็จ',CANCELLED:'ยกเลิก',QUEUED:'รอคิว',WAITING_FOR_WORKER:'รอคิว',RUNNING:'กำลังอัปเดต',ROLLED_BACK:'ย้อนกลับแล้ว',SUPERSEDED:'ถูกแทนด้วยรุ่นใหม่'};
  for(const row of rows){
    const item=document.createElement('article');item.className='history-row';item.dataset.state=String(row.state||'');
    const dot=document.createElement('span');dot.className='history-dot';
    const copy=document.createElement('div');const strong=document.createElement('strong');
    const superseded=String(row.failureCode||'').includes('SUPERSEDED');
    strong.textContent=superseded?'ถูกแทนด้วยรุ่นใหม่':(state[row.state]||String(row.state||'ประวัติ'));
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

function safeDomId(value){return String(value||'item').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase()||'item';}
function accessibleAction(button,item,reasonId,label=null){
  if(!(button instanceof HTMLElement))return button;
  if(reasonId)button.setAttribute('aria-describedby',reasonId);
  if(label)button.setAttribute('aria-label',label);
  return button;
}
function visibleItemStatus(item){
  const pinned=pinnedOperationFor(item?.key);
  if(pinned?.status==='QUEUED'||itemQueued(item))return {state:'QUEUED',label:'รอคิว'};
  if(pinned?.status==='OUTCOME_UNKNOWN')return {state:'UPDATING',label:'กำลังยืนยัน'};
  if(pinned)return {state:'UPDATING',label:'กำลังอัปเดต'};
  return {state:item?.state||'UNKNOWN',label:stateLabel(item?.state)};
}

function actionLabel(item,normalLabel){
  if(!item?.key)return normalLabel;
  if(ownerActionLocked(item.key))return normalLabel;
  if(!operationWillQueue(item.key))return normalLabel;
  if(item.adapter==='PLATFORM_RELEASE')return 'เข้าคิว VPS';
  if(item.adapter==='CORE_RELEASE')return 'เข้าคิว AWH';
  if(item.adapter==='ASSESSMENT_RELEASE')return 'เข้าคิว Assessment';
  if(item.adapter==='LEARNLAB_RELEASE')return 'เข้าคิว LearnLab';
  return 'เข้าคิว '+String(item.name||'อัปเดต');
}

function renderCard(item){
  reconcileTargetFeedback(item);
  const card=document.createElement('article');card.className='update-card';card.dataset.key=item.key;
  card.dataset.attention=String(itemNeedsAttention(item));card.dataset.state=String(item?.state||'UNKNOWN');
  const baseId='update-card-'+safeDomId(item.key);card.id=baseId;

  const main=document.createElement('div');main.className='update-card-main';
  const title=document.createElement('div');title.className='update-title';
  const h3=document.createElement('h3');h3.id=baseId+'-title';h3.textContent=ownerFacingName(item);
  const status=visibleItemStatus(item);
  const chip=document.createElement('span');chip.className='update-chip';chip.dataset.state=status.state;chip.textContent=status.label;chip.setAttribute('aria-label','สถานะ: '+status.label);
  title.append(h3,chip);main.append(title);card.setAttribute('aria-labelledby',h3.id);
  const version=releaseText(item);
  if(version){const line=document.createElement('div');line.className='update-version';line.textContent=version;main.append(line);}
  if(item.key==='awh-line-gateway'||item.key==='bay-excuse-line-oa'){
    const role=document.createElement('p');role.className='update-target-role';
    role.textContent=item.key==='awh-line-gateway'
      ?'Owner Chat · line.kruart.online · Webhook /webhook'
      :'ครู · ผู้ปกครอง · Parent Connect · Rich Menu · LIFF · สหกรณ์';
    main.append(role);
  }
  const reason=document.createElement('p');reason.className='update-reason';reason.id=baseId+'-reason';reason.textContent=ownerFacingReason(item);main.append(reason);card.setAttribute('aria-describedby',reason.id);
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
  if(item.adapter==='PLATFORM_RELEASE'&&item.state==='UPDATE_AVAILABLE'&&item.candidate)actions.append(accessibleAction(actionButton(actionLabel(item,'อัปเดตระบบพื้นฐาน'),()=>updatePlatform(item),'primary-button',item.key),item,reason.id,'อัปเดตระบบพื้นฐาน AWH'));
  else if(item.adapter==='PLATFORM_RELEASE'&&item.state==='WAITING_FOR_APPROVAL'&&item.candidate)actions.append(accessibleAction(actionButton(actionLabel(item,'ทำต่อระบบพื้นฐาน'),()=>updatePlatform(item),'primary-button',item.key),item,reason.id,'ทำต่อการอัปเดตระบบพื้นฐาน AWH'));
  else if(item.adapter==='CORE_RELEASE'&&item.state==='UPDATE_AVAILABLE'&&item.candidate)actions.append(accessibleAction(actionButton(actionLabel(item,item.runtimeState==='SPLIT'?'ปรับ Runtime และอัปเดต':'อัปเดต AWH'),()=>updateAwh(item),'primary-button',item.key),item,reason.id,item.runtimeState==='SPLIT'?'ปรับ Runtime และอัปเดต AWH':'อัปเดต AWH'));
  else if(item.adapter==='CORE_RELEASE'&&item.state==='WAITING_FOR_APPROVAL'&&item.candidate)actions.append(accessibleAction(actionButton(actionLabel(item,'ทำต่อ AWH'),()=>updateAwh(item),'primary-button',item.key),item,reason.id,'ทำต่อการอัปเดต AWH'));
  else if(item.adapter==='LEARNLAB_RELEASE'&&item.state==='WAITING_FOR_APPROVAL'&&item.candidateReleaseSha&&item.candidateVersion)actions.append(accessibleAction(actionButton(actionLabel(item,'ทำต่อ LearnLab'),()=>resumeLearnLab(item),'primary-button',item.key),item,reason.id,'ทำต่อการอัปเดต LearnLab'));
  else if(item.adapter==='ASSESSMENT_RELEASE'&&item.state==='UPDATE_AVAILABLE'&&item.candidate&&item.candidateVersion)actions.append(accessibleAction(actionButton(actionLabel(item,'อัปเดต Assessment'),()=>updateAssessment(item),'primary-button',item.key),item,reason.id,'อัปเดต Assessment'));
  else if(item.adapter==='ASSESSMENT_RELEASE'&&item.state==='WAITING_FOR_APPROVAL'&&item.candidate&&item.candidateVersion)actions.append(accessibleAction(actionButton(actionLabel(item,'ทำต่อ Assessment'),()=>updateAssessment(item),'primary-button',item.key),item,reason.id,'ทำต่อการอัปเดต Assessment'));
  else if(item.adapter==='MANAGED_HOSTING'&&item.state==='UPDATE_AVAILABLE'&&item.siteId)actions.append(accessibleAction(actionButton('อัปเดต',()=>updateHosting(item),'primary-button',item.key),item,reason.id,'อัปเดต '+item.name));
  else if(item.adapter==='BAY_UPDATE_CENTER'&&item.state==='UPDATE_AVAILABLE'&&item.release)actions.append(accessibleAction(actionButton('อัปเดต '+item.name,()=>updateBay(item),'primary-button',item.key),item,reason.id,'อัปเดต '+item.name));
  if(item.canCancel===true&&item.taskId)actions.append(accessibleAction(actionButton('ยกเลิก',()=>cancelUpdate(item),'secondary-button',item.key,'ยกเลิกงานแล้ว · รุ่นที่ใช้งานอยู่ยังไม่เปลี่ยน',true),item,reason.id,'ยกเลิกการอัปเดต '+item.name));
  const storedFeedback=targetFeedback.get(item.key);if(storedFeedback){const feedback=document.createElement('div');feedback.className='update-action-feedback';feedback.dataset.tone=storedFeedback.tone;feedback.textContent=storedFeedback.text;actions.prepend(feedback);}
  if(item.url){const link=document.createElement('a');link.className='secondary-button';link.href=item.url;link.target='_blank';link.rel='noopener';link.textContent='เปิดระบบ ↗';link.setAttribute('aria-label','เปิด '+item.name+' ในแท็บใหม่');link.setAttribute('aria-describedby',reason.id);actions.append(link);}
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
  const text=String(host?.textContent||'').trim();
  const active=primaryItems().find((item)=>['UPDATING','WAITING_FOR_APPROVAL'].includes(item.state));
  const stale=text==='AWH ไม่สามารถดำเนินการได้ในขณะนี้'||text.startsWith('AWH ยังอัปเดตไม่ได้')||(!active&&/(?:เริ่มอัปเดตแล้ว|เข้าคิวแล้ว).*ระบบจะทำต่อ|เริ่มอัปเดตแล้ว · ระบบกำลังทำงาน/.test(text));
  if(!stale)return;
  if(active){
    message(active.name+' กำลังดำเนินการอยู่ · ระบบจะติดตามและตรวจผลให้อัตโนมัติ','info');
    return;
  }
  const actionable=primaryItems().find((item)=>item.state==='UPDATE_AVAILABLE'&&item.actionable!==false);
  if(actionable){
    message(actionable.name+' พร้อมอัปเดตแล้ว · สถานะล่าสุดจาก AWH ยืนยันว่าดำเนินการต่อได้','good');
    return;
  }
  message('AWH กลับมาพร้อมดำเนินการแล้ว · สถานะล่าสุดตรวจสอบสำเร็จ','good');
}

function render(){
  const host=$('update-list');host.replaceChildren();host.setAttribute('aria-busy','false');
  const visible=(center?.items||[]).filter(itemVisible);
  const resultSummary=$('filter-result-summary');
  if(resultSummary){
    const text=visible.length+' ระบบที่แสดง'+(searchTerm?' จากคำค้น “'+$('update-search').value.trim()+'”':'');
    if(resultSummary.textContent!==text)resultSummary.textContent=text;
  }
  for(const groupKey of ['core-control','line-oa','school-systems','channels-public']){
    const rows=orderedRows(visible.filter((item)=>updateGroup(item)===groupKey),groupKey);
    if(!rows.length)continue;
    const section=document.createElement('section');section.className='update-group';section.dataset.group=groupKey;if(groupKey==='line-oa')section.id='line-oa';
    const head=document.createElement('div');head.className='update-group-head';
    const title=document.createElement('div');
    const h2=document.createElement('h2');h2.id='update-group-'+groupKey+'-title';h2.textContent=updateGroupMeta[groupKey].label;section.setAttribute('aria-labelledby',h2.id);
    const p=document.createElement('p');p.id='update-group-'+groupKey+'-description';p.textContent=updateGroupMeta[groupKey].description;section.setAttribute('aria-describedby',p.id);
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
      button.setAttribute('aria-describedby',p.id);
      button.title=exactTargets?'ยืนยันครั้งเดียว แล้วอัปเดตและตรวจสองระบบทีละตัว':'รอให้ LINE OA ครบสองระบบก่อน';
      headActions.append(button);
      const groupFeedback=targetFeedback.get('group-line-oa');
      if(groupFeedback){const feedback=document.createElement('div');feedback.className='update-action-feedback';feedback.dataset.tone=groupFeedback.tone;feedback.textContent=groupFeedback.text;headActions.prepend(feedback);}
    }
    head.append(title,headActions);
    const list=document.createElement('div');list.className='update-group-list';
    for(const item of rows)list.append(renderCard(item));
    section.append(head,list);host.append(section);
  }
  if(!host.childElementCount){const empty=document.createElement('div');empty.className='update-empty';empty.textContent='ไม่พบระบบตามตัวกรองนี้';host.append(empty);}
  renderRuntimeHealth();renderReleaseInfrastructure();renderHistory();summary();renderNextAction();renderProgress();
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

function liveSignalFresh(maxAgeMs=LIVE_SIGNAL_STALE_MS){
  return liveConnected&&Number.isFinite(liveUpdatedAt)&&liveUpdatedAt>0&&(Date.now()-liveUpdatedAt)<=maxAgeMs;
}

function hasActiveUpdate(){
  return Boolean(localOperation)||pinnedOperations.size>0||primaryItems().some((item)=>['UPDATING','WAITING_FOR_APPROVAL'].includes(item.state));
}

function stopLiveStream(){
  if(stopLiveUpdates){stopLiveUpdates();stopLiveUpdates=null;}
  liveConnected=false;liveUpdatedAt=0;
}
function markLiveSignal(){liveConnected=true;liveUpdatedAt=Date.now();}
function stopLiveWatchdog(){if(liveWatchdogTimer){clearInterval(liveWatchdogTimer);liveWatchdogTimer=null;}}
function startLiveWatchdog(){
  if(liveWatchdogTimer)return;
  liveWatchdogTimer=window.setInterval(()=>{
    if(document.hidden||!hasActiveUpdate())return;
    if(liveSignalFresh())return;
    stopLiveStream();ensureLiveStream();
    if(!refreshing)void refresh({reason:'watchdog'});
  },LIVE_WATCHDOG_MS);
}
function recoverLiveView(){
  if(document.hidden)return;
  stopLiveStream();
  if(!refreshing)void refresh({reason:'resume'});
  else scheduleRefresh();
}

function liveUiSignature(snapshot){
  const items=Array.isArray(snapshot?.items)?snapshot.items:[];
  return JSON.stringify(items.map((item)=>[
    item?.key||null,item?.state||null,item?.current||null,item?.candidate||null,item?.activeReleaseSha||null,item?.taskId||null,item?.taskState||null,item?.canCancel===true,
    Number(item?.progress??0),item?.progressEvent?.state||null,item?.progressEvent?.progress??null,item?.progressEvent?.message||null,
  ]));
}

function ensureLiveStream(){
  if(stopLiveUpdates||!hasActiveUpdate())return;
  stopLiveUpdates=subscribeUpdateCenterLive((snapshot)=>{
    const normalized=normalizeUpdateCenter(snapshot);
    const nextSignature=liveUiSignature(normalized);
    const changed=nextSignature!==lastLiveUiSignature;
    markLiveSignal();center=normalized;lastLiveUiSignature=nextSignature;
    $('updates-freshness').textContent='สด · '+new Date(snapshot.generatedAt).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    reconcilePinnedOperations();
    if(pinnedOperations.size===0&&!primaryItems().some((item)=>['UPDATING','WAITING_FOR_APPROVAL'].includes(item.state)))localOperation=null;
    if(changed)render();else renderProgress();
    scheduleRefresh();
  },()=>{
    liveConnected=false;
    scheduleRefresh();
  },()=>{
    markLiveSignal();
    if(hasActiveUpdate())renderProgress();
  });
}

function syncLiveStream(){
  if(hasActiveUpdate()){ensureLiveStream();startLiveWatchdog();}
  else{stopLiveStream();stopLiveWatchdog();}
}

function renderProgress(){
  const active=(center?.items||[]).filter((item)=>['UPDATING','WAITING_FOR_APPROVAL'].includes(item.state));
  const queuedPins=queuedPinnedOperations();
  const host=$('operation-progress');
  const queueHost=$('operation-queue');
  if(!active.length&&!localOperation&&queuedPins.length===0){host.hidden=true;if(queueHost)queueHost.hidden=true;return;}
  host.hidden=false;
  const queued=active.filter(itemQueued);
  const item=active.find((row)=>row.state==='UPDATING'&&!itemQueued(row))
    ||active.find((row)=>row.state==='WAITING_FOR_APPROVAL')
    ||active[0]
    ||null;
  const waiting=item?.state==='WAITING_FOR_APPROVAL';
  const queuedOnly=item?itemQueued(item):(!localOperation&&queuedPins.length>0);
  const queuedPin=queuedOnly&&!item?queuedPins[0]:null;
  const localForItem=!item||localOperation?.key===item?.key?localOperation:null;
  const operationName=item?.name||localForItem?.name||queuedPin?.name||'ระบบ';
  const event=item?.progressEvent||null;
  const truthState=queuedOnly?'QUEUED':waiting?'WAITING_FOR_APPROVAL':String(event?.state||item?.taskState||'RUNNING').toUpperCase();
  const truthLabel={
    QUEUED:'อยู่ในคิว',
    WAITING_FOR_WORKER:'รอ executor',
    WAITING_FOR_APPROVAL:'รออนุมัติ',
    PREPARING:'กำลังเตรียม',
    QA:'กำลังทดสอบ',
    RUNNING:'กำลังทำ',
    DEPLOYING:'กำลังติดตั้ง',
    UPDATING:'กำลังอัปเดต',
    VERIFYING:'กำลังตรวจ',
    RECOVERING:'กำลังกู้ต่อ'
  }[truthState]||'กำลังทำ';
  $('operation-progress-title').textContent=waiting?'รออนุมัติก่อนติดตั้ง':queuedOnly?('รอคิวอัปเดต '+operationName):('กำลังอัปเดต '+operationName);
  $('operation-progress-percent').textContent=truthLabel;
  $('operation-progress-bar').style.width='0';
  const meter=$('operation-progress-meter');
  meter.removeAttribute('aria-valuenow');
  meter.setAttribute('aria-valuetext',queuedOnly?'รอคิว · จะเริ่มอัตโนมัติเมื่อรายการก่อนหน้าจบ':truthLabel);
  const signalFresh=liveSignalFresh();
  const eventFresh=signalFresh&&progressEventFresh(event);
  $('operation-progress-message').textContent=queuedOnly?'รับคำสั่งแล้ว · จะเริ่มอัตโนมัติเมื่อรายการก่อนหน้าจบ':ownerProgressMessage(item,event,waiting);
  $('operation-progress-live').textContent=eventFresh
    ? '● สด · '+relativeLiveTime(event?.occurredAt||null)
    : (signalFresh?'● เชื่อมต่อสด · กำลังรอขั้นตอนถัดไป':'↻ กำลังซิงก์สถานะล่าสุด');
  if(queueHost){
    const names=[...new Set([...queued.map((row)=>row.name),...queuedPins.map((operation)=>operation.name)].filter(Boolean))];
    queueHost.hidden=names.length===0;
    queueHost.textContent=names.length===0?'':'รอคิว '+names.length+' ระบบ · '+names.join(' · ');
  }
  host.dataset.active=!waiting&&!queuedOnly&&!['COMPLETED','FAILED','CANCELLED'].includes(truthState)?'true':'false';
  host.dataset.live=eventFresh?'true':'false';
  const explicitStage={PREPARING:0,QA:0,DEPLOYING:2,VERIFYING:3}[truthState];
  [...$('operation-steps').children].forEach((step,index)=>{
    const status=Number.isInteger(explicitStage)?(index<explicitStage?'done':index===explicitStage?'active':'pending'):'pending';
    step.dataset.status=status;
    if(status==='active')step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');
    const label=String(step.textContent||'ขั้นตอน');
    step.setAttribute('aria-label',label+' · '+(status==='done'?'เสร็จแล้ว':status==='active'?'กำลังทำ':'ยังไม่มีหลักฐานยืนยันขั้นนี้'));
  });
}

async function submitPinnedUpdate(item,name,progress,messageText,requestFn){
  const queuedHint=operationWillQueue(item.key);
  beginPinnedOperation(item,name,queuedHint);
  try{
    const request=await requestFn();
    const queued=pinAcceptedOperation(item,name,request,progress,messageText,queuedHint);
    return {request,queued,feedback:queued?'รับคำสั่งแล้ว · รอคิว · จะเริ่มอัตโนมัติเมื่อรายการก่อนหน้าจบ':'เริ่มอัปเดตแล้ว · ระบบกำลังทำงานและตรวจผลให้อัตโนมัติ',tone:'info'};
  }catch(error){
    if(typeof error?.code==='string'&&error.code!==''){
      clearPinnedOperation(item.key);if(localOperation?.key===item.key)localOperation=null;throw error;
    }
    markPinnedOutcomeUnknown(item,name);
    const uncertain=Object.assign(new Error('ส่งคำสั่งแล้วแต่ยังยืนยันผลตอบกลับไม่ได้'),{code:'UPDATE_OUTCOME_UNKNOWN',outcomeUnknown:true,cause:error});
    throw uncertain;
  }
}

function scheduleActionRefresh(refreshFn=refresh,delay=520){
  window.setTimeout(()=>{void refreshFn();},delay);
}

async function updatePlatform(item){
  const result=await submitPinnedUpdate(item,'VPS Platform',8,'เริ่มอัปเดตแล้ว · กำลังตรวจความพร้อม สำรอง ติดตั้ง และตรวจผล',()=>requestPlatformRelease(item.candidate,false));
  message(result.queued?'VPS Platform เข้าคิวแล้ว · จะเริ่มเองเมื่อ รายการก่อนหน้าตรวจผลเสร็จ':'VPS Platform เริ่มอัปเดตแล้ว · ระบบจะทำต่อและตรวจผลให้อัตโนมัติ','info');
  scheduleActionRefresh();
  return result;
}

async function updateAwh(item){
  const result=await submitPinnedUpdate(item,'AWH',8,'เริ่มอัปเดตแล้ว · กำลังตรวจความพร้อม สำรอง ติดตั้ง และตรวจผล',()=>requestCoreRelease(item.candidate,false));
  message(result.queued?'AWH เข้าคิวแล้ว · จะเริ่มเองเมื่อรายการก่อนหน้าจบ':'AWH เริ่มอัปเดตแล้ว · ระบบจะทำต่อและตรวจผลให้อัตโนมัติ','info');
  scheduleActionRefresh();
  return result;
}
async function resumeLearnLab(item){
  const result=await submitPinnedUpdate(item,'LearnLab',8,'เริ่มทำงานต่อแล้ว · กำลังดำเนินการและตรวจผลให้อัตโนมัติ',()=>requestLearnLabRelease(item.candidateReleaseSha,item.candidateVersion));
  message(result.queued?'LearnLab เข้าคิวแล้ว · จะเริ่มเองเมื่อรายการก่อนหน้าจบ':'LearnLab เริ่มทำงานแล้ว · ระบบจะดำเนินการและตรวจผลให้อัตโนมัติ','info');
  scheduleActionRefresh();
  return result;
}

async function updateAssessment(item){
  const result=await submitPinnedUpdate(item,'Assessment',10,'เริ่มอัปเดตแล้ว · กำลังเตรียม Staging และตรวจผล',()=>requestAssessmentRelease(item.candidate,item.candidateVersion));
  message(result.queued?'Assessment เข้าคิวแล้ว · จะเริ่มเองเมื่อรายการก่อนหน้าจบ':'Assessment เริ่มอัปเดตแล้ว · กำลังดำเนินการแบบ staging-first','info');
  scheduleActionRefresh();
  return result;
}

async function updateHosting(item){
  const result=await submitPinnedUpdate(item,item.name,8,'เริ่มอัปเดตแล้ว · Managed Hosting กำลังติดตั้งและตรวจ health',()=>managedSiteAction(item.siteId,'deploy'));
  message(result.queued?item.name+' เข้าคิวแล้ว · จะเริ่มเองเมื่อรายการก่อนหน้าจบ':item.name+' รับคำสั่งแล้ว · ระบบจะติดตั้งและตรวจ health ให้อัตโนมัติ','info');
  scheduleActionRefresh();
  return result;
}

async function updateBay(item){
  const release=item.release;if(!release)return;
  const relay=await createBayRemoteInstallRelay({targetVersion:release.version,targetSha:release.sourceSha,packageSha256:release.packageSha256});
  try{
    const request=await relayBayRemoteCommand(relay.endpoint,relay.relay);
    pinAcceptedOperation(item,item.name,request,8,'เริ่มอัปเดตแล้ว · BAY กำลังติดตั้งและตรวจ version/source');
    message(item.name+' เริ่มติดตั้งแล้ว · ระบบกำลังตรวจสถานะให้อัตโนมัติ');
  }catch(error){
    if(error?.code==='BAY_INSTALL_OUTCOME_UNKNOWN'){
      beginPinnedOperation(item,item.name,operationWillQueue(item.key));markPinnedOutcomeUnknown(item,item.name);
      localOperation={key:item.key,name:item.name,progress:8,message:'ส่งคำสั่งแล้ว · กำลังยืนยันผลและติดตามงานเดิมให้อัตโนมัติ'};
      message(friendly(error));scheduleActionRefresh(refreshBay,420);return {feedback:'ส่งคำสั่งแล้ว · กำลังยืนยันสถานะงานให้อัตโนมัติ',tone:'info'};
    }
    throw error;
  }
  scheduleActionRefresh(refreshBay);
  return {queued:false,feedback:'เริ่มติดตั้งแล้ว · ระบบกำลังติดตามสถานะให้อัตโนมัติ',tone:'info'};
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
  const confirmed=await confirmUpdate({
    title:'อัปเดต LINE OA ทั้งชุด',
    description:'ระบบจะอัปเดต AWH Owner Chat และ BAY Excuse LINE OA ทีละระบบ พร้อมตรวจผลก่อนเริ่มรายการถัดไป โดยไม่แตะ AWH Core, VPS Platform หรือ BAY Excuse Core',
    confirmLabel:'ยืนยันและเริ่มอัปเดต',
  });
  if(!confirmed)return {cancelled:true,feedback:'ยังไม่ได้เริ่มอัปเดต LINE OA',tone:'info'};

  let awhVerified=!awhNeedsUpdate;
  try{
    localOperation={key:null,name:'LINE OA ทั้งชุด',progress:8,message:'เริ่มสอง release targets แบบแยก lifecycle'};
    renderProgress();

    if(awhNeedsUpdate){
      const targetRevision=String(awh.candidateSourceRevision||'');
      if(!/^[0-9a-f-]{36}$/i.test(targetRevision))throw Object.assign(new Error('AWH LINE Gateway candidate revision ไม่ถูกต้อง'),{code:'LINE_OA_BOUNDARY_INVALID'});
      const previousReleaseId=awh.currentReleaseId||null;
      localOperation={key:'awh-line-gateway',name:'LINE OA · AWH Gateway',progress:18,message:'กำลังอัปเดต AWH LINE Gateway ผ่านช่องทางอัปเดตของระบบ'};
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
      localOperation={key:'bay-excuse-line-oa',name:'LINE OA · BAY Excuse',progress:58,message:'AWH LINE ตรวจผลผ่านแล้ว · กำลังอัปเดต BAY Excuse LINE OA เท่านั้น'};
      renderProgress();
      const relay=await createBayRemoteInstallRelay({targetVersion:bayTarget.version,targetSha:bayTarget.sourceSha,packageSha256:bayTarget.packageSha256});
      try{await relayBayRemoteCommand(relay.endpoint,relay.relay);}
      catch(error){if(error?.code!=='BAY_INSTALL_OUTCOME_UNKNOWN')throw error;}
      await waitForBayLineOa(bayTarget);
    }

    localOperation={key:null,name:'LINE OA ทั้งชุด',progress:100,message:'ตรวจครบแล้ว · สอง target ยังคงมี version/history/rollback แยกจากกัน'};
    message('LINE OA ทั้งชุดตรวจเสร็จแล้ว — แต่ละ target ถูกอัปเดตและตรวจผลแยกกัน');
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
  const delay=active?ACTIVE_REFRESH_MS:IDLE_REFRESH_MS;
  refreshTimer=setTimeout(()=>{
    if(document.hidden){scheduleRefresh();return;}
    void refresh({reason:'fallback-poll'});
  },delay);
}
async function refresh(options={}){
  if(refreshing)return;
  const manual=options?.manual===true;const initial=options?.initial===true;
  const refreshButton=$('updates-refresh');
  const listHost=$('update-list');
  refreshing=true;refreshButton.disabled=true;refreshButton.dataset.busy='true';refreshButton.setAttribute('aria-busy','true');
  if(listHost)listHost.setAttribute('aria-busy','true');
  if(manual)refreshButton.textContent='กำลังตรวจ…';
  if(!center||manual||initial)$('updates-freshness').textContent=manual?'กำลังตรวจสถานะล่าสุด…':'กำลังตรวจทุกระบบ…';
  try{
    await loadAuthSession();
    center=normalizeUpdateCenter(await loadUpdateCenter());
    lastLiveUiSignature=liveUiSignature(center);
    reconcilePinnedOperations();
    $('updates-freshness').textContent='ตรวจล่าสุด '+new Date(center.generatedAt).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
    render();
    await Promise.allSettled([refreshBay(),refreshAgent()]);
    reconcilePinnedOperations();
    if(pinnedOperations.size===0&&!primaryItems().some((item)=>['UPDATING','WAITING_FOR_APPROVAL'].includes(item.state)))localOperation=null;
    reconcileRecoveredActionMessage();
  }catch(error){
    if(center){
      message('การตรวจรอบล่าสุดขัดข้องชั่วคราว · กำลังใช้สถานะล่าสุดที่ยืนยันได้ และจะลองใหม่อัตโนมัติ','info');
      $('updates-freshness').textContent='ใช้สถานะล่าสุด · จะตรวจใหม่อัตโนมัติ';
    }else{
      message(friendly(error));$('updates-overall').textContent='ตรวจไม่สำเร็จ';$('updates-overall').dataset.tone='bad';
    }
  }finally{
    refreshing=false;refreshButton.disabled=false;delete refreshButton.dataset.busy;refreshButton.removeAttribute('aria-busy');refreshButton.textContent='ตรวจอีกครั้ง';
    if(listHost)listHost.setAttribute('aria-busy','false');
    if(manual&&center){flashControlAck(refreshButton,'✓ ล่าสุด','good');announce('ตรวจสถานะล่าสุดแล้ว');}
    summary();renderProgress();scheduleRefresh();
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

installTactileFeedback();
document.querySelectorAll('.filter-chip').forEach((chip)=>chip.setAttribute('aria-pressed',chip.classList.contains('is-active')?'true':'false'));

$('updates-refresh').addEventListener('click',()=>void refresh({manual:true}));
$('show-attention').addEventListener('click',()=>{
  attentionOnly=!attentionOnly;
  const button=$('show-attention');
  button.textContent=attentionOnly?'แสดงทุกระบบ':'แสดงเฉพาะงานที่ต้องทำ';button.setAttribute('aria-pressed',attentionOnly?'true':'false');
  flashControlAck(button,'✓','info');render();
});
$('runtime-health-details').addEventListener('click',()=>{
  $('advanced-diagnostics').open=true;flashControlAck($('runtime-health-details'),'เปิดแล้ว','info');
  $('advanced-diagnostics').scrollIntoView({behavior:'smooth',block:'start'});
});
let updateSearchTimer=null;
$('update-search').addEventListener('input',(event)=>{
  searchTerm=String(event.target.value||'').trim().toLocaleLowerCase('th');
  clearTimeout(updateSearchTimer);updateSearchTimer=window.setTimeout(()=>render(),140);
});
document.querySelectorAll('.filter-chip').forEach((button)=>button.addEventListener('click',()=>{
  filterMode=button.dataset.filter||'ALL';
  document.querySelectorAll('.filter-chip').forEach((chip)=>{const active=chip===button;chip.classList.toggle('is-active',active);chip.setAttribute('aria-pressed',active?'true':'false');});
  flashControlAck(button,'✓','info');render();
}));
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopLiveStream();return;}recoverLiveView();});
window.addEventListener('pageshow',()=>recoverLiveView(),{passive:true});
window.addEventListener('focus',()=>recoverLiveView(),{passive:true});
window.addEventListener('online',()=>recoverLiveView(),{passive:true});
window.addEventListener('pagehide',()=>{stopLiveStream();stopLiveWatchdog();},{passive:true});
window.__AWH_UPDATE_CENTER_BOOT_OK__=true;
try{sessionStorage.removeItem('awh-update-center-boot-__AWH_WEB_RELEASE_ID__');}catch{}
void refresh({initial:true});
