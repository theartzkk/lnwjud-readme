#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '../..');
const commit = git(['rev-parse', 'HEAD']).trim();
const branch = git(['branch', '--show-current']).trim() || 'detached';
const dirty = git(['status', '--porcelain']).trim() !== '';
const output = resolve(process.argv[2] || join(ROOT, '..', `AWH-AI-REVIEW-${commit.slice(0, 12)}.zip`));
const stage = resolve(ROOT, '.tmp-ai-review-pack');
const evidenceDir = process.env.AWH_AI_REVIEW_EVIDENCE_DIR ? resolve(process.env.AWH_AI_REVIEW_EVIDENCE_DIR) : null;
const allowRoots = new Set(['web', 'hub', 'src', 'scripts', 'test', 'docs', 'deploy']);
const allowRootFiles = new Set(['README.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'electron-builder.yml']);
const denyPath = /(^|\/)(?:\.env(?:\.|$)|node_modules|\.git|\.awh-|dist|coverage|vendor|uploads?|backups?|secrets?|credentials?|private)(?:\/|$)|\.(?:pem|key|p12|pfx|sqlite|sqlite3|db|dump|zip|tar|gz|7z)$/i;
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/,
];

function git(args, encoding = 'utf8') {
  return execFileSync('git', ['-C', ROOT, ...args], { encoding: encoding === 'buffer' ? null : encoding, maxBuffer: 32 * 1024 * 1024 });
}
function selected(path) {
  if (denyPath.test(path)) return false;
  if (!path.includes('/')) return allowRootFiles.has(path) || path.endsWith('.md');
  return allowRoots.has(path.split('/')[0]);
}
function looksBinary(buffer) {
  if (buffer.length > 1024 * 1024) return true;
  return buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}
function containsSecret(buffer) {
  const text = buffer.toString('utf8');
  return secretPatterns.some((pattern) => pattern.test(text));
}
function writeStage(path, content) {
  const target = join(stage, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, { mode: 0o600 });
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true, mode: 0o700 });
const tracked = git(['ls-tree', '-r', '--name-only', commit]).split('\n').filter(Boolean);
const included = [];
const skipped = [];
for (const path of tracked) {
  if (!selected(path)) { skipped.push({ path, reason: 'PATH_POLICY' }); continue; }
  let content;
  try { content = git(['show', `${commit}:${path}`], 'buffer'); }
  catch { skipped.push({ path, reason: 'READ_FAILED' }); continue; }
  if (!Buffer.isBuffer(content)) content = Buffer.from(content);
  if (looksBinary(content)) { skipped.push({ path, reason: 'BINARY_OR_LARGE' }); continue; }
  if (containsSecret(content)) { skipped.push({ path, reason: 'SECRET_PATTERN' }); continue; }
  writeStage(join('source', path), content);
  included.push(path);
}

const revision = {
  schemaVersion: 1,
  project: 'Art’s Workspace Hub (AWH)',
  branch,
  commit,
  workingTreeDirtyAtGeneration: dirty,
  generatedAt: new Date().toISOString(),
  sourceMode: 'git-committed-content-only',
};
writeStage('CURRENT_REVISION.json', JSON.stringify(revision, null, 2));
writeStage('SOURCE_TREE.txt', included.join('\n') + '\n');
writeStage('SAFETY_MANIFEST.json', JSON.stringify({ schemaVersion: 1, includedCount: included.length, skipped, policies: ['NO_WORKING_TREE_CONTENT', 'NO_ENV_FILES', 'NO_DATABASES', 'NO_BACKUPS', 'NO_PRIVATE_KEYS', 'SECRET_PATTERN_SCAN'] }, null, 2));
for (const [target, source] of [['AWH-UX-CONSTITUTION.md','docs/AWH-UX-CONSTITUTION.md'],['VISUAL_SCENARIOS.json','scripts/review/visual-review-scenarios.json'],['FINDINGS_SCHEMA.json','scripts/review/aipass-findings.schema.json']]) {
  const content = readFileSync(join(ROOT, source));
  if (containsSecret(content)) throw new Error(`${source} unexpectedly contains a secret pattern`);
  writeStage(target, content);
}
writeStage('PROJECT_CONTEXT.md', `# AWH AI Review Pack\n\nThis pack is a sanitized, committed-source snapshot plus optional rendered evidence.\n\n## Review contract\n- CURRENT_REVISION.json is the source revision authority.\n- AWH-UX-CONSTITUTION.md is the UX contract.\n- Screenshots are visual evidence, not production-runtime proof.\n- Do not infer runtime health from source or fixture screenshots.\n- Prefer root-cause fixes and preserve canonical task/artifact/project authorities.\n- Never propose a parallel queue, issue database, project store, or memory authority.\n`);
writeStage('REVIEW_PROMPT.md', `# AIPass visual review prompt\n\nReview AWH from five perspectives: ChatGPT simplicity, Genspark agentic UX, Thai mobile usability, accessibility/recovery, and adversarial product critique. Treat screenshots and scenario metadata as primary UX evidence; request source snippets only when needed.\n\nFocus on defects and regressions, not praise. A normal question must receive a conversational answer; work should plan/execute/deliver in one conversation; artifacts should be first-class; L1/L2 must not expose backend vocabulary. Check 390x844 safe areas, navigation obstruction, composer friction, Stop/Retry, and artifact continuation.\n\nReturn JSON only and conform to FINDINGS_SCHEMA.json. A BLOCK verdict requires at least one reproducible P0 finding. Include exact sourcePaths only when the pack supports the implementation claim.\n`);

