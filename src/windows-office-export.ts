import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile, resolveExecutable } from './process.js';

export type OfficeKind = 'word' | 'excel' | 'powerpoint';
export interface OfficeExportResult { outputPath: string; sizeBytes: number; kind: OfficeKind; }
export interface OfficeExportOptions {
  platform?: NodeJS.Platform;
  powershellPath?: string;
  execute?: typeof execFile;
}

const MAX_OFFICE_BYTES = 50 * 1024 * 1024;

export function officeKindForName(name: string): OfficeKind | null {
  const extension = extname(name).toLowerCase();
  if (extension === '.doc' || extension === '.docx') return 'word';
  if (extension === '.xls' || extension === '.xlsx') return 'excel';
  if (extension === '.ppt' || extension === '.pptx') return 'powerpoint';
  return null;
}
const POWERSHELL = String.raw`$ErrorActionPreference = 'Stop'
$inputPath = $env:AWH_OFFICE_INPUT
$outputPath = $env:AWH_OFFICE_OUTPUT
$kind = $env:AWH_OFFICE_KIND
if ([string]::IsNullOrWhiteSpace($inputPath) -or [string]::IsNullOrWhiteSpace($outputPath)) { throw 'AWH_OFFICE_PATH_INVALID' }
$app = $null; $document = $null
try {
  if ($kind -eq 'word') {
    $app = New-Object -ComObject Word.Application; $app.Visible = $false; $app.DisplayAlerts = 0
    $document = $app.Documents.Open($inputPath, $false, $true); $document.ExportAsFixedFormat($outputPath, 17)
  } elseif ($kind -eq 'excel') {
    $app = New-Object -ComObject Excel.Application; $app.Visible = $false; $app.DisplayAlerts = $false
    $document = $app.Workbooks.Open($inputPath, 0, $true); $document.ExportAsFixedFormat(0, $outputPath)
  } elseif ($kind -eq 'powerpoint') {
    $app = New-Object -ComObject PowerPoint.Application
    $document = $app.Presentations.Open($inputPath, $true, $false, $false); $document.SaveAs($outputPath, 32)
  } else { throw 'AWH_OFFICE_KIND_INVALID' }
} finally {
  if ($document -ne $null) { try { $document.Close() } catch {} }
  if ($app -ne $null) { try { $app.Quit() } catch {} }
}
`;
function safeName(value: string): string {
  const base = value.replace(/[\\/\u0000-\u001f\u007f]/g, '_').replace(/\s+/g, ' ').trim();
  if (!base || base.length > 140) throw new Error('OFFICE_INPUT_NAME_INVALID');
  return base;
}

export async function exportOfficeFileToPdf(inputPath: string, inputName: string, outputDir: string, options: OfficeExportOptions = {}): Promise<OfficeExportResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') throw new Error('OFFICE_WINDOWS_REQUIRED');
  const kind = officeKindForName(inputName);
  if (kind === null) throw new Error('OFFICE_INPUT_TYPE_UNSUPPORTED');
  const input = await stat(inputPath);
  if (!input.isFile() || input.size < 1 || input.size > MAX_OFFICE_BYTES) throw new Error('OFFICE_INPUT_INVALID');
  const stem = safeName(inputName).replace(/\.[^.]+$/, '');
  const outputPath = join(outputDir, `${stem || 'document'}-${randomUUID().slice(0, 8)}.pdf`);
  const scriptPath = join(outputDir, `.awh-office-${randomUUID()}.ps1`);
  await writeFile(scriptPath, POWERSHELL, { encoding: 'utf8', mode: 0o600 });
  const powershell = options.powershellPath ?? await resolveExecutable('powershell.exe');
  const execute = options.execute ?? execFile;
  try {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      PATHEXT: process.env.PATHEXT,
      SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT,
      AWH_OFFICE_INPUT: inputPath,
      AWH_OFFICE_OUTPUT: outputPath,
      AWH_OFFICE_KIND: kind,
    };
    const result = await execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], dirname(inputPath), 120_000, env);
    if (result.code !== 0) throw new Error('OFFICE_EXPORT_FAILED');
    const info = await stat(outputPath);
    if (!info.isFile() || info.size < 5 || info.size > MAX_OFFICE_BYTES) throw new Error('OFFICE_OUTPUT_INVALID');
    const header = await readFile(outputPath, { encoding: null }).then((buffer) => buffer.subarray(0, 5).toString('ascii'));
    if (header !== '%PDF-') throw new Error('OFFICE_OUTPUT_NOT_PDF');
    return { outputPath, sizeBytes: info.size, kind };
  } finally {
    await rm(scriptPath, { force: true }).catch(() => undefined);
  }
}
