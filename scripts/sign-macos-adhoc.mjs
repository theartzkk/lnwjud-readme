import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const architecture = process.argv[2] ?? process.arch;
if (process.platform !== 'darwin') throw new Error('macOS signing must run on darwin');
if (!['x64', 'arm64'].includes(architecture)) throw new Error('unsupported macOS architecture');
const app = resolve('out', `AWH Agent-darwin-${architecture}`, 'AWH Agent.app');

function run(args) {
  const result = spawnSync('/usr/bin/codesign', args, { encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`codesign failed: ${args.join(' ')}`);
}

run(['--force', '--deep', '--sign', '-', '--timestamp=none', app]);
run(['--verify', '--deep', '--strict', '--verbose=2', app]);
console.log(`AWH_MACOS_ADHOC_SIGN=PASS ${architecture} ${app}`);
