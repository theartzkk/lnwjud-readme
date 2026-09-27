import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('project source authority ships a persistent least-privilege drift monitor', async () => {
  const [service, timer, deploy, remote, telemetry] = await Promise.all([
    readFile(join(root, 'deploy/systemd/awh-source-drift.service'), 'utf8'),
    readFile(join(root, 'deploy/systemd/awh-source-drift.timer'), 'utf8'),
    readFile(join(root, 'deploy/awh-control-plane/deploy-control-plane.sh'), 'utf8'),
    readFile(join(root, 'deploy/awh-control-plane/remote-deploy-control-plane.sh'), 'utf8'),
    readFile(join(root, 'hub/bin/system-telemetry.php'), 'utf8'),
  ]);

  assert.match(service, /User=awh-hub/);
  assert.match(service, /Group=awh-hub/);
  assert.match(service, /ecosystem-source-drift\.php \/var\/lib\/awh-hub\/awh\.sqlite \/srv\/awh-git \/var\/www\/awh-web\/current\/release\.json/);
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
  assert.match(remote, /drift_count=/);
  assert.match(remote, /PRODUCTION_REF_CHANGED=0; PRODUCTION_REF_PREVIOUS=ABSENT; PREVIOUS_PRODUCTION_SHA=/);
  assert.match(remote, /production_ref_reconcile_live\(\)/);
  assert.match(remote, /live_manifest=\/var\/www\/awh-web\/current\/release\.json/);
  assert.match(remote, /control_manifest=\"\$PREVIOUS_TARGET\/dist-web\/release\.json\"/);
  assert.match(remote, /test \"\$control_sha\" = \"\$live_sha\" \|\| return 1/);
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
  assert.match(drift, /AWH execution context runtime drift/);
  assert.match(drift, /AWH working context drift/);
  assert.match(drift, /AWH web source provenance drift/);
  assert.match(drift, /AWH web runtime\/manifest drift/);
  assert.match(drift, /updates\.js.*web\/updates\.js/s);
  assert.match(drift, /control-plane-adapter\.js.*web\/control-plane-adapter\.js/s);
  assert.match(drift, /teacher-evaluation/);
  assert.match(drift, /FIELD_PROOF/);
  assert.match(drift, /projectClass\(\$row\)!=='PRODUCTION'/);

});
