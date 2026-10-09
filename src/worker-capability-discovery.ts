import { access } from 'node:fs/promises';
import { posix as pathPosix, win32 as pathWin32 } from 'node:path';
import { createRequire } from 'node:module';
import { resolveExecutable } from './process.js';

const require = createRequire(import.meta.url);
const DEVICE_ENGINE_VERSION = (require('../config/device-runtime-release.json') as { deviceEngine: { version: string } }).deviceEngine.version;

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
    const local = typeof env.LOCALAPPDATA === 'string' && env.LOCALAPPDATA ? env.LOCALAPPDATA : null;
    const runtimeCandidates = local ? [
      pathWin32.join(local, 'AWH', 'Engines', 'device-runtime', DEVICE_ENGINE_VERSION, 'AWH Device Runtime.exe'),
      pathWin32.join(local, 'AWH', 'Engines', 'lnwjud', 'current', 'lnwjud.exe'),
      pathWin32.join(local, 'Programs', 'lnwjud', 'lnwjud.exe'),
    ] : [];
    const runtimeReady = await anyPath(runtimeCandidates, pathAvailable);
    const systemMcpCandidates = local ? [
      pathWin32.join(local, 'AWH', 'SystemRuntime', 'runtime', 'node_modules', '@wonderwhy-er', 'desktop-commander', 'dist', 'index.js'),
    ] : [];
    const systemMcpReady = await anyPath(systemMcpCandidates, pathAvailable);
    const profile = typeof env.USERPROFILE === 'string' && env.USERPROFILE ? env.USERPROFILE : null;
    const remoteSessionReady = profile ? await pathAvailable(pathWin32.join(profile, '.desktop-commander-device', 'device.json')) : false;
    if (runtimeReady) tools.push('tool.awh-device-runtime', 'tool.awh-device-system', 'tool.awh-device-gui');
    if (systemMcpReady && remoteSessionReady) tools.push('tool.remote-desktop-mcp');
    if (await anyPath(windowsOfficeCandidates(env, 'WINWORD.EXE'), pathAvailable)) tools.push('tool.office.word');
    if (await anyPath(windowsOfficeCandidates(env, 'EXCEL.EXE'), pathAvailable)) tools.push('tool.office.excel');
    if (await anyPath(windowsOfficeCandidates(env, 'POWERPNT.EXE'), pathAvailable)) tools.push('tool.office.powerpoint');
    if (await anyPath(windowsBrowserCandidates(env, 'chrome'), pathAvailable)) tools.push('tool.browser.chrome');
    if (await anyPath(windowsBrowserCandidates(env, 'edge'), pathAvailable)) tools.push('tool.browser.edge');
  }
  if (platform === 'darwin') {
    const home = typeof env.HOME === 'string' && env.HOME ? env.HOME : null;
    const systemCandidates = home ? [
      pathPosix.join(home, '.awh', 'bin', 'awh-system-mcp'),
      pathPosix.join(home, 'Library', 'Application Support', 'AWH', 'RemoteWorker', 'runtime', 'node_modules', '.bin', 'desktop-commander'),
      pathPosix.join(home, '.local', 'share', 'bay-remote', 'node_modules', '.bin', 'desktop-commander'),
    ] : [];
    const guiCandidates = home ? [pathPosix.join(home, '.kruart', 'ai-control', 'kui')] : [];
    const runtimeCandidates = home ? [
      pathPosix.join(home, '.awh', 'bin', 'awh-mcp-stdio'),
      pathPosix.join(home, 'Library', 'Application Support', 'AWH', 'DeviceRuntime', 'awh-mcp-stdio'),
    ] : [];
    const runtimeReady = await anyPath(runtimeCandidates, pathAvailable);
    const systemReady = await anyPath(systemCandidates, pathAvailable);
    const remoteSessionReady = home ? await pathAvailable(pathPosix.join(home, '.desktop-commander-device', 'device.json')) : false;
    const guiReady = runtimeReady || await anyPath(guiCandidates, pathAvailable);
    if (runtimeReady) tools.push('tool.awh-device-runtime');
    if (systemReady && remoteSessionReady) tools.push('tool.remote-desktop-mcp');
    if (systemReady || runtimeReady) tools.push('tool.awh-device-system');
    if (guiReady && (systemReady || runtimeReady)) tools.push('tool.awh-device-gui');
    const apps: Array<[string, string]> = [
      ['/Applications/Microsoft Word.app/Contents/MacOS/Microsoft Word', 'tool.office.word'],
      ['/Applications/Microsoft Excel.app/Contents/MacOS/Microsoft Excel', 'tool.office.excel'],
      ['/Applications/Microsoft PowerPoint.app/Contents/MacOS/Microsoft PowerPoint', 'tool.office.powerpoint'],
      ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'tool.browser.chrome'],
      ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'tool.browser.edge'],
      ['/Applications/Safari.app/Contents/MacOS/Safari', 'tool.browser.safari'],
    ];
    for (const [path, tool] of apps) if (await pathAvailable(path)) tools.push(tool);
    const photoshopCandidates = [
      '/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app/Contents/MacOS/Adobe Photoshop 2026',
      '/Applications/Adobe Photoshop 2025/Adobe Photoshop 2025.app/Contents/MacOS/Adobe Photoshop 2025',
      '/Applications/Adobe Photoshop 2024/Adobe Photoshop 2024.app/Contents/MacOS/Adobe Photoshop 2024',
    ];
    if (await anyPath(photoshopCandidates, pathAvailable)) tools.push('tool.adobe.photoshop');
  }

  return [...new Set(tools)].filter((value) => TOOL_ID.test(value)).sort();
}

export function composeWorkerHeartbeatCapabilities(executable: string[], tools: string[], limit = 24): string[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw new Error('Worker capability limit is invalid');
  const values = [...new Set([...executable, ...tools])].filter((value) => /^[a-z][a-z0-9:._-]{0,63}$/.test(value));
  const execution = values.filter((value) => !value.startsWith('tool.'));
  const inventory = values.filter((value) => value.startsWith('tool.'));
  const priority = ['tool.awh-device-runtime','tool.remote-desktop-mcp','tool.awh-device-gui','tool.awh-device-system','tool.adobe.photoshop'];
  const orderedInventory = [...priority.filter((value) => inventory.includes(value)), ...inventory.filter((value) => !priority.includes(value))];
  return [...execution, ...orderedInventory].slice(0, limit);
}
