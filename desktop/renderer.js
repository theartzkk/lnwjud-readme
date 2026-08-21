const $ = (id) => document.getElementById(id);
let overview = null;
let projectsData = null;
let activeProjectId = null;

function escapeText(value) { return value == null ? '—' : String(value); }
function permission(el, enabled) { el.textContent = enabled ? 'ON' : 'OFF'; el.className = `metric ${enabled ? 'on' : 'off'}`; }
function renderList(container, items, emptyText, render) {
  container.replaceChildren();
  if (!items?.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = emptyText; container.append(p); return; }
  for (const item of items) container.append(render(item));
}
function item(title, detail, cls='list-item') { const root=document.createElement('div');root.className=cls;const strong=document.createElement('strong');strong.textContent=title;const small=document.createElement('small');small.textContent=detail;root.append(strong,small);return root; }
function row(dl, key, value) { const dt=document.createElement('dt');dt.textContent=key;const dd=document.createElement('dd');dd.textContent=escapeText(value);dl.append(dt,dd); }
function dateText(value) { return value ? new Date(value).toLocaleString('th-TH') : '—'; }
function showProjectStatus(message, kind = '') { const status = $('project-status'); status.textContent = message; status.className = `notice ${kind}`.trim(); }
function renderFirstRun(data) {
  $('welcome-title').textContent = data?.trusted ? `ยินดีต้อนรับกลับ ${data.ownerDisplayName || 'กลับมา'}` : 'ตั้งค่า owner และ trusted device ครั้งแรก';
  $('welcome-summary').textContent = data?.trusted ? `${data.deviceName || 'อุปกรณ์นี้'} • ${data.platform} • device identity พร้อมใช้งาน` : 'ตั้งค่าเฉพาะ local session metadata ก่อนเริ่มงาน ไม่ใช่การเก็บ secret หรือ credential';
  $('owner-name').value = data?.ownerDisplayName || $('owner-name').value;
  $('device-name').value = data?.deviceName || $('device-name').value;
  $('trust-owner').textContent = data?.trusted ? 'อัปเดต trusted device' : 'ตั้งค่า trusted device';
}

function renderAutopilotOverview(data) {
  if (!data) return;
  $('autopilot-state').textContent = data.executionEnabled ? 'READY' : 'EXECUTION OFF';
  $('autopilot-state').className = `badge ${data.executionEnabled ? 'success' : 'danger'}`.trim();
  $('autopilot-home-state').textContent = data.executionEnabled ? 'READY' : 'OFF';
  $('autopilot-home-state').className = `badge ${data.executionEnabled ? 'success' : 'danger'}`.trim();
  $('autopilot-project').textContent = `${data.project.name} • ${data.project.type} • ${data.project.projectId}`;
  const profile = $('autopilot-profile'); profile.replaceChildren();
  row(profile, 'Profile', data.profile.label); row(profile, 'Commands', data.profile.packageCommands.join(' • '));
  row(profile, 'Capabilities', Object.entries(data.capabilities || {}).filter(([, value]) => value === true).map(([key]) => key).join(' • ') || 'none');
  renderAutopilotTasks(data.tasks || [], data.allowWrite === true);
}

function renderAutopilotTasks(tasks, allowWrite) {
  renderList($('autopilot-task-list'), tasks, 'ยังไม่มี task — เริ่มจาก goal ด้านบน', (task) => {
    const entry = item(`${task.state} • ${task.goal}`, `${task.taskId} • artifact ${task.artifactRefs?.length || 0} • retry ${task.retryCount}`, 'timeline-item');
    if (allowWrite && task.state === 'COMPLETED') {
      const checkpoint = document.createElement('button'); checkpoint.className = 'btn secondary small'; checkpoint.textContent = 'Save concise Memory checkpoint';
      checkpoint.addEventListener('click', async () => { checkpoint.disabled = true; const result = await window.artAgent.checkpointAutopilotMemory(task.taskId); checkpoint.textContent = result?.ok ? 'Memory checkpoint saved' : 'Review/write permission required'; });
      entry.append(checkpoint);
    }
    return entry;
  });
}

function renderContinuity(data) {
  const badge = $('continuity-state');
  badge.textContent = data?.available ? (data.protectedLocalChanges ? 'REVIEW REQUIRED' : 'READY TO CONTINUE') : 'NO CHECKPOINT';
  badge.className = `badge ${data?.available && !data.protectedLocalChanges ? 'success' : data?.available ? 'danger' : ''}`.trim();
  $('continuity-summary').textContent = data?.reason || 'ยังไม่มี checkpoint';
  const details = $('continuity-details'); details.replaceChildren();
  if (data?.checkpoint) { row(details, 'Source device', data.checkpoint.sourceDeviceId); row(details, 'Task', data.checkpoint.taskId); row(details, 'Revision', data.checkpoint.sourceRevision || 'unavailable'); row(details, 'Source dirty', data.checkpoint.sourceDirty ? 'YES — protect local work' : 'NO'); }
}

