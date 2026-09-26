import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('repository governance is a single machine-enforced contract', async () => {
  const raw = await readFile(join(root, 'config/repository-governance-contract.json'), 'utf8');
  const contract = JSON.parse(raw);
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.authority, 'AWH_REPOSITORY_GOVERNANCE');
  assert.equal(contract.enforcementMode, 'ROLLOUT');
  assert.equal(contract.canonicalSourceBranch, 'main');
  assert.equal(contract.rules.requiredAgentEntrypoint, 'AGENTS.md');
  assert.equal(contract.rules.typedSourcePromotionOnly, true);
  assert.equal(contract.rules.resourceScopedMutationOwnership, true);
  assert.equal(contract.rules.forbidParallelAuthorityFiles, true);

  const expected = new Map([
    ['awh', ['113b45c0-23e1-408d-ae0f-ac5eca7f6900', 'production']],
    ['bay-assessment', ['6f4920ab-3ca5-4f1e-8e91-8833c68c2d1a', 'main']],
    ['bay-computer-lab', ['bcb7e7f1-5b1c-4ae5-a0cf-3d75c46b8a91', 'main']],
    ['bay-excuse-x', ['7ee0b9ec-4d2e-435f-92da-fa949afb7c01', 'main']],
    ['bay-hub', ['7c6f77f6-7d34-4ff4-a240-896ade56576d', 'main']],
    ['bay-learnlab', ['a7285fbd-029b-4d17-9d26-c7497b28a72e', 'main']],
    ['school-website', ['f33d5304-efe1-49bf-a669-72c097ce8465', 'main']],
  ]);
  for (const [repo, [projectId, defaultHead]] of expected) {
    const row = contract.repositories[repo];
    assert.ok(row, repo + ' must be governed');
    assert.equal(row.projectId, projectId);
    assert.equal(row.defaultHead, defaultHead);
    assert.equal(row.canonicalBranch, 'main');
    assert.equal(row.requireProjectManifest, true);
  }
  assert.ok(contract.repositories['awh-local-agent']);
  assert.equal(contract.repositories['awh-local-agent'].requireProjectManifest, false);
  assert.equal(contract.ignoredRepositories.workspaces.length > 0, true);

  const roles = contract.repositories.awh.contextFiles;
  for (const [path, role] of Object.entries(roles)) {
    const body = await readFile(join(root, path), 'utf8');
    assert.match(body, new RegExp('Document role: ' + role));
    for (const pattern of contract.rules.mutableFactPatterns) {
      assert.equal(new RegExp(pattern, 'iu').test(body), false, path + ' must not contain mutable live-state prose');
    }
  }

  const agents = await readFile(join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Document role: AGENT_ENTRYPOINT/);
  assert.match(agents, /repository-governance-contract\.json/);

  const drift = await readFile(join(root, 'hub/bin/ecosystem-source-drift.php'), 'utf8');
  assert.match(drift, /governanceRepositories/);
  assert.match(drift, /default HEAD drift/);
  assert.match(drift, /project manifest id drift/);
  assert.match(drift, /forbidden parallel authority file/);
  assert.match(drift, /active mutation/);

  const registry = await readFile(join(root, 'hub/src/HubUpdateTargetRegistry.php'), 'utf8');
  assert.match(registry, /'defaultBranch'=>'production'/);
  assert.match(registry, /'bay-computer-lab'.*'defaultBranch'=>'main'/s);

  const operator = await readFile(join(root, 'hub/src/HubOperatorBridgeService.php'), 'utf8');
  assert.match(operator, /Repository default HEAD did not converge/);
  assert.match(operator, /symbolic-ref','HEAD'/);
  assert.match(operator, /headChanged/);
  assert.match(operator, /headBefore/);

  const deploy = await readFile(join(root, 'deploy/awh-control-plane/remote-deploy-control-plane.sh'), 'utf8');
  assert.match(deploy, /SOURCE_DRIFT_HOTFIX_RETIRED=0/);
  assert.match(deploy, /SOURCE_DRIFT_HOTFIX_PREEXISTING=1/);
  assert.match(deploy, /SOURCE_DRIFT_OVERRIDE_PREEXISTING=1/);
  assert.match(deploy, /governanceRepositories/);
  assert.match(deploy, /activeProjects/);
  assert.match(deploy, /SOURCE_DRIFT_HOTFIX_RETIRED/);
  assert.match(deploy, /OPERATOR_CLIENT_INSTALLED=0/);
  assert.match(deploy, /deploy\/operator-bridge\/awh-operator/);
  assert.match(deploy, /OPERATOR_CLIENT_BACKUP/);
  assert.match(deploy, /grep -Fq "vault-import" "\$OPERATOR_CLIENT"/);
});
