const MEMORY_FILES = ['PROJECT.md', 'HANDOFF.md', 'TASKS.md', 'ARCHITECTURE.md', 'DECISIONS.md'];
const MAX_JSON_BYTES = 512 * 1024;
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSafeRelativePath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[?#]/.test(value) && !value.split('/').includes('..') ? value : null;
}

export function browserRequestOptions(mode) {
  return { credentials: mode === 'STATIC_PREVIEW' || mode === 'HUB_READ' ? 'same-origin' : 'omit', cache: 'no-store' };
}

export async function getJson(path, mode = 'HUB_READ', fetchImpl = globalThis.fetch) {
  const safePath = isSafeRelativePath(path);
  if (!safePath) throw new Error('Hub read path is not safe');
  const response = await fetchImpl(safePath, browserRequestOptions(mode));
  if (!response.ok) throw new Error(`Hub read unavailable (${response.status})`);
  const body = await response.text();
  if (body.length > MAX_JSON_BYTES) throw new Error('Hub response exceeds the browser bound');
  return JSON.parse(body);
}

function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Web mode configuration is invalid');
  if (value.mode === 'STATIC_PREVIEW') return { mode: value.mode };
  if (value.mode !== 'HUB_READ' || typeof value.apiBase !== 'string') throw new Error('Web mode is not supported');
  const apiBase = isSafeRelativePath(value.apiBase.replace(/\/$/, ''));
  if (!apiBase || apiBase.includes('..')) throw new Error('Hub API base is not safe');
  return { mode: value.mode, apiBase };
}

function portableProject(value) {
  const project = value?.project ?? value;
  if (!project || !PROJECT_ID.test(project.projectId) || typeof project.name !== 'string' || typeof project.type !== 'string') throw new Error('Hub project payload is invalid');
  return { projectId: project.projectId, name: project.name, type: project.type, createdAt: typeof project.createdAt === 'string' ? project.createdAt : null };
}

function memoryStatus(value) {
  const source = value?.files && typeof value.files === 'object' ? value.files : {};
  return Object.fromEntries(MEMORY_FILES.map((file) => [file, source[file]?.status === 'present' ? 'present' : 'missing']));
}

function hubData(projectPayload, memoryPayload, statusPayload, devicesPayload, buildsPayload, releasesPayload) {
  const project = portableProject(projectPayload);
  const memory = memoryStatus(memoryPayload);
  const handoff = typeof memoryPayload?.handoffSummary === 'string' ? memoryPayload.handoffSummary.slice(0, 480) : 'HANDOFF summary is not exposed by this read adapter.';
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    preview: { mode: 'HUB_READ', label: 'Remote Preview — Read Only', status: 'Authenticated Hub read mode' },
    product: { name: 'Art’s Workspace Hub', shortName: 'AWH', tagline: 'Your Projects. One Workspace. Anywhere.' },
    hub: { status: statusPayload?.status === 'ok' ? 'Connected read-only' : 'Hub read available', summary: 'Sanitized metadata from the AWH Hub read foundation.' },
    project: { ...project, milestone: 'M3C1 — AWH Hub Read Foundation', handoffSummary: handoff, memory },
    devices: { status: 'Read-only', summary: 'Device metadata is visible only through the authenticated Hub boundary.', count: Array.isArray(devicesPayload?.devices) ? devicesPayload.devices.length : 0 },
    builds: { status: 'Read-only', summary: `Builds: ${Array.isArray(buildsPayload?.builds) ? buildsPayload.builds.length : 0}; releases: ${Array.isArray(releasesPayload?.releases) ? releasesPayload.releases.length : 0}.` },
    audit: { status: 'Read-only', summary: 'Audit mutation and credential data are not exposed by the browser adapter.' },
  };
}

export async function fetchStaticData(fetchImpl = globalThis.fetch) {
  return getJson('/data.json', 'STATIC_PREVIEW', fetchImpl);
}

export function degradedHubPreview(staticPreview) {
  return {
    ...staticPreview,
    preview: { ...staticPreview.preview, mode: 'HUB_READ_DEGRADED', status: 'Hub unavailable — Static preview' },
    hub: { status: 'Offline', summary: 'Live Hub read is unavailable; showing the static preview.' },
  };
}

async function staticData() {
  return fetchStaticData();
}

async function hubDataFromApi(apiBase) {
  const projectList = await getJson(`${apiBase}/projects`, 'HUB_READ');
  const projects = Array.isArray(projectList?.projects) ? projectList.projects : [];
  const project = projects[0];
  if (!project) throw new Error('Hub has no readable project');
  const id = encodeURIComponent(project.projectId);
  const [projectPayload, memory, status, devices, builds, releases] = await Promise.all([
    getJson(`${apiBase}/projects/${id}`, 'HUB_READ'),
    getJson(`${apiBase}/projects/${id}/memory`, 'HUB_READ'),
    getJson(`${apiBase.replace(/\/v1$/, '')}/status`, 'HUB_READ'),
    getJson(`${apiBase}/devices`, 'HUB_READ'),
    getJson(`${apiBase}/builds`, 'HUB_READ'),
    getJson(`${apiBase}/releases`, 'HUB_READ'),
  ]);
  return hubData(projectPayload, memory, status, devices, builds, releases);
}

export async function loadWebData() {
  let config = { mode: 'STATIC_PREVIEW' };
  try {
    const response = await fetch('/web-config.json', browserRequestOptions('HUB_READ'));
    if (response.ok) {
      const body = await response.text();
      if (body.length > 4096) throw new Error('Web mode configuration exceeds the browser bound');
      config = validateConfig(JSON.parse(body));
    }
  } catch (error) {
    if (error instanceof SyntaxError || String(error?.message).includes('configuration') || String(error?.message).includes('mode')) throw error;
  }
  if (config.mode !== 'HUB_READ') return staticData();
  try {
    return await hubDataFromApi(config.apiBase);
  } catch {
    return degradedHubPreview(await staticData());
  }
}
