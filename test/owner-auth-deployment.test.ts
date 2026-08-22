import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const PHP = '/opt/local/bin/php';
const helper = join(ROOT, 'deploy/nginx/transform-owner-auth.php');
const originRenderer = join(ROOT, 'deploy/nginx/render-control-plane-include.php');
const HOST = '157-85-108-142.sslip.io';
const ENROLLMENT = '/opt/awh-hub/enrollment-current/deploy/nginx/awh-enrollment.conf';
const CONTROL = '/opt/awh-hub/control-plane-current/deploy/nginx/awh-control-plane.conf';

function productionShape(): string {
  return `# sanitized ReadyIDC production-shaped fixture
server {
    listen 443 ssl http2;
    server_name ${HOST};
    root /var/www/awh-web/current;
    index index.html;
    ssl_certificate /etc/letsencrypt/live/${HOST}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${HOST}/privkey.pem;
    auth_basic "AWH Remote Preview";
    auth_basic_user_file /etc/nginx/.awh-preview-users;
    add_header X-Content-Type-Options "nosniff" always;
    location ^~ /api/v1/ {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME /opt/awh-hub/public/web-gateway.php;
        fastcgi_param AWH_HUB_DB_PATH /var/lib/awh-hub/awh.sqlite;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
    }
    location / {
        try_files $uri $uri/ =404;
    }
    include ${ENROLLMENT};
    include ${CONTROL};
}

server {
    listen 80;
    server_name ${HOST};
    return 301 https://$host$request_uri;
}
`;
}

