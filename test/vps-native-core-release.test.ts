import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('VPS-native core release reuses canonical approval and deploy authorities', async () => {
  const [service, operator, runner, router, trust, deploy, remote, hosting] = await Promise.all([
    readFile('hub/src/HubCoreReleaseService.php', 'utf8'),
    readFile('hub/src/HubCoreReleaseOperator.php', 'utf8'),
    readFile('hub/bin/awh-core-release-run.php', 'utf8'),
    readFile('hub/src/HubControlPlaneRouter.php', 'utf8'),
    readFile('hub/src/HubTrustPolicy.php', 'utf8'),
    readFile('deploy/awh-control-plane/deploy-control-plane.sh', 'utf8'),
    readFile('deploy/awh-control-plane/remote-deploy-control-plane.sh', 'utf8'),
    readFile('hub/bin/awh-hosting-operator.php', 'utf8'),
  ]);

  assert.match(service, /required_capability.*system\.core\.release|CAPABILITY='system\.core\.release'/s);
  assert.match(service, /'deployment\.approve'/);
  assert.match(service, /WAITING_FOR_APPROVAL/);
  assert.match(service, /assertRecentStepUpSession/);
  assert.doesNotMatch(service, /shell_exec|proc_open|popen\s*\(|passthru\s*\(|\/bin\/sh/);

  assert.match(trust, /'system\.core\.release'.*CRITICAL.*true.*true/);
  assert.match(router, /\/api\/v1\/control\/system\/releases/);

  assert.match(operator, /file:\/\/\/srv\/awh-git\/awh\.git/);
  assert.match(operator, /systemd-run/);
  assert.match(operator, /bounded-deploy-mission\.mjs/);
  assert.match(operator, /AWH_DEPLOY_TRANSPORT.*local/s);
  assert.match(operator, /posix_geteuid/);
  assert.match(operator, /Node 22\+/);
  assert.doesNotMatch(operator, /sudo\s|shell_exec|\/bin\/sh/);
  assert.match(runner, /runExecution/);

  assert.match(hosting, /PAUSED_FOR_CORE_RELEASE/);
  assert.match(hosting, /HubCoreReleaseOperator/);

  assert.match(deploy, /AWH_DEPLOY_TRANSPORT:-ssh/);
  assert.match(deploy, /Local production deployment requires root authority/);
  assert.match(remote, /required_capability <> 'system\.core\.release'/);
  assert.equal((remote.match(/required_capability <> 'system\.core\.release'/g) ?? []).length, 9);

  for (const file of ['hub/src/HubCoreReleaseService.php','hub/src/HubCoreReleaseOperator.php','hub/bin/awh-core-release-run.php']) {
    assert.ok(deploy.includes(file), `release bundle must include ${file}`);
    assert.ok(remote.includes(file), `remote staging gate must verify ${file}`);
  }
});
