import { cancelTask, createAiPassProjectExport, loadCloudStatus, loadControlData, loadProjectSourceAuthority, stepUp, submitCloudTask, updateCloudCredential } from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';

const $ = (id) => document.getElementById(id);
const ACTIVE = new Set(['QUEUED', 'WAITING_FOR_CAPABILITY', 'WAITING_FOR_WORKER', 'RUNNING', 'LEASED']);
const state = { control: null, cloud: null, source: null, revision: null, busy: false, timer: null };

function message(id, text = '', kind = '') { const node = $(id); if (!node) return; node.textContent = text; node.className = `review-message${kind ? ` ${kind}` : ''}`; }
function shortSha(value) { return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) ? value.slice(0, 12) : '—'; }
function humanState(value) {
  if (['QUEUED', 'WAITING_FOR_CAPABILITY', 'WAITING_FOR_WORKER', 'LEASED'].includes(value)) return ['รับเรื่องแล้ว', ''];
  if (value === 'RUNNING') return ['กำลังตรวจบน Cloud', 'attention'];
  if (value === 'COMPLETED') return ['พร้อมแล้ว', 'ready'];
  if (value === 'CANCELLED') return ['ยกเลิกแล้ว', ''];
  if (value === 'FAILED') return ['ต้องตรวจสอบ', 'attention'];
  return ['กำลังตรวจสถานะ', ''];
}
function humanKind(capability) { return capability === 'review.visual' ? 'ตรวจหน้าจอ + Review Pack' : 'ตรวจระบบ'; }

function renderProjects() {
  const select = $('review-project'); if (!(select instanceof HTMLSelectElement)) return;
  const previous = select.value; select.replaceChildren();
  const projects = [...(state.control?.projects || [])].sort((a, b) => (a.type === 'awh-core' ? -1 : 0) - (b.type === 'awh-core' ? -1 : 0) || String(a.name).localeCompare(String(b.name), 'th'));
  for (const project of projects) { const option = document.createElement('option'); option.value = project.projectId; option.textContent = project.name || 'Project'; select.append(option); }
  if (previous && projects.some((project) => project.projectId === previous)) select.value = previous;
}

function renderCloud() {
  const cloud = state.cloud; const dot = $('cloud-dot'); const title = $('cloud-state'); const detail = $('cloud-detail'); const setup = $('cloud-setup');
  dot?.classList.remove('ready', 'attention');
  if (!cloud || cloud.state === 'NOT_READY') { title.textContent = 'Product Review ยังไม่เปิดใช้'; detail.textContent = 'Project Source Authority / Cloud ยังไม่ถูก activate'; dot?.classList.add('attention'); }
  else if (!cloud.configured) { title.textContent = 'AWH Cloud ยังไม่ได้เชื่อม'; detail.textContent = 'ยืนยัน Owner และเพิ่ม GitHub credential เพียงครั้งเดียว'; dot?.classList.add('attention'); if (setup instanceof HTMLDetailsElement) setup.open = true; }
  else if (!state.source?.canonicalRevision) { title.textContent = 'โปรเจกต์นี้ยังไม่มี Source of Truth'; detail.textContent = 'ต้องผูก GitHub repository/ref ก่อนจึงจะตรวจได้'; dot?.classList.add('attention'); }
  else { title.textContent = 'Source ของโปรเจกต์ยืนยันแล้ว'; detail.textContent = `${state.source.repository || 'GitHub'} · ${state.source.ref || 'default'} · ${state.source.state === 'CURRENT' ? 'local ตรงกับ remote' : 'ยึด canonical remote'}`; dot?.classList.add('ready'); }
  const revision = $('review-revision'); if (revision) { revision.textContent = shortSha(state.revision); revision.title = state.revision || ''; }
  const note = $('review-revision-note'); if (note) note.textContent = state.source?.canonicalRevision ? `${state.source.repository || ''} · ${state.source.ref || ''} · exact SHA` : 'AWH จะยืนยัน exact SHA ของโปรเจกต์ที่เลือกก่อนเริ่มทุกครั้ง';
  const canonicalReady = Boolean(state.source?.canonicalRevision);
  const workflowReady = Boolean(canonicalReady && state.source?.workflowCompatible === true);
  const ownerReady = Boolean(cloud?.configured && state.control?.role === 'OWNER' && state.control?.projects?.length);
  for (const id of ['run-cloud-qa', 'run-visual-review']) { const button = $(id); if (button instanceof HTMLButtonElement) button.disabled = state.busy || !ownerReady || !workflowReady; }
  const aipass = $('run-aipass-export'); if (aipass instanceof HTMLButtonElement) aipass.disabled = state.busy || !ownerReady || !canonicalReady;
}

