import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const policy = JSON.parse(await readFile(path.join(root, 'config', 'teamai-harness-policy.json'), 'utf8'));

function resolveSourceRevision() {
  const fromEnv = process.env.GITHUB_SHA;
  if (fromEnv && /^[0-9a-f]{40}$/i.test(fromEnv)) return fromEnv;
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

const sourceRevision = resolveSourceRevision();
if (!/^[0-9a-f]{40}$/i.test(sourceRevision)) throw new Error('Unable to resolve exact AWH source SHA');

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'awh-teamai-preflight-'));
const out = path.join(tempRoot, 'projection');

try {
  execFileSync(process.execPath, [
    'scripts/integrations/build-teamai-projection.mjs',
    '--out', out,
    '--source-revision', sourceRevision,
  ], { cwd: root, stdio: 'pipe' });

  if (policy.enabled !== false || policy.mode !== 'projection-only') {
    throw new Error('P0 runtime must remain disabled and projection-only');
  }

  const expectedAuthority = {
    canonicalSource: 'AWH',
    projectMemory: 'AWH',
    taskQueue: 'AWH',
    execution: 'AWH',
    approvals: 'AWH',
    ownerIdentity: 'AWH',
    schoolIdentityAndData: 'BAY EXCUSE X',
    mcpRegistry: 'AWH',
  };
  for (const [key, value] of Object.entries(expectedAuthority)) {
    if (policy.authority[key] !== value) throw new Error(`Authority drift: ${key}`);
  }

  const provenance = JSON.parse(await readFile(path.join(out, 'PROVENANCE.json'), 'utf8'));
  if (provenance.source.revision !== sourceRevision) throw new Error('Projection provenance revision mismatch');
  if (provenance.teamaiUpstream.exactSha !== policy.upstream.exactSha) throw new Error('TeamAI upstream provenance mismatch');
  if (provenance.runtimeEnabled !== false) throw new Error('Projection incorrectly enables runtime');

  const required = [
    'teamai.yaml',
    'manifest/projects.yaml',
    'rules/awh/owner-working-protocol.md',
    'rules/awh/agent-entry-contract.md',
    'rules/awh/teamai-harness-boundary.md',
    'docs/awh/current-state.md',
    'docs/awh/architecture.md',
    'docs/awh/decisions.md',
    'docs/awh/project.md',
    'docs/awh/handoff.md',
    'docs/awh/tasks.md',
    'PROVENANCE.json',
  ];
  for (const rel of required) await stat(path.join(out, rel));

  for (const forbidden of policy.projection.forbiddenTopLevelDirectories) {
    try {
      await stat(path.join(out, forbidden));
      throw new Error(`Forbidden TeamAI projection directory exists: ${forbidden}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  console.log(
    `TEAMAI_HARNESS_PREFLIGHT=PASS source=${sourceRevision} teamai=${policy.upstream.version} upstream=${policy.upstream.exactSha}`,
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
