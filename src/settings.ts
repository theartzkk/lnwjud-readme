import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface StoredSettings {
  defaultWorkspace?: string;
  selectedHubProjectId?: string;
  allowWrite?: boolean;
  allowExec?: boolean;
  allowCodex?: boolean;
  /**
   * Whether this enrolled device should poll the Control Plane for work.
   * Kept separate from the execution grants so an owner can explicitly pause
   * remote work without removing the local capability policy.
   */
  controlPlaneWorker?: boolean;
}

export function settingsPath(dataDir: string): string {
  return join(dataDir, 'settings.json');
}

export function loadStoredSettings(dataDir: string): StoredSettings {
  try {
    const raw = readFileSync(settingsPath(dataDir), 'utf8');
    if (raw.length > 64 * 1024) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: StoredSettings = {};
    if (typeof parsed.defaultWorkspace === 'string' && parsed.defaultWorkspace.trim()) out.defaultWorkspace = parsed.defaultWorkspace;
    if (typeof parsed.selectedHubProjectId === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.selectedHubProjectId)) out.selectedHubProjectId = parsed.selectedHubProjectId.toLowerCase();
    if (typeof parsed.allowWrite === 'boolean') out.allowWrite = parsed.allowWrite;
    if (typeof parsed.allowExec === 'boolean') out.allowExec = parsed.allowExec;
    if (typeof parsed.allowCodex === 'boolean') out.allowCodex = parsed.allowCodex;
    if (typeof parsed.controlPlaneWorker === 'boolean') out.controlPlaneWorker = parsed.controlPlaneWorker;
    return out;
  } catch {
    return {};
  }
}

export async function saveStoredSettings(dataDir: string, settings: StoredSettings): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const target = settingsPath(dataDir);
  const normalized: StoredSettings = {};
  if (settings.defaultWorkspace?.trim()) normalized.defaultWorkspace = settings.defaultWorkspace;
  if (settings.selectedHubProjectId && /^[0-9a-f-]{36}$/i.test(settings.selectedHubProjectId)) normalized.selectedHubProjectId = settings.selectedHubProjectId.toLowerCase();
  if (typeof settings.allowWrite === 'boolean') normalized.allowWrite = settings.allowWrite;
  if (typeof settings.allowExec === 'boolean') normalized.allowExec = settings.allowExec;
  if (typeof settings.allowCodex === 'boolean') normalized.allowCodex = settings.allowCodex;
  if (typeof settings.controlPlaneWorker === 'boolean') normalized.controlPlaneWorker = settings.controlPlaneWorker;
  await writeFile(target, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}
