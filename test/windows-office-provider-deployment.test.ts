import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('M16 Office provider keeps raw PDF transport bounded and device-leased', async () => {
  const [entry, router, service, runtime] = await Promise.all([
    readFile(join(root, 'hub/public/control-plane.php'), 'utf8'),
    readFile(join(root, 'hub/src/HubControlPlaneRouter.php'), 'utf8'),
    readFile(join(root, 'hub/src/HubControlPlaneService.php'), 'utf8'),
    readFile(join(root, 'src/control-plane-worker-runtime.ts'), 'utf8'),
  ]);
  assert.match(entry, /workerOfficeArtifact/);
  assert.match(entry, /50 \* 1024 \* 1024/);
  assert.match(entry, /officeArtifact/);
  assert.match(router, /office-artifact/);
  assert.match(router, /application\/pdf/);
  assert.match(router, /acceptOfficeExecutionArtifact/);
  assert.match(service, /OFFICE_TO_PDF/);
  assert.match(service, /office\.word\.pdf/);
  assert.match(service, /office\.excel\.pdf/);
  assert.match(service, /office\.powerpoint\.pdf/);
  assert.match(service, /%PDF-/);
  assert.match(service, /updateEnvelopeState/);
  assert.match(runtime, /officeExecutionCapabilities/);
  assert.doesNotMatch(`${entry}\n${router}\n${service}`, /StrictHostKeyChecking=no|BEGIN [A-Z ]+PRIVATE KEY/i);
});
