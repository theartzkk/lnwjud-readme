const $ = (id) => document.getElementById(id);
let overview = null;
let projectsData = null;
let activeProjectId = null;
let enrollmentNotice = null;
let enrollmentActionInFlight = false;
let enrollmentRefreshSequence = 0;

function escapeText(value) { return value == null ? '—' : String(value); }
function renderList(container, items, emptyText, render) {
  container.replaceChildren();
  if (!items?.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = emptyText; container.append(p); return; }
  for (const item of items) container.append(render(item));
}
function item(title, detail, cls='list-item') { const root=document.createElement('div');root.className=cls;const strong=document.createElement('strong');strong.textContent=title;const small=document.createElement('small');small.textContent=detail;root.append(strong,small);return root; }
function row(dl, key, value) { const dt=document.createElement('dt');dt.textContent=key;const dd=document.createElement('dd');dd.textContent=escapeText(value);dl.append(dt,dd); }
function dateText(value) { return value ? new Date(value).toLocaleString('th-TH') : '—'; }
function showProjectStatus(message, kind = '') { const status = $('project-status'); status.textContent = message; status.className = `notice ${kind}`.trim(); }
function renderAutopilotOverview(data) {
  if (!data) return;
  $('autopilot-project').textContent = data.executionEnabled ? 'AWH จะใช้เฉพาะความสามารถที่อนุมัติและขออนุมัติก่อนงานเสี่ยง' : 'เปิด Approved execution บนอุปกรณ์นี้ก่อนจึงจะรับงานได้';
}

function renderArtifacts(data) {
  renderList($('remote-result-list'), data?.results || [], 'ยังไม่มีผลลัพธ์จาก Work', (result) => item(result.projectName || 'งานล่าสุด', result.resultSummary || result.lastEvent?.message || 'AWH กำลังดำเนินการ', 'timeline-item'));
  renderList($('artifact-list'), data?.artifacts || [], 'ยังไม่มีไฟล์ผลลัพธ์ที่พร้อมตรวจ', (artifact) => item(artifact.label || artifact.name || 'ผลลัพธ์', artifact.status === 'READY' ? 'พร้อมตรวจ' : 'กำลังเตรียมผลลัพธ์', 'timeline-item'));
  renderList($('approval-list'), data?.approvals || [], 'ยังไม่มีสิ่งที่ต้องอนุมัติ', (approval) => item(approval.status === 'PENDING' ? 'ต้องการการอนุมัติ' : 'การอนุมัติ', `หมดอายุ ${dateText(approval.expiresAt)}`, 'timeline-item'));
}

async function refreshWorker() {
  try {
    const state = await window.artAgent.getWorkerState();
    $('worker-state').textContent = state.enabled ? (state.running ? 'WORKING' : 'READY') : 'OFF';
    $('worker-state').className = `badge ${state.enabled ? 'success' : ''}`.trim();
    $('worker-summary').textContent = state.enabled ? `${state.hubAuthority} • งานจะเริ่มเมื่อ Hub มอบหมายและ policy อนุญาต` : 'เปิดใช้ worker ผ่าน device policy เมื่อ control plane พร้อม';
  } catch { $('worker-state').textContent = 'CHECK'; $('worker-state').className = 'badge danger'; }
}

async function refreshAutopilot() {
  await refreshWork();
  const remote = await window.artAgent.getAutopilotRemoteResults().catch(() => ({ results: [], artifacts: [], approvals: [] }));
  const data = await window.artAgent.getAutopilotOverview().catch(() => null);
  if (data) renderAutopilotOverview(data);
  renderArtifacts({ results: remote.results || [], artifacts: [...(data?.artifacts || []), ...(remote.artifacts || [])], approvals: remote.approvals || [] });
  await refreshWorker();
}

function workState(task) {
  return ({ WAITING_FOR_WORKER: 'กำลังจัดเส้นทางงาน', PREPARING: 'กำลังเตรียมงาน', RUNNING: 'กำลังทำงาน', QA: 'กำลังตรวจผลลัพธ์', WAITING_FOR_APPROVAL: 'ต้องอนุมัติ', COMPLETED: 'เสร็จแล้ว', FAILED: 'ต้องตรวจสอบ', CANCELLED: 'ยกเลิกแล้ว' })[task?.state] || 'AWH';
}

