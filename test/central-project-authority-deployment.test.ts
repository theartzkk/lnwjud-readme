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

test('M12 Central Project Authority supports first activation and truthful v12 source refresh with a private Vault and durable executor', async () => {
  const release = 'cccccccccccccccccccccccccccccccccccccccc';
  const result = await execFileAsync('/bin/sh', [deploy, '--dry-run', '--central-project-authority'], {
    cwd: root,
    env: { ...process.env, AWH_SOURCE_ROOT: root, AWH_RELEASE_COMMIT: release, AWH_HUB_HOSTNAME: 'awh.example' },
  });
  assert.match(result.stdout, /^M12_DRY_RUN=PASS$/m);
  assert.match(result.stdout, new RegExp(`^M12_RELEASE=${release}$`, 'm'));
  assert.match(result.stdout, /project-vault-storage-ready,migrate-011-only-from-v11,source-refresh-without-migration-on-v12,control-pointer,refresh-managed-native-executor,php-fpm-reload,project-vault-source-sync/);
  assert.match(result.stdout, /^M12_ARTIFACT_STORAGE=private-object-root-required$/m);
  assert.match(result.stdout, /M12_ROLLBACK=restore-db-only-if-migrated,pointer,web-pointer,managed-executor-units,nginx,service-health,m3d-m3e-control-regression/);
  assert.match(result.stdout, /M12_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL/);

  const [local, remoteSource, migration, vault, vaultService, durable, sourceSync, artifactStore, controlService, controlRouter, nativeAgent, webAdapter, webApp, executionUx, serviceUnit, timerUnit] = await Promise.all([
    readFile(deploy, 'utf8'), readFile(remote, 'utf8'), readFile(join(root, 'hub/migrations/011_central_project_authority.sql'), 'utf8'),
    readFile(join(root, 'hub/src/HubProjectVault.php'), 'utf8'), readFile(join(root, 'hub/src/HubProjectVaultService.php'), 'utf8'), readFile(join(root, 'hub/src/HubDurableExecutionService.php'), 'utf8'), readFile(join(root, 'hub/bin/sync-deployed-source-vault.php'), 'utf8'), readFile(join(root, 'hub/src/HubArtifactStore.php'), 'utf8'), readFile(join(root, 'hub/src/HubControlPlaneService.php'), 'utf8'), readFile(join(root, 'hub/src/HubControlPlaneRouter.php'), 'utf8'),
    readFile(join(root, 'hub/src/HubNativeAgentService.php'), 'utf8'), readFile(join(root, 'web/control-plane-adapter.js'), 'utf8'), readFile(join(root, 'web/app.js'), 'utf8'), readFile(join(root, 'web/execution-ux.js'), 'utf8'),
    readFile(join(root, 'deploy/systemd/awh-native-executor.service'), 'utf8'), readFile(join(root, 'deploy/systemd/awh-native-executor.timer'), 'utf8'),
  ]);
  assert.match(local, /--central-project-authority/);
  assert.match(local, /migrate-central-project-authority\.php/);
  assert.match(remoteSource, /CENTRAL_PROJECT_AUTHORITY=\$\{21\}/);
  assert.match(remoteSource, /RELEASE_COMMIT=\$\{22\}/);
  assert.match(remoteSource, /m12-central-project-authority/);
  assert.match(remoteSource, /M12_START_VERSION/);
  assert.match(remoteSource, /case \"\$M12_START_VERSION\" in 11\|12/);
  assert.match(remoteSource, /M12_REFRESH=1/);
  assert.match(remoteSource, /DB_MUTATED=1; stage CENTRAL_PROJECT_MIGRATION_FIRST/);
  assert.match(remoteSource, /EXECUTOR_UNITS_PREEXISTING=1/);
  assert.match(remoteSource, /cmp -s \"\$EXECUTOR_SERVICE_UNIT\" \"\$PREVIOUS_TARGET\/deploy\/systemd\/awh-native-executor\.service\"/);
  assert.match(remoteSource, /systemctl stop awh-native-executor\.timer/);
  assert.match(remoteSource, /cp -p \"\$EXECUTOR_SERVICE_BACKUP\" \"\$EXECUTOR_SERVICE_UNIT\"/);
  assert.match(remoteSource, /PRAGMA user_version.*= 12/s);
  assert.match(remoteSource, /project-vault/);
  assert.match(remoteSource, /PROJECT_VAULT_SOURCE_SYNC/);
  assert.match(remoteSource, /sync-deployed-source-vault\.php/);
  assert.match(local, /git -C "\$ROOT" archive --format=zip/);
  assert.match(sourceSync, /Art’s Workspace Hub/);
  assert.match(sourceSync, /release-vault:/);
  assert.match(remoteSource, /class_exists\("ZipArchive"\).*\? 0 : 1\);/);
  assert.match(remoteSource, /awh-native-executor\.timer/);
  assert.match(migration, /control_project_vaults/);
  assert.match(migration, /control_task_executions/);
  assert.match(migration, /FOREIGN KEY \(task_id\) REFERENCES control_tasks/);
  assert.match(vault, /MAX_ARCHIVE_BYTES/);
  assert.match(vault, /PROJECT_ARCHIVE_UNSAFE/);
  assert.match(vault, /sensitivePath/);
  assert.match(vault, /function archive/);
  assert.match(vault, /function toolTextPath/);
  assert.match(controlService, /workerExecutionWorkspace/);
  assert.match(controlService, /\$nativeRequest = \['conversationId'/);
  assert.match(controlService, /private function completeNativeConversation/);
  assert.match(controlService, /native-answer-/);
  assert.match(controlService, /for \(\$attempt = 0; \$attempt < 8; \$attempt\+\+\)/);
  assert.match(controlService, /CONVERSATION_RESPONSE_PERSIST_FAILED/);
  assert.match(controlService, /hasUnsafeConversationControl/);
  assert.match(controlService, /isSqliteBusy/);
  assert.match(controlService, /ช่วย\|กรุณา\|โปรด/);
  assert.match(controlService, /acceptWorkerExecutionCandidate/);
  assert.match(controlService, /executor_kind = 'CODEX'/);
  assert.match(controlService, /isServerAssistedEdit/);
  assert.match(controlService, /project\.mutate\.assisted/);
  assert.match(controlRouter, /worker\/executions/);
  assert.match(remoteSource, /task-transfers/);
  assert.match(local, /DEPLOY_STAGE=ARTIFACT_STORAGE_READY/);
  assert.match(durable, /one-to-one FK/);
  assert.match(durable, /NATIVE_CONVERSATION/);
  assert.match(durable, /PROJECT_INSPECTION/);
  assert.match(durable, /PROJECT_TEXT_NORMALIZE/);
  assert.match(durable, /PROJECT_ASSISTED_EDIT/);
  assert.match(durable, /project_write_text/);
  assert.match(durable, /MAX_ASSISTED_EDIT_FILES/);
  assert.match(durable, /project\.revision\.promote/);
  assert.match(durable, /Native conversation provider failed/);
  assert.doesNotMatch(durable, /catch \(HubNativeAgentException \$error\) \{\s*if \(\$error->codeName === 'BUDGET_EXHAUSTED'\)[\s\S]{0,240}conversationFallback/);
  assert.match(nativeAgent, /Reply with OK only/);
  assert.match(nativeAgent, /providerFailure/);
  assert.match(nativeAgent, /assistant' \? 'output_text' : 'input_text'/);
  assert.match(nativeAgent, /PROVIDER_MODEL_UNAVAILABLE/);
  assert.match(nativeAgent, /PROVIDER_QUOTA_EXHAUSTED/);
  assert.match(nativeAgent, /PROVIDER_PERMISSION_DENIED/);
  assert.match(durable, /bounded retry queued on the same task/);
  assert.doesNotMatch(durable, /conversationFallback/);
  assert.match(webAdapter, /PROVIDER_REQUEST_INVALID/);
  assert.match(executionUx, /PROVIDER_RATE_LIMITED:[^\n]*งานยังถูกเก็บไว้/);
  assert.match(executionUx, /BUDGET_EXHAUSTED:[^\n]*งานยังถูกเก็บไว้/);
  assert.match(vault, /ingestDirectory/);
  assert.match(vaultService, /awh_vault_promote/);
  assert.match(vaultService, /function savepoint/);
  assert.match(vaultService, /rollbackSavepoint/);
  assert.doesNotMatch(vaultService, /ownsTransaction/);
  assert.match(artifactStore, /opaque/);
  assert.doesNotMatch(durable, /(?:shell_exec\(|proc_open\(|popen\()/);
  assert.match(serviceUnit, /User=awh-hub/);
  assert.match(serviceUnit, /PrivateNetwork=false/);
  assert.match(serviceUnit, /RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6/);
  assert.match(nativeAgent, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(serviceUnit, /AWH_ARTIFACT_ROOT/);
  assert.match(serviceUnit, /NoNewPrivileges=true/);
  assert.match(timerUnit, /OnUnitActiveSec=15s/);
  assert.doesNotMatch(`${local}\n${remoteSource}\n${migration}\n${vault}\n${durable}`, /(?:BEGIN [A-Z ]+PRIVATE KEY|AWH_OPENAI_API_KEY\s*=|Authorization: Bearer sk-[A-Za-z0-9_-]{20,})/i);
});

test('M12 deployment assets remain valid POSIX shell', async () => {
  await execFileAsync('/bin/sh', ['-n', deploy]);
  await execFileAsync('/bin/sh', ['-n', remote]);
});
