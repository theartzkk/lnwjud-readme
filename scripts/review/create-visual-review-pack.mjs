import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const node = process.execPath;
const commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const evidence = resolve(ROOT, `.awh-local/review/history/${commit.slice(0, 12)}`);
const output = process.argv[2] ? resolve(process.argv[2]) : undefined;
const dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
if (dirty) throw new Error('Visual review pack requires a clean committed working tree');

function run(command, args, env = process.env) {
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit', env, maxBuffer: 32 * 1024 * 1024 });
}

run(npm, ['run', 'web:build:control']);
run(node, ['scripts/review/render-ai-review-scenarios.mjs', evidence]);
if (!existsSync(join(evidence, 'VISUAL_EVIDENCE.json'))) throw new Error('visual evidence was not generated');
const packArgs = ['scripts/review/create-ai-review-pack.mjs'];
if (output) packArgs.push(output);
run(node, packArgs, { ...process.env, AWH_AI_REVIEW_EVIDENCE_DIR: evidence });
process.stdout.write(JSON.stringify({ status: 'PASS', commit, evidence }, null, 2) + '\n');
