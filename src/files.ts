import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { pageText, type TextPage, type TextPageOptions } from './context.js';
import { assertNotSecret, resolveForRead, resolveForWrite } from './security.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache']);
const MAX_SEARCH_SNIPPET_CHARS = 500;

export interface SearchResult {
  path: string;
  line: number;
  text: string;
  truncated: boolean;
}

function searchSnippet(line: string, needle: string): Pick<SearchResult, 'text' | 'truncated'> {
  if (line.length <= MAX_SEARCH_SNIPPET_CHARS) return { text: line, truncated: false };

  const matchIndex = line.toLowerCase().indexOf(needle);
  const payloadLimit = MAX_SEARCH_SNIPPET_CHARS - 2; // Reserve room for both ellipses.
  const halfWindow = Math.max(0, Math.floor((payloadLimit - Math.min(needle.length, payloadLimit)) / 2));
  let start = Math.max(0, matchIndex - halfWindow);
  let end = Math.min(line.length, start + payloadLimit);
  if (end - start < payloadLimit) start = Math.max(0, end - payloadLimit);

  const prefix = start > 0 ? '…' : '';
  const suffix = end < line.length ? '…' : '';
  return {
    text: `${prefix}${line.slice(start, end)}${suffix}`,
    truncated: true,
  };
}

export async function readTextFile(root: string, path: string, maxBytes: number): Promise<string> {
  const target = await resolveForRead(root, path);
  const info = await stat(target);
  if (!info.isFile()) throw new Error('Target is not a file');
  if (info.size > maxBytes) throw new Error(`File exceeds ${maxBytes} byte read limit`);
  return readFile(target, 'utf8');
}

export async function readTextPage(
  root: string,
  path: string,
  maxBytes: number,
  options: TextPageOptions = {},
): Promise<TextPage> {
  return pageText(await readTextFile(root, path, maxBytes), options);
}

export async function writeTextFile(root: string, path: string, content: string): Promise<void> {
  const target = await resolveForWrite(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

export async function listWorkspace(root: string, depth = 2, limit = 300): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, level: number): Promise<void> {
    if (out.length >= limit || level > depth) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (out.length >= limit) break;
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = `${dir}/${entry.name}`;
      try { assertNotSecret(full); } catch { continue; }
      out.push(relative(root, full).replaceAll('\\', '/'));
      if (entry.isDirectory()) await walk(full, level + 1);
    }
  }
  await walk(root, 0);
  return out;
}

export async function searchText(
  root: string,
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const needle = query.toLowerCase();

  async function walk(dir: string): Promise<void> {
    if (results.length >= maxResults) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (results.length >= maxResults) return;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const full = `${dir}/${entry.name}`;
      try { assertNotSecret(full); } catch { continue; }
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const info = await stat(full);
        if (info.size > 1024 * 1024) continue;
        const text = await readFile(full, 'utf8');
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length && results.length < maxResults; i += 1) {
          const line = lines[i] ?? '';
          if (line.toLowerCase().includes(needle)) {
            results.push({
              path: relative(root, full).replaceAll('\\', '/'),
              line: i + 1,
              ...searchSnippet(line, needle),
            });
          }
        }
      } catch {
        // Binary/unreadable files are ignored by automatic discovery.
      }
    }
  }

  await walk(root);
  return results;
}
