import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('MariaDB restore rehearsal is staging/proof-only and cleans its temporary authority', async()=>{
  const s=await readFile('deploy/awh-database/mariadb-restore-rehearsal.py','utf8');
  assert.match(s,/SOURCE_NOT_PROVEN_NON_PRODUCTION/);
  assert.match(s,/\('staging','proof'\)/);
  assert.match(s,/awh_restore_drill_/);
  assert.match(s,/DROP DATABASE IF EXISTS/);
  assert.match(s,/mariadb-dump/);
  assert.match(s,/--single-transaction/);
  assert.match(s,/rowCountMismatchCount/);
  assert.doesNotMatch(s,/DROP DATABASE.*source|DELETE FROM|TRUNCATE/i);
});
