import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { once } from 'node:events';

const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_CONTENT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILES = 10_000;

function safeRelativePath(value: string): string {
  const path = value.replace(/\\/g, '/');
  if (!path || path.length > 900 || path.startsWith('/') || /^[A-Za-z]:\//.test(path) || /[\0-\x1f\x7f]/.test(path)) throw new Error('Vault archive path is invalid');
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.length > 180)) throw new Error('Vault archive path is invalid');
  const base = parts.at(-1)!.toLowerCase();
  const restrictedKey = /(?:^|[._-])(?:id_rsa|id_ed25519|private[_-]?key)(?:[._-]|$)|\.(?:pem|key|p12|pfx)$/.test(base);
  const secretPayload = /(?:^|[._-])(?:credentials?|secrets?|tokens?)(?:[._-]|$)/.test(base) && /\.(?:json|ya?ml|txt|ini|conf|cfg|properties|db|sqlite)$/.test(base);
  if (base === '.env' || restrictedKey || secretPayload || path.toLowerCase().includes('/.ssh/')) throw new Error('Vault archive contains restricted content');
  return path;
}

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) { let value = index; for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); table[index] = value >>> 0; }
  return table;
}
const CRC_TABLE = crcTable();
function crc32Update(crc: number, bytes: Uint8Array): number { let value = crc; for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8); return value >>> 0; }

async function checksum(path: string): Promise<{ size: number; crc32: number; sha256: string }> {
  const info = await stat(path); if (!info.isFile() || info.size < 0 || info.size > MAX_FILE_BYTES) throw new Error('Vault task file is invalid');
  const hash = createHash('sha256'); let crc = 0xffffffff;
  for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); hash.update(bytes); crc = crc32Update(crc, bytes); }
  return { size: info.size, crc32: (crc ^ 0xffffffff) >>> 0, sha256: hash.digest('hex') };
}

async function write(stream: ReturnType<typeof createWriteStream>, bytes: Buffer): Promise<void> { if (!stream.write(bytes)) await once(stream, 'drain'); }

async function copyFile(stream: ReturnType<typeof createWriteStream>, path: string): Promise<void> { for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) await write(stream, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); }

interface ArchiveEntry { path: string; physical: string; size: number; crc32: number; offset: number; }

async function collectWorkspace(root: string): Promise<ArchiveEntry[]> {
  const absolute = resolve(root); const rootInfo = await lstat(absolute); if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Vault task workspace is invalid');
  const output: ArchiveEntry[] = []; let total = 0;
  async function visit(directory: string): Promise<void> {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const physical = join(directory, item.name); const info = await lstat(physical);
      if (info.isSymbolicLink()) throw new Error('Vault task workspace contains a link');
      if (info.isDirectory()) { await visit(physical); continue; }
      if (!info.isFile()) throw new Error('Vault task workspace contains unsupported content');
      const rel = safeRelativePath(relative(absolute, physical).split(sep).join('/'));
      const data = await checksum(physical); total += data.size;
      if (output.length >= MAX_FILES || total > MAX_CONTENT_BYTES) throw new Error('Vault task workspace exceeds its safe limit');
      output.push({ path: rel, physical, size: data.size, crc32: data.crc32, offset: 0 });
    }
  }
  await visit(absolute); if (!output.length) throw new Error('Vault task workspace has no usable files');
  return output.sort((a, b) => a.path.localeCompare(b.path));
}

/** Creates a standards-compliant stored ZIP without shelling out or relying
 * on a platform-specific archive utility. */
