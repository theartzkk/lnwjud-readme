import {
  createBayRemoteInstallRelay, decideApproval, loadAuthSession, loadBayRemoteUpdateStatus, loadUpdateCenter,
  managedSiteAction, relayBayRemoteCommand, requestCoreRelease, stepUp,
} from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';

const $=(id)=>document.getElementById(id);
let center=null;
let bayLive=null;
let refreshing=false;
let stepUpResolver=null;

const stateLabel=(state)=>({
  CURRENT:'ล่าสุดแล้ว',UPDATE_AVAILABLE:'มีอัปเดต',WAITING_FOR_APPROVAL:'รออนุมัติ',UPDATING:'กำลังอัปเดต',
  BLOCKED:'ต้องตรวจสอบ',SOURCE_READY:'Source พร้อม',REMOTE_CHECK_REQUIRED:'กำลังตรวจ BAY',
  DELEGATED:'จัดการผ่าน BAY',INTERNAL_MANAGED:'จัดการภายใน',UNREGISTERED:'ยังไม่ลงทะเบียน',
  BASELINE_REQUIRED:'ต้องผูก Production',MIGRATION_REQUIRED:'ต้องย้าย Deploy path',
})[state]||state||'กำลังตรวจ';

const adapterLabel=(value)=>({CORE_RELEASE:'AWH Core Release',MANAGED_HOSTING:'Managed Hosting',BAY_UPDATE_CENTER:'BAY Update Center',LEARNLAB_RELEASE:'LearnLab Release',LEGACY_DEPLOY:'Legacy deploy',SOURCE_ONLY:'Source only',UNREGISTERED:'ยังไม่ลงทะเบียน',AGENT_MANAGED:'AWH Agent'})[value]||value||'—';
const activityLabel=(value)=>({ONLINE:'ออนไลน์',BUSY:'กำลังทำงาน',STALE:'ออฟไลน์/ข้อมูลเก่า',OFFLINE:'ออฟไลน์',IDLE:'พร้อม'})[String(value||'').toUpperCase()]||value||'ไม่ทราบสถานะ';
const short=(value)=>typeof value==='string'&&/^[0-9a-f]{40}$/i.test(value)?value.slice(0,12):value||'—';
const message=(text)=>{$('updates-message').textContent=text;};
const friendly=(error)=>{
  const code=String(error?.code||'').toUpperCase();
  return ({
    STEP_UP_REQUIRED:'ต้องยืนยันรหัสผ่าน Owner ก่อนดำเนินการ',
    CORE_RELEASE_CONFLICT:'มี AWH Core Release อื่นกำลังทำอยู่ ระบบจะไม่สร้างรายการซ้ำ',
    PROJECT_SOURCE_NOT_READY:'Source ของโปรเจคนี้ยังไม่พร้อม Deploy',
    BAY_UPDATE_NOT_GREEN:'BAY source ล่าสุดยังไม่ผ่าน release gate',
    BAY_UPDATE_TARGET_MOVED:'BAY source เปลี่ยนก่อนติดตั้ง กรุณาตรวจใหม่',
    BAY_INSTALL_OUTCOME_UNKNOWN:'ส่ง INSTALL ไปแล้วแต่การเชื่อมต่อขาด ระบบจะตรวจ STATUS เท่านั้นและไม่ส่ง INSTALL ซ้ำ',
    BAY_TRANSPORT_UNAVAILABLE:'ยังติดต่อ BAY Update Center ไม่ได้',
    BAY_COMMAND_REJECTED:'BAY ปฏิเสธคำขออย่างปลอดภัย กรุณาตรวจสถานะ',
  })[code]||error?.message||'ยังทำรายการนี้ไม่ได้';
};

function summary(){
  const counts={current:0,update:0,progress:0,attention:0};
  for(const item of center?.items||[]){
    if(item.state==='CURRENT')counts.current++;
    else if(item.state==='UPDATE_AVAILABLE')counts.update++;
    else if(['WAITING_FOR_APPROVAL','UPDATING'].includes(item.state))counts.progress++;
    else counts.attention++;
  }
  $('summary-current').textContent=String(counts.current);
  $('summary-update').textContent=String(counts.update);
  $('summary-progress').textContent=String(counts.progress);
  $('summary-attention').textContent=String(counts.attention);
  const actionable=(center?.items||[]).some((item)=>item.actionable===true||item.state==='WAITING_FOR_APPROVAL');
  $('update-all').disabled=!actionable;
  $('updates-overall').textContent=counts.update>0?counts.update+' รายการพร้อมอัปเดต':counts.progress>0?'กำลังดำเนินการ':'ตรวจครบแล้ว';
}

function meta(...values){
  const host=document.createElement('div');host.className='update-meta';
  for(const value of values.filter(Boolean)){const span=document.createElement('span');span.textContent=value;host.append(span);}
  return host;
}

function actionButton(text,handler,className='primary-button'){
  const button=document.createElement('button');button.type='button';button.className=className;button.textContent=text;
  button.addEventListener('click',async()=>{button.disabled=true;try{await handler();}catch(error){message(friendly(error));}finally{button.disabled=false;}});
  return button;
}

