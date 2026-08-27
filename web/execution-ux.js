const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

const STAGES = [
  { id: 'accepted', label: 'รับงานแล้ว' },
  { id: 'preparing', label: 'กำลังเตรียม' },
  { id: 'working', label: 'กำลังทำงาน' },
  { id: 'qa', label: 'กำลังตรวจ' },
  { id: 'approval', label: 'รออนุมัติ' },
  { id: 'done', label: 'เสร็จแล้ว' },
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
  const activeStage = executionStage(task);
  const activeIndex = stageIndex(activeStage);
  const terminal = TERMINAL.has(clean(task?.state));
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
  if (state === 'WAITING_FOR_WORKER') detail = 'กำลังเลือกเครื่องมือหรืออุปกรณ์ที่เหมาะกับงาน';
  else if (state === 'PREPARING') { title = 'กำลังเตรียมงาน'; detail = `กำลังเตรียมบริบทให้ ${actor}`; }
  else if (state === 'RUNNING') { title = 'กำลังทำงาน'; detail = `${actor} กำลังดำเนินงาน`; }
  else if (state === 'QA') { title = 'กำลังตรวจคุณภาพ'; detail = 'AWH กำลังตรวจผลลัพธ์ก่อนส่งกลับ'; }
  else if (state === 'WAITING_FOR_APPROVAL') { title = 'รอการอนุมัติ'; detail = 'มีการเปลี่ยนแปลงสำคัญที่ต้องยืนยันก่อนดำเนินการต่อ'; }
  else if (state === 'COMPLETED') { title = 'เสร็จแล้ว'; detail = result || 'งานเสร็จและผลลัพธ์ถูกบันทึกไว้แล้ว'; }
  else if (state === 'FAILED') { title = 'ต้องตรวจสอบ'; detail = failure || result || 'AWH ยังทำงานนี้ไม่สำเร็จ และไม่ได้อ้างว่าเสร็จแล้ว'; }
  else if (state === 'CANCELLED') { title = 'ยกเลิกแล้ว'; detail = 'งานนี้ถูกยกเลิกแล้ว'; }

  if (eventMessage && /[ก-๙]/u.test(eventMessage) && !TERMINAL.has(state)) detail = eventMessage;

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
  };
}

export const EXECUTION_STAGES = STAGES.map((stage) => ({ ...stage }));
