import { resolve } from 'node:path';
import { resolveActiveDataDir } from './data-migration.js';
import { loadStoredSettings } from './settings.js';

export interface ArtAgentConfig {
  workspace: string;
  dataDir: string;
  allowWrite: boolean;
  allowExec: boolean;
  allowCodex: boolean;
  maxReadBytes: number;
  maxSearchResults: number;
  maxTaskLogBytes: number;
  hubApiBase: string;
}

const ENV_ALIASES = {
  dataDir: ['AWH_DATA_DIR', 'ART_AGENT_DATA_DIR'],
  workspace: ['AWH_WORKSPACE', 'ART_AGENT_WORKSPACE'],
  allowWrite: ['AWH_ALLOW_WRITE', 'ART_AGENT_ALLOW_WRITE'],
  allowExec: ['AWH_ALLOW_EXEC', 'ART_AGENT_ALLOW_EXEC'],
  allowCodex: ['AWH_ALLOW_CODEX', 'ART_AGENT_ALLOW_CODEX'],
  maxReadBytes: ['AWH_MAX_READ_BYTES', 'ART_AGENT_MAX_READ_BYTES'],
  maxSearchResults: ['AWH_MAX_SEARCH_RESULTS', 'ART_AGENT_MAX_SEARCH_RESULTS'],
  maxTaskLogBytes: ['AWH_MAX_TASK_LOG_BYTES', 'ART_AGENT_MAX_TASK_LOG_BYTES'],
  hubApiBase: ['AWH_HUB_API_BASE', 'ART_AGENT_HUB_API_BASE'],
} as const;

export type ConfigEnvironmentKey = keyof typeof ENV_ALIASES;

/** Resolve one AWH config key with AWH_* taking precedence over ART_AGENT_*. */
export function compatibilityEnv(key: ConfigEnvironmentKey): string | undefined {
  const [awhName, legacyName] = ENV_ALIASES[key];
  return process.env[awhName] ?? process.env[legacyName];
}

export function explicitWorkspaceEnv(): string | undefined {
  return compatibilityEnv('workspace');
}

function boolValue(key: ConfigEnvironmentKey, stored: boolean | undefined, fallback = false): boolean {
  const raw = compatibilityEnv(key);
  if (raw === undefined) return stored ?? fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function intEnv(key: ConfigEnvironmentKey, fallback: number): number {
  const raw = Number.parseInt(compatibilityEnv(key) ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

export function loadConfig(): ArtAgentConfig {
  const dataDir = resolve(resolveActiveDataDir());
  const stored = loadStoredSettings(dataDir);
  const workspace = resolve(
    argValue('--workspace') ?? compatibilityEnv('workspace') ?? stored.defaultWorkspace ?? process.cwd(),
  );

  return {
    workspace,
    dataDir,
    allowWrite: boolValue('allowWrite', stored.allowWrite, false),
    allowExec: boolValue('allowExec', stored.allowExec, false),
    allowCodex: boolValue('allowCodex', stored.allowCodex, false),
    maxReadBytes: intEnv('maxReadBytes', 512 * 1024),
    maxSearchResults: intEnv('maxSearchResults', 100),
    maxTaskLogBytes: intEnv('maxTaskLogBytes', 512 * 1024),
    hubApiBase: compatibilityEnv('hubApiBase')?.trim() ?? '',
  };
}
