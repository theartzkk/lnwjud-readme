import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('project source authority ships a persistent least-privilege drift monitor', async () => {
  const [service, timer, deploy, remote, telemetry, validator, coreRelease] = await Promise.all([
    readFile(join(root, 'deploy/systemd/awh-source-drift.service'), 'utf8'),
    readFile(join(root, 'deploy/systemd/awh-source-drift.timer'), 'utf8'),
    readFile(join(root, 'deploy/awh-control-plane/deploy-control-plane.sh'), 'utf8'),
    readFile(join(root, 'deploy/awh-control-plane/remote-deploy-control-plane.sh'), 'utf8'),
    readFile(join(root, 'hub/bin/system-telemetry.php'), 'utf8'),
    readFile(join(root, 'deploy/awh-control-plane/validate-remote-output.sh'), 'utf8'),
    readFile(join(root, 'hub/src/HubCoreReleaseService.php'), 'utf8'),
  ]);

  assert.match(service, /User=awh-hub/);
  assert.match(service, /Group=awh-hub/);
  assert.match(service, /ecosystem-source-drift\.php \/var\/lib\/awh-hub\/awh\.sqlite \/srv\/awh-git \/var\/www\/awh-web\/current\/release\.json/);
  assert.match(service, /SuccessExitStatus=2/);
  assert.match(service, /ProtectSystem=strict/);
  assert.match(service, /ReadWritePaths=\/var\/lib\/awh-hub/);
  assert.match(service, /RestrictAddressFamilies=AF_UNIX/);
  assert.match(service, /CapabilityBoundingSet=\s*$/m);
  assert.doesNotMatch(service, /(?:bash|sh) -c/);

  assert.match(timer, /OnCalendar=\*:0\/15/);
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /Unit=awh-source-drift\.service/);

  assert.match(deploy, /deploy\/systemd\/awh-source-drift\.service/);
  assert.match(deploy, /deploy\/systemd\/awh-source-drift\.timer/);
  assert.match(remote, /setfacl -m u:awh-hub:rx \/srv\/awh-git/);
  assert.match(remote, /sudo -u awh-hub test ! -w \/srv\/awh-git/);
  assert.match(remote, /setfacl -R -x u:awh-hub \"\$governed_path\"/);
  assert.match(remote, /find \"\$governed_path\" -type d -exec chmod g\+rwx,g\+s,o\+rx/);
  assert.match(remote, /find \"\$governed_path\" -type f -exec chmod g\+rw,o\+r/);
  assert.match(remote, /setfacl -m g::rwx,m::rwx,d:g::rwx,d:m::rwx/);
  assert.match(remote, /setfacl -m g::rw,m::rw/);
  assert.match(remote, /sudo -u awh-hub test -r \"\$governed_path\/HEAD\"/);
  assert.match(remote, /sudo -u awh-hub test ! -w \"\$governed_path\/objects\"/);
  assert.match(remote, /sudo -u awh-hub -g bayadmin test -w \"\$governed_path\/objects\"/);
  assert.match(remote, /sudo -u awh-hub -g bayadmin test -w \"\$governed_path\/refs\/heads\"/);
  assert.match(remote, /enable --now awh-source-drift\.timer/);
  assert.match(remote, /VAULT_SOURCE_RECONCILE=.*reconcile-vault-source-authority\.php/);
  assert.match(remote, /stage VAULT_SOURCE_RECONCILE;[\s\S]*\"\$VAULT_SOURCE_RECONCILE\" \"\$DB\" \/srv\/awh-git[\s\S]*stage VAULT_SOURCE_RECONCILED/);
  assert.match(remote, /SOURCE_DRIFT_VERIFY/);
  assert.match(remote, /ecosystem-source-drift\.php" "\$DB" \/srv\/awh-git "\$WEB_POINTER\/release\.json"/);
  assert.match(remote, /DEPLOY_DIAGNOSTIC=SOURCE_DRIFT_FINDINGS_/);
  assert.match(remote, /DEPLOY_DIAGNOSTIC=SOURCE_DRIFT_EXTERNAL_/);
  assert.match(remote, /platform_blocking_count=/);
  assert.match(remote, /external_count=/);
  assert.match(remote, /PLATFORM_HARDENING.*AWH_CORE.*platform_blocking_count/s);
  assert.match(remote, /drift_count=/);
  assert.match(remote, /PRODUCTION_REF_CHANGED=0; PRODUCTION_REF_PREVIOUS=ABSENT; PREVIOUS_PRODUCTION_SHA=/);
  assert.match(remote, /production_ref_reconcile_live\(\)/);
  assert.match(remote, /live_manifest=\/var\/www\/awh-web\/current\/release\.json/);
  assert.match(remote, /control_manifest=\"\$PREVIOUS_TARGET\/dist-web\/release\.json\"/);
  assert.match(remote, /merge-base --is-ancestor \"\$live_sha\" \"\$RELEASE_COMMIT\"/);
  assert.match(remote, /merge-base --is-ancestor \"\$control_sha\" \"\$RELEASE_COMMIT\"/);
  assert.doesNotMatch(remote, /merge-base --is-ancestor \"\$live_sha\" \"\$control_sha\"/);
  assert.match(remote, /test \"\$runtime_current\" = \"\$live_sha\" \|\| return 1/);
  assert.match(remote, /test \"\$platform_current\" = \"\$control_sha\" \|\| return 1/);
  assert.match(remote, /test \"\$legacy_current\" = \"\$live_sha\" \|\| return 1/);
  assert.match(remote, /stage RUNTIME_WEB_SPLIT_ACCEPTED/);
  assert.match(remote, /if test \"\$PLATFORM_HARDENING\" = 1; then[\s\S]*stage WEB_POINTER_PRESERVED[\s\S]*else[\s\S]*stage WEB_POINTER_SWITCH/);
  assert.match(validator, /RUNTIME_WEB_SPLIT_ACCEPTED/);
  assert.match(remote, /stage RUNTIME_REF_PRESERVED/);
  assert.match(validator, /RUNTIME_REF_PRESERVED/);
  assert.match(validator, /WEB_POINTER_PRESERVED/);
  assert.match(coreRelease, /forMission\(\$missionId\)/);
  assert.doesNotMatch(coreRelease, /issueOrResolve\(\$missionId/);
  assert.match(coreRelease, /Release source scope belongs to another repository/);
  assert.match(coreRelease, /Release source scope belongs to another release track/);
  assert.match(remote, /RUNTIME_REF=refs\/heads\/runtime\/production/);
  assert.match(remote, /TRACK_REF=refs\/heads\/production/);
  assert.match(remote, /TRACK_REF=refs\/heads\/platform\/production/);
  assert.match(remote, /rev-parse --verify "\$RUNTIME_REF\^\{commit\}"/);
  assert.match(remote, /rev-parse --verify "\$TRACK_REF\^\{commit\}"/);
  assert.match(remote, /merge-base --is-ancestor \"\$live_sha\" \"\$runtime_current\"/);
  assert.match(remote, /merge-base --is-ancestor \"\$runtime_current\" \"\$RELEASE_COMMIT\"/);
  assert.match(remote, /update-ref \"\$RUNTIME_REF\" \"\$live_sha\" \"\$runtime_current\"/);
  assert.match(remote, /pointer_capture; production_ref_reconcile_live; cleanup_loaded_topology/);
  assert.match(remote, /production_ref_restore\(\)/);
  assert.match(remote, /test \"\$current\" = \"\$RELEASE_COMMIT\" \|\| return 1/);
  assert.match(remote, /update-ref \"\$RUNTIME_REF\" \"\$PREVIOUS_PRODUCTION_SHA\" \"\$RELEASE_COMMIT\"/);
  assert.match(remote, /update-ref -d \"\$RUNTIME_REF\" \"\$RELEASE_COMMIT\"/);
  assert.match(remote, /track_ref_restore\(\)/);
  assert.match(remote, /if test \"\$PRODUCTION_REF_CHANGED\" -eq 1; then production_ref_restore \|\| ok=0; fi/);
  assert.match(remote, /PRODUCTION_REF_PREVIOUS=PRESENT[\s\S]*PREVIOUS_PRODUCTION_SHA=\$current_runtime[\s\S]*PRODUCTION_REF_CHANGED=1/);
  assert.match(remote, /TRACK_REF_PREVIOUS=PRESENT[\s\S]*PREVIOUS_TRACK_SHA=\$current_track[\s\S]*TRACK_REF_CHANGED=1/);
  assert.match(deploy, /DEPLOY_DIAGNOSTIC=SOURCE_DRIFT_FINDINGS_/);
  assert.match(telemetry, /'source-drift'.*'Source Authority Drift'.*'awh-source-drift\.timer'/);
  const drift = await readFile(join(root, 'hub/bin/ecosystem-source-drift.php'), 'utf8');
  assert.match(drift, /AWH canonical main ahead of runtime production/);
  assert.match(drift, /AWH main\/runtime production divergence/);
  assert.match(drift, /PENDING_RELEASE/);
  assert.match(drift, /required_capability<>'operator\.project_mission'/);
  assert.match(drift, /platformBlockingFindings/);
  assert.match(drift, /externalFindings/);
  assert.match(drift, /AWH execution context runtime drift/);
  assert.match(drift, /AWH working context drift/);
  assert.match(drift, /AWH web source provenance drift/);
  assert.match(drift, /AWH web runtime\/manifest drift/);
  assert.match(drift, /intentionalPlatformWebSplit/);
  assert.match(drift, /AWH web intentionally behind VPS Platform runtime/);
  assert.match(drift, /intentionalPlatformControlSplit/);
  assert.match(drift, /AWH Platform control intentionally ahead of Web runtime/);
  assert.match(drift, /hash_equals\(\$controlSource,strtolower\(\$runtimeProduction\)\)/);
  assert.match(drift, /hash_equals\(\$controlSource,strtolower\(\$platformProduction\)\)/);
  assert.match(drift, /hash_equals\(strtolower\(\$platformProduction\),strtolower\(\$runtimeProduction\)\)/);
  assert.match(drift, /hash_equals\(strtolower\(\$legacyProduction\),\$source\)/);
  assert.match(drift, /\$controlMatchesRuntime/);
  assert.match(drift, /updates\.js.*web\/updates\.js/s);
  assert.match(drift, /control-plane-adapter\.js.*web\/control-plane-adapter\.js/s);
  assert.match(drift, /teacher-evaluation/);
  assert.match(drift, /FIELD_PROOF/);
  assert.match(drift, /projectClass\(\$row\)!=='PRODUCTION'/);
  assert.match(drift, /AWH_CONTINUOUS_IMPROVEMENT/);
  assert.match(drift, /continuous-improvement policy is unavailable/);
  assert.match(drift, /continuousImprovementState/);
  assert.match(deploy, /config\/continuous-improvement-policy\.json/);
  assert.match(remote, /AWH_CONTINUOUS_IMPROVEMENT/);

});


test('VPS Platform storage safety is proactive, project-aware and durable', async () => {
  const [janitor,temp,tempService,tempTimer,guard,guardService,guardTimer,deploy,remote,operatorBridge,agents,operations] = await Promise.all([
    readFile(join(root, 'deploy/awh-storage/awh-temp-workspace-janitor.py'), 'utf8'),
    readFile(join(root, 'deploy/awh-storage/awh-temp-cleanup'), 'utf8'),
    readFile(join(root, 'deploy/systemd/awh-temp-cleanup.service'), 'utf8'),
    readFile(join(root, 'deploy/systemd/awh-temp-cleanup.timer'), 'utf8'),
    readFile(join(root, 'deploy/awh-storage/awh-storage-guard'), 'utf8'),
    readFile(join(root, 'deploy/systemd/awh-storage-guard.service'), 'utf8'),
    readFile(join(root, 'deploy/systemd/awh-storage-guard.timer'), 'utf8'),
    readFile(join(root, 'deploy/awh-control-plane/deploy-control-plane.sh'), 'utf8'),
    readFile(join(root, 'deploy/awh-control-plane/remote-deploy-control-plane.sh'), 'utf8'),
    readFile(join(root, 'hub/src/HubOperatorBridgeService.php'), 'utf8'),
    readFile(join(root, 'AGENTS.md'), 'utf8'),
    readFile(join(root, 'docs/OPERATIONS.md'), 'utf8'),
  ]);
  assert.match(janitor, /AWH_CANONICAL_ROOT/);
  assert.match(janitor, /UNKNOWN_FAIL_CLOSED/);
  assert.match(janitor, /control_task_executions/);
  assert.match(janitor, /control_execution_envelopes/);
  assert.match(janitor, /required_capability <> 'operator\.project_mission'/);
  assert.match(janitor, /status.*--porcelain-v1|status.*--porcelain=v1/s);
  assert.match(janitor, /lsof/);
  assert.match(janitor, /\/proc/);
  assert.match(janitor, /head_in_origin/);
  assert.match(janitor, /for-each-ref/);
  assert.match(janitor, /fresh_active\s*=\s*active_projects\(\)/);
  assert.match(janitor, /row\["projectId"\]\s+in\s+fresh_active/);
  assert.match(guard, /RECOVER=79/);
  assert.match(tempService, /ReadWritePaths=.*-\/var\/lib\/awh-remote\/tmp/);
  assert.match(guardService, /ReadWritePaths=.*-\/var\/lib\/awh-remote\/tmp/);
  assert.match(remote, /install -d -o awh-remote -g awh-operator -m 2770 \/var\/lib\/awh-remote\/tmp/);
  assert.match(janitor, /KEEP_NEWEST/);
  assert.match(janitor, /TARGET_FREE/);
  assert.match(janitor, /SKIPPED_PERMISSION/);
  assert.match(temp, /awh-temp-workspace-janitor\.py/);
  assert.match(temp, /AWH_STORAGE_PRESSURE/);
  assert.match(tempService, /User=root/);
  assert.match(tempService, /ReadWritePaths=.*\/var\/lib\/awh-hub/);
  assert.match(tempService, /ReadWritePaths=.*\/var\/lib\/awh-remote\/operator-staging/);
  assert.doesNotMatch(tempService, /\/usr\/local\/sbin\/awh-temp-cleanup/);
  assert.match(tempTimer, /OnUnitActiveSec=30m/);
  assert.match(guard, /TARGET_FREE=6442450944/);
  assert.match(guard, /WARN_FREE=6442450944/);
  assert.match(guard, /AWH_STORAGE_PRESSURE=1/);
  assert.match(guard, /AWH_TMP_KEEP_NEWEST_PER_REPO=1/);
  assert.match(temp, /AWH_PRESSURE_OPERATOR_STAGE_MAX_AGE_MINUTES:-60/);
  assert.match(temp, /AWH_REMOTE_TRANSIENT_MAX_AGE_MINUTES:-720/);
  assert.match(temp, /AWH_PRESSURE_REMOTE_TRANSIENT_MAX_AGE_MINUTES:-60/);
  assert.match(temp, /art-agent-\*\|awh-worker-\*\|awh-remote-connector-\*/);
  assert.match(temp, /owner.*awh-remote/s);
  assert.match(temp, /path_in_use \"\$d\"/);
  assert.match(temp, /remote_transient_dirs=\$remote_transient_dir_count/);
  assert.match(temp, /required_capability<>'operator\.project_mission'/);
  assert.match(temp, /AWH_REMOTE_ELECTRON_CACHE/);
  assert.match(temp, /AWH_REMOTE_NPM_CACHE/);
  assert.ok(temp.includes('REMOTE_UV_CACHE=' + '$' + '{AWH_REMOTE_UV_CACHE:-/var/lib/awh-remote/.cache/uv}'));
  assert.ok(temp.includes('\"$REMOTE_NPM_CACHE\" \"$REMOTE_UV_CACHE\"'));
  assert.match(temp, /reclaim_dependency_dirs/);
  assert.match(temp, /purge_regenerable_cache/);
  assert.match(temp, /vault-\*\.zip/);
  assert.match(temp, /for-each-ref --format='\%\(refname\)' --contains/);
  assert.match(temp, /AWH_CANONICAL_ROOT/);
  assert.match(tempService, /awh-remote\/\.cache/);
  assert.match(guardService, /awh-remote\/\.npm/);
  assert.match(janitor, /AWH_TMP_PRESSURE_MIN_AGE_MINUTES.*60/);
  assert.match(guardService, /ReadWritePaths=.*\/var\/lib\/awh-remote\/tmp/);
  assert.match(guardTimer, /OnUnitActiveSec=10m/);
  assert.match(remote, /systemctl restart "\$UNIT\.timer"/);
  assert.match(remote, /systemctl show -p SubState --value "\$UNIT\.timer"/);
  assert.match(deploy, /awh-temp-workspace-janitor\.py/);
  assert.match(deploy, /systemd-run --unit=\"\$REMOTE_UNIT\".*--collect --no-block/);
  assert.match(deploy, /sudo -n systemd-run --unit=\"\$REMOTE_UNIT\".*--collect --no-block/);
  assert.match(remote, /MAINTENANCE_WORKSPACE_JANITOR_READY/);
  assert.match(remote, /\/usr\/local\/sbin\/awh-temp-cleanup/);
  assert.match(remote, /\/usr\/local\/sbin\/awh-storage-guard/);
  assert.match(remote, /\/usr\/local\/sbin\/awh-retention-manager/);
  assert.match(remote, /sudo rm -f "\$LEGACY_HELPER"/);
  assert.match(remote, /awh-temp-cleanup\.service\.d\/20-private-tmp\.conf/);
  assert.match(remote, /awh-retention\.service\.d\/20-ecosystem-storage\.conf/);
  assert.match(remote, /sudo rm -f "\$LEGACY_DROPIN"/);
  assert.match(remote, /systemctl show -p ExecStart --value awh-temp-cleanup\.service/);
  assert.match(remote, /systemctl show -p ExecStart --value awh-retention\.service/);
  assert.match(operatorBridge, /STORAGE_TARGET_FREE_BYTES=6442450944/);
  assert.match(operatorBridge, /STORAGE_BLOCK_FREE_BYTES=3221225472/);
  assert.match(operatorBridge, /storageSafetyState/);
  assert.match(operatorBridge, /AWH_STORAGE_GUARD_STATE/);
  assert.match(operatorBridge, /'sourceReady'=>\$sourceGateReady/);
  assert.match(operatorBridge, /'productionReadyDeprecated'=>true/);
  assert.match(operatorBridge, /'runtimeParityState'=>'NOT_EVALUATED'/);
  assert.match(agents, /Owner Assist Fast Lane/);
  assert.match(operations, /Storage maintenance is proactive/);
});

test('VPS Platform M25 deploy and build isolation stay inside the platform release track', async () => {
  const [policyRaw, slice, qaRunner, deploy, remote, validator] = await Promise.all([
    readFile(join(root, 'config/ecosystem-platform-policy.json'), 'utf8'),
    readFile(join(root, 'deploy/systemd/awh-build.slice'), 'utf8'),
    readFile(join(root, 'scripts/ops/run-release-qa-isolated.sh'), 'utf8'),
    readFile(join(root, 'deploy/awh-control-plane/deploy-control-plane.sh'), 'utf8'),
    readFile(join(root, 'deploy/awh-control-plane/remote-deploy-control-plane.sh'), 'utf8'),
    readFile(join(root, 'deploy/awh-control-plane/validate-remote-output.sh'), 'utf8'),
  ]);
  const policy = JSON.parse(policyRaw);
  assert.equal(policy.releaseRunner.localIsolation.systemdSlice, 'awh-build.slice');
  assert.equal(policy.releaseRunner.localIsolation.cpuWeight, 10);
  assert.equal(policy.releaseRunner.localIsolation.cpuQuotaPercent, 100);
  assert.equal(policy.releaseRunner.localIsolation.memoryHighBytes, 1073741824);
  assert.equal(policy.releaseRunner.localIsolation.memoryMaxBytes, 1610612736);
  assert.equal(policy.releaseRunner.localIsolation.tasksMax, 1024);
  assert.match(slice, /CPUWeight=10/);
  assert.match(slice, /CPUQuota=100%/);
  assert.match(slice, /MemoryHigh=1G/);
  assert.match(slice, /MemoryMax=1536M/);
  assert.match(slice, /TasksMax=1024/);
  assert.match(qaRunner, /run_bounded install npm ci --ignore-scripts --no-audit --no-fund --prefer-offline/);
  assert.match(qaRunner, /run_bounded qa npm run "\$SCRIPT"/);
  assert.match(qaRunner, /--scope --collect/);
  assert.match(qaRunner, /--slice=awh-build\.slice/);
  assert.match(qaRunner, /--property=CPUQuota=100%/);
  assert.match(qaRunner, /--property=MemoryMax=1536M/);
  assert.match(deploy, /HubConversationDelegateMigration\.php/);
  assert.match(deploy, /HubPlatformMaintenanceMigration\.php/);
  assert.match(deploy, /HubPlatformMaintenanceService\.php/);
  assert.match(deploy, /AWH_CORE_DRY_RUN=PASS/);
  assert.match(deploy, /migrate-023-if-needed/);
  assert.match(deploy, /migrate-024-if-needed/);
  assert.match(remote, /23\|24\|25/);
  assert.match(remote, /AWH_CORE_MIGRATION_FIRST/);
  assert.match(remote, /AWH_CORE_MIGRATION_IDEMPOTENT/);
  assert.match(remote, /m24-conversation-delegates/);
  assert.match(remote, /m25-platform-maintenance-authority/);
  assert.match(remote, /control_platform_maintenance/);
  assert.match(remote, /PLATFORM_START_VERSION.*22\|23\|24\|25/);
  assert.match(remote, /PLATFORM_CONVERSATION_DELEGATE_MIGRATION_FIRST/);
  assert.match(remote, /PLATFORM_CONVERSATION_DELEGATE_MIGRATION_IDEMPOTENT/);
  assert.match(remote, /PLATFORM_MAINTENANCE_MIGRATION_FIRST/);
  assert.match(remote, /PLATFORM_MAINTENANCE_MIGRATION_IDEMPOTENT/);
  assert.match(remote, /PLATFORM_SCHEMA_VERSION=.*PRAGMA user_version/);
  assert.match(remote, /migrate-conversation-delegate\.php/);
  assert.match(remote, /migrate-platform-maintenance\.php/);
  assert.match(remote, /name='control_ai_delegates'/);
  assert.match(remote, /name='control_platform_maintenance'/);
  assert.match(remote, /PLATFORM_EXPECTED_VERSION=25/);
  assert.match(validator, /AWH_CORE_MIGRATION_VERIFIED/);
});


test('VPS Platform governed sensors and off-site Restic mirror remain subordinate to existing authorities', async () => {
  const [gatus, gatusUnit, beszelUnit, offsite, remote] = await Promise.all([
    readFile(join(root, 'deploy/observability/gatus.yaml'), 'utf8'),
    readFile(join(root, 'deploy/systemd/awh-gatus.service'), 'utf8'),
    readFile(join(root, 'deploy/systemd/awh-beszel.service'), 'utf8'),
    readFile(join(root, 'deploy/offsite-backup/macos/awh-backup-pull.sh'), 'utf8'),
    readFile(join(root, 'deploy/awh-control-plane/remote-deploy-control-plane.sh'), 'utf8'),
  ]);

  assert.match(gatus, /address: 127\.0\.0\.1/);
  assert.match(gatus, /port: 8088/);
  assert.match(gatus, /name: line-gateway[\s\S]*group: product[\s\S]*https:\/\/line\.kruart\.online\//);
  assert.match(gatusUnit, /User=awh-remote/);
  assert.match(gatusUnit, /GATUS_CONFIG_PATH=\/var\/lib\/awh-remote\/\.config\/gatus\/config\.yaml/);
  assert.match(gatusUnit, /NoNewPrivileges=true/);
  assert.match(beszelUnit, /127\.0\.0\.1:8090/);
  assert.match(beszelUnit, /ReadWritePaths=\/var\/lib\/awh-remote\/beszel-data/);

  assert.match(offsite, /awh-backup-export metadata/);
  assert.match(offsite, /awh-backup-export payload/);
  assert.match(offsite, /shasum -a 256/);
  assert.match(offsite, /\/usr\/local\/bin\/restic \/opt\/homebrew\/bin\/restic/);
  assert.match(offsite, /AWH_RESTIC_MIRROR=PASS/);
  assert.match(offsite, /restore "\$RESTIC_SNAPSHOT"/);
  assert.match(offsite, /forget --keep-last "\$KEEP" --prune --tag awh-offsite/);
  assert.match(offsite, /AWH_OFFSITE_BACKUP=PASS file=\$file restic=\$RESTIC_STATE/);

  assert.match(remote, /systemctl enable awh-gatus\.service awh-beszel\.service/);
  assert.match(remote, /systemctl start awh-gatus\.service awh-beszel\.service[^\n]*\|\| true/);
  assert.doesNotMatch(remote, /enable --now awh-gatus\.service awh-beszel\.service/);
  assert.match(remote, /while test "\$SENSOR_ATTEMPT" -lt 30/);
  assert.match(remote, /127\.0\.0\.1:8088\/health/);
  assert.match(remote, /beszel health --url http:\/\/127\.0\.0\.1:8090/);
  assert.match(remote, /test "\$SENSOR_RUNTIME_READY" = 1/);
  assert.match(remote, /mktemp -d \/tmp\/awh-platform-verify\.XXXXXX/);
  assert.match(remote, /chown awh-remote:awh-operator "\$d"/);
  assert.match(remote, /install -o awh-remote -g awh-operator -m 0755 "\$1\/scripts\/ops\/verify-platform-tooling\.sh" "\$d\/scripts\/ops\/verify-platform-tooling\.sh"/);
  assert.match(remote, /runuser -u awh-remote -- "\$d\/scripts\/ops\/verify-platform-tooling\.sh" --runtime/);
  assert.match(remote, /sh "\$RELEASE"/);
  assert.doesNotMatch(remote, /sudo -u awh-remote sh -c [^\n]*verify-platform-tooling/);
  assert.match(remote, /24\) test .*m24-conversation-delegates/);
  assert.match(remote, /25\) test .*m25-platform-maintenance-authority/);
});
