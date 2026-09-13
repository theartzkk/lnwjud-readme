import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
function arg(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const root = path.resolve(arg('--root') ?? process.cwd());
const outArg = arg('--out');
const sourceRevision = arg('--source-revision');

if (!outArg) throw new Error('Missing required --out <directory>');
if (!sourceRevision || !/^[0-9a-f]{40}$/i.test(sourceRevision)) {
  throw new Error('Missing or invalid --source-revision; exact 40-character Git SHA is required');
}

const out = path.resolve(outArg);
const policyPath = path.join(root, 'config', 'teamai-harness-policy.json');
const policy = JSON.parse(await readFile(policyPath, 'utf8'));

if (policy.mode !== 'projection-only' || policy.enabled !== false) {
  throw new Error('TeamAI P0 policy must remain projection-only and disabled');
}

const mapping = [
  ['ART_AI_WORKING_PROTOCOL.md', 'rules/awh/owner-working-protocol.md'],
  ['AGENTS.md', 'rules/awh/agent-entry-contract.md'],
  ['CURRENT_STATE.md', 'docs/awh/current-state.md'],
  ['ARCHITECTURE.md', 'docs/awh/architecture.md'],
  ['DECISIONS.md', 'docs/awh/decisions.md'],
  ['PROJECT.md', 'docs/awh/project.md'],
  ['HANDOFF.md', 'docs/awh/handoff.md'],
  ['TASKS.md', 'docs/awh/tasks.md'],
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const files = [];
for (const [sourceRel, targetRel] of mapping) {
  if (!policy.projection.sourceFiles.includes(sourceRel)) {
    throw new Error(`Projection source is not policy-approved: ${sourceRel}`);
  }
  const sourcePath = path.join(root, sourceRel);
  const targetPath = path.join(out, targetRel);
  const content = await readFile(sourcePath, 'utf8');
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, 'utf8');
  files.push({
    source: sourceRel,
    target: targetRel,
    sourceSha256: sha256(content),
    projectedSha256: sha256(content),
    bytes: Buffer.byteLength(content, 'utf8'),
  });
}

const teamaiYaml = 'version: 1\npublicSkills: []\n';
await writeFile(path.join(out, 'teamai.yaml'), teamaiYaml, 'utf8');

await mkdir(path.join(out, 'manifest'), { recursive: true });
const projectsYaml = [
  'version: 1',
  'projects:',
  '  - id: awh',
  "    name: Art's Workspace Hub",
  '    description: AWH project-scoped rules, docs and future skills distributed through a non-authoritative harness.',
  '    resources:',
  '      knowledge: [awh]',
  '      skills: [awh]',
  '      learnings: [awh]',
  '',
].join('\n');
await writeFile(path.join(out, 'manifest', 'projects.yaml'), projectsYaml, 'utf8');

const boundaryRule = [
  '# AWH TeamAI Harness Boundary',
  '',
  '- AWH is the authority for source, Project Memory, tasks, executions, approvals, owner identity, artifacts, runtime policy, MCP registry and secrets.',
  '- BAY EXCUSE X is the Source of Truth for school identity and school data.',
  '- TeamAI is a distribution/recall harness only. Never create a shadow queue, auth system, memory authority, approval authority or MCP registry.',
  '- Never export secrets into TeamAI env files or committed resources.',
  '- A TeamAI learning is a candidate until AWH provenance and promotion rules accept it.',
  '- If TeamAI is unavailable, continue through canonical AWH authorities without blind retry.',
  '',
].join('\n');
const boundaryPath = path.join(out, 'rules', 'awh', 'teamai-harness-boundary.md');
await mkdir(path.dirname(boundaryPath), { recursive: true });
await writeFile(boundaryPath, boundaryRule, 'utf8');

const provenance = {
  schemaVersion: 1,
  source: {
    repository: 'theartzkk/lnwjud-readme',
    revision: sourceRevision,
    authority: 'AWH canonical source',
  },
  teamaiUpstream: policy.upstream,
  mode: policy.mode,
  runtimeEnabled: policy.enabled,
  files,
};
await writeFile(path.join(out, 'PROVENANCE.json'), JSON.stringify(provenance, null, 2) + '\n', 'utf8');

const readme = [
  '# AWH TeamAI Projection',
  '',
  'Generated artifact. It is not an AWH source authority.',
  '',
  `AWH exact source revision: ${sourceRevision}`,
  `TeamAI compatibility target: ${policy.upstream.version} @ ${policy.upstream.exactSha}`,
  '',
  'This P0 projection intentionally excludes env, MCP, hooks, agents and learnings.',
  'Use only for isolated TeamAI distribution/recall canaries.',
  '',
].join('\n');
await writeFile(path.join(out, 'README.md'), readme, 'utf8');

for (const forbidden of policy.projection.forbiddenTopLevelDirectories) {
  const forbiddenPath = path.join(out, forbidden);
  try {
    await readFile(forbiddenPath);
    throw new Error(`Forbidden TeamAI projection path exists: ${forbidden}`);
  } catch (error) {
    if (error?.code !== 'EISDIR' && error?.code !== 'ENOENT') throw error;
    if (error?.code === 'EISDIR') throw new Error(`Forbidden TeamAI projection directory exists: ${forbidden}`);
  }
}

console.log(`TEAMAI_PROJECTION=PASS source=${sourceRevision} files=${files.length} out=${out}`);