function renderWorkConversation(data) {
  const thread = $('desktop-work-thread'); const stickToBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 140; thread.replaceChildren();
  const messages = data?.messages || [];
  const taskById = new Map((data?.tasks || []).map((task) => [task.taskId, task]));
  const artifactsByTask = new Map();
  for (const artifact of data?.artifacts || []) { if (!artifact?.taskId) continue; const list = artifactsByTask.get(artifact.taskId) || []; list.push(artifact); artifactsByTask.set(artifact.taskId, list); }
  $('desktop-work-empty').hidden = messages.some((turn) => turn.kind !== 'progress');
  for (const turn of messages) {
    if (turn.kind === 'progress') continue;
    if (turn.kind === 'assistant' && /(?:เครื่องมือที่เหมาะสม|เตรียมบริบทของโปรเจกต์|เก็บคำขอนี้ไว้แล้ว)/u.test(turn.body || '')) continue;
    const row = document.createElement('li'); row.className = `desktop-turn ${turn.kind === 'user' ? 'user-turn' : 'assistant-turn'}`;
    const body = document.createElement('p'); body.className = turn.kind === 'user' ? 'desktop-user-message' : 'desktop-assistant-message'; body.textContent = turn.body;
    if (turn.kind === 'user') { row.append(body); thread.append(row); continue; }
    const task = turn.taskId ? taskById.get(turn.taskId) : null;
    const meta = document.createElement('div'); meta.className = 'desktop-turn-meta';
    const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = turn.kind === 'approval' ? 'ต้องอนุมัติ' : turn.kind === 'result' ? 'เสร็จแล้ว' : turn.kind === 'failure' ? 'ต้องตรวจสอบ' : task && !['COMPLETED','FAILED','CANCELLED'].includes(task.state) ? workState(task) : 'AWH'; meta.append(badge);
    row.append(meta, body);
    const artifacts = task ? artifactsByTask.get(task.taskId) || [] : [];
    if (artifacts.length) { const list = document.createElement('ul'); list.className = 'desktop-artifact-links'; for (const artifact of artifacts) { const item = document.createElement('li'); item.textContent = `↳ ${artifact.name || 'ไฟล์ผลลัพธ์'}`; list.append(item); } row.append(list); }
    thread.append(row);
  }
  if (stickToBottom) requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
}

async function refreshWork() {
  const result = await window.artAgent.getWorkConversation();
  if (result?.ok !== true) { $('desktop-work-status').textContent = 'AWH Server · Check'; return; }
  $('desktop-work-project').textContent = projectsData?.projects?.find((project) => project.projectId === result.projectId)?.name || 'AWH';
  $('desktop-work-status').textContent = 'AI · Ready';
  renderWorkConversation(result);
}

function workspaceContinuityText(workspace) {
  if (!workspace) return 'ยังไม่มี checkpoint สำหรับส่งต่องานข้ามอุปกรณ์';
  if (workspace.syncStatus === 'SYNCED') return 'พร้อมทำงานต่อจาก checkpoint ล่าสุดบนอุปกรณ์ที่เชื่อถือได้';
  if (workspace.syncStatus === 'HANDOFF_REQUIRED') return 'กำลังทำงานอยู่บนอุปกรณ์อื่น — บันทึกและส่งต่องานจากเครื่องนั้นก่อน';
  if (workspace.syncStatus === 'SOURCE_OFFLINE') return 'เครื่องเดิมออฟไลน์ แต่มี checkpoint ล่าสุดที่ตรวจสอบแล้ว';
  if (workspace.syncStatus === 'UNSYNCED_CHANGES') return 'มีงานที่ยัง sync ไม่ครบ จึงยังไม่อนุญาตให้เขียนทับหรือรับต่อ';
  return 'ยังไม่มี checkpoint — งานใหม่จะเริ่มจาก revision ที่ลงทะเบียนไว้';
}

async function refreshWorkspaceContinuity() {
  const result = await window.artAgent.getWorkspaceContinuity();
  $('workspace-continuity-status').textContent = result?.ok === true ? workspaceContinuityText(result.workspace) : result?.message || 'สถานะการทำงานข้ามอุปกรณ์ยังไม่พร้อม';
  $('workspace-sync').disabled = result?.ok !== true;
  $('workspace-takeover').disabled = result?.ok !== true || result.workspace?.syncStatus === 'UNSYNCED_CHANGES';
}

