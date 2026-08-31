#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const node = process.execPath;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const beforeDir = process.argv[2] ? resolve(process.argv[2]) : null;
const outputZip = process.argv[3] ? resolve(process.argv[3]) : undefined;
if (!beforeDir) throw new Error('usage: create-visual-verification-pack.mjs <before-evidence-dir> [output.zip]');
const dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
if (dirty) throw new Error('visual verification requires a clean committed working tree');
const commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const afterDir = resolve(ROOT, `.awh-local/review/history/${commit.slice(0, 12)}`);

function run(command, args, env = process.env) {
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit', env, maxBuffer: 32 * 1024 * 1024 });
}

run(npm, ['run', 'web:build:control']);
run(node, ['scripts/review/render-ai-review-scenarios.mjs', afterDir]);
if (!existsSync(join(afterDir, 'VISUAL_EVIDENCE.json'))) throw new Error('after evidence was not generated');
const beforeManifest = JSON.parse(readFileSync(join(beforeDir, 'VISUAL_EVIDENCE.json'), 'utf8'));
if (beforeManifest?.schemaVersion !== 1 || beforeManifest?.dirty !== false) throw new Error('before evidence is not a clean exact-revision capture');
const compareDir = resolve(ROOT, `.awh-local/review/compare/${beforeManifest.commit.slice(0, 12)}-to-${commit.slice(0, 12)}`);
run(node, ['scripts/review/compare-visual-evidence.mjs', beforeDir, afterDir, compareDir]);
const packArgs = ['scripts/review/create-ai-review-pack.mjs'];
if (outputZip) packArgs.push(outputZip);
run(node, packArgs, { ...process.env, AWH_AI_REVIEW_EVIDENCE_DIR: afterDir, AWH_AI_REVIEW_COMPARE_DIR: compareDir });
process.stdout.write(JSON.stringify({ status: 'PASS', before: beforeManifest.commit, after: commit, afterDir, compareDir, outputZip: outputZip || null }, null, 2) + '\n');
