import { loadWebData } from './hub-read-adapter.js';
import { changePassword, createRecoveryCodes, decideApproval, listAuthSessions, loadControlData, openMobileSession, recover, revokeAuthSession, submitGoal, login, logout } from './control-plane-adapter.js';

(() => {
  const $ = (id) => document.getElementById(id);
  const text = (id, value) => { const node = $(id); if (node) node.textContent = value == null ? '—' : String(value); };
  let controlData = null;

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => undefined);

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
    if (!signedIn) { text('control-sign-in-message', control?.error || 'เข้าสู่ AWH ด้วยชื่อผู้ใช้และรหัสผ่าน'); return; }
    const projectList = Array.isArray(control.projects) ? control.projects : [];
    const projects = $('control-project'); const previousProjectId = projects.value; projects.replaceChildren();
    if (!projectList.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'ยังไม่มีโปรเจกต์'; projects.append(option); }
    for (const project of projectList) { const option = document.createElement('option'); option.value = project.projectId; option.textContent = `${project.name} · ${project.type}`; projects.append(option); }
    if ([...projects.options].some((option) => option.value === previousProjectId)) projects.value = previousProjectId;
    const hasProjects = projectList.length > 0;
    $('control-empty-project').hidden = hasProjects;
    $('control-submit').disabled = !hasProjects;
    const selected = projectList.find((project) => project.projectId === projects.value) || projectList[0];
    if (selected) {
      text('project-name', selected.name);
      text('project-type', selected.type);
      text('project-id', `Project ID · ${selected.projectId}`);
      text('milestone', 'CONTROL — canonical project selected');
      text('handoff-summary', selected.memoryReady === true ? 'Project Memory metadata is ready; execution context remains on the authorized worker.' : 'Project Memory metadata is partial; AWH will keep the project context bounded on the worker.');
    }
    const tasks = $('control-task-list'); tasks.replaceChildren();
    for (const task of (control.tasks || []).slice(0, 8)) { const row = document.createElement('article'); row.className = 'control-item'; row.textContent = `${task.projectName || task.projectId} · ${task.state} · ${task.goal} · ${task.resultSummary || task.lastEvent?.message || 'กำลังรอผลลัพธ์'}`; tasks.append(row); }
    if (!tasks.childElementCount) tasks.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'ยังไม่มีงาน' }));
    const workers = $('control-worker-list'); workers.replaceChildren();
    for (const worker of control.workers || []) { const row = document.createElement('article'); row.className = 'control-item'; row.textContent = `${worker.displayName} · ${worker.state}`; workers.append(row); }
    if (!workers.childElementCount) workers.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'ยังไม่มี worker ออนไลน์ — งานจะอยู่ในสถานะรอ worker' }));
    const results = $('control-result-list'); results.replaceChildren();
    for (const result of (control.results || []).slice(0, 8)) { const row = document.createElement('article'); row.className = 'control-item'; row.textContent = `${result.projectName || result.projectId} · ${result.state} · ${result.goal} · ${result.resultSummary || result.lastEvent?.message || 'กำลังรอผลลัพธ์'} · artifact ${Array.isArray(result.artifactRefs) && result.artifactRefs.length ? result.artifactRefs.length : 'ไม่มี'}`; results.append(row); }
    if (!results.childElementCount) results.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'ยังไม่มีผลลัพธ์' }));
    const approvals = $('control-approval-list'); approvals.replaceChildren();
    for (const approval of (control.approvals || []).filter((item) => item.status === 'PENDING').slice(0, 8)) { const row = document.createElement('article'); row.className = 'control-item'; const label = document.createElement('strong'); label.textContent = `ต้องการอนุมัติ · ${approval.action}`; const detail = document.createElement('small'); detail.textContent = `หมดอายุ ${new Date(approval.expiresAt).toLocaleString('th-TH')}`; const approve = document.createElement('button'); approve.className = 'control-button'; approve.textContent = 'อนุมัติ'; approve.addEventListener('click', async () => { approve.disabled = true; await decideApproval(approval.approvalId, 'approve'); renderControl(await loadControlData(), 'CONTROL'); }); const reject = document.createElement('button'); reject.className = 'control-button secondary'; reject.textContent = 'ปฏิเสธ'; reject.addEventListener('click', async () => { reject.disabled = true; await decideApproval(approval.approvalId, 'reject'); renderControl(await loadControlData(), 'CONTROL'); }); row.append(label, detail, approve, reject); approvals.append(row); }
    if (!approvals.childElementCount) approvals.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'ไม่มี action ที่ต้องอนุมัติ' }));
  }

  $('control-login-button')?.addEventListener('click', async () => {
    const message = $('control-login-message'); message.textContent = 'กำลังเข้าสู่ AWH...';
    try { await login($('control-username').value, $('control-password').value, $('control-remember').checked); $('control-password').value = ''; const data = await loadControlData(); renderControl(data, 'CONTROL'); message.textContent = ''; }
    catch (error) { message.textContent = error instanceof Error ? error.message : 'เข้าสู่ AWH ไม่สำเร็จ'; }
  });
  $('control-logout-button')?.addEventListener('click', async () => { await logout().catch(() => undefined); window.location.reload(); });

  $('control-password-change-button')?.addEventListener('click', async () => {
    const message = $('control-password-change-message'); message.textContent = 'กำลังเปลี่ยนรหัสผ่าน...';
    try {
      await changePassword($('control-old-password').value, $('control-new-password').value);
      $('control-old-password').value = ''; $('control-new-password').value = '';
      message.textContent = 'เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ AWH อีกครั้ง';
      setTimeout(() => window.location.reload(), 600);
    } catch (error) { message.textContent = error instanceof Error ? error.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ'; }
  });

  $('control-sessions-button')?.addEventListener('click', async () => {
    const list = $('control-session-list'); list.textContent = 'กำลังโหลดเซสชัน...';
    try {
      const data = await listAuthSessions(); list.replaceChildren();
      for (const session of data.sessions || []) { const row = document.createElement('div'); row.className = 'control-item'; const label = document.createElement('span'); label.textContent = `${session.current ? 'อุปกรณ์นี้' : 'เซสชันอื่น'} · ใช้งานล่าสุด ${new Date(session.lastSeenAt).toLocaleString('th-TH')}`; row.append(label); if (!session.current) { const button = document.createElement('button'); button.className = 'control-button secondary'; button.textContent = 'เพิกถอน'; button.addEventListener('click', async () => { button.disabled = true; await revokeAuthSession(session.sessionId); row.remove(); }); row.append(button); } list.append(row); }
      if (!list.childElementCount) list.textContent = 'ไม่มีเซสชันที่ใช้งานอยู่';
    } catch (error) { list.textContent = error instanceof Error ? error.message : 'โหลดเซสชันไม่สำเร็จ'; }
  });

  $('control-recovery-codes-button')?.addEventListener('click', async () => {
    const output = $('control-recovery-codes'); output.textContent = 'กำลังสร้างรหัสกู้คืน...';
    try { const data = await createRecoveryCodes(); output.textContent = Array.isArray(data.recoveryCodes) ? data.recoveryCodes.join('\n') : 'ไม่สามารถสร้างรหัสกู้คืนได้'; } catch (error) { output.textContent = error instanceof Error ? error.message : 'สร้างรหัสกู้คืนไม่สำเร็จ'; }
  });

  $('control-recovery-button')?.addEventListener('click', async () => {
    const message = $('control-recovery-message'); message.textContent = 'กำลังตรวจสอบรหัสกู้คืน...';
    try {
      await recover($('control-username').value, $('control-recovery-code').value, $('control-recovery-password').value);
      $('control-recovery-code').value = ''; $('control-recovery-password').value = '';
      message.textContent = 'ตั้งรหัสผ่านใหม่แล้ว — กลับไปเข้าสู่ AWH ได้';
    } catch (error) { message.textContent = error instanceof Error ? error.message : 'กู้คืนการเข้าถึงไม่สำเร็จ'; }
  });

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
