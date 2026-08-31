#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const reviewRoot = resolve(ROOT, '.awh-local/review');
const keepHistory = Number.parseInt(process.env.AWH_VISUAL_HISTORY_KEEP || '14', 10);
const keepCompare = Number.parseInt(process.env.AWH_VISUAL_COMPARE_KEEP || '8', 10);
if (![keepHistory, keepCompare].every((value) => Number.isInteger(value) && value >= 2 && value <= 100)) throw new Error('visual review retention value is invalid');

function classify(kind, keep) {
  const root = join(reviewRoot, kind);
  if (!existsSync(root)) return { kind, keep, retained: [], purgeCandidates: [] };
  const entries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => ({ name: entry.name, mtimeMs: statSync(join(root, entry.name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return {
    kind,
    keep,
    retained: entries.slice(0, keep).map((entry) => entry.name),
    purgeCandidates: entries.slice(keep).map((entry) => entry.name),
  };
}

const results = [classify('history', keepHistory), classify('compare', keepCompare)];
process.stdout.write(JSON.stringify({ status: 'AUDIT_ONLY', reviewRoot, results, note: 'No files were deleted; purge requires an explicit Owner-approved operation.' }, null, 2) + '\n');
