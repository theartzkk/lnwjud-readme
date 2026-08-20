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

test('Nginx Hub read gateway keeps the perimeter and PHP-FPM private', async () => {
  const nginx = await readFile(join(ROOT, 'deploy/nginx/awh-preview.conf'), 'utf8');
  assert.match(nginx, /auth_basic\s+"AWH Remote Preview"/);
  assert.match(nginx, /auth_basic_user_file\s+\/etc\/nginx\/\.awh-preview-users;/);
  assert.doesNotMatch(nginx, /\/etc\/awh-hub\/preview\.htpasswd/);
  assert.match(nginx, /location \^~ \/api\/v1\//);
  assert.match(nginx, /SCRIPT_FILENAME .*web-gateway\.php/);
  assert.match(nginx, /AWH_WEB_GATEWAY_TRUSTED_PERIMETER nginx/);
  assert.match(nginx, /fastcgi_pass unix:/);
  assert.doesNotMatch(nginx, /fastcgi_pass\s+(?:127\.0\.0\.1|localhost|[0-9]+\.[0-9]+)/);
  assert.doesNotMatch(nginx, /(?:BEGIN [A-Z ]+PRIVATE KEY|password\s*[:=]\s*[^<{\s]+|AWH_HUB_READ_TOKEN_HASH\s*[:=])/i);
  assert.doesNotMatch(nginx, /HTTP_X_AWH_WEB_GATEWAY_TRUSTED_PERIMETER/);
});
