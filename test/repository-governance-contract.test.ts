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
  assert.equal(contract.rules.mutationDecisionAuthority, 'AWH_EXECUTION_GATE');
  assert.equal(contract.rules.blockingDecision, 'WAIT_CONFLICT');
  assert.deepEqual(contract.rules.nonBlockingDecisions, ['CONTINUE','CONTINUE_OR_JOIN']);
  assert.equal(contract.rules.projectMissionIsCoordinationOnly, true);
  assert.equal(contract.rules.projectScopedMutationIsolation, true);
  assert.equal(contract.rules.crossProjectMutationDefault, 'DENY');
  assert.equal(contract.rules.crossProjectReadOnlyAllowed, true);
  assert.equal(contract.rules.sourcePromotionRequiresTargetProjectMission, true);
  assert.equal(contract.rules.verifiedCompletionAuthority, 'HubCompletionAuthorityService');
  assert.equal(contract.rules.completionNotificationRequiresVerifiedTerminal, true);
  assert.equal(contract.rules.heartbeatResumeCursorRequired, true);
  assert.equal(contract.rules.terminalStateEvidence, 'TASK+EXECUTION+ENVELOPE+APPROVAL+CONTINUATION');
  assert.equal(contract.rules.aggregateActiveCountsAreNotBlockingAuthority, true);
  assert.equal(contract.rules.releaseTrackScopedDeployOwnership, true);
  assert.equal(contract.rules.hostGlobalReleaseTrack, 'vps-platform');
  assert.equal(contract.rules.recurringBlockerRequiresPermanentFix, true);
  assert.equal(contract.rules.ownerAssistFastLaneRequired, true);
  assert.equal(contract.rules.maxSameFailureRetriesBeforeEscalation, 2);
  assert.equal(contract.rules.durableCandidateWorkspaceRequired, true);
  assert.equal(contract.rules.durableCandidateWorkspaceRoot, '/var/lib/awh-remote/worktrees');
  assert.equal(contract.rules.ephemeralWorkspaceRoot, '/tmp');
  assert.equal(contract.rules.unpromotedCandidateInEphemeralRootAllowed, false);
  assert.equal(contract.rules.maintenanceRuntimeUsesReleasePointerOnly, true);
  assert.equal(contract.rules.storageSelfHealBeforeBlock, true);
  assert.equal(contract.rules.storageTargetFreeBytes, 17179869184);
  assert.equal(contract.rules.sandboxedConnectorFilesystemViewIsHostAuthority, false);
  assert.equal(contract.rules.hostFilesystemIncidentRequiresAuthorityCrossCheck, true);
  assert.equal(contract.rules.destructiveHostRepairFromConnectorOnlyEvidenceAllowed, false);
  assert.equal(contract.rules.forbidParallelAuthorityFiles, true);
  assert.equal(contract.rules.continuousImprovementAuthority, 'AWH_CONTINUOUS_IMPROVEMENT');
  assert.equal(contract.rules.continuousImprovementPolicyPath, 'config/continuous-improvement-policy.json');
  assert.equal(contract.rules.globalGovernanceProfile, 'KRUART_STANDARD_V1');
  assert.equal(contract.rules.policyInheritanceByRegistry, true);
  assert.equal(contract.rules.existingAndFutureManagedRepositoriesInheritGlobalPolicy, true);
  assert.equal(contract.rules.sharedCauseFixAtHighestSharedLayer, true);
  assert.equal(contract.rules.temporaryWorkaroundNeverClosure, true);
  assert.equal(contract.rules.provenLessonGuardrailsRequired, true);
  const continuous = JSON.parse(await readFile(join(root, contract.rules.continuousImprovementPolicyPath), 'utf8'));
  assert.equal(continuous.authority, 'AWH_CONTINUOUS_IMPROVEMENT');
  assert.equal(continuous.appliesTo, 'ALL_MANAGED_PROJECTS');
  assert.equal(continuous.lessonPromotion.state, 'ENFORCED');
  assert.equal(continuous.lessonPromotion.requiresVerifiedClosure, true);
  assert.equal(continuous.projectBaseline.profile, 'KRUART_STANDARD_V1');
  assert.equal(continuous.projectBaseline.policyInheritanceByRegistry, true);
  assert.equal(continuous.invariants.sharedCauseFixedAtHighestSharedLayer, true);
  assert.equal(continuous.invariants.unverifiedAutonomousPolicyMutationForbidden, true);
  assert.equal(continuous.invariants.sandboxViewNeverHostTruth, true);
  assert.equal(continuous.invariants.hostFilesystemIncidentRequiresAuthorityCrossCheck, true);
  assert.equal(continuous.invariants.destructiveHostRepairRequiresCorroboratedHostEvidence, true);

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
  assert.match(agents, /only `WAIT_CONFLICT` is blocking/);
  assert.match(agents, /Project Mission is a coordination lease, not a writer lock/);
  assert.match(agents, /only `VPS Platform` is host-global/);
  assert.match(agents, /Cross-project mutation is denied by default/);
  assert.match(agents, /Source promotion requires the exact active mission of the target project/);
  assert.match(agents, /Owner Assist Fast Lane/);
  assert.match(agents, /retry the same failure path at most twice/i);
  assert.match(agents, /\/var\/lib\/awh-remote\/worktrees/);
  assert.match(agents, /problem class/);
  assert.match(agents, /continuous-improvement guardrail/);
  assert.match(agents, /highest shared layer/);
  assert.match(agents, /sandboxed connector.*not host authority/i);
  assert.match(agents, /SANDBOX_VIEW versus HOST_STATE/);
  assert.match(agents, /Do not recommend or perform remount, filesystem repair, fsck, reboot/);

  const drift = await readFile(join(root, 'hub/bin/ecosystem-source-drift.php'), 'utf8');
  assert.match(drift, /governanceRepositories/);
  assert.match(drift, /dirname\(__DIR__, 2\).*repository-governance-contract\.json/s);
  assert.match(drift, /default HEAD drift/);
  assert.match(drift, /project manifest id drift/);
  assert.match(drift, /forbidden parallel authority file/);
  assert.match(drift, /active mutation/);
  assert.match(drift, /AWH_CONTINUOUS_IMPROVEMENT/);
  assert.match(drift, /continuous-improvement inheritance drift/);

  const registry = await readFile(join(root, 'hub/src/HubUpdateTargetRegistry.php'), 'utf8');
  assert.match(registry, /'defaultBranch'=>'production'/);
  assert.match(registry, /'bay-computer-lab'.*'defaultBranch'=>'main'/s);

  const operator = await readFile(join(root, 'hub/src/HubOperatorBridgeService.php'), 'utf8');
  assert.match(operator, /Repository default HEAD did not converge/);
  assert.match(operator, /symbolic-ref','HEAD'/);
  assert.match(operator, /headChanged/);
  assert.match(operator, /headBefore/);

  const localDeploy = await readFile(join(root, 'deploy/awh-control-plane/deploy-control-plane.sh'), 'utf8');
  assert.match(localDeploy, /config\/repository-governance-contract\.json/);
  const deploy = await readFile(join(root, 'deploy/awh-control-plane/remote-deploy-control-plane.sh'), 'utf8');
  assert.match(deploy, /SOURCE_DRIFT_HOTFIX_RETIRED=0/);
  assert.match(deploy, /governance_rows=/);
  assert.match(deploy, /setfacl -m u:awh-hub:rx \/srv\/awh-git/);
  assert.match(deploy, /test ! -w \/srv\/awh-git/);
  assert.match(deploy, /setfacl -R -x u:awh-hub "\$governed_path"/);
  assert.match(deploy, /setfacl -x d:u:awh-hub/);
  assert.match(deploy, /chmod g\+rwx,g\+s,o\+rx/);
  assert.match(deploy, /chmod g\+rw,o\+r/);
  assert.match(deploy, /setfacl -m g::rwx,m::rwx,d:g::rwx,d:m::rwx/);
  assert.match(deploy, /setfacl -m g::rw,m::rw/);
  assert.match(deploy, /test -r "\$governed_path\/HEAD"/);
  assert.match(deploy, /test ! -w "\$governed_path\/objects"/);
  assert.match(deploy, /-u awh-hub -g bayadmin test -w "\$governed_path\/objects"/);
  assert.match(deploy, /-u awh-hub -g bayadmin test -w "\$governed_path\/refs\/heads"/);
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
