import { loadConfig } from '../../src/config.ts';
import { createDesktopCredentialStore, DEVICE_TOKEN_CREDENTIAL_KEY } from '../../src/credential-store.ts';
import { ControlPlaneWorkerClient } from '../../src/control-plane-worker-client.ts';
import { loadStoredSettings } from '../../src/settings.ts';

const POLL_MS = 5_000;
const DEADLINE_MS = 120_000;
const FIELD_MESSAGE = 'ตรวจ Source of Truth ของ AWH ต่อเนื่องบน VPS แบบ read-only เท่านั้น ห้ามแก้ source deploy secret billing หรือ permission เมื่อขั้นแรกเสร็จให้เลือกหัวข้อ read-only ที่ปลอดภัยถัดไปเอง';

function fieldError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function taskIds(tasks) {
  return new Set(tasks.map((task) => task.taskId));
}

function assertVpsReadOnly(task, label) {
  if (task?.execution?.executorKind !== 'VPS' || task.execution.requiredCapability !== 'project.read') {
    throw fieldError('AUTOCHAIN_FIELD_EXECUTOR_MISMATCH', `${label} did not use the VPS project.read executor`);
  }
}

function assertLineage(task, rootTaskId, step, label) {
  const continuation = task?.execution?.continuation;
  if (!continuation || continuation.rootTaskId !== rootTaskId || continuation.step !== step || continuation.maxSteps < 1 || continuation.maxSteps > 8) {
    throw fieldError('AUTOCHAIN_FIELD_LINEAGE_MISMATCH', `${label} did not preserve the canonical rootTaskId lineage`);
  }
}

async function delay() {
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}

async function run() {
  const config = loadConfig();
  const firstStore = createDesktopCredentialStore(config.dataDir);
  if (!await firstStore.get(DEVICE_TOKEN_CREDENTIAL_KEY)) throw fieldError('DEVICE_NOT_ENROLLED', 'Desktop enrollment credential is not persisted; sign in on this device before running the field proof');
  const restartedStore = createDesktopCredentialStore(config.dataDir);
  if (!await restartedStore.get(DEVICE_TOKEN_CREDENTIAL_KEY)) throw fieldError('CREDENTIAL_PERSISTENCE_FAILED', 'A fresh credential-store instance could not read the persisted enrollment credential');

  const client = new ControlPlaneWorkerClient(config.hubApiBase, config.dataDir, createDesktopCredentialStore(config.dataDir));
  const projects = await client.projects();
  if (projects.length === 0) throw fieldError('PROJECT_NOT_FOUND', 'The enrolled account has no Hub project available for the field proof');
  const stored = loadStoredSettings(config.dataDir);
  const project = projects.find((item) => item.projectId === stored.selectedHubProjectId) ?? projects[0];
  const before = await client.readConversation(project.projectId);
  const beforeIds = taskIds(before.tasks);
  const idempotencyKey = `autochain-field-${Date.now().toString(36)}`;
  const submitted = await client.submitConversation(project.projectId, FIELD_MESSAGE, idempotencyKey);
  const created = submitted.tasks.filter((task) => !beforeIds.has(task.taskId));
  const root = created.find((task) => task.execution?.continuation?.step === 0) ?? created.at(-1);
  if (!root) throw fieldError('AUTOCHAIN_FIELD_ROOT_MISSING', 'The explicit field request did not create a canonical root task');
  assertVpsReadOnly(root, 'root task');
  assertLineage(root, root.taskId, 0, 'root task');
  if (!root.conversationId || root.projectId !== project.projectId) throw fieldError('AUTOCHAIN_FIELD_CONTEXT_MISMATCH', 'The root task is not bound to the selected canonical project conversation');

  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    await delay();
    const latest = await client.readConversation(project.projectId);
    const rootNow = latest.tasks.find((task) => task.taskId === root.taskId);
    if (!rootNow) throw fieldError('AUTOCHAIN_FIELD_ROOT_DISAPPEARED', 'The canonical root task disappeared from the conversation');
    if (rootNow.state === 'FAILED' || rootNow.execution?.state === 'FAILED') throw fieldError('AUTOCHAIN_FIELD_ROOT_FAILED', 'The canonical root task failed before continuation materialization');
    if (rootNow.state !== 'COMPLETED' || rootNow.execution?.state !== 'COMPLETED') continue;
    assertVpsReadOnly(rootNow, 'completed root task');
    assertLineage(rootNow, root.taskId, 0, 'completed root task');
    const continuation = latest.tasks.find((task) => task.taskId !== root.taskId && task.conversationId === rootNow.conversationId && task.execution?.continuation?.rootTaskId === root.taskId && task.execution.continuation.step === 1);
    if (!continuation) continue;
    if (continuation.state === 'FAILED' || continuation.execution?.state === 'FAILED') throw fieldError('AUTOCHAIN_FIELD_CONTINUATION_FAILED', 'The canonical continuation task was materialized but failed');
    assertVpsReadOnly(continuation, 'continuation task');
    assertLineage(continuation, root.taskId, 1, 'continuation task');
    console.log(JSON.stringify({ status: 'PASS', projectId: project.projectId, rootTaskId: root.taskId, rootState: rootNow.state, rootExecutor: rootNow.execution.executorKind, continuationTaskId: continuation.taskId, continuationState: continuation.state, continuationExecutor: continuation.execution.executorKind, continuationStep: continuation.execution.continuation.step, credentialReadAfterFreshStore: true }));
    return;
  }
  throw fieldError('AUTOCHAIN_FIELD_TIMEOUT', 'The root task did not complete and materialize its canonical continuation within the bounded field-proof window');
}

try {
  await run();
} catch (error) {
  const code = error && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'AUTOCHAIN_FIELD_FAILED';
  const message = error && typeof error === 'object' && typeof error.message === 'string' ? error.message : 'Auto-Chain field proof failed';
  console.error(`AWH Auto-Chain field proof: BLOCKED ${code} — ${message}`);
  process.exitCode = 2;
}
