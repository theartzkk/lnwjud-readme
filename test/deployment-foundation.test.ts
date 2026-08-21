import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import test from 'node:test';

const ROOT = process.cwd();
const execFile = promisify(execFileCallback);

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
  const remoteDeploy = await readFile(join(ROOT, 'deploy/awh-enrollment/remote-deploy.sh'), 'utf8');
  const nginxInsert = await readFile(join(ROOT, 'deploy/awh-enrollment/insert-nginx-include.php'), 'utf8');
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
  assert.match(deploy, /DB_WRITE_READY|DB_WRITE_PROVISION_REQUIRED/);
  assert.match(remoteDeploy, /PRAGMA user_version/);
  assert.match(remoteDeploy, /rollback\(\)/);
  assert.match(remoteDeploy, /\.restore/);
  assert.match(remoteDeploy, /DB_UID|PARENT_UID/);
  assert.match(remoteDeploy, /ROLLBACK=PASS/);
  assert.match(remoteDeploy, /PHP_FPM_BIN.*-t/);
  assert.match(remoteDeploy, /systemctl reload/);
  assert.match(remoteDeploy, /useradd --system --user-group/);
  assert.match(remoteDeploy, /userdel awh-hub/);
  assert.doesNotMatch(remoteDeploy, /userdel --system awh-hub/);
  assert.match(remoteDeploy, /if test "\$SERVICE_USER_CREATED" -eq 1/);
  assert.match(remoteDeploy, /DEPLOY_STAGE=|DEPLOY_RESULT=PASS/);
  assert.doesNotMatch(remoteDeploy, /printf .*hash|printf .*token|printf .*nonce/i);
  assert.match(remoteDeploy, /insert-nginx-include\.php/);
  assert.match(nginxInsert, /authoritative AWH HTTPS server block/);
  assert.match(nginxInsert, /Exactly one authoritative/);
  assert.match(deploy, /remote-deploy\.sh/);
  assert.match(remoteDeploy, /sqlite3/);
  assert.match(remoteDeploy, /systemctl reload/);
  assert.match(remoteDeploy, /nginx -t/);
  assert.match(remoteDeploy, /enrollment\/devices/);
  assert.match(remoteDeploy, /\.restore/);
  assert.doesNotMatch(remoteDeploy, /echo .*BOOTSTRAP|printf .*BOOTSTRAP|cat .*bootstrap/i);
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
  assert.match(preflight, /DB_WRITE_READY/);
  assert.match(preflight, /DB_WRITE_PROVISION_REQUIRED/);
  assert.match(preflight, /DB_WRITE_BLOCKED/);
  assert.match(preflight, /effective_nginx_server_config/);
  assert.match(preflight, /enrollment_route/);
  assert.match(preflight, /enrollment_pool/);
  assert.match(preflight, /enrollment_bootstrap_hash/);
  assert.match(preflight, /nginx -T/);
  assert.match(preflight, /php8\.3-fpm/);
  assert.doesNotMatch(preflight, /scp\s|systemctl\s+(?:reload|restart|start|stop)|sudo\s+(?:install|rm|mv|cp|ln)/i);
  assert.doesNotMatch(`${nginx}\n${pool}\n${deploy}\n${preflight}`, /BEGIN [A-Z ]+PRIVATE KEY|password\s*[:=]\s*[^<{{\s]+|pairingCode\s*[:=]\s*[^<{{\s]+/i);
});

test('guarded deployment refuses a dirty tree and rollback order stays restore-first', async () => {
  const deploy = join(ROOT, 'deploy/awh-enrollment/deploy-enrollment.sh');
  await assert.rejects(() => execFile('sh', [deploy, '--deploy'], { cwd: ROOT, env: { ...process.env, AWH_SOURCE_ROOT: ROOT, AWH_DEPLOY_TARGET: 'awh-vps' } }), /dirty|uncommitted/i);

  const remote = await readFile(join(ROOT, 'deploy/awh-enrollment/remote-deploy.sh'), 'utf8');
  const order = [
    remote.indexOf('.restore'),
    remote.indexOf('chown "$DB_UID:$DB_GID"'),
    remote.indexOf('ln -sfn "$PREVIOUS_TARGET"'),
    remote.indexOf('cp -p "$NGINX_BACKUP"'),
    remote.indexOf('cp -p "$POOL_BACKUP"'),
    remote.indexOf('PHP_FPM_BIN" -t'),
    remote.indexOf('systemctl reload'),
  ];
  assert.equal(order.every((value) => value >= 0), true);
  assert.equal(order.every((value, index) => index === 0 || value > order[index - 1]!), true);
});

test('DB permission readiness arithmetic accepts safe 640/750 modes without broad group write', async () => {
  await execFile('sh', ['-c', 'DB_MODE=640; PARENT_MODE=750; test $((0$DB_MODE & 0020)) -eq 0; test $((0$PARENT_MODE & 0020)) -eq 0; test $((0$DB_MODE & 0600)) -eq $((0600)); test $((0$PARENT_MODE & 0700)) -eq $((0700))']);
});

test('Nginx enrollment insertion selects exactly the AWH HTTPS server, not an HTTP redirect', async () => {
  const php = existsSync('/opt/local/bin/php') ? '/opt/local/bin/php' : 'php';
  const root = await mkdtemp(join(tmpdir(), 'awh-nginx-fixture-'));
  const input = join(root, 'awh.conf');
  const output = join(root, 'awh.out.conf');
  const includePath = '/opt/awh-hub/enrollment-current/deploy/nginx/awh-enrollment.conf';
  const fixture = `server {\n    listen 80;\n    return 301 https://$host$request_uri;\n}\n\nserver {\n    listen 443 ssl;\n    fastcgi_param AWH_HUB_DB_PATH /var/lib/awh-hub/awh.sqlite;\n    fastcgi_param SCRIPT_FILENAME /opt/awh-hub/public/web-gateway.php;\n    location ^~ /api/v1/ {\n        try_files $uri /web-gateway.php?$query_string;\n    }\n}\n`;
  try {
    await writeFile(input, fixture, 'utf8');
    await execFile(php, [join(ROOT, 'deploy/awh-enrollment/insert-nginx-include.php'), input, output, includePath]);
    const inserted = await readFile(output, 'utf8');
    assert.equal((inserted.match(new RegExp(`include ${includePath.replaceAll('/', '\\/')};`, 'g')) ?? []).length, 1);
    const httpBlock = inserted.slice(0, inserted.indexOf('server {', inserted.indexOf('server {') + 1));
    assert.doesNotMatch(httpBlock, /enrollment-current/);
    assert.ok(inserted.indexOf(`include ${includePath};`) > inserted.indexOf('fastcgi_param SCRIPT_FILENAME'));
    await execFile(php, [join(ROOT, 'deploy/awh-enrollment/insert-nginx-include.php'), output, input, includePath]);
    const idempotent = await readFile(input, 'utf8');
    assert.equal(idempotent, inserted);

    const ambiguous = join(root, 'ambiguous.conf');
    await writeFile(ambiguous, `${fixture}\n${fixture.slice(fixture.indexOf('server {', fixture.indexOf('server {') + 1))}`, 'utf8');
    await assert.rejects(() => execFile(php, [join(ROOT, 'deploy/awh-enrollment/insert-nginx-include.php'), ambiguous, output, includePath]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
