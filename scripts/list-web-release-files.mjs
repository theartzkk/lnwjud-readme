#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { consumeDesktopReuseFallbacks } from './release/desktop-reuse-fallback.mjs';

const root = resolve(process.cwd());
const contract = JSON.parse(await readFile(resolve(root, 'scripts/web-release-files.json'), 'utf8'));
if (!Array.isArray(contract.required) || contract.required.some((item) => typeof item !== 'string' || !item || item.includes('..') || item.startsWith('/'))) {
  throw new Error('AWH web release file contract is invalid');
}
for (const path of contract.required) process.stdout.write(`dist-web/${path}\n`);
process.stdout.write('dist-web/release.json\n');
if (process.env.AWH_REUSE_REMOTE_DESKTOP_ARTIFACTS === '1' && process.env.AWH_DEPLOY_TRANSPORT === 'local') {
  const releaseSha = process.env.AWH_RELEASE_COMMIT ?? '';
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error('Desktop reuse fallback release SHA is invalid');
  for (const path of await consumeDesktopReuseFallbacks({ releaseSha })) process.stdout.write(`dist-web/${path}\n`);
}
