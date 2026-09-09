#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const contract = JSON.parse(await readFile(resolve(root, 'scripts/web-release-files.json'), 'utf8'));
if (!Array.isArray(contract.required) || contract.required.some((item) => typeof item !== 'string' || !item || item.includes('..') || item.startsWith('/'))) {
  throw new Error('AWH web release file contract is invalid');
}
for (const path of contract.required) process.stdout.write(`dist-web/${path}\n`);
process.stdout.write('dist-web/release.json\n');
