import { controlRequest } from './control-plane-adapter.js';

// This file is bundled into dashboard.js alongside other product surfaces.
// Keep its private helpers scoped so one product shell cannot fail at parse
// time when another surface uses the same short local names.
(() => {
const SHEET_ID = 'awh-automation-sheet';
const FORM_ID = 'awh-automation-form';
const $ = (id) => document.getElementById(id);
const UUID = /^[0-9a-f-]{36}$/i;
const DAYS = [['MO','จันทร์'],['TU','อังคาร'],['WE','พุธ'],['TH','พฤหัสบดี'],['FR','ศุกร์'],['SA','เสาร์'],['SU','อาทิตย์']];
const CONDITIONS = Object.freeze({
  'project.task.failed': 'มีงานใน Project หยุดด้วยข้อผิดพลาด',
  'project.approval.pending': 'มีรายการรออนุมัติ',
  'project.worker.offline': 'ไม่มี Worker ของ Project ออนไลน์',
});
let state = { available: false, projects: [], conversations: [], automations: [], editing: null };

function option(value, label) { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; }
function button(label, className = 'awh-secondary-action') { const node = document.createElement('button'); node.type = 'button'; node.className = className; node.textContent = label; return node; }
function localTz() { const value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; return /^[A-Za-z0-9_+\/-]{1,64}$/.test(value) ? value : 'UTC'; }
function compactDate(value) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new Error('วันเวลาไม่ถูกต้อง'); const pad = (n) => String(n).padStart(2,'0'); return `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`; }
function clockParts(value) { const [h,m] = String(value || '08:00').split(':').map(Number); if (!Number.isInteger(h) || h<0 || h>23 || !Number.isInteger(m) || m<0 || m>59) throw new Error('เวลาไม่ถูกต้อง'); return [h,m]; }
function onceLocalValue(schedule) { const match=String(schedule||'').match(/DTSTART(?:;TZID=[A-Za-z0-9_+\/-]{1,64})?:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}/); return match?`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`:''; }
function scheduleFor(form) {
  const kind = form.elements.namedItem('scheduleKind').value;
  if (kind === 'once') { const dt = form.elements.namedItem('onceAt').value; if (!dt) throw new Error('เลือกวันและเวลา'); return { timingMode:'exact_schedule', schedule:`BEGIN:VEVENT\nDTSTART;TZID=${localTz()}:${compactDate(dt)}\nEND:VEVENT`, condition:null }; }
  if (kind === 'daily') { const [h,m]=clockParts(form.elements.namedItem('timeAt').value); return { timingMode:'exact_schedule', schedule:`BEGIN:VEVENT\nRRULE:FREQ=DAILY;BYHOUR=${h};BYMINUTE=${m};BYSECOND=0\nEND:VEVENT`, condition:null }; }
  if (kind === 'weekly') { const [h,m]=clockParts(form.elements.namedItem('timeAt').value); const day=form.elements.namedItem('weekDay').value; if (!DAYS.some(([key])=>key===day)) throw new Error('เลือกวันประจำสัปดาห์'); return { timingMode:'exact_schedule', schedule:`BEGIN:VEVENT\nRRULE:FREQ=WEEKLY;BYDAY=${day};BYHOUR=${h};BYMINUTE=${m};BYSECOND=0\nEND:VEVENT`, condition:null }; }
  const key=form.elements.namedItem('conditionKey').value; const description=CONDITIONS[key]; if (!description) throw new Error('เลือกเงื่อนไข'); return { timingMode:'condition_watch', schedule:'BEGIN:VEVENT\nRRULE:FREQ=HOURLY\nEND:VEVENT', condition:{schemaVersion:1,key,description} };
}
function definitionFromForm(form) {
  const projectId=form.elements.namedItem('projectId').value; if (!UUID.test(projectId)) throw new Error('เลือก Project');
  const conversation=form.elements.namedItem('conversationId').value;
  const name=form.elements.namedItem('name').value.trim(); const goal=form.elements.namedItem('goal').value.trim();
  if (!name || name.length>120 || !goal || goal.length>2000) throw new Error('กรอกชื่อและงานที่ต้องการให้ครบ');
  const timing=scheduleFor(form);
  return { schemaVersion:1, projectId, conversationId:UUID.test(conversation)?conversation:null, name, goal, timingMode:timing.timingMode, schedule:timing.schedule, condition:timing.condition, enabled:true };
}
function humanTiming(definition) {
  if (definition.timingMode === 'condition_watch') return `ตรวจทุกชั่วโมง · ${definition.condition?.description || 'ตามเงื่อนไข'}`;
  if (/FREQ=DAILY/.test(definition.schedule)) return 'ทุกวัน';
  if (/FREQ=WEEKLY/.test(definition.schedule)) { const code=definition.schedule.match(/BYDAY=(MO|TU|WE|TH|FR|SA|SU)/)?.[1]; return `ทุกสัปดาห์${DAYS.find(([key])=>key===code)?.[1] ? ` · วัน${DAYS.find(([key])=>key===code)[1]}` : ''}`; }
  return 'ครั้งเดียว';
}
async function loadConversations(projectId) {
  if (!UUID.test(projectId)) { state.conversations=[]; renderConversationOptions(); return; }
  try { const value=await controlRequest(`/api/v1/control/conversations?projectId=${encodeURIComponent(projectId)}`); state.conversations=Array.isArray(value.conversations)?value.conversations:[]; } catch { state.conversations=[]; }
  renderConversationOptions();
}
function renderConversationOptions(selected=null) {
  const select=$('awh-automation-conversation'); if (!(select instanceof HTMLSelectElement)) return; select.replaceChildren(option('', 'สร้างเป็นงานใหม่'));
  for (const row of state.conversations) if (UUID.test(row?.conversationId)) select.append(option(row.conversationId, row.title || 'การสนทนา'));
  if (selected && [...select.options].some((o)=>o.value===selected)) select.value=selected;
}
function renderProjects(selected=null) {
  const select=$('awh-automation-project'); if (!(select instanceof HTMLSelectElement)) return; select.replaceChildren(option('', 'เลือก Project'));
  for (const project of state.projects) if (UUID.test(project?.projectId)) select.append(option(project.projectId, project.name || 'Project'));
  if (selected && [...select.options].some((o)=>o.value===selected)) select.value=selected;
}
function renderList() {
  const list=$('awh-automation-list'); if (!list) return; list.replaceChildren();
  if (!state.automations.length) { const empty=document.createElement('p'); empty.className='awh-automation-empty'; empty.textContent='ยังไม่มีงานอัตโนมัติ'; list.append(empty); return; }
  for (const record of state.automations) {
    const def=record?.definition; if (!def || !UUID.test(def.automationId)) continue;
    const card=document.createElement('article'); card.className='awh-automation-item';
    const copy=document.createElement('div'); const title=document.createElement('strong'); title.textContent=def.name; const detail=document.createElement('small'); detail.textContent=`${humanTiming(def)} · ${def.enabled?'เปิดอยู่':'ปิดไว้'}`; const goal=document.createElement('p'); goal.textContent=def.goal; copy.append(title,detail,goal);
    const actions=document.createElement('div'); actions.className='awh-automation-actions';
    const edit=button('แก้ไข'); edit.addEventListener('click',()=>editAutomation(record));
    const toggle=button(def.enabled?'ปิดชั่วคราว':'เปิดใช้งาน'); toggle.addEventListener('click',()=>toggleAutomation(def));
    const archive=button('Archive'); archive.addEventListener('click',()=>archiveAutomation(def)); actions.append(edit,toggle,archive);
    card.append(copy,actions); list.append(card);
  }
}
async function refresh() {
  const [auto,projects]=await Promise.all([controlRequest('/api/v1/control/automations'),controlRequest('/api/v1/control/projects')]);
  state.available=auto.available===true; state.automations=Array.isArray(auto.automations)?auto.automations:[]; state.projects=Array.isArray(projects.projects)?projects.projects:[];
  renderProjects(); renderList(); return state.available;
}
async function toggleAutomation(def) { await controlRequest(`/api/v1/control/automations/${def.automationId}/enabled`,{method:'POST',body:JSON.stringify({schemaVersion:1,enabled:!def.enabled})}); await refresh(); }
async function archiveAutomation(def) { if (!window.confirm(`Archive “${def.name}” ?`)) return; await controlRequest(`/api/v1/control/automations/${def.automationId}/archive`,{method:'POST',body:JSON.stringify({schemaVersion:1})}); await refresh(); }
function resetForm() { state.editing=null; const form=$(FORM_ID); if (!(form instanceof HTMLFormElement)) return; form.reset(); form.elements.namedItem('timeAt').value='08:00'; form.elements.namedItem('scheduleKind').value='daily'; $('awh-automation-submit').textContent='สร้าง Automation'; $('awh-automation-cancel-edit').hidden=true; syncScheduleFields(); }
async function editAutomation(record) {
  const def=record.definition; state.editing=def.automationId; const form=$(FORM_ID); if (!(form instanceof HTMLFormElement)) return;
  renderProjects(def.projectId); await loadConversations(def.projectId); renderConversationOptions(def.conversationId);
  form.elements.namedItem('name').value=def.name; form.elements.namedItem('goal').value=def.goal;
  let kind='once'; if (def.timingMode==='condition_watch') kind='condition'; else if (/FREQ=DAILY/.test(def.schedule)) kind='daily'; else if (/FREQ=WEEKLY/.test(def.schedule)) kind='weekly'; form.elements.namedItem('scheduleKind').value=kind;
  const h=def.schedule.match(/BYHOUR=(\d{1,2})/)?.[1] || '08'; const m=def.schedule.match(/BYMINUTE=(\d{1,2})/)?.[1] || '00'; form.elements.namedItem('timeAt').value=`${h.padStart(2,'0')}:${m.padStart(2,'0')}`;
  if (kind==='once') form.elements.namedItem('onceAt').value=onceLocalValue(def.schedule);
  const day=def.schedule.match(/BYDAY=(MO|TU|WE|TH|FR|SA|SU)/)?.[1]; if (day) form.elements.namedItem('weekDay').value=day;
  if (def.condition?.key && CONDITIONS[def.condition.key]) form.elements.namedItem('conditionKey').value=def.condition.key;
  $('awh-automation-submit').textContent='บันทึกการแก้ไข'; $('awh-automation-cancel-edit').hidden=false; syncScheduleFields(); form.scrollIntoView({behavior:'smooth',block:'start'});
}
function syncScheduleFields() { const form=$(FORM_ID); if (!(form instanceof HTMLFormElement)) return; const kind=form.elements.namedItem('scheduleKind').value; $('awh-automation-once-wrap').hidden=kind!=='once'; $('awh-automation-time-wrap').hidden=!['daily','weekly'].includes(kind); $('awh-automation-day-wrap').hidden=kind!=='weekly'; $('awh-automation-condition-wrap').hidden=kind!=='condition'; }
async function submitForm(event) { event.preventDefault(); const form=event.currentTarget; const definition=definitionFromForm(form); const path=state.editing?`/api/v1/control/automations/${state.editing}`:'/api/v1/control/automations'; await controlRequest(path,{method:'POST',body:JSON.stringify({schemaVersion:1,definition})}); resetForm(); await refresh(); }
function field(label,name,kind='input') { const wrap=document.createElement('label'); wrap.className='awh-automation-field'; const text=document.createElement('span'); text.textContent=label; const control=document.createElement(kind); control.name=name; wrap.append(text,control); return [wrap,control]; }
function mountSheet() {
  if ($(SHEET_ID)) return; const sheet=document.createElement('section'); sheet.id=SHEET_ID; sheet.className='awh-automation-sheet'; sheet.hidden=true; sheet.setAttribute('role','dialog'); sheet.setAttribute('aria-modal','true');
  const backdrop=button('','awh-automation-backdrop'); backdrop.setAttribute('aria-label','ปิด Automations'); backdrop.addEventListener('click',()=>closeAwhDialog(sheet));
  const panel=document.createElement('div'); panel.className='awh-automation-panel'; const head=document.createElement('header'); head.className='awh-automation-head'; const h=document.createElement('div'); h.innerHTML='<span>AUTOMATIONS</span><h2>งานอัตโนมัติ</h2><p>บอกงานและเวลา AWH จะส่งเข้าระบบงานเดิมให้อัตโนมัติ</p>'; const close=button('ปิด'); close.addEventListener('click',()=>closeAwhDialog(sheet)); head.append(h,close);
  const form=document.createElement('form'); form.id=FORM_ID; form.className='awh-automation-form'; form.addEventListener('submit',submitForm);
  const [nameWrap,name]=field('ชื่อ Automation','name'); name.required=true; name.maxLength=120;
  const [goalWrap,goal]=field('อยากให้ AWH ทำอะไร','goal','textarea'); goal.required=true; goal.maxLength=2000; goal.rows=3;
  const [projectWrap,project]=field('Project','projectId','select'); project.id='awh-automation-project'; project.required=true; project.addEventListener('change',()=>loadConversations(project.value));
  const [conversationWrap,conversation]=field('ทำต่อในแชทเดิม (ไม่บังคับ)','conversationId','select'); conversation.id='awh-automation-conversation';
  const [kindWrap,kind]=field('ทำเมื่อไร','scheduleKind','select'); [['once','ครั้งเดียว'],['daily','ทุกวัน'],['weekly','ทุกสัปดาห์'],['condition','เมื่อเกิดเงื่อนไข']].forEach(([v,l])=>kind.append(option(v,l))); kind.value='daily'; kind.addEventListener('change',syncScheduleFields);
  const [onceWrap,once]=field('วันและเวลา','onceAt'); onceWrap.id='awh-automation-once-wrap'; once.type='datetime-local';
  const [timeWrap,time]=field('เวลา','timeAt'); timeWrap.id='awh-automation-time-wrap'; time.type='time'; time.value='08:00';
  const [dayWrap,day]=field('วัน','weekDay','select'); dayWrap.id='awh-automation-day-wrap'; DAYS.forEach(([v,l])=>day.append(option(v,l)));
  const [conditionWrap,condition]=field('เงื่อนไข','conditionKey','select'); conditionWrap.id='awh-automation-condition-wrap'; Object.entries(CONDITIONS).forEach(([v,l])=>condition.append(option(v,l)));
  const actions=document.createElement('div'); actions.className='awh-automation-form-actions'; const submit=document.createElement('button'); submit.type='submit'; submit.id='awh-automation-submit'; submit.className='awh-command-send'; submit.textContent='สร้าง Automation'; const cancel=button('ยกเลิกการแก้ไข'); cancel.id='awh-automation-cancel-edit'; cancel.hidden=true; cancel.addEventListener('click',resetForm); actions.append(submit,cancel);
  form.append(nameWrap,goalWrap,projectWrap,conversationWrap,kindWrap,onceWrap,timeWrap,dayWrap,conditionWrap,actions);
  const list=document.createElement('div'); list.id='awh-automation-list'; list.className='awh-automation-list'; panel.append(head,form,list); sheet.append(backdrop,panel); document.body.append(sheet); syncScheduleFields();
}
async function activate() {
  const trigger=document.querySelector('[data-owner-action="automations"]'); if (!(trigger instanceof HTMLButtonElement) || trigger.dataset.awhAutomationReady==='1') return false;
  trigger.dataset.awhAutomationReady='1'; mountSheet();
  try { const available=await refresh(); if (!available) { trigger.disabled=true; const badge=trigger.querySelector('.awh-owner-command-badge'); if (badge) badge.textContent='รอเปิดใช้'; return true; } }
  catch { return true; }
  trigger.disabled=false; const badge=trigger.querySelector('.awh-owner-command-badge'); if (badge) badge.textContent='พร้อมใช้';
  trigger.addEventListener('click',(event)=>{ event.preventDefault(); event.stopImmediatePropagation(); const sheet=$(SHEET_ID); if (sheet) { openAwhDialog(sheet); refresh().catch(()=>{}); } },true); return true;
}
function start() { if (activate()) return; const observer=new MutationObserver(()=>{ if (activate()) observer.disconnect(); }); observer.observe(document.documentElement,{childList:true,subtree:true}); }
if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
