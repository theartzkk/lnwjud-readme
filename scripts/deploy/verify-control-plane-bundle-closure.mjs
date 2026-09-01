import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? '');
const files = process.argv.slice(3);
if (files.length === 0) {
  console.error('CONTROL_BUNDLE_CLOSURE_EMPTY');
  process.exit(1);
}

const normalized = new Set(files.map((file) => file.replaceAll('\\', '/')));
const failures = [];
const dependencyPatterns = [
  { pattern: /(?:require|require_once|include|include_once)\s+__DIR__\s*\.\s*['"]\/([^'"]+)['"]/g, base: (sourcePath) => dirname(sourcePath) },
  { pattern: /(?:require|require_once|include|include_once)\s+dirname\(__DIR__\)\s*\.\s*['"]\/([^'"]+)['"]/g, base: (sourcePath) => resolve(dirname(sourcePath), '..') },
];

for (const file of normalized) {
  if (file.includes('\0') || isAbsolute(file) || file.split('/').includes('..')) {
    failures.push(`${file} -> unsafe bundle path`);
    continue;
  }
  if (!file.endsWith('.php')) continue;

  const sourcePath = resolve(root, file);
  let source;
  try { source = await readFile(sourcePath, 'utf8'); }
  catch { failures.push(`${file} -> source missing`); continue; }
  for (const { pattern, base } of dependencyPatterns) {
   for (const match of source.matchAll(pattern)) {
    const dependencyPath = resolve(base(sourcePath), match[1]);
    const dependencyRelative = relative(root, dependencyPath);
    if (dependencyRelative === '' || dependencyRelative === '..' || dependencyRelative.startsWith(`..${sep}`) || isAbsolute(dependencyRelative)) {
      failures.push(`${file} -> dependency escapes source root`);
      continue;
    }
    const dependency = dependencyRelative.split(sep).join('/');
    try { await readFile(dependencyPath, 'utf8'); }
    catch { failures.push(`${file} -> missing source ${dependency}`); continue; }
    if (!normalized.has(dependency)) failures.push(`${file} -> unbundled ${dependency}`);
   }
  }
}

if (failures.length > 0) {
  for (const failure of [...new Set(failures)].sort()) console.error(`CONTROL_BUNDLE_CLOSURE_FAILED ${failure}`);
  process.exit(1);
}

console.log(`CONTROL_BUNDLE_CLOSURE=PASS files=${normalized.size}`);
