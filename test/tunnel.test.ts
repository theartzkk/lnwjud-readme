import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  buildPackagedMcpCommand,
  connectTunnelRuntime,
  inspectTunnelReadiness,
  packagedMcpPaths,
  stopTunnelRuntime,
  tunnelRuntimeAlias,
  tunnelRuntimeEnvironment,
  tunnelRuntimeStatus,
  type TunnelBinaryProbe,
  type TunnelCommandRunner,
} from '../src/tunnel.js';

const VALID_TUNNEL_ID = 'tunnel_0123456789abcdef0123456789abcdef';
const VALID_RUNTIME_KEY = 'runtime_key-0123456789';
const TRUSTED_PROBE: TunnelBinaryProbe = async () => ({
  version: '0.0.0-test',
  help: 'Tunnel client for the OpenAI MCP control plane\n\nruntimes',
});

async function packagedFixture(t: TestContext): Promise<{ root: string; appExecutable: string; workspace: string }> {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-tunnel-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appExecutable = join(root, process.platform === 'win32' ? 'ArtAgent.exe' : 'ArtAgent');
  const workspace = join(root, 'workspace with spaces');
  const appAsar = join(dirname(appExecutable), 'resources', 'app.asar');
  await mkdir(dirname(appAsar), { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(appExecutable, 'fixture', 'utf8');
  await writeFile(appAsar, 'fixture', 'utf8');
  return { root, appExecutable, workspace };
}

function readyEnv(appExecutable: string): NodeJS.ProcessEnv {
  return {
    TUNNEL_CLIENT_BIN: appExecutable,
    CONTROL_PLANE_API_KEY: VALID_RUNTIME_KEY,
    CONTROL_PLANE_TUNNEL_ID: VALID_TUNNEL_ID,
    OPENAI_API_KEY: 'generic-openai-key-must-not-propagate',
    OPENAI_ADMIN_KEY: 'admin-key-must-not-propagate',
    CODEX_API_KEY: 'codex-key-must-not-propagate',
    NODE_OPTIONS: '--require malicious-preload.js',
    NODE_PATH: 'malicious-node-path',
    ART_AGENT_ALLOW_WRITE: '1',
    ART_AGENT_ALLOW_EXEC: '1',
    ART_AGENT_ALLOW_CODEX: '1',
  };
}

function statusJson(alias: string, options: {
  processRunning?: boolean;
  healthy?: boolean;
  ready?: boolean;
  runtimeState?: string;
} = {}): string {
  return JSON.stringify({
    alias,
    process_running: options.processRunning ?? true,
    healthy: options.healthy ?? true,
    ready: options.ready ?? true,
    runtime_state: options.runtimeState ?? 'ready',
  });
}

test('packaged MCP command is fixed to the packaged entrypoint and remote profile', async (t) => {
  const fixture = await packagedFixture(t);
  const paths = packagedMcpPaths(fixture.appExecutable);
  const command = buildPackagedMcpCommand(fixture.appExecutable, fixture.workspace);

  assert.equal(paths.appAsar, join(dirname(fixture.appExecutable), 'resources', 'app.asar'));
  assert.equal(paths.entrypoint, join(paths.appAsar, 'dist', 'index.js'));
  assert.match(command, /--remote-tunnel/);
  assert.match(command, /--workspace/);
  assert.match(command, /app\.asar/);
  assert.match(command, /dist.*index\.js/);
  assert.doesNotMatch(command, /(?:^|\s)(?:cmd|powershell|pwsh|sh|bash)(?:\.exe)?(?:\s|$)/i);
  assert.ok(command.startsWith('"') && command.endsWith('"'));
});

test('tunnel readiness requires explicit trusted binary, restricted runtime key, tunnel id and packaged MCP layout', async (t) => {
  const fixture = await packagedFixture(t);
  const secret = 'runtime_secret_must_never_be_returned';
  const status = await inspectTunnelReadiness(fixture.workspace, fixture.appExecutable, {
    TUNNEL_CLIENT_BIN: fixture.appExecutable,
    CONTROL_PLANE_API_KEY: secret,
    CONTROL_PLANE_TUNNEL_ID: VALID_TUNNEL_ID,
  }, TRUSTED_PROBE);

  assert.equal(status.binaryConfigured, true);
  assert.equal(status.binaryReady, true);
  assert.equal(status.binaryVersion, '0.0.0-test');
  assert.equal(status.runtimeKeyPresent, true);
  assert.equal(status.runtimeKeyValid, true);
  assert.equal(status.tunnelIdPresent, true);
  assert.equal(status.tunnelIdValid, true);
  assert.equal(status.tunnelId, VALID_TUNNEL_ID);
  assert.equal(status.packagedMcpReady, true);
  assert.equal(status.ready, true);
  assert.deepEqual(status.blockers, []);
  assert.match(status.mcpCommand ?? '', /--remote-tunnel/);
  assert.doesNotMatch(JSON.stringify(status), new RegExp(secret));
});

test('tunnel readiness rejects a non-tunnel executable even when it can answer --version', async (t) => {
  const fixture = await packagedFixture(t);
  const status = await inspectTunnelReadiness(fixture.workspace, fixture.appExecutable, {
    TUNNEL_CLIENT_BIN: process.execPath,
    CONTROL_PLANE_API_KEY: VALID_RUNTIME_KEY,
    CONTROL_PLANE_TUNNEL_ID: VALID_TUNNEL_ID,
  });

  assert.equal(status.binaryConfigured, true);
  assert.equal(status.binaryReady, false);
  assert.equal(status.ready, false);
  assert.ok(status.blockers.some((blocker) => blocker.includes('binary identity does not match OpenAI tunnel-client')));
});

test('tunnel readiness does not select PATH implicitly and does not treat OPENAI_API_KEY as the runtime key', async (t) => {
  const fixture = await packagedFixture(t);
  const status = await inspectTunnelReadiness(fixture.workspace, fixture.appExecutable, {
    PATH: process.env.PATH,
    OPENAI_API_KEY: 'generic-key-must-not-enable-runtime',
    CONTROL_PLANE_TUNNEL_ID: VALID_TUNNEL_ID,
  });

  assert.equal(status.binaryConfigured, false);
  assert.equal(status.binaryReady, false);
  assert.equal(status.runtimeKeyPresent, false);
  assert.equal(status.runtimeKeyValid, false);
  assert.equal(status.ready, false);
  assert.ok(status.blockers.includes('TUNNEL_CLIENT_BIN is not configured'));
  assert.ok(status.blockers.includes('CONTROL_PLANE_API_KEY is not present'));
});

test('relative tunnel-client configuration fails closed even if PATH may contain a candidate', async (t) => {
  const fixture = await packagedFixture(t);
  const status = await inspectTunnelReadiness(fixture.workspace, fixture.appExecutable, {
    PATH: process.env.PATH,
    TUNNEL_CLIENT_BIN: 'tunnel-client',
    CONTROL_PLANE_API_KEY: VALID_RUNTIME_KEY,
    CONTROL_PLANE_TUNNEL_ID: VALID_TUNNEL_ID,
  }, TRUSTED_PROBE);

  assert.equal(status.binaryConfigured, true);
  assert.equal(status.binaryReady, false);
  assert.equal(status.ready, false);
  assert.ok(status.blockers.some((blocker) => blocker.includes('TUNNEL_CLIENT_BIN must be an absolute path')));
});

test('malformed tunnel ids, malformed runtime keys and unsafe command arguments fail closed', async (t) => {
  const fixture = await packagedFixture(t);
  const status = await inspectTunnelReadiness(fixture.workspace, fixture.appExecutable, {
    TUNNEL_CLIENT_BIN: fixture.appExecutable,
    CONTROL_PLANE_API_KEY: 'bad key with spaces',
    CONTROL_PLANE_TUNNEL_ID: 'tunnel_bad',
  }, TRUSTED_PROBE);

  assert.equal(status.runtimeKeyPresent, true);
  assert.equal(status.runtimeKeyValid, false);
  assert.equal(status.tunnelIdPresent, true);
  assert.equal(status.tunnelIdValid, false);
  assert.equal(status.ready, false);
  assert.ok(status.blockers.includes('CONTROL_PLANE_API_KEY is malformed'));
  assert.ok(status.blockers.includes('CONTROL_PLANE_TUNNEL_ID is malformed'));
  assert.throws(() => buildPackagedMcpCommand(fixture.appExecutable, `${fixture.workspace}\nmalicious`), /must not contain NUL or newlines/);
});

test('runtime alias is deterministic, path-private and workspace-specific', async (t) => {
  const fixture = await packagedFixture(t);
  const otherWorkspace = join(fixture.root, 'another workspace');
  await mkdir(otherWorkspace);
  const first = tunnelRuntimeAlias(fixture.workspace);
  const second = tunnelRuntimeAlias(fixture.workspace);
  const other = tunnelRuntimeAlias(otherWorkspace);

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^art-agent-[a-f0-9]{16}$/);
  assert.doesNotMatch(first, /workspace|art-agent-tunnel/i);
});

test('runtime child environment forces remote read-only Node mode and removes injection or generic API keys', () => {
  const env = tunnelRuntimeEnvironment({
    PATH: process.env.PATH,
    CONTROL_PLANE_API_KEY: VALID_RUNTIME_KEY,
    OPENAI_API_KEY: 'generic',
    OPENAI_ADMIN_KEY: 'admin',
    CODEX_API_KEY: 'codex',
    NODE_OPTIONS: '--require malicious.js',
    NODE_PATH: 'malicious',
    ART_AGENT_ALLOW_WRITE: '1',
    ART_AGENT_ALLOW_EXEC: '1',
    ART_AGENT_ALLOW_CODEX: '1',
    ELECTRON_RUN_AS_NODE: '0',
  });

  assert.equal(env.CONTROL_PLANE_API_KEY, VALID_RUNTIME_KEY);
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(env.ART_AGENT_ALLOW_WRITE, '0');
  assert.equal(env.ART_AGENT_ALLOW_EXEC, '0');
  assert.equal(env.ART_AGENT_ALLOW_CODEX, '0');
  for (const key of ['OPENAI_API_KEY', 'OPENAI_ADMIN_KEY', 'CODEX_API_KEY', 'NODE_OPTIONS', 'NODE_PATH']) {
    assert.equal(env[key], undefined, `${key} unexpectedly propagated`);
  }
});

test('managed connect uses fixed argv, secret reference and verifies status before reporting connected', async (t) => {
  const fixture = await packagedFixture(t);
  const alias = tunnelRuntimeAlias(fixture.workspace);
  const calls: Array<{ binary: string; args: string[]; cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv }> = [];
  const runner: TunnelCommandRunner = async (binary, args, cwd, timeoutMs, env) => {
    calls.push({ binary, args: [...args], cwd, timeoutMs, env: { ...env } });
    if (args[1] === 'connect') return { code: 0, stdout: JSON.stringify({ alias }), stderr: '' };
    if (args[1] === 'status') return { code: 0, stdout: statusJson(alias), stderr: '' };
    throw new Error(`Unexpected fake tunnel command: ${args.join(' ')}`);
  };

  const result = await connectTunnelRuntime(
    fixture.workspace,
    fixture.appExecutable,
    readyEnv(fixture.appExecutable),
    TRUSTED_PROBE,
    runner,
  );

  assert.equal(result.connectAccepted, true);
  assert.equal(result.connected, true);
  assert.equal(result.state, 'connected');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]?.args.slice(0, 4), ['runtimes', 'connect', '--alias', alias]);
  assert.deepEqual(calls[1]?.args, ['runtimes', 'status', alias, '--json']);
  const connectArgs = calls[0]?.args ?? [];
  assert.ok(connectArgs.includes('--tunnel-id'));
  assert.ok(connectArgs.includes(VALID_TUNNEL_ID));
  assert.ok(connectArgs.includes('--runtime-api-key'));
  assert.ok(connectArgs.includes('env:CONTROL_PLANE_API_KEY'));
  assert.ok(connectArgs.includes('--mcp-command'));
  const tunnelClientBinIndex = connectArgs.indexOf('--tunnel-client-bin');
  assert.ok(tunnelClientBinIndex >= 0);
  assert.equal(connectArgs[tunnelClientBinIndex + 1], calls[0]?.binary);
  assert.equal(connectArgs.at(-1), '--json');
  assert.doesNotMatch(JSON.stringify(connectArgs), new RegExp(VALID_RUNTIME_KEY));
  assert.equal(calls[0]?.env.CONTROL_PLANE_API_KEY, VALID_RUNTIME_KEY);
  assert.equal(calls[0]?.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(calls[0]?.env.ART_AGENT_ALLOW_WRITE, '0');
  assert.equal(calls[0]?.env.OPENAI_API_KEY, undefined);
  assert.equal(calls[0]?.env.NODE_OPTIONS, undefined);
});

