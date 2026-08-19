const $ = (id) => document.getElementById(id);
let overview = null;

function escapeText(value) { return value == null ? '—' : String(value); }
function permission(el, enabled) { el.textContent = enabled ? 'ON' : 'OFF'; el.className = `metric ${enabled ? 'on' : 'off'}`; }
function renderList(container, items, emptyText, render) {
  container.replaceChildren();
  if (!items?.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = emptyText; container.append(p); return; }
  for (const item of items) container.append(render(item));
}
function item(title, detail, cls='list-item') { const root=document.createElement('div');root.className=cls;const strong=document.createElement('strong');strong.textContent=title;const small=document.createElement('small');small.textContent=detail;root.append(strong,small);return root; }
function row(dl, key, value) { const dt=document.createElement('dt');dt.textContent=key;const dd=document.createElement('dd');dd.textContent=escapeText(value);dl.append(dt,dd); }

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

async function refresh() {
  $('refresh').disabled = true;
  try { render(await window.artAgent.getOverview()); }
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

document.querySelectorAll('.nav').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.nav').forEach((node) => node.classList.toggle('active', node === button));
  document.querySelectorAll('.section').forEach((node) => node.classList.remove('active'));
  $(`section-${button.dataset.section}`).classList.add('active');
}));

$('refresh').addEventListener('click', refresh);
$('choose-workspace').addEventListener('click', async () => { const result=await window.artAgent.chooseWorkspace(); if(result.changed) $('restart-banner').classList.remove('hidden'); });
$('save-permissions').addEventListener('click', async () => {
  const execute = $('perm-exec').checked;
  const codex = $('perm-codex').checked;
  if (codex && !execute) { $('perm-exec').checked = true; }
  await window.artAgent.setPermissions({ write: $('perm-write').checked, execute: $('perm-exec').checked, codex: $('perm-codex').checked });
  $('restart-banner').classList.remove('hidden');
});
$('remote-connect').addEventListener('click', () => runRemoteAction('connect'));
$('remote-stop').addEventListener('click', () => runRemoteAction('stop'));
$('restart').addEventListener('click', () => window.artAgent.restart());
$('open-data-dir').addEventListener('click', () => window.artAgent.openDataDir());

void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 10000);
