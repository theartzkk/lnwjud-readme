import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const runFile = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('M17 Database Studio web release is owner-first, read-only, and emitted by the canonical web build', async () => {
  const output = await mkdtemp(join(tmpdir(), 'awh-db-studio-'));
  try {
    await runFile(process.execPath, ['--import', 'tsx', 'scripts/build-web-preview.ts', '--control'], { cwd: ROOT, shell: false, env: { ...process.env, AWH_PREVIEW_GENERATED_AT: '2026-08-26T00:00:00.000Z', AWH_WEB_RELEASE_ID: 'm17-fixture', AWH_WEB_OUTPUT_DIR: output } });
    const [html, css, app, shell] = await Promise.all([readFile(join(output, 'database.html'), 'utf8'), readFile(join(output, 'database.css'), 'utf8'), readFile(join(output, 'database.js'), 'utf8'), readFile(join(output, 'index.html'), 'utf8')]);
    assert.match(html, /AWH Database Studio/);
    assert.match(html, /Owner · SQLite Control Plane/);
    assert.match(html, /SQL อ่านอย่างเดียว/);
    assert.match(html, /query_only ON/);
    assert.match(html, /database\.css\?release=m17-fixture/);
    assert.match(html, /database\.js\?release=m17-fixture/);
    assert.match(shell, /settings-panel-system/);
    assert.match(shell, /href="\.\/database\.html"/);
    assert.match(shell, /ระบบและฐานข้อมูล/);
    assert.match(app, /\/database-studio\.php/);
    assert.match(app, /\/api\/v1\/auth\/session/);
    assert.match(app, /credentials:\s*'include'/);
    assert.match(app, /studioApi\('query'/);
    assert.doesNotMatch(app, /ยืนยันรหัสผ่าน.*SQL|STEP_UP_REQUIRED/);
    assert.match(css, /--accent:#ff7a1a/);
    assert.doesNotMatch(`${html}\n${app}`, /localStorage|sessionStorage|document\.cookie|Authorization|Bearer\s+/i);
    assert.doesNotMatch(app, /innerHTML|outerHTML|insertAdjacentHTML/);
    assert.doesNotMatch(`${html}\n${app}`, /DELETE FROM|DROP TABLE|UPDATE .* SET|INSERT INTO/i);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test('M17 Database Studio is wired into the production deployment surface', async () => {
  const [deploy, remote, nginx] = await Promise.all([
    readFile(join(ROOT, 'deploy/awh-control-plane/deploy-control-plane.sh'), 'utf8'),
    readFile(join(ROOT, 'deploy/awh-control-plane/remote-deploy-control-plane.sh'), 'utf8'),
    readFile(join(ROOT, 'deploy/nginx/awh-control-plane.conf'), 'utf8'),
  ]);
  for (const asset of ['dist-web/database.html', 'dist-web/database.css', 'dist-web/database.js']) assert.match(deploy, new RegExp(asset.replace('.', '\\.')));
  for (const backend of ['hub/public/database-studio.php', 'hub/src/HubDatabaseStudioService.php', 'hub/src/HubDatabaseStudioRouter.php']) assert.ok(deploy.includes(backend), `deployment bundle missing ${backend}`);
  assert.ok(deploy.includes('hub/migrations/001_m3e_enrollment.sql'), 'Migration Center must ship the full migration catalog');
  assert.match(nginx, /location = \/database-studio\.php \{/);
  assert.match(nginx, /Hub session|Owner-only Database Studio/);
  assert.match(nginx, /HTTP_COOKIE \$http_cookie/);
  assert.match(nginx, /HTTP_X_AWH_CSRF \$http_x_awh_csrf/);
  assert.match(nginx, /AWH_HUB_BACKUP_ROOT \/var\/backups\/awh-hub/);
  assert.match(remote, /install -d -o root -g awh-hub -m 0750 \/var\/backups\/awh-hub/);
  assert.match(remote, /chown root:root \"\$BACKUP\"/);
  assert.match(remote, /chmod 0600 \"\$BACKUP\"/);
  assert.match(remote, /database_html_code=.*database\.html/);
  assert.match(remote, /database_api_code=.*database-studio\.php\?action=overview/);
  assert.match(remote, /test "\$database_api_code" = 401/);
});