export async function createVaultCandidateArchive(workspace: string, archive: string): Promise<{ sha256: string; sizeBytes: number; fileCount: number }> {
  const entries = await collectWorkspace(workspace); await mkdir(dirname(archive), { recursive: true, mode: 0o700 });
  const stream = createWriteStream(archive, { flags: 'wx', mode: 0o600 }); let offset = 0;
  try {
    for (const entry of entries) {
      const name = Buffer.from(entry.path, 'utf8'); const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0, 6); header.writeUInt16LE(0, 8); header.writeUInt16LE(0, 10); header.writeUInt16LE(0, 12); header.writeUInt32LE(entry.crc32, 14); header.writeUInt32LE(entry.size, 18); header.writeUInt32LE(entry.size, 22); header.writeUInt16LE(name.length, 26); header.writeUInt16LE(0, 28);
      entry.offset = offset; await write(stream, header); await write(stream, name); await copyFile(stream, entry.physical); offset += header.length + name.length + entry.size;
    }
    const centralOffset = offset;
    for (const entry of entries) {
      const name = Buffer.from(entry.path, 'utf8'); const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0, 8); header.writeUInt16LE(0, 10); header.writeUInt16LE(0, 12); header.writeUInt16LE(0, 14); header.writeUInt32LE(entry.crc32, 16); header.writeUInt32LE(entry.size, 20); header.writeUInt32LE(entry.size, 24); header.writeUInt16LE(name.length, 28); header.writeUInt16LE(0, 30); header.writeUInt16LE(0, 32); header.writeUInt16LE(0, 34); header.writeUInt16LE(0, 36); header.writeUInt32LE(0, 38); header.writeUInt32LE(entry.offset, 42);
      await write(stream, header); await write(stream, name); offset += header.length + name.length;
    }
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(offset - centralOffset, 12); end.writeUInt32LE(centralOffset, 16); end.writeUInt16LE(0, 20); await write(stream, end); stream.end(); await once(stream, 'finish');
    const result = await checksum(archive); if (result.size > MAX_ARCHIVE_BYTES) throw new Error('Vault candidate archive exceeds its safe limit'); return { sha256: result.sha256, sizeBytes: result.size, fileCount: entries.length };
  } catch (error) { stream.destroy(); await rm(archive, { force: true }); throw error; }
}

/** Extracts only the non-compressed archive layout that AWH itself emits.
 * Rejecting compression/data descriptors/links keeps the worker boundary
 * simple and prevents an archive from becoming an execution primitive. */
export async function extractVaultWorkspaceArchive(archive: string, workspace: string): Promise<void> {
  const archiveInfo = await stat(archive); if (!archiveInfo.isFile() || archiveInfo.size < 1 || archiveInfo.size > MAX_ARCHIVE_BYTES) throw new Error('Vault task archive is invalid');
  if (await lstat(dirname(workspace)).catch(() => null) === null) await mkdir(dirname(workspace), { recursive: true, mode: 0o700 });
  await mkdir(workspace, { recursive: false, mode: 0o700 }); const handle = await open(archive, 'r'); let position = 0; let count = 0; let total = 0;
  try {
    while (position + 4 <= archiveInfo.size) {
      const probe = Buffer.alloc(30); const read = await handle.read(probe, 0, probe.length, position); if (read.bytesRead < 4) throw new Error('Vault task archive is truncated'); const signature = probe.readUInt32LE(0);
      if (signature === 0x02014b50 || signature === 0x06054b50) break;
      if (signature !== 0x04034b50 || read.bytesRead !== 30 || probe.readUInt16LE(6) !== 0 || probe.readUInt16LE(8) !== 0) throw new Error('Vault task archive format is forbidden');
      const crc = probe.readUInt32LE(14); const size = probe.readUInt32LE(18); const compressed = probe.readUInt32LE(22); const nameLength = probe.readUInt16LE(26); const extraLength = probe.readUInt16LE(28);
      if (size !== compressed || size > MAX_FILE_BYTES || nameLength < 1 || nameLength > 900 || count >= MAX_FILES || (total += size) > MAX_CONTENT_BYTES) throw new Error('Vault task archive exceeds its safe limit');
      const nameBuffer = Buffer.alloc(nameLength); if ((await handle.read(nameBuffer, 0, nameLength, position + 30)).bytesRead !== nameLength) throw new Error('Vault task archive is truncated'); const path = safeRelativePath(nameBuffer.toString('utf8'));
      const target = join(workspace, ...path.split('/')); if (!resolve(target).startsWith(resolve(workspace) + sep)) throw new Error('Vault task archive path is unsafe'); await mkdir(dirname(target), { recursive: true, mode: 0o700 }); const out = await open(target, 'wx', 0o600);
      let remaining = size; let source = position + 30 + nameLength + extraLength; let calculated = 0xffffffff;
      try { while (remaining > 0) { const chunk = Buffer.alloc(Math.min(64 * 1024, remaining)); const segment = await handle.read(chunk, 0, chunk.length, source); if (segment.bytesRead !== chunk.length) throw new Error('Vault task archive is truncated'); await out.write(chunk); calculated = crc32Update(calculated, chunk); source += chunk.length; remaining -= chunk.length; } } finally { await out.close(); }
      if (((calculated ^ 0xffffffff) >>> 0) !== crc) throw new Error('Vault task archive checksum is invalid'); position = source; count += 1;
    }
    if (!count) throw new Error('Vault task archive has no usable files');
  } catch (error) { await rm(workspace, { recursive: true, force: true }); throw error; } finally { await handle.close(); }
}
