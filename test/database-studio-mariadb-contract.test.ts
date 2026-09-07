import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root=process.cwd();

test('MariaDB Studio installer is check-first, bounded, and provisions SELECT-only observer', async()=>{
  const s=await readFile(`${root}/deploy/awh-control-plane/install-database-studio-mariadb.sh`,'utf8');
  assert.match(s,/MODE=\$\{1:---check\}/);
  assert.match(s,/GRANT SELECT, SHOW VIEW/);
  assert.match(s,/OBSERVER_WRITE_GUARD_FAILED/);
  assert.match(s,/DATABASE_STUDIO_MARIADB_ROLLBACK=PASS/);
  assert.match(s,/AWH_DATABASE_STUDIO_MARIADB_PASSWORD_FILE/);
  assert.doesNotMatch(s,/GRANT ALL|ALL PRIVILEGES/);
});

test('MariaDB reader exposes no mutation API and uses server-side unix socket credentials', async()=>{
  const s=await readFile(`${root}/hub/src/HubMariaDbReadClient.php`,'utf8');
  assert.match(s,/unix_socket=/);
  assert.match(s,/AWH_DATABASE_STUDIO_MARIADB_PASSWORD_FILE/);
  assert.match(s,/readOnly.*true/);
  assert.doesNotMatch(s,/function\s+(?:insert|update|delete|drop|alter|create)\s*\(/i);
});