async function runWorkspaceAction(action) {
  $('workspace-sync').disabled = true; $('workspace-takeover').disabled = true;
  $('workspace-continuity-status').textContent = 'กำลังตรวจและบันทึกสถานะ workspace อย่างปลอดภัย…';
  try {
    const result = await action();
    $('workspace-continuity-status').textContent = result?.message || 'AWH ยังดำเนินการไม่ได้';
  } finally { await refreshWorkspaceContinuity(); }
}

async function submitWork() {
  const input = $('desktop-work-input'); const message = input.value.trim();
  if (!message) { $('desktop-work-message').textContent = 'พิมพ์สิ่งที่อยากให้ AWH ช่วยได้เลย'; return; }
  const key = `desktop-${crypto.randomUUID()}`; input.value = ''; input.focus(); $('desktop-work-message').textContent = 'AWH · กำลังตอบ';
  const thread = $('desktop-work-thread');
  const local = document.createElement('li'); local.className = 'desktop-turn user-turn'; const bubble = document.createElement('p'); bubble.className = 'desktop-user-message'; bubble.textContent = message; local.append(bubble); thread.append(local);
  const typing = document.createElement('li'); typing.className = 'desktop-turn assistant-turn desktop-typing'; const text = document.createElement('p'); text.className = 'desktop-assistant-message'; text.textContent = 'AWH · กำลังตอบ'; typing.append(text); thread.append(typing); thread.scrollTop = thread.scrollHeight;
  try {
    const result = await window.artAgent.submitWorkMessage(message, key);
    if (result?.ok !== true) throw new Error(result?.message || 'ส่ง Work ไม่สำเร็จ');
    renderWorkConversation(result); $('desktop-work-message').textContent = '';
  } catch (error) { typing.remove(); $('desktop-work-message').textContent = error?.message || 'AWH Server · Check'; void refreshWork(); }
}

function remoteState(data) {
  const readiness = data.doctor.remoteTunnel;
  const runtime = data.doctor.remoteRuntime;
  if (runtime?.connected) return { label: 'CONNECTED', cls: 'success', summary: 'Secure MCP Tunnel พร้อมใช้งานและผ่าน running + healthy + ready แล้ว' };
  if (runtime?.processRunning) return { label: 'STARTING', cls: '', summary: `Tunnel runtime กำลังเริ่ม (${runtime.runtimeState}) และยังไม่ถูกนับว่า Connected` };
  if (runtime?.state === 'stopped') return { label: 'STOPPED', cls: '', summary: 'Tunnel runtime ถูกหยุดและตรวจสถานะซ้ำแล้ว' };
  if (readiness?.ready) return { label: 'READY TO CONNECT', cls: 'success', summary: 'องค์ประกอบครบแล้ว กดเชื่อมต่อและยืนยันใน dialog เมื่อต้องการเปิด Remote Connection' };
  return { label: 'NOT READY', cls: 'danger', summary: readiness?.blockers?.join(' • ') || 'Remote Connection ยังไม่พร้อม' };
}

function renderRemote(data) {
  const readiness = data.doctor.remoteTunnel;
  const runtime = data.doctor.remoteRuntime;
  const state = remoteState(data);
  const badge = $('remote-state');
  badge.textContent = state.label;
  badge.className = `badge ${state.cls}`.trim();
  $('remote-summary').textContent = state.summary;
  $('remote-connect').disabled = !readiness?.ready || runtime?.processRunning === true;
  $('remote-stop').disabled = runtime?.processRunning !== true;

  const details = $('remote-details');
  details.replaceChildren();
  row(details, 'Readiness', readiness?.ready ? 'READY' : 'NOT READY');
  row(details, 'Tunnel binary', readiness?.binaryReady ? `READY${readiness.binaryVersion ? ` • ${readiness.binaryVersion}` : ''}` : readiness?.binaryConfigured ? 'INVALID' : 'NOT CONFIGURED');
  row(details, 'Runtime key', readiness?.runtimeKeyValid ? 'PRESENT' : readiness?.runtimeKeyPresent ? 'INVALID' : 'NOT SET');
  row(details, 'Tunnel ID', readiness?.tunnelIdValid ? 'VALID' : readiness?.tunnelIdPresent ? 'INVALID' : 'NOT SET');
  row(details, 'Packaged MCP', readiness?.packagedMcpReady ? 'READY' : 'NOT READY');
  row(details, 'Last verified', runtime?.verifiedAt ? new Date(runtime.verifiedAt).toLocaleString('th-TH') : 'ยังไม่มีการเชื่อมต่อ/หยุดใน session นี้');
  if (readiness?.blockers?.length) row(details, 'Blocker', readiness.blockers.join(' • '));
}