async function runTransform(input: string, host = HOST): Promise<{ output: string; stderr: string }> {
  const root = await mkdtemp(join(tmpdir(), 'awh-owner-auth-nginx-'));
  const inputPath = join(root, 'input.conf');
  const outputPath = join(root, 'output.conf');
  await writeFile(inputPath, input, 'utf8');
  try {
    const result = await execFileAsync(PHP, [helper, inputPath, outputPath, host]);
    return { output: await readFile(outputPath, 'utf8'), stderr: result.stderr };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('owner-auth transformation matches the real ReadyIDC topology and is idempotent', async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), 'awh-owner-auth-idempotent-'));
  const input = join(firstRoot, 'input.conf');
  const first = join(firstRoot, 'first.conf');
  const second = join(firstRoot, 'second.conf');
  try {
    await writeFile(input, productionShape(), 'utf8');
    await execFileAsync(PHP, [helper, input, first, HOST]);
    await execFileAsync(PHP, [helper, first, second, HOST]);
    const rendered = await readFile(first, 'utf8');
    assert.equal(rendered, await readFile(second, 'utf8'));
    const authoritativeHead = rendered.slice(0, rendered.indexOf('    location'));
    assert.match(authoritativeHead, /^    auth_basic off;$/m);
    assert.doesNotMatch(authoritativeHead, /^\s*auth_basic "AWH Remote Preview";/m);
    assert.doesNotMatch(authoritativeHead, /^\s*auth_basic_user_file \/etc\/nginx\/\.awh-preview-users;/m);
    assert.match(rendered, /location \^~ \/api\/v1\/ \{\n        auth_basic "AWH Remote Preview";/);
    assert.match(rendered, /location \^~ \/api\/v1\/auth\/ \{\n        auth_basic off;[\s\S]*fastcgi_param SCRIPT_FILENAME \/opt\/awh-hub\/control-plane-current\/hub\/public\/control-plane\.php;/);
    assert.match(rendered, /location = \/api\/v1\/auth\/login \{\n        auth_basic off;/);
    assert.match(rendered, /location = \/api\/v1\/auth\/session \{\n        auth_basic off;/);
    assert.match(rendered, /fastcgi_param AWH_CONTROL_ORIGIN https:\/\/157-85-108-142\.sslip\.io;/);
    assert.match(rendered, /location \/ \{\n        auth_basic off;/);
    assert.match(rendered, /location \^~ \/preview\/ \{\n        auth_basic "AWH Remote Preview";/);
    assert.equal((rendered.match(new RegExp(`include ${ENROLLMENT.replaceAll('/', '\\/')};`, 'g')) ?? []).length, 1);
    assert.equal((rendered.match(new RegExp(`include ${CONTROL.replaceAll('/', '\\/')};`, 'g')) ?? []).length, 1);
    assert.match(rendered, /fastcgi_pass unix:\/run\/php\/php8\.3-fpm\.sock;/);
    assert.match(rendered, /AWH_HUB_DB_PATH \/var\/lib\/awh-hub\/awh\.sqlite;/);
  } finally {
    await rm(firstRoot, { recursive: true, force: true });
  }
});

test('owner-auth transformation rejects duplicate/outside/ambiguous topology', async () => {
  const duplicateLocation = productionShape().replace('    location / {', '    location ^~ /preview/ {\n        auth_basic "AWH Remote Preview";\n        auth_basic_user_file /etc/nginx/.awh-preview-users;\n    }\n    location ^~ /preview/ {\n        auth_basic "AWH Remote Preview";\n        auth_basic_user_file /etc/nginx/.awh-preview-users;\n    }\n    location / {');
  const duplicateInclude = productionShape().replace(`    include ${CONTROL};`, `    include ${CONTROL};\n    include ${CONTROL};`);
  const outsideInclude = productionShape().replace(`    include ${CONTROL};`, '').replace('    return 301 https://$host$request_uri;', `    include ${CONTROL};\n    return 301 https://$host$request_uri;`);
  const ambiguous = `${productionShape()}\n${productionShape()}`;
  for (const [index, fixture] of [duplicateLocation, duplicateInclude, outsideInclude, ambiguous].entries()) {
    const root = await mkdtemp(join(tmpdir(), 'awh-owner-auth-reject-'));
    const input = join(root, 'input.conf');
    const output = join(root, 'output.conf');
    try {
      await writeFile(input, fixture, 'utf8');
      await assert.rejects(execFileAsync(PHP, [helper, input, output, HOST]), undefined, `fixture ${index} should be rejected`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('owner-auth deployment assets keep owner identity bootstrap bounded to stdin', async () => {
  const setup = await readFile(join(ROOT, 'hub/bin/setup-owner-auth.php'), 'utf8');
  const remote = await readFile(join(ROOT, 'deploy/awh-control-plane/remote-deploy-control-plane.sh'), 'utf8');
  const deploy = await readFile(join(ROOT, 'deploy/awh-control-plane/deploy-control-plane.sh'), 'utf8');
  assert.match(setup, /setup-owner-auth\.php INPUT_USERNAME/);
  assert.match(setup, /file_get_contents\('php:\/\/stdin'\)/);
  assert.doesNotMatch(setup, /password_hash|recoveryCode|password=/i);
  assert.match(remote, /OWNER_AUTH_SETUP.*OWNER_USERNAME|setup-owner-auth\.php.*OWNER_USERNAME/);
  assert.match(remote, /printf '%s\\n' "\$OWNER_PASSWORD"/);
  assert.match(remote, /OWNER_AUTH_LOGIN/);
  assert.match(remote, /surface_code.*= 405/);
  assert.match(remote, /METHOD_NOT_ALLOWED/);
  assert.match(remote, /www-authenticate: Basic/);
  assert.match(remote, /CONTROL_ORIGIN_RENDER/);
  assert.match(remote, /-H \"Origin: https:\/\/\$HOSTNAME\"/);
  assert.match(remote, /-c \"\$OWNER_AUTH_COOKIE_JAR\"/);
  assert.match(remote, /OWNER_AUTH_SESSION/);
  assert.match(remote, /OWNER_AUTH_EFFECTIVE_CONFIG/);
  assert.match(remote, /WEB_ACCESS_READY/);
  assert.match(remote, /www-data test -r.*WEB_RELEASE/);
  assert.match(remote, /chown -R awh-hub:www-data/);
  assert.match(remote, /location = \/api\/v1\/auth\/login/);
  assert.match(remote, /api\/v1\/auth\/session/);
  assert.match(remote, /cleanup_owner_auth_cookie_files/);
  assert.match(deploy, /scp .*\$REMOTE_DEPLOY.*\$TARGET:\$REMOTE_SCRIPT/);
  assert.match(deploy, /printf '%s\\n' "\$OWNER_PASSWORD" \| ssh/);
  assert.match(remote, /printf '%s\\n' "\$OWNER_PASSWORD" \| sudo/);
});

test('owner-auth release renders the real origin into the staged control include', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-owner-auth-origin-'));
  const input = join(root, 'control.conf');
  const output = join(root, 'rendered.conf');
  try {
    await writeFile(input, await readFile(join(ROOT, 'deploy/nginx/awh-control-plane.conf'), 'utf8'));
    await execFileAsync(PHP, [originRenderer, input, output, HOST]);
    const rendered = await readFile(output, 'utf8');
    assert.equal((rendered.match(new RegExp(`https://${HOST.replaceAll('.', '\\.')}`, 'g')) ?? []).length, 1);
    assert.doesNotMatch(rendered, /PREVIEW_HOSTNAME/);
    await assert.rejects(execFileAsync(PHP, [originRenderer, input, output, 'localhost']));
    await writeFile(input, rendered, 'utf8');
    await assert.rejects(execFileAsync(PHP, [originRenderer, input, output, HOST]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
