import { loadWebData } from './hub-read-adapter.js';
import { loadControlData, openMobileSession, submitGoal } from './control-plane-adapter.js';

(() => {
  const $ = (id) => document.getElementById(id);
  const text = (id, value) => { const node = $(id); if (node) node.textContent = value == null ? '—' : String(value); };
  let controlData = null;

  function render(data) {
    text('product-name', data.product.name);
    text('product-tagline', data.product.tagline);
    text('preview-label', data.preview.label);
    text('hub-status', data.hub.status);
    text('hub-summary', data.hub.summary);
    text('project-name', data.project.name);
    text('project-type', data.project.type);
    text('project-id', `Project ID · ${data.project.projectId}`);
    text('milestone', data.project.milestone);
    text('handoff-summary', data.project.handoffSummary);
    text('memory-ready', Object.values(data.project.memory).every((state) => state === 'present') ? 'READY' : 'PARTIAL');
    $('memory-ready').className = `status-pill ${Object.values(data.project.memory).every((state) => state === 'present') ? 'success' : 'warning'}`;
    const memory = $('memory-list');
    memory.replaceChildren();
    for (const [file, state] of Object.entries(data.project.memory)) {
      const item = document.createElement('li');
      const name = document.createElement('span'); name.textContent = file;
      const badge = document.createElement('span'); badge.textContent = state === 'present' ? 'Present' : 'Missing'; badge.className = `file-state ${state}`;
      item.append(name, badge); memory.append(item);
    }
    text('device-status', data.devices.status);
    text('device-summary', data.devices.summary);
    text('build-status', data.builds.status);
    text('build-summary', data.builds.summary);
    text('audit-status', data.audit.status);
    text('audit-summary', data.audit.summary);
    text('tasks-status', data.tasks?.status || '—');
    text('tasks-summary', data.tasks?.summary || '—');
    text('artifacts-status', data.artifacts?.status || '—');
    text('artifacts-summary', data.artifacts?.summary || '—');
    renderControl(data.control, data.preview?.mode);
  }

  function renderControl(control, mode) {
    const panel = $('control-panel');
    if (!panel || (mode !== 'CONTROL' && mode !== 'CONTROL_SIGN_IN')) return;
    panel.hidden = false;
    controlData = control;
    const signedIn = control?.authenticated === true;
    text('control-state', signedIn ? 'พร้อมใช้งาน' : 'ต้องเชื่อมต่อ');
    $('control-sign-in').hidden = signedIn;
    $('control-workspace').hidden = !signedIn;
    if (!signedIn) { text('control-sign-in-message', control?.error || 'กรอกรหัสเชื่อมต่อเพื่อเริ่มใช้งาน'); return; }
    const projects = $('control-project'); const previousProjectId = projects.value; projects.replaceChildren();
    for (const project of control.projects || []) { const option = document.createElement('option'); option.value = project.projectId; option.textContent = `${project.name} · ${project.type}`; projects.append(option); }
    if ([...projects.options].some((option) => option.value === previousProjectId)) projects.value = previousProjectId;
    const selected = (control.projects || []).find((project) => project.projectId === projects.value) || control.projects?.[0];
    if (selected) {
      text('project-name', selected.name);
      text('project-type', selected.type);
      text('project-id', `Project ID · ${selected.projectId}`);
      text('milestone', 'CONTROL — canonical project selected');
      text('handoff-summary', selected.memoryReady === true ? 'Project Memory metadata is ready; execution context remains on the authorized worker.' : 'Project Memory metadata is partial; AWH will keep the project context bounded on the worker.');
    }
    const tasks = $('control-task-list'); tasks.replaceChildren();
    for (const task of (control.tasks || []).slice(0, 8)) { const row = document.createElement('article'); row.className = 'control-item'; row.textContent = `${task.state} · ${task.goal}`; tasks.append(row); }
    if (!tasks.childElementCount) tasks.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'ยังไม่มีงาน' }));
    const workers = $('control-worker-list'); workers.replaceChildren();
    for (const worker of control.workers || []) { const row = document.createElement('article'); row.className = 'control-item'; row.textContent = `${worker.displayName} · ${worker.state}`; workers.append(row); }
    if (!workers.childElementCount) workers.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'ยังไม่มี worker ออนไลน์ — งานจะอยู่ในสถานะรอ worker' }));
  }

  $('control-sign-in-button')?.addEventListener('click', async () => {
    const message = $('control-sign-in-message'); message.textContent = 'กำลังเชื่อมต่อ...';
    try { await openMobileSession($('control-pairing-code').value.trim()); window.location.reload(); } catch (error) { message.textContent = error instanceof Error ? error.message : 'เชื่อมต่อไม่สำเร็จ'; }
  });
  $('control-project')?.addEventListener('change', () => { if (controlData) renderControl(controlData, 'CONTROL'); });
  $('control-submit')?.addEventListener('click', async () => {
    const message = $('control-submit-message'); message.textContent = 'กำลังส่ง Goal...';
    try { const result = await submitGoal($('control-project').value, $('control-goal').value); message.textContent = result.state === 'WAITING_FOR_WORKER' ? 'รับงานแล้ว — กำลังรอ worker ที่เหมาะสม' : 'รับงานแล้ว'; $('control-goal').value = ''; renderControl(await loadControlData(), 'CONTROL'); } catch (error) { message.textContent = error instanceof Error ? error.message : 'ส่ง Goal ไม่สำเร็จ'; }
  });

  loadWebData()
    .then(render)
    .catch((error) => { text('hub-status', 'Preview unavailable'); text('hub-summary', error.message); });
})();