function renderEnrollment(data) {
  const status = $('enrollment-state');
  const connected = data?.hubConfigured === true;
  const enrolled = data?.enrolled === true;
  status.textContent = data?.ok === false ? 'UNAVAILABLE' : enrolled ? 'ENROLLED' : 'NOT ENROLLED';
  status.className = `badge ${data?.ok === false ? 'danger' : enrolled ? 'success' : ''}`.trim();
  $('enrollment-hub').textContent = connected ? 'พร้อมเชื่อมต่อเมื่อคุณสั่งงาน' : 'ยังไม่ได้ตั้งค่า AWH Hub';
  $('enrollment-device-name').textContent = data?.displayName || '—';
  $('enrollment-device-id').textContent = data?.deviceId || '—';
  $('enrollment-platform').textContent = data?.platform || '—';
  $('enrollment-message').textContent = enrollmentNotice || (data?.ok === false ? data.message : enrolled ? 'เข้าสู่ระบบแล้ว เครื่องนี้พร้อมใช้สิทธิ์ของบัญชี AWH' : 'เข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่าน AWH ได้เลย');
  $('enrollment-login').disabled = !connected || enrolled;
  $('enrollment-username').disabled = !connected || enrolled;
  $('enrollment-password').disabled = !connected || enrolled;
  $('enrollment-pair').disabled = !connected || enrolled;
  $('enrollment-issue-pairing').disabled = !connected || !enrolled;
  $('owner-access-reset').disabled = !connected;
  $('enrollment-rotate').disabled = !connected || !enrolled;
  $('enrollment-revoke').disabled = !connected || !enrolled;
  if (!enrolled) clearOwnerCode();
}

async function refreshEnrollment(force = false) {
  if (enrollmentActionInFlight && !force) return;
  const sequence = ++enrollmentRefreshSequence;
  try {
    const state = await window.artAgent.getEnrollmentState();
    if (sequence !== enrollmentRefreshSequence || (enrollmentActionInFlight && !force)) return;
    renderEnrollment(state);
  } catch {
    if (sequence !== enrollmentRefreshSequence || (enrollmentActionInFlight && !force)) return;
    renderEnrollment({ ok: false, message: 'ยังตรวจสถานะอุปกรณ์นี้ไม่ได้ ลองรีเฟรชอีกครั้ง' });
  }
}

async function runEnrollmentAction(action) {
  clearOwnerCode();
  enrollmentNotice = null;
  enrollmentActionInFlight = true;
  for (const id of ['enrollment-login', 'enrollment-pair', 'enrollment-issue-pairing', 'owner-access-reset', 'enrollment-rotate', 'enrollment-revoke']) $(id).disabled = true;
  try {
    const result = await action();
    enrollmentNotice = result?.ok === true ? null : result?.message || 'Enrollment action was rejected';
    await refreshEnrollment(true);
    if (result?.ok === true) { await refreshProjects(); await refreshAutopilot(); }
  } catch (error) {
    enrollmentNotice = error instanceof Error && error.message ? error.message : 'Enrollment action was rejected';
    await refreshEnrollment(true);
  } finally {
    enrollmentActionInFlight = false;
  }
}

let ownerCodeExpiryTimer = null;
function clearOwnerCode() {
  if (ownerCodeExpiryTimer !== null) { clearTimeout(ownerCodeExpiryTimer); ownerCodeExpiryTimer = null; }
  $('enrollment-pairing-code').textContent = '';
  $('enrollment-pairing-expiry').textContent = '';
  $('enrollment-pairing-scope').textContent = '';
  $('enrollment-pairing-result').hidden = true;
}

