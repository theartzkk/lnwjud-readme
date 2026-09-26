import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path: string): Promise<string> {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('production desktop is a thin AWH Agent bridge and management lives on web', async () => {
  const [main, forge, connect, preload, verifier] = await Promise.all([
    source('src/desktop/main.ts'),
    source('forge.config.cjs'),
    source('desktop/connect.html'),
    source('desktop/connect-preload.cjs'),
    source('scripts/qa/verify-packaged-bundle.mjs'),
  ]);
  assert.doesNotMatch(main, /AWH_DESKTOP_ADVANCED/);
  assert.match(main, /thin local bridge/);
  assert.match(main, /win\.loadFile\(join\(app\.getAppPath\(\), 'desktop', 'connect\.html'\)\)/);
  assert.doesNotMatch(main, /loadFile\([^\n]*desktop[^\n]*index\.html/);
  assert.match(main, /registerBridgeIpc\(\)/);
  assert.equal((main.match(/registerLegacyDesktopIpc\(/g) || []).length, 1);
  assert.match(main, /จัดการอุปกรณ์บนเว็บ/);
  assert.match(main, /\?awh-settings=devices/);
  assert.match(main, /app\.dock\?\.hide\(\)/);
  assert.match(connect, /id="manage-device"/);
  assert.match(connect, /การจัดการอุปกรณ์ เครื่องมือ และการอัปเดตอยู่บนเว็บทั้งหมด/);
  assert.doesNotMatch(preload, /enrollmentRevoke|logout:|remoteConnect|remoteStop/);
  assert.match(forge, /Historical desktop Control Panel/);
  assert.match(forge, /desktop.*index.*renderer.*styles.*preload/s);
  assert.match(verifier, /must not include the historical desktop Control Panel/);
});

test('fresh device bootstrap provisions rebranded AWH runtime and pinned system MCP on macOS and Windows', async () => {
  const bootstrap = await source('src/device-bootstrap.ts');
  assert.match(bootstrap, /lnwjud-Portable-5\.5\.0\.exe/);
  assert.doesNotMatch(bootstrap, /lnwjud-Setup-5\.5\.0\.exe/);
  assert.match(bootstrap, /AWH Device Runtime\.exe/);
  assert.match(bootstrap, /CFBundleName'.*lnwjud/s);
  assert.match(bootstrap, /internal implementation key unchanged/);
  assert.match(bootstrap, /CFBundleExecutable'.*MAC_RUNTIME_EXECUTABLE/s);
  assert.match(bootstrap, /CFBundleIdentifier'.*online\.kruart\.awh-device-runtime/s);
  assert.match(bootstrap, /LSUIElement/);
  assert.match(bootstrap, /codesign/);
  assert.match(bootstrap, /NODE_VERSION = '24\.21\.0'/);
  assert.match(bootstrap, /SYSTEM_MCP_VERSION = '0\.2\.51'/);
  assert.match(bootstrap, /SYSTEM_MCP_INTEGRITY/);
  assert.match(bootstrap, /awh-system-mcp/);
  assert.match(bootstrap, /pinned-audited-device-runtime/);
});

test('web device center owns revocation and surfaces AWH runtime plus Remote Desktop MCP readiness', async () => {
  const [router, service, enrollment, adapter, app] = await Promise.all([
    source('hub/src/HubControlPlaneRouter.php'),
    source('hub/src/HubControlPlaneService.php'),
    source('hub/src/HubEnrollmentService.php'),
    source('web/control-plane-adapter.js'),
    source('web/app.js'),
  ]);
  assert.match(router, /control\/devices\/.*\/revoke/);
  assert.match(service, /revokeDeviceForSession/);
  assert.match(service, /tool\.awh-device-runtime.*AWH Device Runtime/s);
  assert.match(service, /tool\.remote-desktop-mcp.*Remote Desktop MCP/s);
  assert.match(enrollment, /revokeDeviceForOwnerUser/);
  assert.match(adapter, /export async function revokeDevice/);
  assert.match(app, /Device Runtime ✓/);
  assert.match(app, /Remote Desktop MCP ✓/);
  assert.match(app, /ยกเลิกการเชื่อมต่อ/);
});
