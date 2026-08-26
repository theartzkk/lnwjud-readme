import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { evaluateReleaseReadiness } from '../../src/release-readiness.js';

const runFile = promisify(execFile);

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

const evidencePath = resolve(arg('--evidence') ?? 'release-evidence.json');
const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as { version?: unknown };
if (typeof packageJson.version !== 'string') throw new Error('PACKAGE_VERSION_INVALID');
const { stdout } = await runFile('git', ['rev-parse', 'HEAD'], { shell: false, windowsHide: true, maxBuffer: 4096 });
const gitSha = stdout.trim().toLowerCase();
const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
const readiness = evaluateReleaseReadiness(evidence, packageJson.version, gitSha);
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, version: packageJson.version, gitSha, ...readiness })}\n`);
if (readiness.status !== 'READY') process.exitCode = 2;
