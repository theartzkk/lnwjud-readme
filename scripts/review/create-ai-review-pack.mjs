#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '../..');
const commit = git(['rev-parse', 'HEAD']).trim();
const branch = git(['branch', '--show-current']).trim() || 'detached';
const dirty = git(['status', '--porcelain']).trim() !== '';
const output = resolve(process.argv[2] || join(ROOT, '..', `AWH-AI-REVIEW-${commit.slice(0, 12)}.zip`));
const stage = resolve(ROOT, '.tmp-ai-review-pack');
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
writeStage('PROJECT_CONTEXT.md', `# AWH AI Review Pack\n\nThis pack is a sanitized, committed-source snapshot of Art’s Workspace Hub.\n\n## Review contract\n- Treat CURRENT_REVISION.json as the revision authority for this pack.\n- Inspect source/ before making architectural claims.\n- Do not assume production runtime state from source alone.\n- Prefer root-cause fixes and preserve existing data contracts.\n- User-facing UX should describe intent and outcomes, not Agent/Executor/Worker/Provider/Job internals.\n- Do not propose a parallel source of truth or duplicate project data.\n\n## Safety\nThe generator excludes working-tree changes, environment files, databases, backups, private-key material, and files matching known live-secret patterns.\n`);
writeStage('REVIEW_PROMPT.md', `# Suggested review prompt\n\nAudit this AWH snapshot as a Senior Product Designer, UX Architect and Software Architect.\n\nGoal: AWH should feel as simple as ChatGPT for normal conversation while completing multi-step deliverables with the breadth of Genspark. Users should not need to understand model, agent, tool, executor, worker or provider internals.\n\nReview information architecture, Home, chat composer, task progress, artifacts, recovery, mobile safe areas, accessibility, architecture, data integrity and migration risk. Separate findings into P0/P1/P2. Cite exact source paths for every implementation-specific claim.\n`);

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
