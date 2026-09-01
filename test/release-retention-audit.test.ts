import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('../deploy/awh-control-plane/audit-release-retention.sh', import.meta.url);

test('release retention audit is read-only and block-aware', async () => {
  const script = await readFile(scriptUrl, 'utf8');
  assert.match(script, /BatchMode=yes/);
  assert.match(script, /StrictHostKeyChecking=yes/);
  assert.match(script, /os\.statvfs\('\/'\)/);
  assert.match(script, /source_stat\.st_nlink/);
  assert.match(script, /GUARANTEED_RECLAIM_BYTES/);
  assert.match(script, /UNCERTAIN_SHARED_BYTES/);
  assert.match(script, /CURRENT_CONTROL=/);
  assert.match(script, /CURRENT_WEB=/);
  assert.match(script, /PREDICTED_USED_AFTER_BOTH_PERCENT=/);
  assert.doesNotMatch(script, /\b(?:rm|mv|ln|unlink|rename|chown|chmod|truncate|rmdir)\b/);
  assert.doesNotMatch(script, /os\.(?:remove|unlink|rename|replace|truncate)\s*\(/);
  assert.doesNotMatch(script, /open\([^\n]+['"](?:w|a|x|\+)/);
});
