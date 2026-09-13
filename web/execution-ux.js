const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

const STAGES = [
  { id: 'accepted', label: 'รับงานแล้ว' },
  { id: 'preparing', label: 'กำลังวิเคราะห์' },
  { id: 'working', label: 'กำลังทำ' },
  { id: 'qa', label: 'กำลังตรวจ' },
  { id: 'approval', label: 'รออนุมัติ' },
  { id: 'done', label: 'พร้อมใช้' },
];

const FAILURE_COPY = {
  PROVIDER_UNAVAILABLE: 'AI ยังตอบไม่ได้ในขณะนี้ แต่งานยังถูกเก็บไว้',
  PROVIDER_RATE_LIMITED: 'AI ถูกจำกัดการเรียกใช้ชั่วคราว แต่งานยังถูกเก็บไว้',
  PROVIDER_QUOTA_EXHAUSTED: 'โควตา AI ยังไม่พร้อม แต่งานยังถูกเก็บไว้',
  BUDGET_EXHAUSTED: 'งบ AI ถึงขีดจำกัด แต่งานยังถูกเก็บไว้',
  PROVIDER_AUTH_FAILED: 'การเชื่อมต่อ AI ต้องตรวจสอบ',
  PROVIDER_PERMISSION_DENIED: 'AI ยังไม่อนุญาตคำขอนี้',
  PROVIDER_MODEL_UNAVAILABLE: 'โมเดล AI ที่ตั้งไว้ยังใช้ไม่ได้',
  PROVIDER_REQUEST_INVALID: 'คำขอ AI ไม่ถูกต้อง งานไม่ได้ถูกอ้างว่าเสร็จแล้ว',
};

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function workerForTask(task, workers = []) {
  const id = clean(task?.assignedDevice);
  return id ? workers.find((worker) => worker?.deviceId === id) || null : null;
}

export function executionActor(task, workers = []) {
  const worker = workerForTask(task, workers);
  if (worker) {
    const name = clean(worker.displayName);
    if (name) return name;
    const platform = clean(worker.platform)?.toLowerCase();
    if (platform?.includes('win')) return 'เครื่อง Windows ของ AWH';
    if (platform?.includes('darwin') || platform?.includes('mac')) return 'เครื่อง Mac ของ AWH';
    return 'อุปกรณ์ที่เหมาะกับงาน';
  }

  const kind = clean(task?.execution?.executorKind);
  if (kind === 'VPS') return 'ระบบกลาง AWH';
  if (kind === 'CODEX') return 'ผู้เชี่ยวชาญโค้ด';
  if (kind === 'DEVICE') return 'อุปกรณ์ที่เหมาะกับงาน';
  return 'AWH';
}

function capabilityLabel(capability) {
  const value = clean(capability)?.toLowerCase();
  if (!value) return null;
  if (value === 'agent.conversation' || value.startsWith('agent.')) return 'AI สนทนา';
  if (value === 'project.read' || value.startsWith('project.search')) return 'อ่าน Project';
  if (value.startsWith('project.mutate')) return 'แก้ Project แบบมี revision';
  if (value === 'codex:cli' || value.startsWith('code.')) return 'ผู้เชี่ยวชาญโค้ด';
  if (value.startsWith('document:') || value.startsWith('office:')) return 'งานเอกสาร';
  if (value.startsWith('qa.') || value.startsWith('review.')) return 'ตรวจคุณภาพ';
  if (value.startsWith('artifact.')) return 'จัดการไฟล์ผลลัพธ์';
  return 'ความสามารถที่เหมาะกับงาน';
}

export function executionContext(task, workers = []) {
  const execution = task?.execution;
  if (!execution || typeof execution !== 'object') return [];
  const items = [{ label: 'ทำงานโดย', value: executionActor(task, workers) }];
  const capability = capabilityLabel(execution.requiredCapability);
  if (capability) items.push({ label: 'วิธีทำ', value: capability });
  const revision = clean(execution.vaultRevisionId);
  if (revision && /^[0-9a-f-]{8,64}$/i.test(revision)) items.push({ label: 'Project revision', value: revision.slice(0, 8) });
  const continuation = execution.continuation;
  if (continuation && typeof continuation === 'object' && Number.isInteger(continuation.step) && Number.isInteger(continuation.maxSteps)
      && continuation.step >= 0 && continuation.maxSteps >= 1 && continuation.step < continuation.maxSteps && continuation.maxSteps <= 8) {
    items.push({ label: 'งานต่อเนื่อง', value: `ขั้น ${continuation.step + 1}/${continuation.maxSteps}` });
  }
  return items.slice(0, 4);
}

