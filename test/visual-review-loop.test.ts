import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { writeAipassCompatibleExports } from '../scripts/review/aipass-compatible-export.mjs';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

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

test('Visual QA contract is fixture-first and does not grant deployment authority', async () => {
  const constitution = await read('docs/AWH-UX-CONSTITUTION.md');
  const guide = await read('docs/AWH-VISUAL-QA.md');
  const roles = await read('docs/AWH-AIPASS-MODEL-ROLES.md');
  assert.match(constitution, /Home = Chat|Home.*Chat/i);
  assert.match(constitution, /3 mobile destinations|3.*แท็บ|three/i);
  assert.match(constitution, /RUNNING|Worker|Provider|backend/i);
  assert.match(guide, /Render.*Package.*Review|render/i);
  assert.match(roles, /reviewer, never the Production authority/i);
});

test('visual renderer binds evidence to a clean exact revision', async () => {
  const runner = await read('scripts/review/render-ai-review-scenarios.mjs');
  const capture = await read('scripts/review/visual-review-capture.cjs');
  assert.match(runner, /rev-parse/);
  assert.match(runner, /status.*--porcelain/);
  assert.match(runner, /local-contract-fixture/);
  assert.match(capture, /390x844/);
  assert.match(capture, /horizontalOverflow/);
  assert.match(capture, /question-identity/);
});

test('review pack and findings validator preserve fail-closed evidence rules', async () => {
  const pack = await read('scripts/review/create-ai-review-pack.mjs');
  const validator = await read('scripts/review/validate-aipass-findings.mjs');
  const schema = JSON.parse(await read('scripts/review/aipass-findings.schema.json'));
  assert.match(pack, /AWH_AI_REVIEW_EVIDENCE_DIR/);
  assert.match(pack, /manifest\?\.commit !== commit/);
  assert.match(pack, /manifest\?\.dirty !== false/);
  assert.match(pack, /NO_WORKING_TREE_CONTENT/);
  assert.match(pack, /FINDINGS_SCHEMA\.json/);
  assert.match(pack, /writeAipassCompatibleExports/);
  assert.match(validator, /P0 requires BLOCK/);
  assert.equal(schema.properties.verdict.enum.includes('BLOCK'), true);
  assert.equal(schema.properties.findings.items.properties.severity.enum.includes('P0'), true);
});

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

test('visual review scenario set covers conversation, work, artifact and recovery UX', async () => {
  const config = JSON.parse(await read('scripts/review/visual-review-scenarios.json'));
  const ids = new Set(config.scenarios.map((scenario: { id: string }) => scenario.id));
  for (const id of ['home-empty','question-identity','work-progress','document-artifact','failed-retry','artifact-follow-up']) assert.equal(ids.has(id), true, id);
  assert.equal(config.referenceViewports.some((item: { width: number; height: number }) => item.width === 390 && item.height === 844), true);
  assert.equal(config.referenceViewports.some((item: { width: number; height: number }) => item.width === 1440 && item.height === 900), true);
});