function showOwnerCode(data) {
  const expiry = Date.parse(data?.expiresAt || '');
  if (typeof data?.code !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(data.code) || !Number.isFinite(expiry) || expiry <= Date.now()) {
    clearOwnerCode();
    $('enrollment-message').textContent = 'รหัสเชื่อมต่อที่ได้รับไม่ปลอดภัย จึงไม่แสดงผล';
    return;
  }
  $('enrollment-pairing-code').textContent = data.code;
  $('enrollment-pairing-expiry').textContent = `หมดอายุ ${new Date(expiry).toLocaleString('th-TH')}`;
  $('enrollment-pairing-scope').textContent = data.projectCount === 0
    ? 'รหัสนี้เปิด Control Panel ได้ แต่ยังไม่มีสิทธิ์เข้าถึงโปรเจกต์ใด จนกว่าจะมีการ onboard โปรเจกต์'
    : `ขอบเขตโปรเจกต์: ${data.projectCount} โปรเจกต์`;
  $('enrollment-pairing-result').hidden = false;
  $('enrollment-message').textContent = 'สร้างรหัสแล้ว — แสดงเฉพาะในหน้าจอนี้และจะไม่ถูกบันทึก';
  ownerCodeExpiryTimer = setTimeout(() => {
    clearOwnerCode();
    $('enrollment-message').textContent = 'รหัสเชื่อมต่อหมดอายุแล้ว สร้างรหัสใหม่ได้เมื่อจำเป็น';
  }, Math.max(0, expiry - Date.now()));
}

async function issueOwnerCode() {
  $('enrollment-issue-pairing').disabled = true;
  $('enrollment-message').textContent = 'กำลังสร้างรหัสเชื่อมต่อแบบใช้ครั้งเดียว...';
  try {
    const result = await window.artAgent.createDeviceCode();
    if (result?.ok === true) showOwnerCode(result);
    else $('enrollment-message').textContent = result?.message || 'สร้างรหัสเชื่อมต่อไม่สำเร็จ';
    await refreshEnrollment();
  } catch {
    $('enrollment-message').textContent = 'สร้างรหัสเชื่อมต่อไม่สำเร็จ';
    await refreshEnrollment();
  }
}

function projectStatusLabel(project) {
  if (project.hubAvailable) return [project.selected ? 'SELECTED' : 'HUB READY', 'success'];
  if (project.state === 'CONFLICT') return ['CHECK', 'danger'];
  return ['LOCAL ONLY', ''];
}

function renderProjects(data) {
  projectsData = data;
  const list = $('project-list');
  list.replaceChildren();
  if (!data.projects?.length) {
    list.append(item('ยังไม่มี registered project', 'ใช้ Register Existing Project หรือ Initialize as AWH Project เพื่อเริ่มต้น', 'list-item'));
    return;
  }
  for (const project of data.projects) {
    const card = document.createElement('article'); card.className = 'card project-card';
    const head = document.createElement('div'); head.className = 'card-head';
    const title = document.createElement('div');
    const name = document.createElement('h3'); name.textContent = project.name || project.projectId; name.className = 'project-name';
    const stateText = document.createElement('small'); stateText.textContent = project.hubAvailable ? `AWH Hub · Ready${project.localAvailable ? ' · Mac workspace · Bound' : ''}` : 'Mac workspace · Local only'; stateText.className = 'muted';
    title.append(name, stateText);
    const badge = document.createElement('span'); const [label, cls] = projectStatusLabel(project); badge.textContent = label; badge.className = `badge ${cls}`.trim();
    head.append(title, badge); card.append(head);
    if (project.error) { const note = document.createElement('p'); note.className = 'muted'; note.textContent = project.error; card.append(note); }
    const actions = document.createElement('div'); actions.className = 'actions';
    if (project.hubAvailable) {
      const select = document.createElement('button'); select.className = 'btn'; select.textContent = project.selected ? 'กำลังใช้งาน' : 'เปิด Work'; select.disabled = project.selected;
      select.addEventListener('click', () => runProjectAction(() => window.artAgent.selectProject(project.projectId), 'เลือกโปรเจกต์บน AWH Hub แล้ว'));
      actions.append(select);
    }
    if (project.localAvailable) { const memory = document.createElement('button'); memory.className = 'btn secondary'; memory.textContent = 'Local tools'; memory.addEventListener('click', () => loadMemory(project.projectId)); actions.append(memory); }
    else if (project.hubAvailable) { const locate = document.createElement('button'); locate.className = 'btn secondary'; locate.textContent = 'ผูกโฟลเดอร์ Mac (ถ้าต้องใช้)'; locate.addEventListener('click', () => runProjectAction(() => window.artAgent.locateProject(project.projectId), 'ผูก local workspace แล้ว')); actions.append(locate); }
    card.append(actions); list.append(card);
  }
}