export function executionStage(task) {
  const state = clean(task?.state) || 'QUEUED';
  if (state === 'PREPARING') return 'preparing';
  if (state === 'RUNNING') return 'working';
  if (state === 'QA') return 'qa';
  if (state === 'WAITING_FOR_APPROVAL') return 'approval';
  if (state === 'COMPLETED') return 'done';
  if (state === 'FAILED' || state === 'CANCELLED') return 'done';
  return 'accepted';
}

function stageIndex(stage) {
  const index = STAGES.findIndex((item) => item.id === stage);
  return index < 0 ? 0 : index;
}

export function executionJourney(task) {
  const projected = Array.isArray(task?.actionGraph?.nodes) ? task.actionGraph.nodes : [];
  if (projected.length > 0 && projected.length <= 8) {
    return projected.map((node) => ({
      id: clean(node?.nodeId) || 'step',
      label: clean(node?.title) || 'กำลังดำเนินงาน',
      state: node?.state === 'COMPLETED' ? 'done'
        : node?.state === 'RUNNING' || node?.state === 'READY' ? 'active'
        : node?.state === 'FAILED' || node?.state === 'BLOCKED' || node?.state === 'CANCELLED' ? 'halted'
        : 'upcoming',
    }));
  }
  const taskState = clean(task?.state) || 'QUEUED';
  if (taskState === 'FAILED' || taskState === 'CANCELLED') {
    const progress = Number.isInteger(task?.progress) ? Math.max(0, Math.min(100, task.progress)) : 0;
    const haltedStage = progress >= 80 ? 'qa' : progress >= 10 ? 'working' : 'accepted';
    const haltedIndex = stageIndex(haltedStage);
    return STAGES.map((stage, index) => ({ ...stage, state: index < haltedIndex ? 'done' : index === haltedIndex ? 'halted' : 'upcoming' }));
  }
  const activeStage = executionStage(task);
  const activeIndex = stageIndex(activeStage);
  const terminal = TERMINAL.has(taskState);
  return STAGES.map((stage, index) => ({
    ...stage,
    state: terminal && index <= activeIndex ? 'done' : index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'upcoming',
  }));
}

export function executionStatus(task, workers = []) {
  const state = clean(task?.state) || 'QUEUED';
  const actor = executionActor(task, workers);
  const progress = Number.isInteger(task?.progress) ? Math.max(0, Math.min(100, task.progress)) : 0;
  const eventMessage = clean(task?.lastEvent?.message);
  const result = clean(task?.resultSummary);
  const failure = FAILURE_COPY[clean(task?.failureCode)] || null;

  let title = 'AWH รับงานแล้ว';
  let detail = 'กำลังจัดเส้นทางให้เหมาะกับงานนี้';
  if (state === 'WAITING_FOR_WORKER') detail = 'AWH กำลังเตรียมขั้นตอนถัดไปและจะทำต่ออัตโนมัติเมื่อพร้อม';
  else if (state === 'PREPARING') { title = 'กำลังวิเคราะห์'; detail = `${actor} กำลังรวบรวมข้อมูลที่เกี่ยวข้องและเลือกวิธีทำที่เหมาะสม`; }
  else if (state === 'RUNNING') { title = 'กำลังทำ'; detail = `${actor} กำลังดำเนินงาน`; }
  else if (state === 'QA') { title = 'กำลังตรวจคุณภาพ'; detail = 'AWH กำลังตรวจผลลัพธ์ก่อนส่งกลับ'; }
  else if (state === 'WAITING_FOR_APPROVAL') { title = 'รอการอนุมัติ'; detail = 'มีการเปลี่ยนแปลงสำคัญที่ต้องยืนยันก่อนดำเนินการต่อ'; }
  else if (state === 'COMPLETED') { title = 'พร้อมใช้'; detail = result || 'งานเสร็จและผลลัพธ์พร้อมใช้งานแล้ว'; }
  else if (state === 'FAILED') { title = 'กำลังแก้ไข'; detail = failure || result || 'AWH เก็บสถานะไว้แล้วและกำลังหาวิธีทำต่ออย่างปลอดภัย'; }
  else if (state === 'CANCELLED') { title = 'ยกเลิกแล้ว'; detail = 'งานนี้ถูกยกเลิกแล้ว'; }

  const eventLooksInternal = eventMessage ? /(?:worker|device|capability|executor|VPS|Codex|อุปกรณ์|เครื่องมือ|เซิร์ฟเวอร์|server)/iu.test(eventMessage) : false;
  if (eventMessage && /[ก-๙]/u.test(eventMessage) && !eventLooksInternal && !TERMINAL.has(state)) detail = eventMessage;

  return {
    state,
    stage: executionStage(task),
    title,
    detail,
    actor,
    progress,
    terminal: TERMINAL.has(state),
    needsApproval: state === 'WAITING_FOR_APPROVAL',
    journey: executionJourney(task),
    context: executionContext(task, workers),
  };
}

export const EXECUTION_STAGES = STAGES.map((stage) => ({ ...stage }));
