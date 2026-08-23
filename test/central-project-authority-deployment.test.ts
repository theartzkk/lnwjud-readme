import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const deploy = join(root, 'deploy/awh-control-plane/deploy-control-plane.sh');
const remote = join(root, 'deploy/awh-control-plane/remote-deploy-control-plane.sh');

test('M12 Central Project Authority is an explicit v11-to-v12 release with a private Vault, durable executor, and exact rollback', async () => {
  const release = 'cccccccccccccccccccccccccccccccccccccccc';
  const result = await execFileAsync('/bin/sh', [deploy, '--dry-run', '--central-project-authority'], {
    cwd: root,
    env: { ...process.env, AWH_SOURCE_ROOT: root, AWH_RELEASE_COMMIT: release, AWH_HUB_HOSTNAME: 'awh.example' },
  });
  assert.match(result.stdout, /^M12_DRY_RUN=PASS$/m);
  assert.match(result.stdout, new RegExp(`^M12_RELEASE=${release}$`, 'm'));
  assert.match(result.stdout, /project-vault-storage-ready,migrate-011,idempotence,central-project-authority,control-pointer,install-unprivileged-native-executor/);
  assert.match(result.stdout, /^M12_ARTIFACT_STORAGE=private-object-root-required$/m);
  assert.match(result.stdout, /M12_ROLLBACK=restore-db-v11,pointer,web-pointer,nginx,service-health,m3d-m3e-m4-m7-m11-regression/);
  assert.match(result.stdout, /M12_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL/);

  const [local, remoteSource, migration, vault, vaultService, durable, artifactStore, controlService, controlRouter, serviceUnit, timerUnit] = await Promise.all([
    readFile(deploy, 'utf8'), readFile(remote, 'utf8'), readFile(join(root, 'hub/migrations/011_central_project_authority.sql'), 'utf8'),
    readFile(join(root, 'hub/src/HubProjectVault.php'), 'utf8'), readFile(join(root, 'hub/src/HubProjectVaultService.php'), 'utf8'), readFile(join(root, 'hub/src/HubDurableExecutionService.php'), 'utf8'), readFile(join(root, 'hub/src/HubArtifactStore.php'), 'utf8'), readFile(join(root, 'hub/src/HubControlPlaneService.php'), 'utf8'), readFile(join(root, 'hub/src/HubControlPlaneRouter.php'), 'utf8'),
    readFile(join(root, 'deploy/systemd/awh-native-executor.service'), 'utf8'), readFile(join(root, 'deploy/systemd/awh-native-executor.timer'), 'utf8'),
  ]);
  assert.match(local, /--central-project-authority/);
  assert.match(local, /migrate-central-project-authority\.php/);
  assert.match(remoteSource, /CENTRAL_PROJECT_AUTHORITY=\$\{21\}/);
  assert.match(remoteSource, /m12-central-project-authority/);
  assert.match(remoteSource, /PRAGMA user_version.*= 11/s);
  assert.match(remoteSource, /PRAGMA user_version.*= 12/s);
  assert.match(remoteSource, /project-vault/);
  assert.match(remoteSource, /class_exists\("ZipArchive"\).*\? 0 : 1\);/);
  assert.match(remoteSource, /awh-native-executor\.timer/);
  assert.match(migration, /control_project_vaults/);
  assert.match(migration, /control_task_executions/);
  assert.match(migration, /FOREIGN KEY \(task_id\) REFERENCES control_tasks/);
  assert.match(vault, /MAX_ARCHIVE_BYTES/);
  assert.match(vault, /PROJECT_ARCHIVE_UNSAFE/);
  assert.match(vault, /sensitivePath/);
  assert.match(vault, /function archive/);
  assert.match(controlService, /workerExecutionWorkspace/);
  assert.match(controlService, /acceptWorkerExecutionCandidate/);
  assert.match(controlService, /executor_kind = 'CODEX'/);
  assert.match(controlRouter, /worker\/executions/);
  assert.match(remoteSource, /task-transfers/);
  assert.match(local, /DEPLOY_STAGE=ARTIFACT_STORAGE_READY/);
  assert.match(durable, /one-to-one FK/);
  assert.match(durable, /NATIVE_CONVERSATION/);
  assert.match(durable, /PROJECT_INSPECTION/);
  assert.match(durable, /PROJECT_TEXT_NORMALIZE/);
  assert.match(durable, /project\.revision\.promote/);
  assert.match(vault, /ingestDirectory/);
  assert.match(vaultService, /awh_vault_promote/);
  assert.match(vaultService, /function savepoint/);
  assert.match(vaultService, /rollbackSavepoint/);
  assert.doesNotMatch(vaultService, /ownsTransaction/);
  assert.match(artifactStore, /opaque/);
  assert.doesNotMatch(durable, /(?:shell_exec\(|proc_open\(|popen\()/);
  assert.match(serviceUnit, /User=awh-hub/);
  assert.match(serviceUnit, /PrivateNetwork=true/);
  assert.match(serviceUnit, /AWH_ARTIFACT_ROOT/);
  assert.match(serviceUnit, /NoNewPrivileges=true/);
  assert.match(timerUnit, /OnUnitActiveSec=15s/);
  assert.doesNotMatch(`${local}\n${remoteSource}\n${migration}\n${vault}\n${durable}`, /(?:BEGIN [A-Z ]+PRIVATE KEY|AWH_OPENAI_API_KEY\s*=|Authorization: Bearer sk-[A-Za-z0-9_-]{20,})/i);
});

test('M12 deployment assets remain valid POSIX shell', async () => {
  await execFileAsync('/bin/sh', ['-n', deploy]);
  await execFileAsync('/bin/sh', ['-n', remote]);
});
