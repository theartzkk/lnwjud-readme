import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const architecture = process.argv[2] ?? process.arch;
if (process.platform !== 'darwin') throw new Error('macOS signing must run on darwin');
if (!['x64', 'arm64'].includes(architecture)) throw new Error('unsupported macOS architecture');

const app = resolve('out', `AWH Agent-darwin-${architecture}`, 'AWH Agent.app');
const identity = process.env.AWH_MAC_APP_SIGN_IDENTITY?.trim() || '';
const keychain = process.env.AWH_MAC_KEYCHAIN?.trim() || '';
const releaseMode = process.env.AWH_MAC_RELEASE_MODE?.trim() === 'production';

function run(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`${executable} failed: ${result.stderr || result.stdout}`);
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

if (identity) {
  const { signAsync } = await import('@electron/osx-sign');
  await signAsync({
    app,
    identity,
    ...(keychain ? { keychain } : {}),
    platform: 'darwin',
    hardenedRuntime: true,
    identityValidation: true,
  });
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const detail = run('/usr/bin/codesign', ['-dv', '--verbose=4', app]);
  if (!/Authority=Developer ID Application:/i.test(detail)) {
    throw new Error('AWH_MACOS_DEVELOPER_ID_APP_SIGNATURE_MISSING');
  }
  if (!/Runtime Version=/i.test(detail) && !/flags=.*runtime/i.test(detail)) {
    throw new Error('AWH_MACOS_HARDENED_RUNTIME_MISSING');
  }
  console.log(`AWH_MACOS_DEVELOPER_SIGN=PASS ${architecture} ${app}`);
} else {
  if (releaseMode) throw new Error('AWH_MAC_APP_SIGN_IDENTITY_REQUIRED');
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  console.log(`AWH_MACOS_ADHOC_SIGN=PASS ${architecture} ${app}`);
}
