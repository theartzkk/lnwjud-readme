import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, win32 as pathWin32 } from 'node:path';
import { createInterface, type Interface as ReadLineInterface } from 'node:readline';

const MODERN_PROTOCOL_VERSION = '2026-07-28';
const MAX_TEXT = 32 * 1024;
const MAX_IMAGE_BASE64 = 2 * 1024 * 1024;

export interface DeviceObservation {
  workspaceId: string;
  text: string;
  imageBase64: string | null;
  imageMimeType: 'image/png' | null;
}

export interface DeviceAction {
  tool: 'finish' | 'accessibility' | 'computer_use' | 'input_event' | 'dom_cdp' | 'shell' | 'read_file' | 'write_file' | 'search_text' | 'process_list' | 'process_start' | 'process_status' | 'process_stop';
  arguments: Record<string, unknown>;
  summary: string;
}

export interface LnwjudLaunchSpec { command: string; argsPrefix: string[]; }

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function discoverLnwjudLaunchSpec(platform: NodeJS.Platform = process.platform, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<LnwjudLaunchSpec | null> {
  if (platform === 'darwin') {
    const candidates: LnwjudLaunchSpec[] = [
      { command: join(home, '.awh', 'bin', 'awh-mcp-stdio'), argsPrefix: [] },
      { command: join(home, 'Library', 'Application Support', 'AWH', 'DeviceRuntime', 'awh-mcp-stdio'), argsPrefix: [] },
      { command: join(home, 'Library', 'Application Support', 'AWH', 'Engines', 'lnwjud', 'current', 'Contents', 'MacOS', 'AWH Device Runtime'), argsPrefix: ['--mcp-stdio'] },
    ];
    for (const candidate of candidates) if (await exists(candidate.command)) return candidate;
    return null;
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA;
    const candidates = [
      local ? pathWin32.join(local, 'AWH', 'Engines', 'device-runtime', '5.5.0', 'AWH Device Runtime.exe') : null,
      local ? pathWin32.join(local, 'AWH', 'Engines', 'lnwjud', 'current', 'lnwjud.exe') : null,
      local ? pathWin32.join(local, 'Programs', 'lnwjud', 'lnwjud.exe') : null,
    ].filter((value): value is string => Boolean(value));
    for (const command of candidates) if (await exists(command)) return { command, argsPrefix: ['--mcp-stdio'] };
  }
  return null;
}

function boundedText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').slice(0, MAX_TEXT);
}

function responseText(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const result = (value as Record<string, unknown>).result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return '';
  const content = (result as Record<string, unknown>).content;
  if (!Array.isArray(content)) return '';
  return boundedText(content.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))).filter((item) => item.type === 'text' && typeof item.text === 'string').map((item) => item.text).join('\n'));
}

function responseImage(value: unknown): { data: string; mime: 'image/png' } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = (value as Record<string, unknown>).result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const content = (result as Record<string, unknown>).content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (record.type === 'image' && record.mimeType === 'image/png' && typeof record.data === 'string' && record.data.length > 0 && record.data.length <= MAX_IMAGE_BASE64 && /^[A-Za-z0-9+/=]+$/.test(record.data)) return { data: record.data, mime: 'image/png' };
  }
  return null;
}

function structuredValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = (value as Record<string, unknown>).result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const structured = (result as Record<string, unknown>).structuredContent;
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) return null;
  return (structured as Record<string, unknown>).value ?? structured;
}

export class LnwjudDeviceClient {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly lines: ReadLineInterface;
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private sequence = 0;
  private stderr = '';

