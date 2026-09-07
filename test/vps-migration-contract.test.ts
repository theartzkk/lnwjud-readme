import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();

test('VPS migration audit is read-only and excludes credential surfaces', async () => {
  const script = await readFile(join(ROOT, 'scripts/ops/vps-migration-audit.sh'), 'utf8');
  assert.match(script, /AUDIT_MODE=READ_ONLY/);
  assert.doesNotMatch(script, /\brm\s+-|\bDROP\s+(?:DATABASE|TABLE)|\bDELETE\s+FROM|\bTRUNCATE\b|mysqldump|\.env\b|credential_ref|DB_PASSWORD/i);
  assert.match(script, /information_schema\.tables/);
  assert.match(script, /nginx -T/);
});

test('migration contract forbids dual-write and preserves live data authority', async () => {
  const doc = await readFile(join(ROOT, 'docs/VPS-MIGRATION-READINESS.md'), 'utf8');
  assert.match(doc, /Never dual-write/i);
  assert.match(doc, /current live database remains Source of Truth/i);
  assert.match(doc, /shadow copy/i);
  assert.match(doc, /BAY EXCUSE X \(last business-system cutover/i);
  assert.match(doc, /credentials.*never exposed/i);
});
