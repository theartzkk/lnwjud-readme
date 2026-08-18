import { homedir } from 'node:os';
import { resolve } from 'node:path';
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
}

function boolValue(name: string, stored: boolean | undefined, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return stored ?? fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function intEnv(name: string, fallback: number): number {
  const raw = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

export function loadConfig(): ArtAgentConfig {
  const dataDir = resolve(process.env.ART_AGENT_DATA_DIR ?? `${homedir()}/.art-agent`);
  const stored = loadStoredSettings(dataDir);
  const workspace = resolve(
    argValue('--workspace') ?? process.env.ART_AGENT_WORKSPACE ?? stored.defaultWorkspace ?? process.cwd(),
  );

  return {
    workspace,
    dataDir,
    allowWrite: boolValue('ART_AGENT_ALLOW_WRITE', stored.allowWrite, false),
    allowExec: boolValue('ART_AGENT_ALLOW_EXEC', stored.allowExec, false),
    allowCodex: boolValue('ART_AGENT_ALLOW_CODEX', stored.allowCodex, false),
    maxReadBytes: intEnv('ART_AGENT_MAX_READ_BYTES', 512 * 1024),
    maxSearchResults: intEnv('ART_AGENT_MAX_SEARCH_RESULTS', 100),
    maxTaskLogBytes: intEnv('ART_AGENT_MAX_TASK_LOG_BYTES', 512 * 1024),
  };
}
