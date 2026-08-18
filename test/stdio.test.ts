import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ART_AGENT_VERSION } from '../src/version.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('desktop main dispatches packaged MCP stdio mode without importing Electron UI', async () => {
  const dispatcher = await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../src/desktop/ui.ts', import.meta.url), 'utf8');
  assert.match(dispatcher, /--mcp-stdio/);
  assert.match(dispatcher, /import\('\.\/ui\.js'\)/);
  assert.match(dispatcher, /import\('\.\.\/stdio\.js'\)/);
  assert.doesNotMatch(dispatcher, /from ['"]electron['"]/);
  assert.match(ui, /from ['"]electron['"]/);
});

test('stdio entrypoint returns a valid MCP initialize response without stdout noise', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'art-agent-stdio-workspace-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'art-agent-stdio-data-'));
  const child = spawn(process.execPath, [
    '--import',
    'tsx',
    'src/index.ts',
    '--workspace',
    workspace,
  ], {
    cwd: repoRoot,
    env: { ...process.env, ART_AGENT_DATA_DIR: dataDir },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  try {
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'art-agent-test', version: '1.0.0' },
      },
    };
    child.stdin.write(`${JSON.stringify(request)}\n`);

    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for MCP response. stdout=${stdout} stderr=${stderr}`)), 8_000);
      const inspect = () => {
        const line = stdout.split(/\r?\n/).find((value) => value.trim().length > 0);
        if (!line) return;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          clearTimeout(timer);
          resolve(parsed);
        } catch (error) {
          clearTimeout(timer);
          reject(new Error(`Non-JSON stdout corrupted MCP stdio: ${line}; ${String(error)}`));
        }
      };
      child.stdout.on('data', inspect);
      child.once('exit', (code) => {
        if (!stdout.trim()) {
          clearTimeout(timer);
          reject(new Error(`MCP process exited before response: code=${code}; stderr=${stderr}`));
        }
      });
      inspect();
    });

    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, 1);
    const result = response.result as { serverInfo?: { name?: string; version?: string } } | undefined;
    assert.equal(result?.serverInfo?.name, 'art-agent');
    assert.equal(result?.serverInfo?.version, ART_AGENT_VERSION);
    assert.match(stderr, new RegExp(`Art Agent MCP ${ART_AGENT_VERSION.replaceAll('.', '\\.')} running on stdio`));
    const protocolLines = stdout.split(/\r?\n/).filter((line) => line.trim());
    assert.equal(protocolLines.length, 1, `Unexpected extra stdout lines: ${stdout}`);
  } finally {
    child.stdin.end();
    if (!child.killed) child.kill();
    await Promise.all([
      rm(workspace, { recursive: true, force: true }),
      rm(dataDir, { recursive: true, force: true }),
    ]);
  }
});
