import { loadWebData } from './hub-read-adapter.js?release=__AWH_WEB_RELEASE_ID__';
import {
  changePassword, changeUsername, createRecoveryCodes, decideApproval, listAuthSessions,
  loadControlData, login, logout, recover, revokeAuthSession, submitGoal,
} from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';

(() => {
  const $ = (id) => document.getElementById(id);
  const state = { control: null, selectedProjectId: null };
  const taskLabels = {
    WAITING_FOR_WORKER: 'กำลังรออุปกรณ์ทำงาน', PREPARING: 'กำลังเตรียมงาน', RUNNING: 'กำลังทำงาน',
    QA: 'กำลังตรวจคุณภาพ', WAITING_FOR_APPROVAL: 'รอการอนุมัติ', COMPLETED: 'เสร็จแล้ว',
    FAILED: 'ต้องตรวจสอบ', CANCELLED: 'ยกเลิกแล้ว',
  };

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => undefined);

  function message(id, value = '') { const node = $(id); if (node) node.textContent = value; }
  function show(id) { $(id).hidden = false; }
  function hide(id) { $(id).hidden = true; }
  function date(value) { const time = Date.parse(value || ''); return Number.isFinite(time) ? new Date(time).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : ''; }
  function selectedProject() { return state.control?.projects?.find((project) => project.projectId === state.selectedProjectId) || null; }
  function stateText(task) { return taskLabels[task?.state] || 'กำลังอัปเดต'; }
  function stateClass(task) { return task?.state === 'COMPLETED' ? 'completed' : task?.state === 'FAILED' ? 'failed' : task?.state === 'WAITING_FOR_APPROVAL' ? 'approval' : ''; }

  function setSurface(data) {
    document.title = data?.product?.shortName ? `${data.product.shortName} — Work` : 'AWH';
    const control = data?.control;
    const status = control?.authenticated ? 'พร้อมทำงาน' : control?.available ? 'เข้าสู่ระบบ' : 'ยังไม่พร้อม';
    message('surface-state', status);
    $('login-form').querySelector('button[type="submit"]').disabled = control?.available !== true;
    if (control?.available !== true && control?.error) message('login-message', control.error);
  }

  function renderProjectSheet(projects) {
    const list = $('project-list'); list.replaceChildren();
    const empty = !Array.isArray(projects) || projects.length === 0;
    $('project-empty').hidden = !empty;
    if (empty) return;
    for (const project of projects) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `project-choice${project.projectId === state.selectedProjectId ? ' selected' : ''}`;
      const name = document.createElement('strong'); name.textContent = project.name;
      const detail = document.createElement('span'); detail.textContent = project.memoryReady ? 'พร้อมใช้ context ของโปรเจกต์' : 'Project Memory ยังต้องตรวจสอบบน worker';
      button.append(name, detail);
      button.addEventListener('click', () => { state.selectedProjectId = project.projectId; renderWorkspace(); closeSheet('project-sheet'); });
      list.append(button);
    }
  }

  function workerSummary(workers) {
    const source = Array.isArray(workers) ? workers : [];
    const working = source.filter((worker) => worker.state === 'WORKING');
    const ready = source.filter((worker) => worker.state === 'READY');
    if (working.length) return `${working.length} อุปกรณ์กำลังทำงาน`;
    if (ready.length) return `${ready.length} อุปกรณ์พร้อมทำงาน`;
    return 'ยังไม่มีอุปกรณ์ทำงานออนไลน์ — งานจะรออย่างปลอดภัย';
  }

  function renderApproval(task, approvals) {
    const approval = approvals.find((item) => item.taskId === task.taskId && item.status === 'PENDING');
    if (!approval) return null;
    const actions = document.createElement('div'); actions.className = 'task-actions';
    for (const [decision, text] of [['approve', 'อนุมัติ'], ['reject', 'ปฏิเสธ']]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = text;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await decideApproval(approval.approvalId, decision); await refreshWorkspace(); }
        catch (error) { message('goal-message', error instanceof Error ? error.message : 'AWH ไม่สามารถบันทึกการอนุมัติได้'); button.disabled = false; }
      });
      actions.append(button);
    }
    return actions;
  }

  function renderThread(tasks, approvals) {
    const thread = $('work-thread'); thread.replaceChildren();
    const projectId = state.selectedProjectId;
    const projectTasks = (Array.isArray(tasks) ? tasks : []).filter((task) => task.projectId === projectId).sort((a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''));
    $('empty-work').hidden = projectTasks.length > 0 || !projectId;
    for (const task of projectTasks) {
      const row = document.createElement('li'); row.className = 'task-turn';
      const goal = document.createElement('p'); goal.className = 'task-goal'; goal.textContent = task.goal;
      const response = document.createElement('div'); response.className = 'task-response';
      const meta = document.createElement('div'); meta.className = 'task-meta';
      const chip = document.createElement('span'); chip.className = `state-chip ${stateClass(task)}`.trim(); chip.textContent = stateText(task);
      const time = document.createElement('span'); time.textContent = date(task.updatedAt || task.createdAt);
      meta.append(chip, time);
      const detail = task.resultSummary || task.lastEvent?.message || (task.state === 'WAITING_FOR_WORKER' ? 'AWH บันทึกงานแล้ว และจะเริ่มเมื่ออุปกรณ์ที่เหมาะสมพร้อมทำงาน' : 'กำลังอัปเดตความคืบหน้า');
      const summary = document.createElement('p'); summary.className = 'task-summary'; summary.textContent = detail;
      response.append(meta, summary);
      const actions = renderApproval(task, approvals); if (actions) response.append(actions);
      row.append(goal, response); thread.append(row);
    }
  }

  function renderWorkspace() {
    const control = state.control;
    if (!control?.authenticated) return;
    const projects = Array.isArray(control.projects) ? control.projects : [];
    if (!projects.some((project) => project.projectId === state.selectedProjectId)) state.selectedProjectId = projects[0]?.projectId || null;
    const project = selectedProject();
    message('selected-project-name', project?.name || 'ยังไม่มีโปรเจกต์');
    message('worker-summary', workerSummary(control.workers));
    message('work-context', project ? (project.memoryReady ? 'บริบทและงานจะถูกผูกกับโปรเจกต์นี้' : 'AWH จะรักษาขอบเขตของโปรเจกต์นี้ไว้ขณะ worker ตรวจ context') : 'เพิ่มโปรเจกต์จาก AWH Desktop เพื่อเริ่มงาน');
    message('advanced-status', `${workerSummary(control.workers)} · งานและผลลัพธ์แสดงเฉพาะตามสิทธิ์ของบัญชีคุณ`);
    $('goal-submit').disabled = project === null;
    $('goal-input').disabled = project === null;
    $('goal-input').placeholder = project ? 'พิมพ์สิ่งที่อยากให้ AWH ช่วย…' : 'เลือกหรือเพิ่มโปรเจกต์ก่อน';
    renderProjectSheet(projects);
    renderThread(control.tasks, control.approvals);
  }

  function render(data) {
    setSurface(data);
    state.control = data?.control || { authenticated: false, available: false, error: 'AWH ยังไม่พร้อมใช้งาน' };
    const authenticated = state.control.authenticated === true;
    $('sign-in-view').hidden = authenticated;
    $('workspace-view').hidden = !authenticated;
    $('account-open').hidden = !authenticated;
    if (authenticated) renderWorkspace();
  }

  async function refreshWorkspace() {
    message('goal-message', 'กำลังรีเฟรช…');
    try { state.control = await loadControlData(); renderWorkspace(); message('goal-message', ''); }
    catch (error) { message('goal-message', error instanceof Error ? error.message : 'AWH ไม่สามารถรีเฟรชข้อมูลได้'); }
  }

  function openSheet(id) { show(id); }
  function closeSheet(id) { hide(id); }
  function openAccount() { if (state.control?.authenticated) openSheet('account-sheet'); }

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault(); message('login-message', 'กำลังเข้าสู่ AWH…');
    try {
      await login($('login-username').value, $('login-password').value, $('login-remember').checked);
      $('login-password').value = '';
      state.control = await loadControlData(); render({ product: { shortName: 'AWH' }, control: state.control });
      message('login-message', '');
    } catch (error) { message('login-message', error instanceof Error ? error.message : 'เข้าสู่ AWH ไม่สำเร็จ'); }
  });

  $('goal-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const goal = $('goal-input').value.trim(); const project = selectedProject();
    if (!project || !goal) { message('goal-message', 'เลือกโปรเจกต์และพิมพ์สิ่งที่อยากให้ AWH ช่วยก่อน'); return; }
    message('goal-message', 'กำลังบันทึกงาน…'); $('goal-submit').disabled = true;
    try {
      const task = await submitGoal(project.projectId, goal);
      $('goal-input').value = '';
      message('goal-message', task.state === 'WAITING_FOR_WORKER' ? 'รับงานแล้ว — กำลังรออุปกรณ์ที่เหมาะสม' : 'รับงานแล้ว');
      await refreshWorkspace();
    } catch (error) { message('goal-message', error instanceof Error ? error.message : 'ส่งงานไม่สำเร็จ'); }
    finally { $('goal-submit').disabled = selectedProject() === null; }
  });

  $('refresh-work').addEventListener('click', refreshWorkspace);
  $('project-open').addEventListener('click', () => openSheet('project-sheet'));
  $('account-open').addEventListener('click', openAccount);
  $('account-open-inline').addEventListener('click', openAccount);
  $('recovery-open').addEventListener('click', () => openSheet('recovery-sheet'));
  document.querySelectorAll('[data-close-sheet]').forEach((button) => button.addEventListener('click', () => closeSheet(button.dataset.closeSheet)));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') document.querySelectorAll('.sheet:not([hidden])').forEach((sheet) => { sheet.hidden = true; }); });

  $('username-form').addEventListener('submit', async (event) => {
    event.preventDefault(); message('username-message', 'กำลังบันทึกชื่อผู้ใช้…');
    try { await changeUsername($('identity-password').value, $('new-username').value); $('identity-password').value = ''; message('username-message', 'บันทึกแล้ว กรุณาเข้าสู่ AWH อีกครั้ง'); setTimeout(() => window.location.reload(), 700); }
    catch (error) { message('username-message', error instanceof Error ? error.message : 'เปลี่ยนชื่อผู้ใช้ไม่สำเร็จ'); }
  });

  $('password-form').addEventListener('submit', async (event) => {
    event.preventDefault(); message('password-message', 'กำลังบันทึกรหัสผ่าน…');
    try {
      if ($('new-password').value !== $('confirm-password').value) throw new Error('กรุณายืนยันรหัสผ่านใหม่ให้ตรงกัน');
      await changePassword($('old-password').value, $('new-password').value);
      $('old-password').value = ''; $('new-password').value = ''; $('confirm-password').value = '';
      message('password-message', 'บันทึกแล้ว กรุณาเข้าสู่ AWH อีกครั้ง'); setTimeout(() => window.location.reload(), 700);
    } catch (error) { message('password-message', error instanceof Error ? error.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ'); }
  });

  $('sessions-load').addEventListener('click', async () => {
    const list = $('session-list'); list.replaceChildren();
    try {
      const data = await listAuthSessions();
      for (const session of data.sessions || []) {
        const row = document.createElement('div'); row.className = 'session-row';
        const detail = document.createElement('span'); detail.textContent = `${session.current ? 'อุปกรณ์นี้' : 'อุปกรณ์อื่น'} · ใช้งานล่าสุด ${date(session.lastSeenAt)}`;
        row.append(detail);
        if (!session.current) {
          const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'secondary-button'; revoke.textContent = 'เพิกถอน';
          revoke.addEventListener('click', async () => { revoke.disabled = true; try { await revokeAuthSession(session.sessionId); row.remove(); } catch { revoke.disabled = false; } }); row.append(revoke);
        }
        list.append(row);
      }
      if (!list.childElementCount) list.textContent = 'ไม่มีเซสชันที่ใช้งานอยู่';
    } catch (error) { list.textContent = error instanceof Error ? error.message : 'โหลดเซสชันไม่สำเร็จ'; }
  });

  $('recovery-codes-create').addEventListener('click', async () => {
    const output = $('recovery-codes'); output.hidden = false; output.textContent = 'กำลังสร้างรหัสกู้คืน…';
    try { const data = await createRecoveryCodes(); output.textContent = Array.isArray(data.recoveryCodes) ? data.recoveryCodes.join('\n') : 'ไม่สามารถสร้างรหัสกู้คืนได้'; }
    catch (error) { output.textContent = error instanceof Error ? error.message : 'ไม่สามารถสร้างรหัสกู้คืนได้'; }
  });

  $('recovery-form').addEventListener('submit', async (event) => {
    event.preventDefault(); message('recovery-message', 'กำลังตรวจสอบรหัสกู้คืน…');
    try { await recover($('recovery-username').value, $('recovery-code').value, $('recovery-password').value); $('recovery-code').value = ''; $('recovery-password').value = ''; message('recovery-message', 'ตั้งรหัสผ่านใหม่แล้ว กลับไปเข้าสู่ AWH ได้'); }
    catch (error) { message('recovery-message', error instanceof Error ? error.message : 'กู้คืนการเข้าถึงไม่สำเร็จ'); }
  });

  $('logout-button').addEventListener('click', async () => { await logout().catch(() => undefined); window.location.reload(); });

  loadWebData().then(render).catch(() => render({ product: { shortName: 'AWH' }, control: { authenticated: false, available: false, error: 'AWH ยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง' } }));
})();