function renderRecent() {
  const host = $('review-recent'); if (!host) return; host.replaceChildren(); const items = Array.isArray(state.cloud?.recent) ? state.cloud.recent : [];
  if (!items.length) { const empty = document.createElement('div'); empty.className = 'review-empty'; empty.textContent = 'ยังไม่มีงานตรวจบน Cloud'; host.append(empty); return; }
  for (const item of items.slice(0, 8)) {
    const row = document.createElement('article'); row.className = 'review-job';
    const copy = document.createElement('div'); copy.className = 'review-job-copy'; const title = document.createElement('strong'); title.textContent = humanKind(item.capability); const meta = document.createElement('span'); meta.textContent = `${shortSha(item.revision)}${item.profile === 'final' ? ' · Candidate สุดท้าย' : item.profile === 'daily' ? ' · ตรวจประจำวัน' : ''}`; copy.append(title, meta);
    const right = document.createElement('div'); right.className = 'review-job-state'; const [label, cls] = humanState(item.state); const badge = document.createElement('b'); badge.textContent = label; if (cls) badge.classList.add(cls); right.append(badge);
    if (ACTIVE.has(item.state) && typeof item.taskId === 'string') { const stop = document.createElement('button'); stop.type = 'button'; stop.className = 'review-stop'; stop.textContent = 'หยุด'; stop.addEventListener('click', () => stopTask(item.taskId, stop)); right.append(stop); }
    row.append(copy, right); host.append(row);
  }
}

async function refresh({ quiet = false } = {}) {
  if (state.busy && quiet) return;
  try {
    const [control, cloud] = await Promise.all([loadControlData(), loadCloudStatus()]); state.control = control; state.cloud = cloud;
    if (control.role !== 'OWNER') { window.location.replace('./'); return; }
    renderProjects();
    const projectId = $('review-project')?.value || null; state.source = null; state.revision = null;
    if (cloud.configured && projectId) { try { state.source = await loadProjectSourceAuthority(projectId); state.revision = state.source.canonicalRevision || null; } catch { state.source = null; state.revision = null; } }
    renderCloud(); renderRecent();
    if (!quiet) {
      if (state.source?.canonicalRevision && state.source.workflowCompatible !== true) message('review-action-message', `โปรเจกต์นี้ใช้ Source ของตัวเอง (${state.source.repository}) จึงจะไม่ถูกส่งเข้า workflow ตรวจ AWH ผิดโปรเจกต์; ใช้ “เตรียมแพ็ก AiPASS” ได้โดยตรง`, 'success');
      else message('review-action-message');
    }
  } catch (error) {
    renderCloud(); if (!quiet) message('review-action-message', error instanceof Error ? error.message : 'AWH ไม่สามารถโหลด Product Review ได้', 'error');
  }
}

async function run(kind) {
  if (state.busy) return; const projectId = $('review-project')?.value; if (!projectId) { message('review-action-message', 'เลือกโปรเจกต์ก่อน', 'error'); return; }
  state.busy = true; renderCloud(); message('review-action-message', 'กำลังยืนยัน Source revision ล่าสุดของโปรเจกต์นี้…');
  try {
    const source = await loadProjectSourceAuthority(projectId); state.source = source; const revision = source.canonicalRevision;
    if (!revision || source.workflowCompatible !== true) throw new Error('AWH หยุดไว้เพื่อป้องกันการตรวจ Source ผิดโปรเจกต์');
    state.revision = revision; const profile = kind === 'VISUAL_REVIEW' ? $('review-profile')?.value || 'daily' : null;
    await submitCloudTask({ projectId, kind, revision, profile, idempotencyKey: `product-review-${kind.toLowerCase()}-${revision.slice(0, 12)}-${Date.now()}` });
    message('review-action-message', kind === 'VISUAL_REVIEW' ? 'รับงานแล้ว · AWH Cloud กำลังสร้างหลักฐานและ Review Pack ของโปรเจกต์นี้' : 'รับงานแล้ว · AWH Cloud กำลังตรวจระบบ', 'success');
    await refresh({ quiet: true });
  } catch (error) { message('review-action-message', error instanceof Error ? error.message : 'เริ่มงานตรวจไม่สำเร็จ', 'error'); }
  finally { state.busy = false; renderCloud(); }
}

