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
  assert.match(deploy, /AWH_DEPLOY_TARGET:-awh-vps/);
  assert.match(deploy, /--deploy/);
  assert.match(rollback, /MODE=dry-run/);
  assert.match(rollback, /AWH_DEPLOY_TARGET:-awh-vps/);
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

test('enrollment deployment is isolated, bearer-compatible, and dry-run by default', async () => {
  const nginx = await readFile(join(ROOT, 'deploy/nginx/awh-enrollment.conf'), 'utf8');
  const pool = await readFile(join(ROOT, 'deploy/php-fpm/awh-enrollment.pool.conf'), 'utf8');
  const deploy = await readFile(join(ROOT, 'deploy/awh-enrollment/deploy-enrollment.sh'), 'utf8');
  const preflight = await readFile(join(ROOT, 'deploy/awh-enrollment/preflight-production.sh'), 'utf8');
  assert.match(nginx, /location \^~ \/api\/v1\/enrollment\//);
  assert.match(nginx, /auth_basic off/);
  assert.match(nginx, /HTTP_AUTHORIZATION \$http_authorization/);
  assert.match(nginx, /client_max_body_size 16k/);
  assert.match(nginx, /access_log off/);
  assert.match(nginx, /enrollment-current\/public\/enrollment\.php/);
  assert.match(nginx, /fastcgi_pass unix:/);
  assert.match(pool, /clear_env = yes/);
  assert.match(pool, /AWH_ENROLLMENT_BOOTSTRAP_NONCE_HASH/);
  assert.match(pool, /REPLACE_WITH_SHA256_HASH_PROVISIONED_OUT_OF_BAND/);
  assert.match(deploy, /MODE=dry-run/);
  assert.match(deploy, /--deploy/);
  assert.match(deploy, /AWH_DEPLOY_TARGET:-awh-vps/);
  assert.match(deploy, /PRODUCTION_DEPLOY_APPROVAL_REQUIRED/);
  assert.match(deploy, /StrictHostKeyChecking=yes/);
  assert.match(deploy, /migrate-m3e2\.php/);
  assert.match(deploy, /Refusing deployment from a dirty or uncommitted working tree/);
  assert.match(deploy, /db_enrollment_write=PASS/);
  assert.match(deploy, /PRAGMA user_version/);
  assert.match(deploy, /rollback\(\)/);
  assert.match(deploy, /\.restore/);
  assert.match(preflight, /AWH_DEPLOY_TARGET|awh-vps/);
  assert.match(preflight, /DB_AUTHORITY_RESOLVED/);
  assert.match(preflight, /DB_NOT_FOUND/);
  assert.match(preflight, /DB_AMBIGUOUS/);
  assert.match(preflight, /DB_INTEGRITY_FAILED/);
  assert.match(preflight, /BACKUP_READY/);
  assert.match(preflight, /BACKUP_PROVISION_REQUIRED/);
  assert.match(preflight, /BACKUP_BLOCKED/);
  assert.match(preflight, /FIRST_DEPLOY_EXPECTED/);
  assert.match(preflight, /PRAGMA integrity_check/);
  assert.match(preflight, /PRAGMA foreign_key_check/);
  assert.match(preflight, /enrollment_rate_limits/);
  assert.match(preflight, /projects=.*devices=.*builds=.*releases=/);
  assert.match(preflight, /canonical_project/);
  assert.match(preflight, /db_enrollment_write/);
  assert.match(preflight, /effective_nginx_server_config/);
  assert.match(preflight, /enrollment_route/);
  assert.match(preflight, /enrollment_pool/);
  assert.match(preflight, /nginx -T/);
  assert.match(preflight, /php8\.3-fpm/);
  assert.doesNotMatch(preflight, /scp\s|systemctl\s+(?:reload|restart|start|stop)|sudo\s+(?:install|rm|mv|cp|ln)/i);
  assert.doesNotMatch(`${nginx}\n${pool}\n${deploy}\n${preflight}`, /BEGIN [A-Z ]+PRIVATE KEY|password\s*[:=]\s*[^<{{\s]+|pairingCode\s*[:=]\s*[^<{{\s]+/i);
});
