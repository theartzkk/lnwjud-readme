import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { npmLaunchSpec } from '../scripts/qa/lib/npm-runtime.mjs';

test('Windows npm.cmd discovery launches the adjacent npm CLI through Node without a shell', () => {
  const result = npmLaunchSpec('C:\\Program Files\\nodejs\\npm.cmd', 'C:\\Program Files\\nodejs\\node.exe', 'win32');
  assert.equal(result.path, 'C:\\Program Files\\nodejs\\npm.cmd');
  assert.equal(result.executable, 'C:\\Program Files\\nodejs\\node.exe');
  assert.deepEqual(result.argsPrefix, ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js']);
  assert.match(result.source, /Windows npm\.cmd/);
});

test('native npm and npm-cli discovery remain shell-free', () => {
  assert.deepEqual(npmLaunchSpec('/usr/local/bin/npm', '/usr/local/bin/node', 'darwin'), {
    path: '/usr/local/bin/npm', executable: '/usr/local/bin/npm', argsPrefix: [], source: 'native executable',
  });
  assert.deepEqual(npmLaunchSpec('/usr/local/lib/node_modules/npm/bin/npm-cli.js', '/usr/local/bin/node', 'darwin'), {
    path: '/usr/local/lib/node_modules/npm/bin/npm-cli.js', executable: '/usr/local/bin/node', argsPrefix: ['/usr/local/lib/node_modules/npm/bin/npm-cli.js'], source: 'Node-adjacent npm CLI',
  });
});

test('local candidate QA accepts clean detached exact SHA while full QA keeps upstream identity', async () => {
  const source = await readFile(new URL('../scripts/qa/awh-local-qa.mjs', import.meta.url), 'utf8');
  assert.match(source, /const detached = branch\.code === 0 && branchName\.length === 0/);
  assert.match(source, /mode === 'local' \? baseValid && clean : baseValid && clean && validBranch && exactRemote/);
  assert.match(source, /DETACHED_EXACT_SHA/);
  assert.match(source, /rev-parse', '@\{u\}'/);
  assert.match(source, /head\.stdout === upstream\.stdout/);
  assert.doesNotMatch(source, /branchName === 'awh\/v0\.1-migration'/);
});


test('local QA resolves npm symlinks before choosing the launch runtime', async () => {
  const source = await readFile(new URL('../scripts/qa/awh-local-qa.mjs', import.meta.url), 'utf8');
  assert.match(source, /realpath\(candidate\)/);
  assert.match(source, /npmLaunchSpec\(resolvedCandidate, process\.execPath\)/);
});


test('local QA lockfile probe is isolated from the active workspace', async () => {
  const source = await readFile(new URL('../scripts/qa/awh-local-qa.mjs', import.meta.url), 'utf8');
  assert.match(source, /mkdtemp\(join\(tmpdir\(\), 'awh-lock-probe-'\)\)/);
  assert.match(source, /cwd: lockProbe/);
  assert.match(source, /rm\(lockProbe, \{ recursive: true, force: true \}\)/);
});


test('fast QA defers exact-revision deploy contracts only while the candidate is dirty', async () => {
  const source = await readFile(new URL('../scripts/qa/awh-local-qa.mjs', import.meta.url), 'utf8');
  assert.match(source, /fast-deploy-contracts/);
  assert.match(source, /runGit\(\['status', '--porcelain'\]\)/);
  assert.match(source, /deferred until the candidate is committed/);
  assert.match(source, /central-project-authority-deployment\.test\.ts/);
  assert.match(source, /automation-deployment\.test\.ts/);
});


test('local QA self-promotes to the bounded AWH Node runtime instead of failing on stale system Node', async () => {
  const source = await readFile(new URL('../scripts/qa/awh-local-qa.mjs', import.meta.url), 'utf8');
  assert.match(source, /AWH_NODE_RUNTIME/);
  assert.match(source, /\/opt\/awh-toolchain\/node\/bin\/node/);
  assert.match(source, /AWH_QA_REEXEC/);
  assert.match(source, /boundedMajor >= MIN_NODE_MAJOR/);
  assert.match(source, /AWH bounded Node runtime/);
});
