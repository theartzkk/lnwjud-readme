import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('retention --plan is a zero-mutation inspection mode', async () => {
  const s=await readFile('deploy/awh-storage/awh-retention-manager.py','utf8');
  assert.match(s,/PLAN="--plan" in sys\.argv/);
  assert.match(s,/if not PLAN:\n\s+CFG\.mkdir/);
  assert.match(s,/if not PLAN:\n\s+tmp=Path\(str\(STATE\)/);
  assert.match(s,/"state":"APPLIED" if APPLY else \("PLAN" if PLAN else "PREVIEW"\)/);
  assert.match(s,/if APPLY:/);
});
