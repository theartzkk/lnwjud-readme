import { loadWebData } from './hub-read-adapter.js?release=__AWH_WEB_RELEASE_ID__';
import {
  cancelTask, changePassword, changeUsername, createConversation, createRecoveryCodes, decideApproval, listAuthSessions,
  exportWorkspace, loadControlData, loadConversation, loadConversations, loadCurrentContext, loadProductSettings, loadWorkspaceContinuity, login, logout, recover, resetProductSetting, revokeAuthSession, saveCurrentContext, submitWorkMessage, updateConversation, updateProductSetting,
} from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';

(() => {
  const $ = (id) => document.getElementById(id);
  const state = { control: null, selectedProjectId: null, selectedConversationId: null, conversations: [], conversation: null, workspaceContinuity: null, productSettings: null, refreshTimer: null };
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

  function settingValue(key, fallback) { const item = state.productSettings?.[key]; return item && Object.prototype.hasOwnProperty.call(item, 'value') ? item.value : fallback; }
  function applyProductSettings() {
    const name = settingValue('productName', 'Art’s Workspace Hub');
    const tagline = settingValue('tagline', 'Your Projects. One Workspace. Anywhere.');
    const accent = settingValue('accent', '#ff7a1a');
    document.title = `${name} — Work`; message('product-name', name); message('product-tagline', tagline);
    document.documentElement.style.setProperty('--accent', accent);
    $('setting-product-name').value = name; $('setting-short-name').value = settingValue('shortName', 'AWH'); $('setting-tagline').value = tagline; $('setting-welcome').value = settingValue('welcome', 'เริ่มคุยกับ Art’s Workspace Hub ได้เลย'); $('setting-accent').value = accent;
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
      button.addEventListener('click', async () => { state.selectedProjectId = project.projectId; state.selectedConversationId = null; state.conversations = []; state.conversation = null; state.workspaceContinuity = null; renderWorkspace(); closeSheet('project-sheet'); await refreshConversation(); });
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

  function continuitySummary(workspace) {
    if (!workspace) return '';
    if (workspace.syncStatus === 'SYNCED') return ' · งานล่าสุดพร้อมทำต่อบนอุปกรณ์ที่เชื่อถือได้';
    if (workspace.syncStatus === 'HANDOFF_REQUIRED') return ' · งานกำลังอยู่บนอุปกรณ์อื่น';
    if (workspace.syncStatus === 'SOURCE_OFFLINE') return ' · อุปกรณ์เดิมออฟไลน์ แต่มี checkpoint ล่าสุด';
    if (workspace.syncStatus === 'UNSYNCED_CHANGES') return ' · มีงานที่ยัง sync ไม่ครบ';
    return '';
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

  function renderCancellation(task) {
    if (!task || !['WAITING_FOR_WORKER', 'WAITING_FOR_APPROVAL'].includes(task.state)) return null;
    const actions = document.createElement('div'); actions.className = 'task-actions';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = 'ยกเลิกงานนี้';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await cancelTask(task.taskId); await refreshWorkspace(); }
      catch (error) { message('goal-message', error instanceof Error ? error.message : 'AWH ยังยกเลิกงานนี้ไม่ได้'); button.disabled = false; }
    });
    actions.append(button); return actions;
  }

  function renderThread(conversation, approvals) {
    const thread = $('work-thread'); thread.replaceChildren();
    const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
    const taskById = new Map((conversation?.tasks || []).map((task) => [task.taskId, task]));
    const artifactsByTask = new Map();
    for (const artifact of conversation?.artifacts || []) {
      if (!artifact?.taskId) continue;
      const list = artifactsByTask.get(artifact.taskId) || []; list.push(artifact); artifactsByTask.set(artifact.taskId, list);
    }
    $('empty-work').hidden = messages.length > 0 || !state.selectedProjectId;
    for (const turn of messages) {
      const task = turn.taskId ? taskById.get(turn.taskId) : null;
      const row = document.createElement('li'); row.className = `task-turn ${turn.kind === 'user' ? 'user-turn' : 'assistant-turn'}`;
      const body = document.createElement('p'); body.className = turn.kind === 'user' ? 'task-goal' : 'task-summary'; body.textContent = turn.body;
      if (turn.kind === 'user') { row.append(body); thread.append(row); continue; }
      const response = document.createElement('div'); response.className = 'task-response';
      const meta = document.createElement('div'); meta.className = 'task-meta';
      const chip = document.createElement('span'); chip.className = `state-chip ${stateClass(task)}`.trim();
      chip.textContent = turn.kind === 'approval' ? 'ต้องอนุมัติ' : turn.kind === 'result' ? 'เสร็จแล้ว' : turn.kind === 'failure' ? 'ต้องตรวจสอบ' : task ? stateText(task) : 'AWH';
      const time = document.createElement('span'); time.textContent = date(turn.createdAt);
      meta.append(chip, time); response.append(meta, body);
      if (task) {
        const actions = renderApproval(task, approvals) || renderCancellation(task); if (actions) response.append(actions);
        const artifacts = artifactsByTask.get(task.taskId) || [];
        if (artifacts.length) { const list = document.createElement('ul'); list.className = 'artifact-links'; for (const artifact of artifacts) { const item = document.createElement('li'); item.textContent = `↳ ${artifact.name || 'ไฟล์ผลลัพธ์'}`; list.append(item); } response.append(list); }
      }
      row.append(response); thread.append(row);
    }
  }

  function renderConversationSheet() {
    const list = $('conversation-list'); if (!list) return; list.replaceChildren();
    for (const conversation of state.conversations) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `project-choice${conversation.conversationId === state.selectedConversationId ? ' selected' : ''}`;
      const title = document.createElement('strong'); title.textContent = conversation.title || 'Work';
      const detail = document.createElement('span'); detail.textContent = date(conversation.updatedAt) || 'ยังไม่มีข้อความ'; button.append(title, detail);
      button.addEventListener('click', async () => { state.selectedConversationId = conversation.conversationId; closeSheet('conversation-sheet'); await refreshConversation(false); }); list.append(button);
    }
    $('conversation-empty').hidden = state.conversations.length > 0;
    const selected = state.conversations.find((conversation) => conversation.conversationId === state.selectedConversationId) || state.conversation?.conversation || null;
    $('conversation-title-input').value = selected?.title || 'Work';
    $('conversation-title-input').disabled = !selected;
    $('conversation-archive').disabled = !selected;
  }

  function renderWorkspace() {
    const control = state.control;
    if (!control?.authenticated) return;
    const projects = Array.isArray(control.projects) ? control.projects : [];
    if (!projects.some((project) => project.projectId === state.selectedProjectId)) state.selectedProjectId = projects[0]?.projectId || null;
    const project = selectedProject();
    message('selected-project-name', project?.name || 'ยังไม่มีโปรเจกต์');
    message('selected-conversation-name', state.conversation?.conversation?.title || 'Work');
    message('worker-summary', workerSummary(control.workers));
    message('work-context', project ? (project.memoryReady ? `บริบทและงานจะถูกผูกกับโปรเจกต์นี้${continuitySummary(state.workspaceContinuity)}` : 'AWH จะรักษาขอบเขตของโปรเจกต์นี้ไว้ขณะ worker ตรวจ context') : 'เพิ่มโปรเจกต์จาก AWH Desktop เพื่อเริ่มงาน');
    message('advanced-status', `${workerSummary(control.workers)} · งานและผลลัพธ์แสดงเฉพาะตามสิทธิ์ของบัญชีคุณ`);
    $('goal-submit').disabled = project === null;
    $('goal-input').disabled = project === null;
    $('goal-input').placeholder = project ? 'พิมพ์สิ่งที่อยากให้ AWH ช่วย…' : 'เลือกหรือเพิ่มโปรเจกต์ก่อน';
    renderProjectSheet(projects);
    renderConversationSheet();
    renderThread(state.conversation, state.conversation?.approvals || control.approvals);
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

  async function refreshConversation(refreshList = true) {
    const project = selectedProject();
    if (!project) { state.selectedConversationId = null; state.conversations = []; state.conversation = null; state.workspaceContinuity = null; renderWorkspace(); return; }
    try {
      const [conversations, workspaceContinuity, currentContext] = await Promise.all([loadConversations(project.projectId), loadWorkspaceContinuity(project.projectId), loadCurrentContext(project.projectId)]);
      state.conversations = conversations;
      if (!conversations.some((conversation) => conversation.conversationId === state.selectedConversationId)) {
        const remembered = currentContext?.context?.conversationId;
        state.selectedConversationId = conversations.some((conversation) => conversation.conversationId === remembered) ? remembered : conversations[0]?.conversationId || null;
      }
      if (!state.selectedConversationId) {
        const created = await createConversation(project.projectId, 'Work'); state.selectedConversationId = created.conversation.conversationId; state.conversations = [created.conversation]; state.conversation = created;
      } else state.conversation = await loadConversation(state.selectedConversationId);
      state.workspaceContinuity = workspaceContinuity; renderWorkspace();
      void saveCurrentContext(project.projectId, state.selectedConversationId, 'work').catch(() => undefined);
    } catch (error) { state.conversation = { messages: [{ messageId: 'local-unavailable', taskId: null, kind: 'assistant', sequence: 1, body: 'Work stream นี้จะพร้อมทันทีที่ Hub ได้รับ release ล่าสุด', createdAt: new Date().toISOString() }], tasks: [], artifacts: [], approvals: [] }; renderWorkspace(); message('goal-message', error instanceof Error ? error.message : 'AWH ยังโหลดการสนทนาไม่ได้'); }
  }

  async function refreshWorkspace() {
    message('goal-message', 'กำลังรีเฟรช…');
    try { state.control = await loadControlData(); renderWorkspace(); await refreshConversation(); message('goal-message', ''); }
    catch (error) { message('goal-message', error instanceof Error ? error.message : 'AWH ไม่สามารถรีเฟรชข้อมูลได้'); }
  }

  function openSheet(id) { show(id); }
  function closeSheet(id) { hide(id); }
  async function openAccount() {
    if (!state.control?.authenticated) return;
    openSheet('account-sheet');
    try { state.productSettings = (await loadProductSettings()).settings; applyProductSettings(); }
    catch { message('product-settings-message', 'ยังโหลดการตั้งค่าลักษณะของ AWH ไม่ได้'); }
  }

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault(); message('login-message', 'กำลังเข้าสู่ AWH…');
    try {
      await login($('login-username').value, $('login-password').value, $('login-remember').checked);
      $('login-password').value = '';
      state.control = await loadControlData(); render({ product: { shortName: 'AWH' }, control: state.control }); await refreshConversation();
      message('login-message', '');
    } catch (error) { message('login-message', error instanceof Error ? error.message : 'เข้าสู่ AWH ไม่สำเร็จ'); }
  });

  $('goal-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const goal = $('goal-input').value.trim(); const project = selectedProject();
    if (!project || !goal) { message('goal-message', 'เลือกโปรเจกต์และพิมพ์สิ่งที่อยากให้ AWH ช่วยก่อน'); return; }
    const conversationId = state.selectedConversationId;
    if (!conversationId) { message('goal-message', 'กำลังเตรียมการสนทนา กรุณาลองใหม่อีกครั้ง'); return; }
    const idempotencyKey = `web-${crypto.randomUUID()}`;
    state.conversation = { ...(state.conversation || {}), messages: [...(state.conversation?.messages || []), { messageId: `local-${idempotencyKey}`, taskId: null, kind: 'user', sequence: Number.MAX_SAFE_INTEGER - 1, body: goal, createdAt: new Date().toISOString() }, { messageId: `local-progress-${idempotencyKey}`, taskId: null, kind: 'progress', sequence: Number.MAX_SAFE_INTEGER, body: 'กำลังตรวจบริบทและบันทึกงาน…', createdAt: new Date().toISOString() }], tasks: state.conversation?.tasks || [], artifacts: state.conversation?.artifacts || [], approvals: state.conversation?.approvals || [] };
    renderWorkspace(); message('goal-message', ''); $('goal-submit').disabled = true;
    try {
      await submitWorkMessage(project.projectId, conversationId, goal, idempotencyKey);
      $('goal-input').value = '';
      await refreshConversation();
    } catch (error) { message('goal-message', error instanceof Error ? error.message : 'ส่งงานไม่สำเร็จ'); }
    finally { $('goal-submit').disabled = selectedProject() === null; }
  });

  $('refresh-work').addEventListener('click', refreshWorkspace);
  $('project-open').addEventListener('click', () => openSheet('project-sheet'));
  $('conversation-open').addEventListener('click', () => openSheet('conversation-sheet'));
  $('conversation-new').addEventListener('click', async () => {
    const project = selectedProject(); if (!project) return; const button = $('conversation-new'); button.disabled = true;
    try { const created = await createConversation(project.projectId, 'การสนทนาใหม่'); state.selectedConversationId = created.conversation.conversationId; state.conversation = created; await refreshConversation(); closeSheet('conversation-sheet'); }
    catch (error) { message('goal-message', error instanceof Error ? error.message : 'AWH ยังสร้างการสนทนาใหม่ไม่ได้'); }
    finally { button.disabled = false; }
  });
  $('conversation-title-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const conversationId = state.selectedConversationId; if (!conversationId) return;
    message('conversation-title-message', 'กำลังบันทึก…');
    try { await updateConversation(conversationId, $('conversation-title-input').value, false); await refreshConversation(); message('conversation-title-message', 'บันทึกแล้ว'); }
    catch (error) { message('conversation-title-message', error instanceof Error ? error.message : 'ยังบันทึกชื่อการสนทนาไม่ได้'); }
  });
  $('conversation-archive').addEventListener('click', async () => {
    const conversationId = state.selectedConversationId; const current = state.conversation?.conversation; if (!conversationId || !current) return;
    $('conversation-archive').disabled = true; message('conversation-title-message', 'กำลังเก็บเข้าคลัง…');
    try { await updateConversation(conversationId, current.title || 'Work', true); state.selectedConversationId = null; await refreshConversation(); message('conversation-title-message', 'เก็บการสนทนาแล้ว'); }
    catch (error) { message('conversation-title-message', error instanceof Error ? error.message : 'ยังเก็บการสนทนาไม่ได้'); }
    finally { $('conversation-archive').disabled = false; }
  });
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

  $('product-settings-form').addEventListener('submit', async (event) => {
    event.preventDefault(); message('product-settings-message', 'กำลังบันทึก…');
    try {
      const values = [['productName', $('setting-product-name').value], ['shortName', $('setting-short-name').value], ['tagline', $('setting-tagline').value], ['welcome', $('setting-welcome').value], ['accent', $('setting-accent').value]];
      for (const [key, value] of values) state.productSettings = (await updateProductSetting(key, value)).settings;
      applyProductSettings(); message('product-settings-message', 'บันทึกลักษณะของ AWH แล้ว');
    } catch (error) { message('product-settings-message', error instanceof Error ? error.message : 'ยังบันทึกการตั้งค่าไม่ได้'); }
  });

  $('product-settings-reset').addEventListener('click', async () => {
    const button = $('product-settings-reset'); button.disabled = true; message('product-settings-message', 'กำลังคืนค่ามาตรฐาน…');
    try {
      for (const key of ['productName', 'shortName', 'tagline', 'welcome', 'accent']) state.productSettings = (await resetProductSetting(key)).settings;
      applyProductSettings(); message('product-settings-message', 'คืนค่ามาตรฐานแล้ว');
    } catch (error) { message('product-settings-message', error instanceof Error ? error.message : 'ยังคืนค่ามาตรฐานไม่ได้'); }
    finally { button.disabled = false; }
  });

  $('workspace-export').addEventListener('click', async () => {
    const button = $('workspace-export'); button.disabled = true;
    try {
      const data = await exportWorkspace(); const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `awh-workspace-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
    } catch (error) { message('product-settings-message', error instanceof Error ? error.message : 'ยังส่งออกข้อมูลไม่ได้'); }
    finally { button.disabled = false; }
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

  loadWebData().then(async (data) => { render(data); if (data?.control?.authenticated) { await refreshConversation(); try { state.productSettings = (await loadProductSettings()).settings; applyProductSettings(); } catch {} state.refreshTimer = window.setInterval(() => { void refreshWorkspace(); }, 15_000); } }).catch(() => render({ product: { shortName: 'AWH' }, control: { authenticated: false, available: false, error: 'AWH ยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง' } }));
})();
