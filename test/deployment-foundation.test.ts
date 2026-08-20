import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();

test('local deployment assets are dry-run by default and require explicit reviewed deployment', async () => {
  const deploy = await readFile(join(ROOT, 'deploy/awh-web/deploy-preview.sh'), 'utf8');
  const rollback = await readFile(join(ROOT, 'deploy/awh-web/rollback-preview.sh'), 'utf8');
  const caddy = await readFile(join(ROOT, 'deploy/caddy/awh-preview.Caddyfile'), 'utf8');
  const health = await readFile(join(ROOT, 'deploy/awh-web/health-check.sh'), 'utf8');
  assert.match(deploy, /MODE=dry-run/);
  assert.match(deploy, /--deploy/);
  assert.match(rollback, /MODE=dry-run/);
  assert.match(rollback, /--deploy/);
  assert.match(deploy, /StrictHostKeyChecking=yes/);
  assert.doesNotMatch(`${deploy}\n${rollback}\n${caddy}`, /(?:1\.2\.3\.4|BEGIN [A-Z ]+PRIVATE KEY|password\s*[:=]\s*[^<{\s]+)/i);
  assert.doesNotMatch(`${deploy}\n${rollback}`, /\beval\s+|curl\s+|wget\s+/i);
  assert.match(caddy, /AWH_CADDY_PASSWORD_HASH/);
  assert.match(health, /MODE=dry-run/);
  assert.match(health, /--proto '=https'/);
});

test('Hub data schema has explicit provenance and no workspace or content columns', async () => {
  const schema = await readFile(join(ROOT, 'hub/schema.sql'), 'utf8');
  assert.match(schema, /provenance/);
  assert.match(schema, /observed_at/);
  assert.doesNotMatch(schema, /workspace_path|\bcontent\b/i);
});
