import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportOfficeFileToPdf, officeKindForName } from '../src/windows-office-export.js';

test('Office input classification is bounded to supported document types', () => {
  assert.equal(officeKindForName('report.docx'), 'word');
  assert.equal(officeKindForName('scores.xlsx'), 'excel');
  assert.equal(officeKindForName('slides.pptx'), 'powerpoint');
  assert.equal(officeKindForName('script.ps1'), null);
});

test('Office exporter uses a fixed PowerShell file and validates PDF output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-office-'));
  const input = join(root, 'report.docx'); await writeFile(input, 'fixture');
  let argv: string[] = [];
  try {
    const result = await exportOfficeFileToPdf(input, 'report.docx', root, {
      platform: 'win32', powershellPath: 'powershell.exe',
      execute: async (_exe, args, _cwd, _timeout, env) => {
        argv = args; await writeFile(String(env?.AWH_OFFICE_OUTPUT), Buffer.from('%PDF-1.7\nfixture'));
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    assert.match(result.outputPath, /\.pdf$/i);
    assert.deepEqual(argv.slice(0, 5), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']);
    const script = argv[6]; assert.equal(typeof script, 'string');
    assert.equal(await readFile(String(script), 'utf8').then(() => 'exists').catch(() => 'removed'), 'removed');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Office exporter never runs on a non-Windows provider', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-office-'));
  const input = join(root, 'report.docx'); await writeFile(input, 'fixture');
  try {
    await assert.rejects(() => exportOfficeFileToPdf(input, 'report.docx', root, { platform: 'darwin', powershellPath: 'powershell.exe' }), /WINDOWS_REQUIRED/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