if (evidenceDir !== null) {
  if (!existsSync(evidenceDir) || !statSync(evidenceDir).isDirectory()) throw new Error('AWH_AI_REVIEW_EVIDENCE_DIR is not a directory');
  const rootReal = realpathSync(evidenceDir);
  const manifestPath = join(evidenceDir, 'VISUAL_EVIDENCE.json');
  if (!existsSync(manifestPath)) throw new Error('visual evidence manifest is missing');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest?.schemaVersion !== 1 || manifest?.commit !== commit || manifest?.dirty !== false) throw new Error('visual evidence does not match the clean committed revision');
  const copyEvidence = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const source = join(directory, entry.name); const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`visual evidence contains symlink: ${relative}`);
      const real = realpathSync(source); if (real !== rootReal && !real.startsWith(`${rootReal}/`)) throw new Error('visual evidence escaped its root');
      if (entry.isDirectory()) { copyEvidence(source, relative); continue; }
      if (!/^[A-Za-z0-9._/-]+$/.test(relative) || !/\.(?:png|json)$/i.test(relative)) continue;
      const info = lstatSync(source); const limit = relative.toLowerCase().endsWith('.png') ? 8 * 1024 * 1024 : 1024 * 1024;
      if (!info.isFile() || info.size < 1 || info.size > limit) throw new Error(`visual evidence file is invalid: ${relative}`);
      const content = readFileSync(source); if (relative.toLowerCase().endsWith('.json') && containsSecret(content)) throw new Error(`visual evidence metadata contains a secret pattern: ${relative}`);
      writeStage(join('visual-evidence', relative), content);
    }
  };
  copyEvidence(evidenceDir);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTimeDate(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}
function zipEntries(entries) {
  const local = []; const central = []; let offset = 0; const stamp = dosTimeDate();
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll('\\', '/'), 'utf8'); const raw = entry.data;
    const compressed = deflateRawSync(raw, { level: 6 }); const useDeflate = compressed.length < raw.length;
    const body = useDeflate ? compressed : raw; const method = useDeflate ? 8 : 0; const crc = crc32(raw); const flags = 0x0800;
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(flags, 6); head.writeUInt16LE(method, 8); head.writeUInt16LE(stamp.time, 10); head.writeUInt16LE(stamp.day, 12); head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(name.length, 26);
    local.push(head, name, body);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(flags, 8); dir.writeUInt16LE(method, 10); dir.writeUInt16LE(stamp.time, 12); dir.writeUInt16LE(stamp.day, 14); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(body.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, name); offset += head.length + name.length + body.length;
  }
  const centralBytes = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}
function collect(dir, prefix = '') {
  const entries = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name); const relative = prefix ? `${prefix}/${name}` : name;
    if (statSync(path).isDirectory()) entries.push(...collect(path, relative));
    else entries.push({ name: relative, data: readFileSync(path) });
  }
  return entries;
}

const entries = collect(stage);
if (entries.length < 10 || included.length < 5) throw new Error('AI review pack is unexpectedly empty');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, zipEntries(entries), { mode: 0o600 });
rmSync(stage, { recursive: true, force: true });
process.stdout.write(JSON.stringify({
  output,
  commit,
  branch,
  dirty,
  includedFiles: included.length,
  skippedFiles: skipped.length,
  bytes: statSync(output).size,
}, null, 2) + '\n');
