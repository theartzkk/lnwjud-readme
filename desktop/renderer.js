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

  const runtime = $('doctor-runtime'); runtime.replaceChildren();
  row(runtime, 'Platform', `${data.doctor.platform} / ${data.doctor.arch}`); row(runtime, 'Node', data.doctor.node); row(runtime, 'Electron', data.doctor.electron); row(runtime, 'Data dir', data.dataDir);
  const boundary = $('doctor-boundary'); boundary.replaceChildren();
  row(boundary, 'Workspace', data.doctor.workspaceReady ? 'READY' : 'ERROR'); row(boundary, 'Remote tunnel', data.doctor.remoteTunnelEnabled ? 'ON' : 'OFF'); row(boundary, 'Codex CLI', data.codex.available ? 'READY' : 'NOT FOUND');
}

async function refresh() {
  $('refresh').disabled = true;
  try { render(await window.artAgent.getOverview()); }
  catch (error) { $('git-output').textContent = `Control Center error: ${error?.message ?? error}`; }
  finally { $('refresh').disabled = false; }
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
$('restart').addEventListener('click', () => window.artAgent.restart());
$('open-data-dir').addEventListener('click', () => window.artAgent.openDataDir());

void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 10000);
