import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const AWH_FPM_SOCKET = '/run/php/php8.3-fpm-awh.sock';
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
    const result = await execFileAsync(PHP, [helper, inputPath, outputPath, host, AWH_FPM_SOCKET]);
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
    await execFileAsync(PHP, [helper, input, first, HOST, AWH_FPM_SOCKET]);
    await execFileAsync(PHP, [helper, first, second, HOST, AWH_FPM_SOCKET]);
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
    assert.ok(rendered.indexOf('location = /api/v1/auth/login {') < rendered.indexOf('location ^~ /api/v1/ {'));
    assert.match(rendered, /fastcgi_param AWH_CONTROL_ORIGIN https:\/\/157-85-108-142\.sslip\.io;/);
    assert.match(rendered, /fastcgi_pass unix:\/run\/php\/php8\.3-fpm-awh\.sock;/);
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
      await assert.rejects(execFileAsync(PHP, [helper, input, output, HOST, AWH_FPM_SOCKET]), undefined, `fixture ${index} should be rejected`);
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
  assert.match(remote, /stage OWNER_AUTH_WEB_SURFACE/);
  assert.match(remote, /WEB_ACCESS_READY/);
  assert.match(remote, /www-data test -x \/var\/www\/awh-web/);
  assert.match(remote, /www-data test -r.*WEB_RELEASE/);
  assert.match(remote, /chown -R awh-hub:www-data/);
  assert.match(remote, /location = \/api\/v1\/auth\/login/);
  assert.match(remote, /api\/v1\/auth\/session/);
  assert.match(remote, /cleanup_owner_auth_cookie_files/);
  assert.match(remote, /if test "\$COMPAT_REFRESH" = 1; then/);
  assert.match(remote, /stage OWNER_AUTH_COMPATIBILITY/);
  assert.match(remote, /OWNER_AUTH_CONTROL/);
  assert.match(remote, /Sec-Fetch-Site: same-origin/);
  assert.match(deploy, /AWH_WEB_RELEASE_ID="\$RELEASE_ID"/);
  assert.match(deploy, /CONTROL web release contains stale preview data/);
  assert.match(deploy, /--compat-refresh/);
  assert.match(deploy, /Owner username is invalid/);
  assert.doesNotMatch(deploy, /Owner username is not the reviewed installation identity/);
  assert.match(remote, /owner_bootstrap b JOIN owner_passwords p/);
  assert.match(remote, /rather than assuming that the owner still uses the installation default/);
  assert.doesNotMatch(remote, /case "\$OWNER_USERNAME" in art\)/);
  const activation = await readFile(join(ROOT, 'scripts/ops/activate-owner-auth.mjs'), 'utf8');
  assert.match(activation, /process\.env\.AWH_OWNER_AUTH_USERNAME \|\| 'art'/);
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
    await execFileAsync(PHP, [originRenderer, input, output, HOST, AWH_FPM_SOCKET]);
    const rendered = await readFile(output, 'utf8');
    assert.equal((rendered.match(new RegExp(`https://${HOST.replaceAll('.', '\\.')}`, 'g')) ?? []).length, 1);
    assert.match(rendered, /fastcgi_pass unix:\/run\/php\/php8\.3-fpm-awh\.sock;/);
    assert.doesNotMatch(rendered, /PREVIEW_HOSTNAME/);
    await assert.rejects(execFileAsync(PHP, [originRenderer, input, output, 'localhost', AWH_FPM_SOCKET]));
    await writeFile(input, rendered, 'utf8');
    await assert.rejects(execFileAsync(PHP, [originRenderer, input, output, HOST, AWH_FPM_SOCKET]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('effective owner-auth config gate consumes nginx -T diagnostics from stderr', async () => {
  const remote = await readFile(join(ROOT, 'deploy/awh-control-plane/remote-deploy-control-plane.sh'), 'utf8');
  const functionLine = remote.split('\n').find((line) => line.startsWith('verify_owner_auth_effective_config()'));
  assert.ok(functionLine, 'remote verifier function is present');
  assert.match(functionLine, /nginx -T 2>&1/);
  const root = await mkdtemp(join(tmpdir(), 'awh-owner-auth-nginx-t-'));
  const bin = join(root, 'bin');
  const config = join(root, 'effective.conf');
  try {
    await mkdir(bin);
    await writeFile(config, `server {\n  location = /api/v1/auth/login {}\n  location = /api/v1/auth/session {}\n  fastcgi_param AWH_CONTROL_ORIGIN https://${HOST};\n  fastcgi_pass unix:${AWH_FPM_SOCKET};\n}\n`);
    await writeFile(join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n');
    await writeFile(join(bin, 'nginx'), '#!/bin/sh\nif test "$1" = -T; then cat "$AWH_FAKE_NGINX_CONFIG" >&2; exit 0; fi\nexit 64\n');
    await chmod(join(bin, 'sudo'), 0o755);
    await chmod(join(bin, 'nginx'), 0o755);
    await execFileAsync('/bin/sh', ['-c', `HOSTNAME=${HOST}; AWH_FPM_SOCKET=${AWH_FPM_SOCKET}; ${functionLine}\nverify_owner_auth_effective_config`], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AWH_FAKE_NGINX_CONFIG: config },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('owner-auth route gate waits for the reloaded Nginx generation before failing closed', async () => {
  const remote = await readFile(join(ROOT, 'deploy/awh-control-plane/remote-deploy-control-plane.sh'), 'utf8');
  const start = remote.indexOf('verify_owner_auth_surface() {');
  const end = remote.indexOf('verify_owner_auth_login() {', start);
  assert.ok(start >= 0 && end > start, 'surface verifier is present');
  const verifier = remote.slice(start, end);
  const root = await mkdtemp(join(tmpdir(), 'awh-owner-auth-reload-'));
  const bin = join(root, 'bin');
  const counter = join(root, 'counter');
  try {
    await mkdir(bin);
    await writeFile(join(bin, 'curl'), `#!/bin/sh\nheaders= body=\nwhile test \"$#\" -gt 0; do\n  case \"$1\" in -D) headers=$2; shift 2; continue ;; -o) body=$2; shift 2; continue ;; esac\n  shift\ndone\ncount=$(cat \"$AWH_FAKE_COUNTER\" 2>/dev/null || printf 0)\ncount=$((count + 1))\nprintf %s \"$count\" > \"$AWH_FAKE_COUNTER\"\nif test \"$count\" = 1; then\n  printf \"WWW-Authenticate: Basic realm=fixture\\n\" > \"$headers\"\n  printf \"{}\\n\" > \"$body\"\n  printf 401\nelse\n  : > \"$headers\"\n  printf \"{\\\"code\\\":\\\"METHOD_NOT_ALLOWED\\\"}\\n\" > \"$body\"\n  printf 405\nfi\n`);
    await writeFile(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n');
    await chmod(join(bin, 'curl'), 0o755);
    await chmod(join(bin, 'sleep'), 0o755);
    const result = await execFileAsync('/bin/sh', ['-c', `HOSTNAME=${HOST}; ${verifier}\nverify_owner_auth_surface`], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AWH_FAKE_COUNTER: counter },
    });
    assert.equal(await readFile(counter, 'utf8'), '2');
    assert.match(result.stdout, /DEPLOY_DIAGNOSTIC=OWNER_AUTH_SURFACE_HTTP_405/);
    assert.match(result.stdout, /DEPLOY_DIAGNOSTIC=OWNER_AUTH_SURFACE_ATTEMPTS_2/);
    assert.doesNotMatch(result.stdout, /Basic realm|password|token/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('owner-auth activation refreshes the AWH PHP-FPM runtime after pointer movement', async () => {
  const [remote, deploy] = await Promise.all([
    readFile(join(ROOT, 'deploy/awh-control-plane/remote-deploy-control-plane.sh'), 'utf8'),
    readFile(join(ROOT, 'deploy/awh-control-plane/deploy-control-plane.sh'), 'utf8'),
  ]);
  const start = remote.indexOf('reload_awh_php_fpm() {');
  const end = remote.indexOf('\nverify_nginx_topology_clean()', start);
  assert.ok(start >= 0 && end > start, 'AWH PHP-FPM runtime helper is present');
  const helper = remote.slice(start, end);
  const root = await mkdtemp(join(tmpdir(), 'awh-owner-auth-fpm-reload-'));
  const bin = join(root, 'bin');
  const log = join(root, 'systemctl.log');
  try {
    await mkdir(bin);
    await writeFile(join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n');
    await writeFile(join(bin, 'systemctl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$AWH_SYSTEMCTL_LOG"\ncase "$1:$2" in reload:php8.3-fpm.service|is-active:--quiet) exit 0 ;; esac\nexit 64\n');
    await chmod(join(bin, 'sudo'), 0o755);
    await chmod(join(bin, 'systemctl'), 0o755);
    await execFileAsync('/bin/sh', ['-c', `AWH_FPM_SERVICE=php8.3-fpm.service; ${helper}\nreload_awh_php_fpm`], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AWH_SYSTEMCTL_LOG: log },
    });
    assert.equal(await readFile(log, 'utf8'), 'reload php8.3-fpm.service\nis-active --quiet php8.3-fpm.service\n');
    const pointer = remote.indexOf('stage CONTROL_POINTER');
    const reload = remote.indexOf('stage PHP_FPM_RELOAD; reload_awh_php_fpm');
    const nginx = remote.indexOf('stage NGINX_CUTOVER_INSTALL');
    assert.ok(pointer >= 0 && reload > pointer && nginx > reload, 'PHP-FPM reload follows the pointer and precedes public cutover');
    const rollback = remote.slice(remote.indexOf('rollback() {'), remote.indexOf('\ntrap rollback', remote.indexOf('rollback() {')));
    assert.match(rollback, /POINTER_CHANGED.*reload_awh_php_fpm/s);
    assert.match(deploy, /AWH_FPM_SERVICE=php\$AWH_FPM_VERSION-fpm\.service/);
    assert.match(deploy, /php_service_\$\{AWH_FPM_SERVICE\}=active/);
    assert.match(deploy, /\$AWH_FPM_SOCKET" "\$AWH_FPM_SERVICE"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
