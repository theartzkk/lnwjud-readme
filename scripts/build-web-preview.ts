import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PRODUCT } from '../src/product.js';
import { buildProjectContext } from '../src/project-registry.js';

const ROOT = resolve(process.cwd());
const OUTPUT = join(ROOT, 'dist-web');
const MEMORY_FILES = ['PROJECT.md', 'HANDOFF.md', 'TASKS.md', 'ARCHITECTURE.md', 'DECISIONS.md'] as const;
const MAX_HANDOFF_PREVIEW = 480;

function safeHandoffSummary(markdown: string | null): string {
  if (!markdown) return 'HANDOFF.md is not available in this preview build.';
  const allowedHeadings = new Set(['Current milestone', 'Next action', 'Blockers and warnings']);
  let currentHeading = '';
  const selected: string[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const heading = raw.match(/^##\s+(.+)$/)?.[1]?.trim();
    if (heading) { currentHeading = heading; continue; }
    if (!allowedHeadings.has(currentHeading)) continue;
    const line = raw.replaceAll(/[`*_>#]/g, '').trim();
    if (!line || /(?:\/Users\/|[A-Za-z]:\\|workspacePath|Authorization|accessToken|secret|credential|\.env)/i.test(line)) continue;
    selected.push(line);
    if (selected.join(' ').length >= MAX_HANDOFF_PREVIEW) break;
  }
  const summary = selected.join(' ').replaceAll(/\s+/g, ' ').trim();
  return summary ? summary.slice(0, MAX_HANDOFF_PREVIEW) : 'HANDOFF.md is present; its sensitive or device-local details are hidden in this preview.';
}

async function asset(name: string): Promise<string> {
  return readFile(join(ROOT, 'web', name), 'utf8');
}

function generatedAt(): string {
  const fixed = process.env.AWH_PREVIEW_GENERATED_AT;
  if (fixed !== undefined && Number.isFinite(Date.parse(fixed))) return fixed;
  return new Date().toISOString();
}

async function main(): Promise<void> {
  const context = await buildProjectContext(ROOT);
  const memory = Object.fromEntries(MEMORY_FILES.map((file) => [file, context.memory[file] === null ? 'missing' : 'present']));
  const data = {
    schemaVersion: 1,
    generatedAt: generatedAt(),
    preview: {
      mode: 'REMOTE_READ_ONLY',
      label: 'Remote Preview — Read Only',
      status: 'Static preview build',
    },
    product: {
      name: PRODUCT.productName,
      shortName: PRODUCT.shortName,
      tagline: PRODUCT.tagline,
    },
    hub: {
      status: 'Preview only',
      summary: 'Hub API is not connected in the static build. Local AWH Desktop remains the runtime client.',
    },
    project: {
      projectId: context.project.projectId,
      name: context.project.name,
      type: context.project.type,
      milestone: 'Autopilot v0.5 — First Usable Product (read-only browser view)',
      handoffSummary: safeHandoffSummary(context.memory['HANDOFF.md']),
      memory,
    },
    devices: {
      status: 'Not connected',
      summary: 'Device enrollment and Hub authentication are not exposed in the public preview.',
      count: 0,
    },
    builds: {
      status: 'Not connected',
      summary: 'Build and release metadata will appear after a future authenticated Hub integration.',
    },
    audit: {
      status: 'Preview only',
      summary: 'No remote audit stream or credential data is exposed here.',
    },
    tasks: {
      status: 'Desktop runtime only',
      summary: 'Local Autopilot tasks are started and approved in AWH Desktop; this browser surface is review-only.',
      count: 0,
    },
    artifacts: {
      status: 'Preview only',
      summary: 'Artifact metadata will appear through a future sanitized Hub read contract.',
      count: 0,
    },
  };
  await mkdir(OUTPUT, { recursive: true });
  await Promise.all([
    writeFile(join(OUTPUT, 'index.html'), await asset('index.html'), 'utf8'),
    writeFile(join(OUTPUT, 'styles.css'), await asset('styles.css'), 'utf8'),
    writeFile(join(OUTPUT, 'app.js'), await asset('app.js'), 'utf8'),
    writeFile(join(OUTPUT, 'hub-read-adapter.js'), await asset('hub-read-adapter.js'), 'utf8'),
    writeFile(join(OUTPUT, 'data.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf8'),
  ]);
  console.log(`AWH web preview built at ${OUTPUT}`);
}

await main();
