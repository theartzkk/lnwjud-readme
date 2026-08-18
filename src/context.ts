import { createHash } from 'node:crypto';

export interface TextPageOptions {
  startLine?: number;
  maxLines?: number;
  knownDigest?: string;
}

export interface TextPage {
  digest: string;
  totalBytes: number;
  totalLines: number;
  startLine: number;
  endLine: number;
  hasMore: boolean;
  nextStartLine: number | null;
  unchanged: boolean;
  content?: string;
}

const DEFAULT_PAGE_LINES = 200;
const MAX_PAGE_LINES = 500;

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value ?? fallback)));
}

function lineUnits(text: string): string[] {
  // Keep each original line ending attached so page output never normalizes CRLF/LF.
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

export function textDigest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function pageText(text: string, options: TextPageOptions = {}): TextPage {
  const units = lineUnits(text);
  const totalLines = units.length;
  const requestedStart = boundedInteger(options.startLine, 1, 1, Number.MAX_SAFE_INTEGER);
  const maxLines = boundedInteger(options.maxLines, DEFAULT_PAGE_LINES, 1, MAX_PAGE_LINES);
  const startLine = Math.min(requestedStart, totalLines + 1);
  const startIndex = Math.max(0, startLine - 1);
  const selected = units.slice(startIndex, startIndex + maxLines);
  const endLine = selected.length > 0 ? startLine + selected.length - 1 : startLine - 1;
  const hasMore = startIndex + selected.length < totalLines;
  const digest = textDigest(text);
  const unchanged = options.knownDigest?.trim().toLowerCase() === digest;

  return {
    digest,
    totalBytes: Buffer.byteLength(text, 'utf8'),
    totalLines,
    startLine,
    endLine,
    hasMore,
    nextStartLine: hasMore ? endLine + 1 : null,
    unchanged,
    ...(unchanged ? {} : { content: selected.join('') }),
  };
}
