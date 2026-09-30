import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface as ReadLineInterface } from 'node:readline';
import { activateToolPackAfterSmoke, ensureToolPackReady, toolPackForCapability, type ToolPackDefinition } from './tool-pack-runtime.js';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_TOOL_COUNT = 512;

export interface ToolPackToolSummary {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolPackCallResult {
  text: string;
  imageBase64: string | null;
  imageMimeType: 'image/png' | null;
}

function cleanText(value: unknown, max = 500): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}

function responseError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'MCP_RESPONSE_INVALID';
  const row = value as Record<string, unknown>;
  if (row.error && typeof row.error === 'object' && !Array.isArray(row.error)) {
    const message = cleanText((row.error as Record<string, unknown>).message, 1000);
    return message || 'MCP_TOOL_FAILED';
  }
  const result = row.result;
  if (result && typeof result === 'object' && !Array.isArray(result) && (result as Record<string, unknown>).isError === true) {
    const content = (result as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      const text = content.map((item) => item && typeof item === 'object' && !Array.isArray(item) ? cleanText((item as Record<string, unknown>).text, 800) : '').filter(Boolean).join(' ');
      return text || 'MCP_TOOL_FAILED';
    }
    return 'MCP_TOOL_FAILED';
  }
  return null;
}

export class ToolPackClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: ReadLineInterface;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private sequence = 0;
  private closed = false;
  private stderr = '';

  private constructor(readonly id: string, command: string, args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}) {
    this.child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['pipe','pipe','pipe'],
      env: { ...process.env, ...extraEnv, AWH_TOOL_PACK_ID: id, AWH_TOOL_PACK_MODE: 'managed' },
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', (line) => this.accept(line));
    this.child.stderr.on('data', (chunk: Buffer | string) => {
      if (this.stderr.length < 16 * 1024) this.stderr += String(chunk).slice(0, 16 * 1024 - this.stderr.length);
    });
    this.child.once('error', (error) => this.rejectAll(error));
    this.child.once('exit', (code) => {
      if (!this.closed) this.rejectAll(new Error('TOOL_PACK_EXIT_' + String(code ?? -1)));
    });
  }

  static async open(capability: string): Promise<ToolPackClient> {
    const pack = toolPackForCapability(capability);
    if (!pack) throw new Error('TOOL_PACK_CAPABILITY_UNKNOWN');
    const state = await ensureToolPackReady(pack);
    if (!state.verified || !state.hostReady || !state.connectorReady || !state.node || !state.entry) throw new Error(state.reason || 'TOOL_PACK_UNAVAILABLE');
    const client = new ToolPackClient(pack.id, state.node, [state.entry, ...pack.args], state.root);
    try {
      const initialized = await client.request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'AWH Agent Tool Fabric', version: '1' },
      }, 20_000);
      const error = responseError(initialized);
      if (error) throw new Error('TOOL_PACK_INITIALIZE_FAILED:' + error);
      client.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
      const smokeTools = await client.listTools();
      if (smokeTools.length < 1) throw new Error('TOOL_PACK_SMOKE_EMPTY');
      await activateToolPackAfterSmoke(pack, state);
      return client;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  static async openManaged(id: string, command: string, args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<ToolPackClient> {
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id) || typeof command !== 'string' || command.length < 1 || command.length > 500 || !Array.isArray(args) || args.length > 32 || args.some((arg) => typeof arg !== 'string' || arg.length > 500)) throw new Error('TOOL_PACK_MANAGED_LAUNCH_INVALID');
    const client = new ToolPackClient(id, command, args, cwd, extraEnv);
    try {
      const initialized = await client.request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'AWH Agent Tool Fabric', version: '1' },
      }, 20_000);
      const error = responseError(initialized);
      if (error) throw new Error('TOOL_PACK_INITIALIZE_FAILED:' + error);
      client.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
      const smokeTools = await client.listTools();
      if (smokeTools.length < 1) throw new Error('TOOL_PACK_SMOKE_EMPTY');
      return client;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  private accept(line: string): void {
    if (!line.trim().startsWith('{') || line.length > MAX_RESPONSE_BYTES) return;
    let value: unknown;
    try { value = JSON.parse(line); } catch { return; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const id = (value as Record<string, unknown>).id;
    if (typeof id !== 'number') return;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(value);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private request(method: string, params: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('TOOL_PACK_CLOSED'));
    const id = ++this.sequence;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    if (payload.length > 2 * 1024 * 1024) return Promise.reject(new Error('TOOL_PACK_REQUEST_TOO_LARGE'));
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('TOOL_PACK_TIMEOUT'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(payload + '\n');
    });
  }

  async listTools(): Promise<ToolPackToolSummary[]> {
    const response = await this.request('tools/list', {}, 30_000);
    const error = responseError(response);
    if (error) throw new Error('TOOL_PACK_LIST_FAILED:' + error);
    const result = response && typeof response === 'object' && !Array.isArray(response) ? (response as Record<string, unknown>).result : null;
    const raw = result && typeof result === 'object' && !Array.isArray(result) ? (result as Record<string, unknown>).tools : null;
    if (!Array.isArray(raw) || raw.length > MAX_TOOL_COUNT) throw new Error('TOOL_PACK_TOOL_CATALOG_INVALID');
    const tools: ToolPackToolSummary[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const name = typeof row.name === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(row.name) ? row.name : null;
      if (!name) continue;
      const schema = row.inputSchema && typeof row.inputSchema === 'object' && !Array.isArray(row.inputSchema) ? row.inputSchema as Record<string, unknown> : {};
      tools.push({ name, description: cleanText(row.description, 360), inputSchema: schema });
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs = 120_000): Promise<ToolPackCallResult> {
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(name)) throw new Error('TOOL_PACK_TOOL_NAME_INVALID');
    const response = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    const error = responseError(response);
    if (error) throw new Error('TOOL_PACK_TOOL_FAILED:' + error);
    const result = response && typeof response === 'object' && !Array.isArray(response) ? (response as Record<string, unknown>).result : null;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return { text: '{}', imageBase64: null, imageMimeType: null };
    const content = (result as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      return { text: JSON.stringify((result as Record<string, unknown>).structuredContent ?? {}).slice(0, 32 * 1024), imageBase64: null, imageMimeType: null };
    }
    const texts: string[] = [];
    let imageBase64: string | null = null;
    for (const item of content) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      if (row.type === 'text') {
        const value = cleanText(row.text, 16 * 1024); if (value) texts.push(value); continue;
      }
      if (row.type === 'resource' && row.resource && typeof row.resource === 'object' && !Array.isArray(row.resource)) {
        const value = cleanText((row.resource as Record<string, unknown>).text, 16 * 1024); if (value) texts.push(value); continue;
      }
      if (imageBase64 === null && row.type === 'image' && row.mimeType === 'image/png' && typeof row.data === 'string' && row.data.length <= 2 * 1024 * 1024 && /^[A-Za-z0-9+/=]+$/.test(row.data)) imageBase64 = row.data;
    }
    const fallback = JSON.stringify((result as Record<string, unknown>).structuredContent ?? {}).slice(0, 32 * 1024);
    return { text: texts.join('\n').slice(0, 32 * 1024) || fallback || '{}', imageBase64, imageMimeType: imageBase64 === null ? null : 'image/png' };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.lines.close();
    this.rejectAll(new Error('TOOL_PACK_CLOSED'));
    if (!this.child.killed) this.child.kill();
  }
}
