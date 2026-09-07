import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