test('connect exit zero is not reported connected until status is process-running, healthy and ready', async (t) => {
  const fixture = await packagedFixture(t);
  const alias = tunnelRuntimeAlias(fixture.workspace);
  let call = 0;
  const runner: TunnelCommandRunner = async (_binary, args) => {
    call += 1;
    if (args[1] === 'connect') return { code: 0, stdout: JSON.stringify({ alias }), stderr: '' };
    return {
      code: 0,
      stdout: statusJson(alias, { processRunning: true, healthy: false, ready: false, runtimeState: 'starting' }),
      stderr: '',
    };
  };

  const result = await connectTunnelRuntime(
    fixture.workspace,
    fixture.appExecutable,
    readyEnv(fixture.appExecutable),
    TRUSTED_PROBE,
    runner,
  );
  assert.equal(call, 2);
  assert.equal(result.connectAccepted, true);
  assert.equal(result.connected, false);
  assert.equal(result.state, 'starting');
  assert.equal(result.processRunning, true);
  assert.equal(result.healthy, false);
  assert.equal(result.ready, false);
});

test('managed status fails closed on malformed JSON or alias mismatch', async (t) => {
  const fixture = await packagedFixture(t);
  const env = readyEnv(fixture.appExecutable);
  const invalidJson: TunnelCommandRunner = async () => ({ code: 0, stdout: 'not-json', stderr: '' });
  await assert.rejects(
    () => tunnelRuntimeStatus(fixture.workspace, env, TRUSTED_PROBE, invalidJson),
    /invalid JSON/,
  );

  const wrongAlias: TunnelCommandRunner = async () => ({
    code: 0,
    stdout: statusJson('art-agent-wrong'),
    stderr: '',
  });
  await assert.rejects(
    () => tunnelRuntimeStatus(fixture.workspace, env, TRUSTED_PROBE, wrongAlias),
    /alias did not match/,
  );
});

