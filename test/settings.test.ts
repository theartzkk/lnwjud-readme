import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadStoredSettings, saveStoredSettings } from '../src/settings.js';

test('stored settings persist only known non-secret fields', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'art-agent-settings-'));
  const projectId = '11111111-1111-4111-8111-111111111111';
  await saveStoredSettings(dataDir, { defaultWorkspace: 'C:/Projects/Test', selectedHubProjectId: projectId, allowWrite: true, allowExec: false, allowCodex: false, controlPlaneWorker: false, updateChannel: 'stable' });
  assert.deepEqual(loadStoredSettings(dataDir), { defaultWorkspace: 'C:/Projects/Test', selectedHubProjectId: projectId, allowWrite: true, allowExec: false, allowCodex: false, controlPlaneWorker: false, updateChannel: 'stable' });
  await saveStoredSettings(dataDir, { defaultWorkspace: 'D:/Projects/Next', selectedHubProjectId: projectId, allowWrite: false, allowExec: true, allowCodex: true, controlPlaneWorker: true, updateChannel: 'preview' });
  assert.deepEqual(loadStoredSettings(dataDir), { defaultWorkspace: 'D:/Projects/Next', selectedHubProjectId: projectId, allowWrite: false, allowExec: true, allowCodex: true, controlPlaneWorker: true, updateChannel: 'preview' });
});
