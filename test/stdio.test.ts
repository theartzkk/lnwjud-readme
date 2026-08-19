import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ART_AGENT_VERSION } from '../src/version.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const REMOTE_READONLY_TOOLS = [
  'git_diff',
  'git_log',
  'git_status',
  'health',
  'read_file',
  'search_text',
  'workspace_info',
  'workspace_tree',
] as const;

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface McpHarness {
  child: ChildProcessWithoutNullStreams;
  workspace: string;
  dataDir: string;
  stderr: () => string;
  stdoutLines: string[];
  request(method: string, params?: unknown): Promise<JsonRpcResponse>;
  notify(method: string, params?: unknown): void;
  close(): Promise<void>;
}

async function startMcp(extraArgs: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): Promise<McpHarness> {
  const workspace = await mkdtemp(join(tmpdir(), 'art-agent-stdio-workspace-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'art-agent-stdio-data-'));
  const child = spawn(process.execPath, [
    '--import',
    'tsx',
    'src/index.ts',
    '--workspace',
    workspace,
    ...extraArgs,
  ], {
    cwd: repoRoot,
    env: { ...process.env, ART_AGENT_DATA_DIR: dataDir, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stderr = '';
  let nextId = 1;
  let protocolError: Error | undefined;
  const stdoutLines: string[] = [];
  const pending = new Map<number, {
    resolve: (response: JsonRpcResponse) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    stdoutLines.push(line);
    let response: JsonRpcResponse;
    try {
      response = JSON.parse(line) as JsonRpcResponse;
    } catch (error) {
      protocolError = new Error(`Non-JSON stdout corrupted MCP stdio: ${line}; ${String(error)}`);
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(protocolError);
      }
      pending.clear();
      return;
    }
    if (typeof response.id !== 'number') return;
    const waiter = pending.get(response.id);
    if (!waiter) return;
    pending.delete(response.id);
    clearTimeout(waiter.timer);
    waiter.resolve(response);
  });

  child.once('exit', (code) => {
    if (pending.size === 0) return;
    const error = protocolError ?? new Error(`MCP process exited with code=${code}; stderr=${stderr}`);
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  });

  return {
    child,
    workspace,
    dataDir,
    stderr: () => stderr,
    stdoutLines,
    request(method, params) {
      if (protocolError) return Promise.reject(protocolError);
      const id = nextId;
      nextId += 1;
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`);
      return new Promise<JsonRpcResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for ${method}; stdout=${stdoutLines.join(' | ')}; stderr=${stderr}`));
        }, 8_000);
        pending.set(id, { resolve, reject, timer });
      });
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })}\n`);
    },
    async close() {
      child.stdin.end();
      if (!child.killed) child.kill();
      lines.close();
      await Promise.all([
        rm(workspace, { recursive: true, force: true }),
        rm(dataDir, { recursive: true, force: true }),
      ]);
    },
  };
}

async function initialize(harness: McpHarness): Promise<void> {
  const response = await harness.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'art-agent-test', version: '1.0.0' },
  });
  assert.equal(response.jsonrpc, '2.0');
  assert.equal((response.result as { serverInfo?: { name?: string } } | undefined)?.serverInfo?.name, 'art-agent');
  assert.equal((response.result as { serverInfo?: { version?: string } } | undefined)?.serverInfo?.version, ART_AGENT_VERSION);
  harness.notify('notifications/initialized', {});
}

test('stdio entrypoint returns valid MCP JSON-RPC without stdout noise', async () => {
  const harness = await startMcp();
  try {
    await initialize(harness);
    assert.match(harness.stderr(), new RegExp(`Art Agent MCP ${ART_AGENT_VERSION.replaceAll('.', '\\.')} running on stdio`));
    assert.equal(harness.stdoutLines.length, 1);
    for (const line of harness.stdoutLines) assert.doesNotThrow(() => JSON.parse(line));
  } finally {
    await harness.close();
  }
});

test('remote tunnel profile exposes exactly the read-only tools even when local permissions are enabled', async () => {
  const harness = await startMcp(['--remote-tunnel'], {
    ART_AGENT_ALLOW_WRITE: '1',
    ART_AGENT_ALLOW_EXEC: '1',
    ART_AGENT_ALLOW_CODEX: '1',
  });
  try {
    await initialize(harness);

    const listed = await harness.request('tools/list', {});
    assert.equal(listed.error, undefined);
    const names = ((listed.result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? [])
      .map((tool) => tool.name ?? '')
      .sort();
    assert.deepEqual(names, [...REMOTE_READONLY_TOOLS]);

    const healthResponse = await harness.request('tools/call', { name: 'health', arguments: {} });
    assert.equal(healthResponse.error, undefined);
    const healthText = ((healthResponse.result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content ?? [])
      .find((entry) => entry.type === 'text')?.text;
    assert.ok(healthText, 'health tool did not return text content');
    const health = JSON.parse(healthText) as Record<string, unknown>;
    assert.equal(health.profile, 'remote-readonly');
    assert.equal(health.allowWrite, false);
    assert.equal(health.allowExec, false);
    assert.equal(health.allowCodex, false);

    const forbidden = await harness.request('tools/call', {
      name: 'write_file',
      arguments: { path: 'should-not-exist.txt', content: 'blocked' },
    });
    assert.ok(forbidden.error, 'unregistered remote write_file call unexpectedly succeeded');
    assert.match(forbidden.error?.message ?? '', /tool|write_file|not found|unknown/i);

    assert.match(harness.stderr(), /profile=remote-readonly \| write=false \| exec=false \| codex=false/);
    for (const line of harness.stdoutLines) assert.doesNotThrow(() => JSON.parse(line));
  } finally {
    await harness.close();
  }
});

test('local profile retains local-only tool registrations', async () => {
  const harness = await startMcp([], {
    ART_AGENT_ALLOW_WRITE: '1',
    ART_AGENT_ALLOW_EXEC: '1',
    ART_AGENT_ALLOW_CODEX: '1',
  });
  try {
    await initialize(harness);
    const listed = await harness.request('tools/list', {});
    const names = new Set(
      ((listed.result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? []).map((tool) => tool.name ?? ''),
    );
    for (const name of ['write_file', 'apply_patch', 'project_command', 'task_stop', 'codex_run', 'audit_tail']) {
      assert.ok(names.has(name), `local profile lost ${name}`);
    }
  } finally {
    await harness.close();
  }
});