test('managed connect fails before runner invocation when readiness is incomplete', async (t) => {
  const fixture = await packagedFixture(t);
  let invoked = false;
  const runner: TunnelCommandRunner = async () => {
    invoked = true;
    return { code: 0, stdout: '{}', stderr: '' };
  };
  await assert.rejects(
    () => connectTunnelRuntime(
      fixture.workspace,
      fixture.appExecutable,
      {
        TUNNEL_CLIENT_BIN: fixture.appExecutable,
        CONTROL_PLANE_TUNNEL_ID: VALID_TUNNEL_ID,
      },
      TRUSTED_PROBE,
      runner,
    ),
    /Tunnel is not ready/,
  );
  assert.equal(invoked, false);
});

test('managed stop targets only the deterministic alias and verifies the stopped status', async (t) => {
  const fixture = await packagedFixture(t);
  const alias = tunnelRuntimeAlias(fixture.workspace);
  const calls: string[][] = [];
  const runner: TunnelCommandRunner = async (_binary, args) => {
    calls.push([...args]);
    if (args[1] === 'stop') return { code: 0, stdout: JSON.stringify({ alias }), stderr: '' };
    if (args[1] === 'status') {
      return {
        code: 0,
        stdout: statusJson(alias, { processRunning: false, healthy: false, ready: false, runtimeState: 'stopped' }),
        stderr: '',
      };
    }
    throw new Error(`Unexpected fake tunnel command: ${args.join(' ')}`);
  };

  const result = await stopTunnelRuntime(
    fixture.workspace,
    readyEnv(fixture.appExecutable),
    TRUSTED_PROBE,
    runner,
  );
  assert.deepEqual(calls, [
    ['runtimes', 'stop', alias, '--json'],
    ['runtimes', 'status', alias, '--json'],
  ]);
  assert.equal(result.stopAccepted, true);
  assert.equal(result.connected, false);
  assert.equal(result.state, 'stopped');
  assert.equal(result.processRunning, false);
});
