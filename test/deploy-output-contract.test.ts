import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('every remote deploy stage is accepted by the strict output validator', async () => {
  const [remote, validator] = await Promise.all([
    read('deploy/awh-control-plane/remote-deploy-control-plane.sh'),
    read('deploy/awh-control-plane/validate-remote-output.sh'),
  ]);

  const emitted = new Set(
    [...remote.matchAll(/\bstage\s+([A-Z0-9_]+)/g)].map((match) => match[1]),
  );
  const allowedMatch = validator.match(/ALLOWED_STAGES='([^']+)'/);
  assert.ok(allowedMatch, 'validator must declare ALLOWED_STAGES');
  const allowed = new Set(allowedMatch[1].trim().split(/\s+/));

  const missing = [...emitted].filter((stage) => !allowed.has(stage)).sort();
  assert.deepEqual(
    missing,
    [],
    `strict output validator is missing remote deploy stages: ${missing.join(', ')}`,
  );
});


test('modern production deploys run in a server-side durable systemd unit', async () => {
  const [deploy, runner] = await Promise.all([
    read('deploy/awh-control-plane/deploy-control-plane.sh'),
    read('deploy/awh-control-plane/durable-remote-runner.sh'),
  ]);
  assert.match(deploy, /sudo -n systemd-run/);
  assert.match(deploy, /REMOTE_RESULT/);
  assert.match(deploy, /REMOTE_LOG/);
  assert.match(deploy, /systemctl is-active/);
  assert.match(deploy, /durable_attempt/);
  assert.match(runner, /sh "\$SCRIPT" "\$@"/);
  assert.match(runner, /mv -f "\$TMP_RESULT" "\$RESULT"/);
});