function renderMemory(context) {
  activeProjectId = context.project.projectId;
  $('memory-title').textContent = context.project.name;
  $('memory-project-state').textContent = `${context.project.type} • READY`;
  $('memory-project-state').className = 'badge success';
  $('memory-workspace').textContent = context.workspacePath;
  const handoff = $('handoff-preview');
  if (!context.handoffPreview) handoff.textContent = 'HANDOFF.md — Missing';
  else handoff.textContent = `${context.handoffPreview.text}${context.handoffPreview.truncated ? '\n\n[Preview truncated]' : ''}`;
  const list = $('memory-list'); list.replaceChildren();
  for (const [file, status] of Object.entries(context.memory || {})) {
    const entry = document.createElement('div'); entry.className = 'memory-entry';
    const name = document.createElement('strong'); name.textContent = file;
    const state = document.createElement('span'); state.textContent = status === 'present' ? 'Present' : 'Missing'; state.className = `badge ${status === 'present' ? 'success' : ''}`.trim();
    entry.append(name, state); list.append(entry);
  }
  $('initialize-memory').disabled = !Object.values(context.memory || {}).includes('missing');
}

async function loadMemory(projectId) {
  showSection('memory');
  $('memory-title').textContent = 'Project Memory'; $('memory-project-state').textContent = 'กำลังโหลด...'; $('initialize-memory').disabled = true;
  try { renderMemory(await window.artAgent.getProjectContext(projectId)); }
  catch (error) { $('memory-project-state').textContent = 'UNAVAILABLE'; $('memory-project-state').className = 'badge danger'; $('handoff-preview').textContent = `Project Memory error: ${error?.message ?? error}`; }
}

async function refreshProjects() {
  try { renderProjects(await window.artAgent.getProjects()); }
  catch (error) { showProjectStatus(`Projects error: ${error?.message ?? error}`, 'danger'); }
}

async function runProjectAction(action, successMessage) {
  try {
    const result = await action();
    if (result?.changed) {
      showProjectStatus(successMessage, '');
      if (result.restartRequired === true) $('restart-banner').classList.remove('hidden');
      else $('restart-banner').classList.add('hidden');
      await refresh();
      if (result.projectId && result.restartRequired === false) {
        showSection('autopilot');
        $('desktop-work-input').focus();
      }
      return;
    }
    await refreshProjects();
  } catch (error) { showProjectStatus(error?.message ?? String(error), 'danger'); }
}

function render(data) {
  overview = data;
  const hubAuthority = typeof data.hubAuthority === 'string' && data.hubAuthority ? new URL(data.hubAuthority).hostname : 'AWH Hub';
  $('version').textContent = `v${data.version} • Hub กลาง ${hubAuthority}`;
  $('home-project-summary').textContent = data.workspace && data.workspace !== 'not configured' ? 'โปรเจกต์ที่เลือกพร้อมให้คุยและทำงานต่อได้จาก Work' : 'ยังไม่มีโปรเจกต์ที่เลือก — เริ่มจากเลือกหรือเพิ่มโปรเจกต์';
  $('git-state').textContent = data.git.ok ? 'READY' : 'CHECK';
  $('git-state').className = `badge ${data.git.ok ? 'success' : 'danger'}`;
  $('git-output').textContent = data.git.text || 'Working tree clean';
  $('perm-write').checked = data.permissions.write;
  $('perm-exec').checked = data.permissions.execute;
  $('perm-codex').checked = data.permissions.codex;
  $('perm-worker').checked = data.permissions.worker;

  renderList($('audit-list'), data.audit, 'ยังไม่มีกิจกรรมที่บันทึก', (entry) => item(`${entry.tool} • ${entry.outcome}`, `${new Date(entry.ts).toLocaleString('th-TH')} • ${entry.detail}`, 'timeline-item'));

  renderRemote(data);

  const runtime = $('doctor-runtime'); runtime.replaceChildren();
  row(runtime, 'Platform', `${data.doctor.platform} / ${data.doctor.arch}`); row(runtime, 'Node', data.doctor.node); row(runtime, 'Electron', data.doctor.electron); row(runtime, 'Data dir', data.dataDir);
  row(runtime, 'Device identity', data.doctor.device?.ready ? 'READY' : data.doctor.device?.error ? 'ERROR' : 'NOT INITIALIZED');
  if (data.doctor.device?.ready) { row(runtime, 'Device name', data.doctor.device.displayName); row(runtime, 'Device ID', data.doctor.device.idShort); }
  const boundary = $('doctor-boundary'); boundary.replaceChildren();
  const tunnel = data.doctor.remoteTunnel;
  const tunnelRuntime = data.doctor.remoteRuntime;
  const binaryState = tunnel?.binaryReady ? `READY${tunnel.binaryVersion ? ` • ${tunnel.binaryVersion}` : ''}` : tunnel?.binaryConfigured ? 'INVALID' : 'NOT CONFIGURED';
  const keyState = tunnel?.runtimeKeyValid ? 'PRESENT' : tunnel?.runtimeKeyPresent ? 'INVALID' : 'NOT SET';
  const tunnelIdState = tunnel?.tunnelIdValid ? 'VALID' : tunnel?.tunnelIdPresent ? 'INVALID' : 'NOT SET';
  row(boundary, 'Workspace', data.doctor.workspaceReady ? 'READY' : 'ERROR');
  row(boundary, 'Remote tunnel', tunnelRuntime?.connected ? 'CONNECTED' : tunnel?.ready ? 'READY TO CONNECT' : 'NOT READY');
  row(boundary, 'Tunnel binary', binaryState);
  row(boundary, 'Runtime key', keyState);
  row(boundary, 'Tunnel ID', tunnelIdState);
  row(boundary, 'Packaged MCP', tunnel?.packagedMcpReady ? 'READY' : 'NOT READY');
  if (tunnel?.pathDiagnosticCandidate && !tunnel.binaryConfigured) row(boundary, 'PATH candidate', tunnel.pathDiagnosticCandidate);
  if (tunnel?.blockers?.length) row(boundary, 'Remote blocker', tunnel.blockers.join(' • '));
  row(boundary, 'Codex CLI', data.codex.available ? 'READY' : 'NOT FOUND');
}