  private constructor(spec: LnwjudLaunchSpec, workspace: string) {
    this.process = spawn(spec.command, [...spec.argsPrefix, '--workspace', workspace], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, AWH_DEVICE_RUNTIME_HEADLESS: '1' } });
    this.lines = createInterface({ input: this.process.stdout });
    this.lines.on('line', (line) => this.acceptLine(line));
    this.process.stderr.on('data', (chunk: Buffer | string) => { if (this.stderr.length < 8192) this.stderr += String(chunk).slice(0, 8192 - this.stderr.length); });
    this.process.once('error', (error) => this.rejectAll(error));
    this.process.once('exit', (code) => this.rejectAll(new Error('AWH_DEVICE_RUNTIME_EXIT_' + String(code ?? -1))));
  }

  static async open(workspace: string): Promise<LnwjudDeviceClient> {
    const spec = await discoverLnwjudLaunchSpec();
    if (!spec) throw new Error('AWH_DEVICE_RUNTIME_UNAVAILABLE');
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    const client = new LnwjudDeviceClient(spec, workspace);
    const discovered = await client.request('server/discover', {});
    if (!discovered || typeof discovered !== 'object' || Array.isArray(discovered) || !('result' in (discovered as Record<string, unknown>))) { client.close(); throw new Error('AWH_DEVICE_RUNTIME_PROTOCOL_UNAVAILABLE'); }
    return client;
  }

  private meta(): Record<string, unknown> {
    return {
      'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
      'io.modelcontextprotocol/clientInfo': { name: 'AWH Agent Device Worker', version: '1' },
      'io.modelcontextprotocol/clientCapabilities': { extensions: { 'io.modelcontextprotocol/tasks': {} } },
    };
  }

  private acceptLine(line: string): void {
    if (!line.startsWith('{') || line.length > 8 * 1024 * 1024) return;
    let value: unknown;
    try { value = JSON.parse(line); } catch { return; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const id = (value as Record<string, unknown>).id;
    if (typeof id !== 'string') return;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(id); pending.resolve(value);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  private async request(method: string, params: Record<string, unknown>, timeoutMs = 20_000): Promise<unknown> {
    const id = 'awh-' + String(++this.sequence);
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: this.meta() } });
    if (payload.length > 2 * 1024 * 1024) throw new Error('AWH_DEVICE_RUNTIME_REQUEST_TOO_LARGE');
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('AWH_DEVICE_RUNTIME_TIMEOUT')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.process.stdin.write(payload + '\n');
    return result;
  }

  async callTool(name: string, argumentsValue: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
    if (!/^[a-z][a-z0-9_]{1,48}$/.test(name)) throw new Error('AWH_DEVICE_TOOL_INVALID');
    return this.request('tools/call', { name, arguments: argumentsValue }, timeoutMs);
  }

  private async workspaceId(workspace: string): Promise<string> {
    const listed = await this.callTool('workspace_list', {});
    const values = structuredValue(listed);
    if (Array.isArray(values)) {
      const exact = values.find((item) => item && typeof item === 'object' && !Array.isArray(item) && String((item as Record<string, unknown>).rootPath ?? '') === workspace);
      const id = exact && typeof (exact as Record<string, unknown>).id === 'string' ? String((exact as Record<string, unknown>).id) : '';
      if (/^[0-9a-f-]{36}$/i.test(id)) return id;
    }
    await this.callTool('workspace_register', { path: workspace, displayName: 'AWH Device Task', userConfirmed: true });
    const refreshed = structuredValue(await this.callTool('workspace_list', {}));
    if (Array.isArray(refreshed)) {
      const exact = refreshed.find((item) => item && typeof item === 'object' && !Array.isArray(item) && String((item as Record<string, unknown>).rootPath ?? '') === workspace);
      const id = exact && typeof (exact as Record<string, unknown>).id === 'string' ? String((exact as Record<string, unknown>).id) : '';
      if (/^[0-9a-f-]{36}$/i.test(id)) return id;
    }
    throw new Error('AWH_DEVICE_WORKSPACE_UNAVAILABLE');
  }

  async observe(workspace: string, requireVisual: boolean): Promise<DeviceObservation> {
    const workspaceId = await this.workspaceId(workspace);
    let accessibility = '';
    try { accessibility = responseText(await this.callTool('accessibility', { action: 'observe_summary', dry_run: true }, 15_000)); } catch { accessibility = ''; }
    let imageBase64: string | null = null;
    if (requireVisual) {
      try {
        const capture = await this.callTool('computer_use', { workspaceId, action: 'snapshot', capture: 'display' }, 25_000);
        imageBase64 = responseImage(capture)?.data ?? null;
      } catch { imageBase64 = null; }
    }
    if (requireVisual && !accessibility && !imageBase64) throw new Error('AWH_DEVICE_VISUAL_PERMISSION_REQUIRED');
    return { workspaceId, text: accessibility, imageBase64, imageMimeType: imageBase64 ? 'image/png' : null };
  }

  async execute(action: DeviceAction, workspaceId: string): Promise<string> {
    if (action.tool === 'finish') return boundedText(action.summary) || 'AWH device task completed';
    const args: Record<string, unknown> = { ...action.arguments };
    if (['computer_use', 'shell'].includes(action.tool) && args.workspaceId === undefined) args.workspaceId = workspaceId;
    if (['accessibility', 'input_event'].includes(action.tool) && args.userConfirmed === undefined) args.userConfirmed = true;
    const response = await this.callTool(action.tool, args, action.tool === 'shell' ? 120_000 : 30_000);
    const record = response && typeof response === 'object' && !Array.isArray(response) ? response as Record<string, unknown> : {};
    const result = record.result && typeof record.result === 'object' && !Array.isArray(record.result) ? record.result as Record<string, unknown> : {};
    if (result.isError === true) throw new Error('AWH_DEVICE_TOOL_FAILED: ' + boundedText(responseText(response)));
    return boundedText(responseText(response) || JSON.stringify(structuredValue(response) ?? {}));
  }

  close(): void {
    this.lines.close();
    this.rejectAll(new Error('AWH_DEVICE_RUNTIME_CLOSED'));
    if (!this.process.killed) this.process.kill();
  }
}
