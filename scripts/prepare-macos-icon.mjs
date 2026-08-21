#!/usr/bin/env node

import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const source = resolve(ROOT, 'logo-256x256.png');
const target = resolve(process.env.AWH_MAC_ICON_OUT?.trim() || join(ROOT, '.awh-build', 'awh.icns'));

function run(executable, args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, { cwd: ROOT, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { if (stderr.length < 2_000) stderr += chunk.slice(0, 2_000 - stderr.length); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolveResult() : reject(new Error(`icon tool failed (${code}): ${stderr.trim().slice(0, 240)}`)));
  });
}

if (process.platform !== 'darwin') throw new Error('macOS icon preparation requires macOS');
if (!target.startsWith('/')) throw new Error('AWH_MAC_ICON_OUT must be an absolute path');
await access(source, constants.R_OK);
await mkdir(dirname(target), { recursive: true, mode: 0o700 });
await run('/usr/bin/sips', ['-s', 'format', 'icns', source, '--out', target]);
console.log(target);
