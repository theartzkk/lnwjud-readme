import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, win32 as pathWin32 } from 'node:path';
import { execFile, resolveExecutable } from './process.js';

export interface WorkerToolProbeOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  commandAvailable?: (command: string) => Promise<boolean>;
  pathAvailable?: (path: string) => Promise<boolean>;
}

const TOOL_ID = /^tool\.[a-z0-9][a-z0-9._-]{0,55}$/;

async function defaultCommandAvailable(command: string): Promise<boolean> {
  try { await resolveExecutable(command); return true; } catch { return false; }
}

async function defaultPathAvailable(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

function uniquePaths(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}
function windowsOfficeCandidates(env: NodeJS.ProcessEnv, executable: string): string[] {
  const roots = uniquePaths([env.ProgramFiles, env['ProgramFiles(x86)']]);
  const out: string[] = [];
  for (const root of roots) {
    out.push(pathWin32.join(root, 'Microsoft Office', 'root', 'Office16', executable));
    out.push(pathWin32.join(root, 'Microsoft Office', 'Office16', executable));
  }
  return out;
}

function windowsBrowserCandidates(env: NodeJS.ProcessEnv, vendor: 'chrome' | 'edge'): string[] {
  if (vendor === 'chrome') return uniquePaths([
    env.ProgramFiles && pathWin32.join(env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['ProgramFiles(x86)'] && pathWin32.join(env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.LOCALAPPDATA && pathWin32.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]);
  return uniquePaths([
    env.ProgramFiles && pathWin32.join(env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    env['ProgramFiles(x86)'] && pathWin32.join(env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]);
}

async function anyPath(paths: string[], available: (path: string) => Promise<boolean>): Promise<boolean> {
  for (const path of paths) if (await available(path)) return true;
  return false;
}

export interface WorkerOperationalProbeOptions {
  platform?: NodeJS.Platform;
  home?: string;
  readText?: (path: string) => Promise<string>;
  foregroundApp?: () => Promise<string | null>;
}

function appCapability(value: string): string | null {
  const name = value.trim().toLocaleLowerCase('en-US');
  if (/photoshop/.test(name)) return 'photoshop';
  if (/after effects/.test(name)) return 'after-effects';
  if (/premiere/.test(name)) return 'premiere';
  if (/remotion/.test(name)) return 'remotion';
  if (/chrome/.test(name)) return 'chrome';
  if (/safari/.test(name)) return 'safari';
  return null;
}

export async function discoverWorkerOperationalCapabilities(options: WorkerOperationalProbeOptions = {}): Promise<string[]> {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const readText = options.readText ?? (async (path: string) => readFile(path, 'utf8'));
  let mode: 'off' | 'on' | 'live' | null = null;
  try {
    const value = (await readText(join(home, '.kruart', 'ai-control', 'state'))).trim().toLocaleLowerCase('en-US');
    if (value === 'off' || value === 'on' || value === 'live') mode = value;
  } catch { /* KRUART mode is optional outside managed KRUART devices. */ }
  let guiReady = false;
  try {
    const registry = JSON.parse(await readText(join(home, '.kruart', 'capability-registry.json'))) as { capabilities?: { gui?: { runtime?: unknown } } };
    guiReady = registry.capabilities?.gui?.runtime === 'READY';
  } catch { /* Registry absence must not fabricate readiness. */ }
  const out: string[] = [];
  if (mode) out.push(`runtime.ai.${mode}`);
  if (guiReady) out.push('runtime.gui.ready');
  if (mode === 'live' && guiReady) out.push('runtime.visual.ready');
  if (platform === 'darwin') {
    try {
      const foreground = options.foregroundApp ?? (async () => {
        const result = await execFile('/usr/bin/osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'], home, 2_000);
        return result.code === 0 ? result.stdout.trim() || null : null;
      });
      const app = appCapability((await foreground()) ?? '');
      if (app) out.push(`app.foreground.${app}`);
    } catch { /* Foreground evidence is opportunistic and short-lived. */ }
  }
  return [...new Set(out)].sort();
}

export async function discoverWorkerTools(options: WorkerToolProbeOptions = {}): Promise<string[]> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const commandAvailable = options.commandAvailable ?? defaultCommandAvailable;
  const pathAvailable = options.pathAvailable ?? defaultPathAvailable;
  const tools: string[] = [];
  const addCommand = async (command: string, tool: string): Promise<void> => { if (await commandAvailable(command)) tools.push(tool); };

  await addCommand('git', 'tool.git');
  await addCommand('node', 'tool.node');
  await addCommand('php', 'tool.php');
  await addCommand('ffmpeg', 'tool.ffmpeg');
  await addCommand('ffprobe', 'tool.ffprobe');
  await addCommand('teamai', 'tool.teamai');
  await addCommand('context-mode', 'tool.context-mode');
  if (await commandAvailable('python3') || await commandAvailable('python')) tools.push('tool.python');

  if (platform === 'win32') {
    if (await anyPath(windowsOfficeCandidates(env, 'WINWORD.EXE'), pathAvailable)) tools.push('tool.office.word');
    if (await anyPath(windowsOfficeCandidates(env, 'EXCEL.EXE'), pathAvailable)) tools.push('tool.office.excel');
    if (await anyPath(windowsOfficeCandidates(env, 'POWERPNT.EXE'), pathAvailable)) tools.push('tool.office.powerpoint');
    if (await anyPath(windowsBrowserCandidates(env, 'chrome'), pathAvailable)) tools.push('tool.browser.chrome');
    if (await anyPath(windowsBrowserCandidates(env, 'edge'), pathAvailable)) tools.push('tool.browser.edge');
  }
  if (platform === 'darwin') {
    const apps: Array<[string, string]> = [
      ['/Applications/lnwjud.app/Contents/MacOS/lnwjud', 'tool.awh-device-gui'],
      ...(typeof env.HOME === 'string' && env.HOME ? [[join(env.HOME, '.local', 'share', 'bay-remote', 'node_modules', '.bin', 'desktop-commander'), 'tool.awh-device-system'] as [string, string]] : []),
      ['/Applications/Microsoft Word.app/Contents/MacOS/Microsoft Word', 'tool.office.word'],
      ['/Applications/Microsoft Excel.app/Contents/MacOS/Microsoft Excel', 'tool.office.excel'],
      ['/Applications/Microsoft PowerPoint.app/Contents/MacOS/Microsoft PowerPoint', 'tool.office.powerpoint'],
      ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'tool.browser.chrome'],
      ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'tool.browser.edge'],
      ['/Applications/Safari.app/Contents/MacOS/Safari', 'tool.browser.safari'],
    ];
    for (const [path, tool] of apps) if (await pathAvailable(path)) tools.push(tool);
  }

  return [...new Set(tools)].filter((value) => TOOL_ID.test(value)).sort();
}

export function composeWorkerHeartbeatCapabilities(executable: string[], tools: string[], limit = 24): string[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw new Error('Worker capability limit is invalid');
  const values = [...new Set([...executable, ...tools])].filter((value) => /^[a-z][a-z0-9:._-]{0,63}$/.test(value));
  const execution = values.filter((value) => !value.startsWith('tool.'));
  const inventory = values.filter((value) => value.startsWith('tool.'));
  return [...execution, ...inventory].slice(0, limit);
}