function renderArtifacts(data) {
  renderList($('artifact-list'), data?.artifacts || [], 'ยังไม่มี artifact ที่พร้อม review', (artifact) => item(`${artifact.kind} • ${artifact.label}`, `${artifact.status} • ${artifact.relativeRef} • ${artifact.bytes} bytes`, 'timeline-item'));
}

async function refreshAutopilot() {
  try {
    const data = await window.artAgent.getAutopilotOverview();
    renderAutopilotOverview(data);
    renderContinuity(await window.artAgent.getAutopilotContinuity());
    renderArtifacts({ artifacts: data.artifacts });
  } catch (error) {
    $('autopilot-state').textContent = 'UNAVAILABLE'; $('autopilot-state').className = 'badge danger';
    $('autopilot-project').textContent = 'เลือกและลงทะเบียน project ก่อนเริ่ม Local Autopilot';
  }
}

async function startAutopilot(goalId) {
  const goal = $(goalId).value.trim();
  if (!goal) { $('autopilot-home-message').textContent = 'กรุณาระบุ goal ก่อนเริ่มงาน'; return; }
  $('autopilot-home-message').textContent = 'กำลังสร้าง Task Contract และเริ่มงานแบบ local...';
  try {
    const result = await window.artAgent.startAutopilot(goal);
    $('autopilot-home-message').textContent = result?.ok ? `สร้าง task แล้ว: ${result.task.taskId}` : (result?.message || 'Autopilot เริ่มไม่ได้');
    showSection('autopilot');
    await refreshAutopilot();
  } catch { $('autopilot-home-message').textContent = 'Autopilot เริ่มไม่ได้ — ตรวจ project และ Approved execution'; }
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
  $('enrollment-hub').textContent = connected ? 'API configured — connection is used only for explicit actions' : 'Hub API not configured';
  $('enrollment-device-name').textContent = data?.displayName || '—';
  $('enrollment-device-id').textContent = data?.deviceId || '—';
  $('enrollment-platform').textContent = data?.platform || '—';
  $('enrollment-message').textContent = data?.ok === false ? data.message : enrolled ? 'This device has an active local credential.' : 'Enter a short-lived pairing code issued by the owner.';
  $('enrollment-pair').disabled = !connected || enrolled;
  $('enrollment-issue-pairing').disabled = !connected || !enrolled;
  $('enrollment-rotate').disabled = !connected || !enrolled;
  $('enrollment-revoke').disabled = !connected || !enrolled;
  if (!enrolled) clearOwnerCode();
}

async function refreshEnrollment() {
  try { renderEnrollment(await window.artAgent.getEnrollmentState()); }
  catch (error) { renderEnrollment({ ok: false, message: 'Device enrollment is unavailable' }); }
}

async function runEnrollmentAction(action) {
  clearOwnerCode();
  for (const id of ['enrollment-pair', 'enrollment-issue-pairing', 'enrollment-rotate', 'enrollment-revoke']) $(id).disabled = true;
  try {
    const result = await action();
    if (result?.ok !== true) $('enrollment-message').textContent = result?.message || 'Enrollment action was rejected';
    await refreshEnrollment();
    if (result?.ok === true) { await refreshProjects(); await refreshAutopilot(); }
  } catch (error) {
    $('enrollment-message').textContent = 'Enrollment action was rejected';
    await refreshEnrollment();
  }
}

let ownerCodeExpiryTimer = null;
function clearOwnerCode() {
  if (ownerCodeExpiryTimer !== null) { clearTimeout(ownerCodeExpiryTimer); ownerCodeExpiryTimer = null; }
  $('enrollment-pairing-code').textContent = '';
  $('enrollment-pairing-expiry').textContent = '';
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
  if (project.state === 'CONFLICT') return ['CONFLICT', 'danger'];
  if (!project.localAvailable) return ['WORKSPACE UNAVAILABLE', 'danger'];
  return [project.selected ? 'SELECTED' : 'AVAILABLE', project.selected ? 'success' : ''];
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
    const identity = document.createElement('small'); identity.textContent = `${project.type || 'type unavailable'} • ${project.projectId}`; identity.className = 'mono muted';
    title.append(name, identity);
    const badge = document.createElement('span'); const [label, cls] = projectStatusLabel(project); badge.textContent = label; badge.className = `badge ${cls}`.trim();
    head.append(title, badge); card.append(head);
    const details = document.createElement('dl'); details.className = 'kv project-details';
    row(details, 'Local workspace', project.localAvailable ? project.workspacePath : 'Workspace unavailable');
    row(details, 'Last opened', dateText(project.lastOpenedAt));
    row(details, 'Last used', dateText(project.lastUsedAt));
    row(details, 'Git', project.git ? (project.git.ok ? (project.git.text || 'Working tree clean') : project.git.text) : '—');
    if (project.error) row(details, 'Note', project.error);
    card.append(details);
    const actions = document.createElement('div'); actions.className = 'actions';
    if (project.localAvailable && project.state === 'AVAILABLE') {
      const select = document.createElement('button'); select.className = 'btn'; select.textContent = project.selected ? 'Selected Project' : 'Select / Open Project'; select.disabled = project.selected;
      select.addEventListener('click', () => runProjectAction(() => window.artAgent.selectProject(project.projectId), 'เลือกโปรเจกต์แล้ว ต้อง restart เพื่อเปิด workspace นี้'));
      actions.append(select);
      const memory = document.createElement('button'); memory.className = 'btn secondary'; memory.textContent = 'Project Memory'; memory.addEventListener('click', () => loadMemory(project.projectId)); actions.append(memory);
    }
    if (!project.localAvailable || project.state === 'CONFLICT') {
      const locate = document.createElement('button'); locate.className = 'btn secondary'; locate.textContent = 'Locate Project'; locate.addEventListener('click', () => runProjectAction(() => window.artAgent.locateProject(project.projectId), 'พบและผูกโปรเจกต์แล้ว ต้อง restart เพื่อเปิด workspace นี้'));
    actions.append(locate);
    }
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
    if (result?.changed) { showProjectStatus(successMessage, ''); $('restart-banner').classList.remove('hidden'); }
    await refreshProjects();
  } catch (error) { showProjectStatus(error?.message ?? String(error), 'danger'); }
}

