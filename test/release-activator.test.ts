import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

async function read(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8');
}

test('typed release activator is bounded and fail-closed', async () => {
  const source = await read('hub/bin/activate-release.php');
  assert.match(source, /PHP_SAPI !== 'cli'/);
  assert.match(source, /\^m16-\(\[0-9a-f\]\{12\}\)/);
  assert.match(source, /RELEASE_COMMIT_MARKER_MISMATCH/);
  assert.match(source, /PRAGMA integrity_check/);
  assert.match(source, /PRAGMA foreign_key_check/);
  assert.match(source, /state IN \('LEASED','RUNNING'\)/);
  assert.match(source, /EXECUTIONS_ACTIVE/);
  assert.match(source, /verifyWebManifest/);
  assert.match(source, /WEB_SW_RELEASE_MISMATCH/);
  assert.match(source, /\$data\['surface'\].*\['mode'\]/);
  assert.doesNotMatch(source, /\$data\['mode'\]/);
  assert.match(source, /swapPointer\(AWH_CONTROL_POINTER/);
  assert.match(source, /restorePointer\(AWH_CONTROL_POINTER/);
});

test('deployment packages typed activation authority and exact commit evidence', async () => {
  const deploy = await read('deploy/awh-control-plane/deploy-control-plane.sh');
  assert.match(deploy, /hub\/bin\/activate-release\.php/);
  assert.match(deploy, /\.awh-build\/release-commit\.txt/);
  assert.match(deploy, /grep -Fx "\$RELEASE"/);
  assert.match(deploy, /EXTRA_FILES='\.awh-build\/awh-source\.zip \.awh-build\/release-commit\.txt'/);
});