function showSection(section) {
  document.body.classList.toggle('work-mode', section === 'autopilot');
  document.querySelectorAll('.nav').forEach((node) => node.classList.toggle('active', node.dataset.section === section));
  document.querySelectorAll('.section').forEach((node) => node.classList.toggle('active', node.id === `section-${section}`));
}

async function refresh() {
  $('refresh').disabled = true;
  try { render(await window.artAgent.getOverview()); await refreshProjects(); await refreshEnrollment(); await refreshAutopilot(); await refreshWorkspaceContinuity(); }
  catch (error) { $('git-output').textContent = `Control Center error: ${error?.message ?? error}`; }
  finally { $('refresh').disabled = false; }
}

async function runRemoteAction(action) {
  const connect = $('remote-connect');
  const stop = $('remote-stop');
  connect.disabled = true;
  stop.disabled = true;
  $('remote-summary').textContent = action === 'connect' ? 'กำลังเชื่อมต่อและตรวจ health/ready...' : 'กำลังหยุดและตรวจสถานะซ้ำ...';
  try {
    const result = action === 'connect'
      ? await window.artAgent.remoteConnect()
      : await window.artAgent.remoteStop();
    await refresh();
    if (result?.cancelled) return;
    if (result?.ok !== true) {
      $('remote-summary').textContent = result?.message || result?.blockers?.join(' • ') || 'Remote Connection ทำรายการไม่สำเร็จ';
      $('remote-state').textContent = 'CHECK';
      $('remote-state').className = 'badge danger';
    }
  } catch (error) {
    await refresh();
    $('remote-summary').textContent = `Remote Connection error: ${error?.message ?? error}`;
    $('remote-state').textContent = 'CHECK';
    $('remote-state').className = 'badge danger';
  }
}

document.querySelectorAll('.nav').forEach((button) => button.addEventListener('click', () => showSection(button.dataset.section)));

