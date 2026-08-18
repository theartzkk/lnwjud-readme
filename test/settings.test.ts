import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadStoredSettings, saveStoredSettings } from '../src/settings.js';

test('stored settings persist only known non-secret fields', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'art-agent-settings-'));
  await saveStoredSettings(dataDir, { defaultWorkspace: 'C:/Projects/Test', allowWrite: true, allowExec: false, allowCodex: false });
  assert.deepEqual(loadStoredSettings(dataDir), { defaultWorkspace: 'C:/Projects/Test', allowWrite: true, allowExec: false, allowCodex: false });
  await saveStoredSettings(dataDir, { defaultWorkspace: 'D:/Projects/Next', allowWrite: false, allowExec: true, allowCodex: true });
  assert.deepEqual(loadStoredSettings(dataDir), { defaultWorkspace: 'D:/Projects/Next', allowWrite: false, allowExec: true, allowCodex: true });
});
