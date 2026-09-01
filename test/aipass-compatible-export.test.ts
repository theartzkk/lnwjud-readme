import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { writeAipassCompatibleExports } from '../scripts/review/aipass-compatible-export.mjs';

function zipEntryNames(buffer: Buffer): string[] {
  const names: string[] = [];
  for (let offset = 0; offset + 46 <= buffer.length;) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) { offset += 1; continue; }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('AiPASS export emits attachable DOCX/PDF files without weakening revision evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-aipass-export-'));
  try {
    const source = join(root, 'source');
    const visual = join(root, 'visual-evidence');
    await mkdir(source, { recursive: true });
    await mkdir(visual, { recursive: true });

    const commit = 'a'.repeat(40);
    const fixtures: Record<string, string> = {
      'REVIEW_PROMPT.md': '# Review\nReturn JSON only.',
      'PROJECT_CONTEXT.md': '# Context\nAWH review context.',
      'CURRENT_REVISION.json': JSON.stringify({ schemaVersion: 1, commit, workingTreeDirtyAtGeneration: false }),
      'SAFETY_MANIFEST.json': JSON.stringify({ schemaVersion: 1, policies: ['NO_WORKING_TREE_CONTENT'] }),
      'REVIEWER_POLICY.json': JSON.stringify({ schemaVersion: 1, role: 'reviewer' }),
      'FINDINGS_SCHEMA.json': JSON.stringify({ type: 'object' }),
      'AWH-UX-CONSTITUTION.md': '# UX\nMobile first.',
      'AWH-VISUAL-QA.md': '# Visual QA\nEvidence first.',
      'VISUAL_SCENARIOS.json': JSON.stringify({ schemaVersion: 1, scenarios: [] }),
      'SOURCE_TREE.txt': 'src/example.ts\n',
    };
    await Promise.all(Object.entries(fixtures).map(([name, content]) => writeFile(join(root, name), content, 'utf8')));
    await writeFile(join(source, 'example.ts'), "export const thai = 'ทดสอบภาษาไทย';\n", 'utf8');
    await writeFile(join(visual, 'VISUAL_EVIDENCE.json'), JSON.stringify({ schemaVersion: 1, commit, dirty: false }), 'utf8');
    await writeFile(join(visual, 'mobile.png'), onePixelPng);

    const files = await writeAipassCompatibleExports({ stage: root, commit, branch: 'fixture', includedFiles: 1 });
    assert.deepEqual(files.map((item) => item.name), [
      'AIPASS-COMPATIBLE/01_AIPASS_REVIEW_CONTEXT.docx',
      'AIPASS-COMPATIBLE/02_AIPASS_SOURCE_EVIDENCE.docx',
      'AIPASS-COMPATIBLE/03_AIPASS_VISUAL_EVIDENCE.pdf',
    ]);

    for (const item of files.slice(0, 2)) {
      const bytes = await readFile(item.path);
      assert.equal(bytes.readUInt32LE(0), 0x04034b50);
      const entries = zipEntryNames(bytes);
      assert.ok(entries.includes('[Content_Types].xml'));
      assert.ok(entries.includes('word/document.xml'));
      assert.ok(entries.includes('word/styles.xml'));
      assert.ok(item.bytes > 100 && item.bytes < 28 * 1024 * 1024);
    }

    const pdfBytes = await readFile(files[2].path);
    assert.equal(pdfBytes.subarray(0, 5).toString('ascii'), '%PDF-');
    const pdf = await PDFDocument.load(pdfBytes);
    assert.equal(pdf.getPageCount(), 2);
    assert.ok(files[2].bytes > 100 && files[2].bytes < 28 * 1024 * 1024);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