$('refresh').addEventListener('click', refresh);
$('home-open-projects').addEventListener('click', () => showSection('projects'));
$('home-open-work').addEventListener('click', () => showSection('autopilot'));
$('register-project').addEventListener('click', () => runProjectAction(() => window.artAgent.registerProject(), 'ลงทะเบียนโปรเจกต์แล้ว'));
$('initialize-project').addEventListener('click', () => runProjectAction(() => window.artAgent.initializeProject(), 'เริ่มต้นและลงทะเบียน AWH Project แล้ว'));
$('initialize-memory').addEventListener('click', async () => {
  if (!activeProjectId) return;
  await runProjectAction(async () => {
    const result = await window.artAgent.initializeProjectMemory(activeProjectId);
    await loadMemory(activeProjectId);
    return { changed: result.changed };
  }, 'สร้างเฉพาะ Project Memory ที่หายไปแล้ว');
});
$('save-permissions').addEventListener('click', async () => {
  const execute = $('perm-exec').checked;
  const codex = $('perm-codex').checked;
  if (codex && !execute) { $('perm-exec').checked = true; }
  if ($('perm-worker').checked && !$('perm-exec').checked) { $('perm-exec').checked = true; }
  await window.artAgent.setPermissions({ write: $('perm-write').checked, execute: $('perm-exec').checked, codex: $('perm-codex').checked, worker: $('perm-worker').checked });
  $('restart-banner').classList.remove('hidden');
});
$('remote-connect').addEventListener('click', () => runRemoteAction('connect'));
$('remote-stop').addEventListener('click', () => runRemoteAction('stop'));
$('enrollment-login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const username = $('enrollment-username').value.trim(); const password = $('enrollment-password').value;
  if (!username || !password) { enrollmentNotice = 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'; $('enrollment-message').textContent = enrollmentNotice; return; }
  $('enrollment-message').textContent = 'กำลังเข้าสู่ AWH…';
  void runEnrollmentAction(async () => { const result = await window.artAgent.loginDevice(username, password); $('enrollment-password').value = ''; return result; });
});
$('enrollment-username').addEventListener('input', () => { enrollmentNotice = null; });
$('enrollment-password').addEventListener('input', () => { enrollmentNotice = null; });
$('enrollment-password-toggle').addEventListener('click', () => {
  const input = $('enrollment-password'); const reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  $('enrollment-password-toggle').textContent = reveal ? 'ซ่อน' : 'แสดง';
  $('enrollment-password-toggle').setAttribute('aria-label', reveal ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
});
$('enrollment-pair').addEventListener('click', () => runEnrollmentAction(() => window.artAgent.pairDevice($('enrollment-code').value.trim())));
$('enrollment-issue-pairing').addEventListener('click', issueOwnerCode);
$('owner-access-reset').addEventListener('click', async () => { $('owner-access-reset').disabled = true; $('owner-access-reset-message').textContent = 'กำลังเปิดหน้ากู้คืนบัญชี…'; try { const result = await window.artAgent.openOwnerRecovery(); $('owner-access-reset-message').textContent = result?.message || 'เปิด browser แล้ว'; } catch { $('owner-access-reset-message').textContent = 'ยังเปิดหน้ากู้คืนบัญชีไม่ได้'; } finally { await refreshEnrollment(); } });
$('enrollment-rotate').addEventListener('click', () => runEnrollmentAction(() => window.artAgent.rotateDeviceCredential()));
$('enrollment-revoke').addEventListener('click', () => runEnrollmentAction(() => window.artAgent.revokeDeviceCredential()));
$('refresh-autopilot').addEventListener('click', refreshAutopilot);
$('desktop-work-form').addEventListener('submit', (event) => { event.preventDefault(); void submitWork(); });
$('workspace-sync').addEventListener('click', () => { void runWorkspaceAction(() => window.artAgent.syncWorkspaceForHandoff()); });
$('workspace-takeover').addEventListener('click', () => { void runWorkspaceAction(() => window.artAgent.takeOverWorkspace()); });
$('desktop-work-project').addEventListener('click', () => showSection('projects'));
$('view-results').addEventListener('click', () => showSection('artifacts'));
$('refresh-artifacts').addEventListener('click', async () => renderArtifacts(await window.artAgent.getAutopilotArtifacts()));
$('worker-run-once').addEventListener('click', async () => { $('worker-run-once').disabled = true; await window.artAgent.runWorkerOnce(); await refreshWorker(); await refreshAutopilot(); $('worker-run-once').disabled = false; });
$('restart').addEventListener('click', () => window.artAgent.restart());
$('open-data-dir').addEventListener('click', () => window.artAgent.openDataDir());

document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); showSection('autopilot'); $('desktop-work-input').focus(); } });

showSection('overview');
document.querySelectorAll('[data-home-section]').forEach((button) => button.addEventListener('click', () => showSection(button.dataset.homeSection)));
void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 10000);
setInterval(() => { if (!document.hidden && document.body.classList.contains('work-mode')) void refreshWork(); }, 2000);