function renderDevices(item,host){
  if(!Array.isArray(item.devices)||item.devices.length===0)return;
  const list=document.createElement('div');list.className='device-list';
  for(const device of item.devices){
    const row=document.createElement('div');row.className='device-row';
    const name=document.createElement('span');name.textContent=device.displayName+' · '+device.platform+'/'+device.arch;
    const status=document.createElement('span');status.textContent=(device.appVersion||'ไม่ทราบรุ่น')+' · '+activityLabel(device.activity);
    row.append(name,status);list.append(row);
  }
  host.append(list);
}

function render(){
  const host=$('update-list');host.replaceChildren();
  for(const item of center?.items||[]){
    const card=document.createElement('article');card.className='update-card';card.dataset.key=item.key;
    const main=document.createElement('div');main.className='update-card-main';
    const title=document.createElement('div');title.className='update-title';
    const h3=document.createElement('h3');h3.textContent=item.name;
    const chip=document.createElement('span');chip.className='update-chip';chip.dataset.state=item.state;chip.textContent=stateLabel(item.state);
    title.append(h3,chip);main.append(title);
    main.append(meta(adapterLabel(item.adapter),item.current?'ใช้อยู่ '+short(item.current):null,item.candidate?'ใหม่ '+short(item.candidate):null));
    const reason=document.createElement('p');reason.className='update-reason';reason.textContent=item.reason||'กำลังตรวจ';main.append(reason);
    renderDevices(item,main);
    const actions=document.createElement('div');actions.className='update-actions';
    if(item.adapter==='CORE_RELEASE'&&item.state==='UPDATE_AVAILABLE'&&item.candidate)actions.append(actionButton('อัปเดต AWH',()=>updateAwh(item)));
    else if(item.adapter==='CORE_RELEASE'&&item.state==='WAITING_FOR_APPROVAL'&&item.approvalId)actions.append(actionButton('อนุมัติและอัปเดต',()=>approveAwh(item)));
    else if(item.adapter==='LEARNLAB_RELEASE'&&item.state==='WAITING_FOR_APPROVAL'&&item.approvalId)actions.append(actionButton('อนุมัติ LearnLab',()=>approveLearnLab(item)));
    else if(item.adapter==='MANAGED_HOSTING'&&item.state==='UPDATE_AVAILABLE'&&item.siteId)actions.append(actionButton('อัปเดต',()=>updateHosting(item)));
    else if(item.adapter==='BAY_UPDATE_CENTER'&&item.state==='UPDATE_AVAILABLE'&&item.release)actions.append(actionButton('อัปเดต BAY',()=>updateBay(item)));
    if(item.url){const link=document.createElement('a');link.className='secondary-button';link.href=item.url;link.target='_blank';link.rel='noopener';link.textContent='เปิดระบบ';actions.append(link);}
    card.append(main,actions);host.append(card);
  }
  if(!host.childElementCount){const empty=document.createElement('div');empty.className='update-empty';empty.textContent='ยังไม่มีระบบใน Update Center';host.append(empty);}
  summary();
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
  if(!confirm('ยืนยันให้อัปเดต AWH เป็นรุ่นที่ผ่าน verification แล้ว?'))return;
  await decideApproval(item.approvalId,'approve');
  message('อนุมัติแล้ว AWH จะ Backup → Deploy → Verify และ Rollback อัตโนมัติถ้าจำเป็น');
  await refresh();
}

async function approveLearnLab(item){
  if(!confirm('ยืนยัน LearnLab release ที่ผ่าน typed release boundary แล้ว?'))return;
  await decideApproval(item.approvalId,'approve');
  message('อนุมัติ LearnLab แล้ว release controller จะ Deploy → Verify และ Rollback อัตโนมัติถ้าจำเป็น');
  await refresh();
}

async function updateAwh(item){
  if(!confirm('อัปเดต AWH เป็น Source '+short(item.candidate)+' ใช่หรือไม่? ระบบจะตรวจทุก gate ก่อนเปลี่ยน Production'))return;
  const request=await privileged(()=>requestCoreRelease(item.candidate,false));
  if(request?.approvalId)await decideApproval(request.approvalId,'approve');
  message('AWH Core Release ถูกอนุมัติแล้ว ระบบกำลังทำ QA, Backup, Deploy และ Verify');
  await refresh();
}

async function updateHosting(item){
  if(!confirm('อัปเดต “'+item.name+'” เป็น Project Vault รุ่นล่าสุด? รุ่นปัจจุบันจะถูกเก็บไว้เป็น rollback point'))return;
  await managedSiteAction(item.siteId,'deploy');
  message('ส่ง '+item.name+' เข้า Managed Hosting deploy แล้ว');
  await refresh();
}

