import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type AgentRuntimeMode = 'OFF' | 'ON' | 'LIVE';

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
  /** Version of the completed local OS permission onboarding contract. */
  permissionSetupVersion?: number;
  /** Local interruption policy. OS permissions remain independent from this mode. */
  runtimeMode?: AgentRuntimeMode;
  runtimeModeUpdatedAt?: string;
  lastEmergencyStopAt?: string;
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
    if (Number.isSafeInteger(parsed.permissionSetupVersion) && (parsed.permissionSetupVersion as number) >= 1 && (parsed.permissionSetupVersion as number) <= 100) out.permissionSetupVersion = parsed.permissionSetupVersion as number;
    if (parsed.runtimeMode === 'OFF' || parsed.runtimeMode === 'ON' || parsed.runtimeMode === 'LIVE') out.runtimeMode = parsed.runtimeMode;
    if (typeof parsed.runtimeModeUpdatedAt === 'string' && Number.isFinite(Date.parse(parsed.runtimeModeUpdatedAt))) out.runtimeModeUpdatedAt = parsed.runtimeModeUpdatedAt;
    if (typeof parsed.lastEmergencyStopAt === 'string' && Number.isFinite(Date.parse(parsed.lastEmergencyStopAt))) out.lastEmergencyStopAt = parsed.lastEmergencyStopAt;
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
  const permissionSetupVersion = settings.permissionSetupVersion;
  if (Number.isSafeInteger(permissionSetupVersion) && (permissionSetupVersion as number) >= 1 && (permissionSetupVersion as number) <= 100) normalized.permissionSetupVersion = permissionSetupVersion as number;
  if (settings.runtimeMode === 'OFF' || settings.runtimeMode === 'ON' || settings.runtimeMode === 'LIVE') normalized.runtimeMode = settings.runtimeMode;
  if (typeof settings.runtimeModeUpdatedAt === 'string' && Number.isFinite(Date.parse(settings.runtimeModeUpdatedAt))) normalized.runtimeModeUpdatedAt = settings.runtimeModeUpdatedAt;
  if (typeof settings.lastEmergencyStopAt === 'string' && Number.isFinite(Date.parse(settings.lastEmergencyStopAt))) normalized.lastEmergencyStopAt = settings.lastEmergencyStopAt;
  await writeFile(target, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}
