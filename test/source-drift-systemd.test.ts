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
  assert.match(remote, /enable --now awh-source-drift\.timer/);
  assert.match(remote, /SOURCE_DRIFT_VERIFY/);
  assert.match(remote, /ecosystem-source-drift\.php" "\$DB" \/srv\/awh-git "\$WEB_POINTER\/release\.json"/);
  assert.match(remote, /DEPLOY_DIAGNOSTIC=SOURCE_DRIFT_FINDINGS_/);
  assert.match(remote, /drift_count=/);
  assert.match(deploy, /DEPLOY_DIAGNOSTIC=SOURCE_DRIFT_FINDINGS_/);
  assert.match(telemetry, /'source-drift'.*'Source Authority Drift'.*'awh-source-drift\.timer'/);
  const drift = await readFile(join(root, 'hub/bin/ecosystem-source-drift.php'), 'utf8');
  assert.match(drift, /AWH main ahead of production/);
  assert.match(drift, /AWH main\/production divergence/);
  assert.match(drift, /PENDING_RELEASE/);
  assert.match(drift, /AWH execution context runtime drift/);
  assert.match(drift, /AWH working context drift/);

});
