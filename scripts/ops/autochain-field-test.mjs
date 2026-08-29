import { loadConfig } from '../../src/config.ts';
import { createDesktopCredentialStore } from '../../src/credential-store.ts';
import { ControlPlaneWorkerClient } from '../../src/control-plane-worker-client.ts';
import { loadStoredSettings } from '../../src/settings.ts';

const POLL_MS = 5_000;
const DEADLINE_MS = 120_000;
const MESSAGE = 'ตรวจ Source of Truth ของ AWH ต่อเนื่องบน VPS แบบ read-only เท่านั้น ห้ามแก้ source deploy secret billing หรือ permission เมื่อขั้นแรกเสร็จให้เลือกหัวข้อ read-only ที่ปลอดภัยถัดไปเอง';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const config = loadConfig();
if (!config.hubApiBase) throw new Error('AUTOCHAIN_FIELD_HUB_NOT_CONFIGURED');
const client = new ControlPlaneWorkerClient(config.hubApiBase, config.dataDir, createDesktopCredentialStore(config.dataDir));
const projects = await client.projects();
const stored = loadStoredSettings(config.dataDir);
const project = projects.find((item) => item.projectId === stored.selectedHubProjectId) ?? projects[0];
if (!project) throw new Error('AUTOCHAIN_FIELD_PROJECT_NOT_FOUND');

const before = await client.readConversation(project.projectId);
const beforeIds = new Set(before.tasks.map((task) => task.taskId));
const key = `autochain-field-${Date.now().toString(36)}`;
const submitted = await client.submitConversation(project.projectId, MESSAGE, key);
const roots = submitted.tasks.filter((task) => !beforeIds.has(task.taskId));
const root = roots.at(-1);
if (!root) throw new Error('AUTOCHAIN_FIELD_ROOT_NOT_CREATED');
const deadline = Date.now() + DEADLINE_MS;
let latest = submitted;
let continuation = null;
while (Date.now() < deadline) {
  await delay(POLL_MS);
  latest = await client.readConversation(project.projectId);
  const rootNow = latest.tasks.find((task) => task.taskId === root.taskId);
  const newTasks = latest.tasks.filter((task) => !beforeIds.has(task.taskId) && task.taskId !== root.taskId);
  continuation = newTasks.find((task) => task.execution?.executorKind === 'VPS') ?? newTasks.at(-1) ?? null;
  if (rootNow?.state === 'FAILED') throw new Error('AUTOCHAIN_FIELD_ROOT_FAILED');
  if (continuation) break;
}
if (!continuation) throw new Error('AUTOCHAIN_FIELD_CONTINUATION_NOT_OBSERVED');
console.log(JSON.stringify({
  status: 'PASS',
  project: project.name,
  root: { taskId: root.taskId, state: latest.tasks.find((task) => task.taskId === root.taskId)?.state ?? root.state },
  continuation: { taskId: continuation.taskId, state: continuation.state, executor: continuation.execution?.executorKind ?? null, capability: continuation.execution?.requiredCapability ?? null },
}, null, 2));