function render(data) {
  overview = data;
  $('version').textContent = `v${data.version} • local`;
  $('workspace').textContent = data.workspace;
  $('git-summary').textContent = data.git.ok ? 'Git workspace พร้อมใช้งาน' : 'Git ตรวจพบปัญหา';
  permission($('metric-write'), data.permissions.write);
  permission($('metric-exec'), data.permissions.execute);
  permission($('metric-codex'), data.permissions.codex);
  $('metric-checkpoints').textContent = String(data.checkpoints.length);
  $('codex-version').textContent = data.codex.available ? data.codex.version : 'ยังไม่พร้อมใช้งาน';
  $('git-state').textContent = data.git.ok ? 'READY' : 'CHECK';
  $('git-state').className = `badge ${data.git.ok ? 'success' : 'danger'}`;
  $('git-output').textContent = data.git.text || 'Working tree clean';
  $('perm-write').checked = data.permissions.write;
  $('perm-exec').checked = data.permissions.execute;
  $('perm-codex').checked = data.permissions.codex;

  renderList($('checkpoint-list'), data.checkpoints, 'ยังไม่มี checkpoint', (checkpoint) => item(checkpoint.id, `${checkpoint.files.length} file(s) • ${new Date(checkpoint.createdAt).toLocaleString('th-TH')}`));
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
  document.querySelectorAll('.nav').forEach((node) => node.classList.toggle('active', node.dataset.section === section));
  document.querySelectorAll('.section').forEach((node) => node.classList.toggle('active', node.id === `section-${section}`));
}

async function refresh() {
  $('refresh').disabled = true;
  try { render(await window.artAgent.getOverview()); renderFirstRun(await window.artAgent.getFirstRun()); await refreshProjects(); await refreshEnrollment(); await refreshAutopilot(); }
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
$('choose-workspace').addEventListener('click', () => showSection('projects'));
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
  await window.artAgent.setPermissions({ write: $('perm-write').checked, execute: $('perm-exec').checked, codex: $('perm-codex').checked });
  $('restart-banner').classList.remove('hidden');
});
$('remote-connect').addEventListener('click', () => runRemoteAction('connect'));
$('remote-stop').addEventListener('click', () => runRemoteAction('stop'));
$('enrollment-pair').addEventListener('click', () => runEnrollmentAction(() => window.artAgent.pairDevice($('enrollment-code').value.trim())));
$('enrollment-issue-pairing').addEventListener('click', issueOwnerCode);
$('enrollment-rotate').addEventListener('click', () => runEnrollmentAction(() => window.artAgent.rotateDeviceCredential()));
$('enrollment-revoke').addEventListener('click', () => runEnrollmentAction(() => window.artAgent.revokeDeviceCredential()));
$('trust-owner').addEventListener('click', async () => { const result = await window.artAgent.trustOwner($('owner-name').value.trim(), $('device-name').value.trim()); if (result?.ok) renderFirstRun(await window.artAgent.getFirstRun()); else $('welcome-summary').textContent = result?.message || 'ตั้งค่า trusted device ไม่สำเร็จ'; });
$('start-autopilot-home').addEventListener('click', () => startAutopilot('autopilot-goal'));
$('start-autopilot').addEventListener('click', () => startAutopilot('autopilot-goal-center'));
$('view-autopilot').addEventListener('click', () => showSection('autopilot'));
$('refresh-autopilot').addEventListener('click', refreshAutopilot);
$('refresh-artifacts').addEventListener('click', async () => renderArtifacts(await window.artAgent.getAutopilotArtifacts()));
$('restart').addEventListener('click', () => window.artAgent.restart());
$('open-data-dir').addEventListener('click', () => window.artAgent.openDataDir());

document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); showSection('autopilot'); $('autopilot-goal-center').focus(); } });

void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 10000);