async function updateBay(item,askConfirmation=true){
  const release=item.release;
  if(!release)return;
  if(askConfirmation&&!confirm('อัปเดต BAY EXCUSE X จาก '+(bayLive?.currentVersion||'รุ่นปัจจุบัน')+' เป็น '+release.version+'?'))return;
  const relay=await createBayRemoteInstallRelay({targetVersion:release.version,targetSha:release.sourceSha,packageSha256:release.packageSha256});
  try{
    await relayBayRemoteCommand(relay.endpoint,relay.relay);
    message('BAY ติดตั้งแพ็กเกจผ่าน PackageManager แล้ว กำลังตรวจสถานะใหม่');
  }catch(error){
    if(error?.code==='BAY_INSTALL_OUTCOME_UNKNOWN'){message(friendly(error));await refreshBay();return;}
    throw error;
  }
  await refreshBay();
}

async function refreshBay(){
  const item=(center?.items||[]).find((row)=>row.adapter==='BAY_UPDATE_CENTER');
  if(!item)return;
  try{
    const bridge=await loadBayRemoteUpdateStatus();
    bayLive=await relayBayRemoteCommand(bridge.endpoint,bridge.statusRelay);
    const release=(bayLive.packages||[]).find((row)=>row?.installable===true&&['ready','READY'].includes(String(row.state||row.version_state||'')));
    item.current=bayLive.currentVersion||null;
    item.release=release||null;
    item.candidate=release?.version||null;
    item.actionable=Boolean(release)&&bayLive.preflight?.ready===true;
    item.state=item.actionable?'UPDATE_AVAILABLE':(bayLive.preflight?.ready===true?'CURRENT':'BLOCKED');
    item.reason=item.actionable?'BAY Update Inbox มีแพ็กเกจใหม่ที่ผ่าน checksum/source/compatibility แล้ว':(item.state==='CURRENT'?'BAY ใช้แพ็กเกจล่าสุดที่ติดตั้งได้แล้ว':'BAY preflight ยังไม่พร้อม');
  }catch(error){
    item.state='BLOCKED';item.actionable=false;item.reason=friendly(error);
  }
  render();
}

async function refreshAgent(){
  const item=(center?.items||[]).find((row)=>row.adapter==='AGENT_MANAGED');
  if(!item)return;
  try{
    const response=await fetch('./release.json',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)return;
    const release=await response.json();
    const packages=Array.isArray(release.desktopReleases)?release.desktopReleases:[];
    const versions=[...new Set(packages.map((row)=>row?.productVersion).filter((v)=>typeof v==='string'&&v))];
    item.candidate=versions.length===1?versions[0]:(versions.length?versions.join(' / '):null);
    item.reason=packages.length
      ?'มี package evidence '+packages.length+' แพลตฟอร์ม · Web/PWA อัปเดตอัตโนมัติ · macOS native ยังคง Internal จนกว่า Apple platform trust ผ่าน'
      :'Web/PWA อัปเดตอัตโนมัติ · release นี้ยังไม่มี Agent package ที่ตรวจสอบยืนยันได้';
  }catch{}
  render();
}
async function updateAll(){
  const ready=(center?.items||[]).filter((item)=>item.state==='UPDATE_AVAILABLE'&&item.actionable===true);
  const pending=(center?.items||[]).filter((item)=>item.state==='WAITING_FOR_APPROVAL'&&item.approvalId);
  if(!ready.length&&!pending.length)return;
  if(!confirm('ดำเนินการ '+(ready.length+pending.length)+' รายการที่พร้อมตอนนี้? ระบบจะใช้ Backup/Verify/Rollback ของแต่ละ adapter และไม่แตะรายการที่ Blocked'))return;
  $('update-all').disabled=true;
  try{
    for(const item of ready.filter((row)=>row.adapter==='MANAGED_HOSTING'))await managedSiteAction(item.siteId,'deploy');
    for(const item of ready.filter((row)=>row.adapter==='BAY_UPDATE_CENTER'&&row.release))await updateBay(item,false);
    for(const item of pending.filter((row)=>['CORE_RELEASE','LEARNLAB_RELEASE'].includes(row.adapter)))await decideApproval(item.approvalId,'approve');
    for(const item of ready.filter((row)=>row.adapter==='CORE_RELEASE')){
      const request=await privileged(()=>requestCoreRelease(item.candidate,false));
      if(request?.approvalId)await decideApproval(request.approvalId,'approve');
    }
    message('ส่งรายการที่พร้อมเข้าสู่ authority เดิมครบแล้ว AWH จะติดตามสถานะต่อ');
  }finally{await refresh();}
}

async function refresh(){
  if(refreshing)return;refreshing=true;$('updates-refresh').disabled=true;$('updates-freshness').textContent='กำลังตรวจทุกระบบ…';
  try{
    await loadAuthSession();
    center=await loadUpdateCenter();
    $('updates-freshness').textContent='ตรวจล่าสุด '+new Date(center.generatedAt).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
    render();
    await Promise.allSettled([refreshBay(),refreshAgent()]);
  }catch(error){
    message(friendly(error));$('updates-overall').textContent='ตรวจไม่สำเร็จ';
  }finally{refreshing=false;$('updates-refresh').disabled=false;}
}

$('updates-refresh').addEventListener('click',refresh);
$('update-all').addEventListener('click',updateAll);
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
void refresh();
