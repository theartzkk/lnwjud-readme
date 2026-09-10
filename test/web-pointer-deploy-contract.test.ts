import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const read = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('web deploy accepts safe absolute and relative release pointers', async () => {
  const remote = await read('deploy/awh-control-plane/remote-deploy-control-plane.sh');
  assert.match(remote, /\/var\/www\/awh-web\/releases\/\*/);
  assert.match(remote, /releases\/\*/);
  assert.match(remote, /WEB_REL=\$\{WEB_TARGET#releases\/\}/);
  assert.match(remote, /''\|\*\/\*\|\*\[!A-Za-z0-9\._-\]\*\) return 1/);
  assert.match(remote, /test -d "\/var\/www\/awh-web\/releases\/\$WEB_REL" \|\| return 1/);
  assert.match(remote, /sudo ln -s "\$WEB_TARGET" "\$WEB_POINTER"/);
});

test('web pointer capture remains fail-closed for non-release targets', async () => {
  const remote = await read('deploy/awh-control-plane/remote-deploy-control-plane.sh');
  const start = remote.indexOf('web_pointer_capture()');
  const end = remote.indexOf('web_pointer_restore()', start);
  assert.ok(start >= 0 && end > start);
  const capture = remote.slice(start, end);
  assert.match(capture, /\*\) return 1/);
  assert.doesNotMatch(capture, /realpath .*\|\| true|readlink -f .*\|\| true/);
});

test('named web deployment validates manifest and rendered release identity before activation', async () => {
  const deploy = await read('deploy/awh-web/deploy-preview.sh');
  assert.match(deploy, /validate-release\.sh "\$LOCAL_DIR" "\$RELEASE_ID"/);
  assert.match(deploy, /releaseId/);
  assert.match(deploy, /release=\$RELEASE_ID/);
  assert.match(deploy, /release=local/);
  assert.match(deploy, /REMOTE_SHARED_DOWNLOADS="\$REMOTE_ROOT\/shared\/downloads"/);
  assert.match(deploy, /sudo test ! -e \$REMOTE_ROOT\/releases\/\$RELEASE_ID\/downloads/);
  assert.match(deploy, /sudo ln -s \.\.\/\.\.\/shared\/downloads \$REMOTE_ROOT\/releases\/\$RELEASE_ID\/downloads/);
});

test('web release validator rejects local or mismatched identity for a named release', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-release-identity-'));
  const validator = new URL('../deploy/awh-web/validate-release.sh', import.meta.url);
  const releaseId = 'm20-contract-test';
  try {
    await mkdir(root, { recursive: true });
    await Promise.all([
      writeFile(join(root, 'index.html'), `<link href="./styles.css?release=${releaseId}">\n`, 'utf8'),
      writeFile(join(root, 'styles.css'), 'body{}\n', 'utf8'),
      writeFile(join(root, 'app.js'), 'console.log("ready")\n', 'utf8'),
      writeFile(join(root, 'hub-read-adapter.js'), 'export {}\n', 'utf8'),
      writeFile(join(root, 'data.json'), '{}\n', 'utf8'),
      writeFile(join(root, 'release.json'), `${JSON.stringify({ schemaVersion: 1, releaseId }, null, 2)}\n`, 'utf8'),
    ]);

    const ok = await execFileAsync('sh', [validator.pathname, root, releaseId]);
    assert.match(ok.stdout, /validation: PASS/);

    await writeFile(join(root, 'index.html'), '<link href="./styles.css?release=local">\n', 'utf8');
    await assert.rejects(
      execFileAsync('sh', [validator.pathname, root, releaseId]),
      /Rendered HTML release identity mismatch|Local release identity rejected/,
    );

    await writeFile(join(root, 'index.html'), `<link href="./styles.css?release=${releaseId}">\n`, 'utf8');
    await writeFile(join(root, 'release.json'), `${JSON.stringify({ schemaVersion: 1, releaseId: 'other-release' }, null, 2)}\n`, 'utf8');
    await assert.rejects(
      execFileAsync('sh', [validator.pathname, root, releaseId]),
      /Release manifest identity mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
