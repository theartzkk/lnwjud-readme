import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { buildPackagedMcpCommand, inspectTunnelReadiness, packagedMcpPaths } from '../src/tunnel.js';

const VALID_TUNNEL_ID = 'tunnel_0123456789abcdef0123456789abcd';

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

test('tunnel readiness requires explicit binary, restricted runtime key, tunnel id and packaged MCP layout', async (t) => {
  const fixture = await packagedFixture(t);
  const secret = 'runtime_secret_must_never_be_returned';
  const status = await inspectTunnelReadiness(fixture.workspace, fixture.appExecutable, {
    ...process.env,
    TUNNEL_CLIENT_BIN: process.execPath,
    CONTROL_PLANE_API_KEY: secret,
    CONTROL_PLANE_TUNNEL_ID: VALID_TUNNEL_ID,
  });

  assert.equal(status.binaryConfigured, true);
  assert.equal(status.binaryReady, true);
  assert.ok(status.binaryVersion);
  assert.equal(status.runtimeKeyPresent, true);
  assert.equal(status.tunnelIdPresent, true);
  assert.equal(status.tunnelIdValid, true);
  assert.equal(status.tunnelId, VALID_TUNNEL_ID);
  assert.equal(status.packagedMcpReady, true);
  assert.equal(status.ready, true);
  assert.deepEqual(status.blockers, []);
  assert.match(status.mcpCommand ?? '', /--remote-tunnel/);
  assert.doesNotMatch(JSON.stringify(status), new RegExp(secret));
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
  assert.equal(status.ready, false);
  assert.ok(status.blockers.includes('TUNNEL_CLIENT_BIN is not configured'));
  assert.ok(status.blockers.includes('CONTROL_PLANE_API_KEY is not present'));
});

test('relative tunnel-client configuration fails closed even if PATH may contain a candidate', async (t) => {
  const fixture = await packagedFixture(t);
  const status = await inspectTunnelReadiness(fixture.workspace, fixture.appExecutable, {
    PATH: process.env.PATH,
    TUNNEL_CLIENT_BIN: 'tunnel-client',
    CONTROL_PLANE_API_KEY: 'runtime-key',
    CONTROL_PLANE_TUNNEL_ID: VALID_TUNNEL_ID,
  });

  assert.equal(status.binaryConfigured, true);
  assert.equal(status.binaryReady, false);
  assert.equal(status.ready, false);
  assert.ok(status.blockers.includes('TUNNEL_CLIENT_BIN must be an absolute path'));
});

test('malformed tunnel ids and unsafe command arguments fail closed', async (t) => {
  const fixture = await packagedFixture(t);
  const status = await inspectTunnelReadiness(fixture.workspace, fixture.appExecutable, {
    TUNNEL_CLIENT_BIN: process.execPath,
    CONTROL_PLANE_API_KEY: 'runtime-key',
    CONTROL_PLANE_TUNNEL_ID: 'tunnel_bad',
  });

  assert.equal(status.tunnelIdPresent, true);
  assert.equal(status.tunnelIdValid, false);
  assert.equal(status.ready, false);
  assert.ok(status.blockers.includes('CONTROL_PLANE_TUNNEL_ID is malformed'));
  assert.throws(() => buildPackagedMcpCommand(fixture.appExecutable, `${fixture.workspace}\nmalicious`), /must not contain NUL or newlines/);
});