async function exportAiPass() {
  if (state.busy) return; const projectId = $('review-project')?.value; if (!projectId) { message('review-action-message', 'เลือกโปรเจกต์ก่อน', 'error'); return; }
  state.busy = true; renderCloud(); message('review-action-message', 'กำลังดึง exact Source ล่าสุดเข้า Canonical Review Cache และทำ sanitizer…');
  try {
    const result = await createAiPassProjectExport(projectId, `aipass-review-${projectId.slice(0, 8)}-${Date.now()}`);
    const artifact = result.artifact; if (!artifact?.downloadUrl) throw new Error('AWH สร้างแพ็กแล้วแต่ไม่พบไฟล์ดาวน์โหลด');
    state.source = await loadProjectSourceAuthority(projectId); state.revision = state.source.canonicalRevision || null;
    const link = document.createElement('a'); link.href = artifact.downloadUrl; link.download = artifact.name || ''; link.rel = 'noopener'; document.body.append(link); link.click(); link.remove();
    message('review-action-message', `พร้อมแล้ว · ${artifact.name || 'AiPASS Review Pack'} แตกไฟล์แล้วแนบ 01 + 02 ทุกส่วนให้ Claude ใน AiPASS ได้เลย`, 'success');
  } catch (error) { message('review-action-message', error instanceof Error ? error.message : 'สร้าง AiPASS Export ไม่สำเร็จ', 'error'); }
  finally { state.busy = false; renderCloud(); }
}

async function stopTask(taskId, button) {
  if (button instanceof HTMLButtonElement) button.disabled = true;
  try { await cancelTask(taskId); message('review-action-message', 'รับคำขอหยุดแล้ว · AWH จะไม่รับผลลัพธ์ที่มาถึงภายหลัง', 'success'); await refresh({ quiet: true }); }
  catch (error) { message('review-action-message', error instanceof Error ? error.message : 'หยุดงานไม่สำเร็จ', 'error'); if (button instanceof HTMLButtonElement) button.disabled = false; }
}

async function saveCredential() {
  const password = $('cloud-owner-password')?.value || ''; const secret = $('cloud-credential')?.value || '';
  if (!password || !secret) { message('cloud-setup-message', 'กรอกรหัสผ่าน Owner และ credential ให้ครบ', 'error'); return; }
  const button = $('save-cloud-credential'); if (button instanceof HTMLButtonElement) button.disabled = true;
  try {
    await stepUp(password); await updateCloudCredential('SET', secret);
    if ($('cloud-owner-password')) $('cloud-owner-password').value = ''; if ($('cloud-credential')) $('cloud-credential').value = '';
    message('cloud-setup-message', 'เชื่อม AWH Cloud แล้ว', 'success'); if ($('cloud-setup') instanceof HTMLDetailsElement) $('cloud-setup').open = false; await refresh({ quiet: true });
  } catch (error) { message('cloud-setup-message', error instanceof Error ? error.message : 'เชื่อม AWH Cloud ไม่สำเร็จ', 'error'); }
  finally { if (button instanceof HTMLButtonElement) button.disabled = false; }
}

$('review-project')?.addEventListener('change', () => refresh());
$('refresh-review')?.addEventListener('click', () => refresh());
$('run-cloud-qa')?.addEventListener('click', () => run('QA'));
$('run-visual-review')?.addEventListener('click', () => run('VISUAL_REVIEW'));
$('run-aipass-export')?.addEventListener('click', exportAiPass);
$('save-cloud-credential')?.addEventListener('click', saveCredential);
window.addEventListener('pagehide', () => { if (state.timer) clearInterval(state.timer); });
await refresh(); state.timer = window.setInterval(() => refresh({ quiet: true }), 8000);
