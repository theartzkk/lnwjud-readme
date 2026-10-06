#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const architecture = process.argv[2] ?? 'x64';
if (process.platform !== 'darwin') throw new Error('macOS installer packaging must run on darwin');
if (!['x64', 'arm64'].includes(architecture)) throw new Error('unsupported macOS architecture');

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const version = String(pkg.version);
const app = join(ROOT, 'out', `AWH Agent-darwin-${architecture}`, 'AWH Agent.app');
const output = join(ROOT, `AWH-macOS-${architecture}-Installer.pkg`);
const identifier = 'online.kruart.awh.agent';
const hostArch = architecture === 'x64' ? 'x86_64' : 'arm64';
const archLabel = architecture === 'x64' ? 'Mac Intel' : 'Mac Apple Silicon';
const signingIdentity = process.env.AWH_MAC_INSTALLER_SIGN_IDENTITY?.trim() || '';
const work = await mkdtemp(join(tmpdir(), 'awh-macos-installer-'));

function run(executable, args, cwd = ROOT) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`${basename(executable)} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

try {
  run('/bin/test', ['-d', app]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);

  const root = join(work, 'Root');
  const scripts = join(work, 'Scripts');
  const resources = join(work, 'Resources');
  await mkdir(join(root, 'Applications'), { recursive: true });
  await mkdir(scripts, { recursive: true });
  await mkdir(resources, { recursive: true });
  run('/usr/bin/ditto', [app, join(root, 'Applications', 'AWH Agent.app')]);

  const preinstall = `#!/bin/sh
set -eu
APP="/Applications/AWH Agent.app"
STATE_DIR="/Library/Application Support/AWH/Installer"
BACKUP="$STATE_DIR/AWH Agent.previous.app"
mkdir -p "$STATE_DIR"
chmod 755 "$STATE_DIR"
rm -rf "$BACKUP"
if [ -d "$APP" ]; then /usr/bin/ditto "$APP" "$BACKUP"; fi
CONSOLE_USER="$(/usr/bin/stat -f '%Su' /dev/console 2>/dev/null || true)"
if [ -n "$CONSOLE_USER" ] && [ "$CONSOLE_USER" != "root" ] && [ "$CONSOLE_USER" != "loginwindow" ]; then
  USER_UID="$(/usr/bin/id -u "$CONSOLE_USER" 2>/dev/null || true)"
  if [ -n "$USER_UID" ]; then
    /bin/launchctl asuser "$USER_UID" /usr/bin/osascript -e 'tell application "AWH Agent" to quit' >/dev/null 2>&1 || true
  fi
fi
/bin/sleep 1
exit 0
`;

  const postinstall = `#!/bin/sh
set -eu
APP="/Applications/AWH Agent.app"
STATE_DIR="/Library/Application Support/AWH/Installer"
BACKUP="$STATE_DIR/AWH Agent.previous.app"
PLIST="$APP/Contents/Info.plist"
EXECUTABLE="$APP/Contents/MacOS/AWH Agent"
rollback() {
  echo "AWH installer verification failed: $1" >&2
  if [ -d "$BACKUP" ]; then
    rm -rf "$APP"
    /usr/bin/ditto "$BACKUP" "$APP" || true
  fi
  exit 1
}
[ -d "$APP" ] || rollback "application bundle missing"
[ -x "$EXECUTABLE" ] || rollback "application executable missing"
[ -f "$PLIST" ] || rollback "Info.plist missing"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST" 2>/dev/null || true)"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST" 2>/dev/null || true)"
[ "$BUNDLE_ID" = "com.artworkspacehub.awh" ] || rollback "bundle identifier mismatch"
[ -n "$VERSION" ] || rollback "version missing"
/usr/bin/codesign --verify --deep --strict "$APP" >/dev/null 2>&1 || rollback "code signature verification failed"
CONSOLE_USER="$(/usr/bin/stat -f '%Su' /dev/console 2>/dev/null || true)"
if [ -n "$CONSOLE_USER" ] && [ "$CONSOLE_USER" != "root" ] && [ "$CONSOLE_USER" != "loginwindow" ]; then
  USER_UID="$(/usr/bin/id -u "$CONSOLE_USER" 2>/dev/null || true)"
  if [ -n "$USER_UID" ]; then
    /bin/launchctl asuser "$USER_UID" /usr/bin/open -a "$APP" >/dev/null 2>&1 || rollback "application launch failed"
    /bin/sleep 3
    /usr/bin/pgrep -f "/Applications/AWH Agent.app/Contents/MacOS/AWH Agent" >/dev/null 2>&1 || rollback "application did not stay running"
  fi
fi
rm -rf "$BACKUP"
printf '%s\n' "$VERSION" > "$STATE_DIR/last-installed-version"
chmod 644 "$STATE_DIR/last-installed-version"
exit 0
`;

  await writeFile(join(scripts, 'preinstall'), preinstall, { encoding: 'utf8', mode: 0o755 });
  await writeFile(join(scripts, 'postinstall'), postinstall, { encoding: 'utf8', mode: 0o755 });
  run('/bin/sh', ['-n', join(scripts, 'preinstall')]);
  run('/bin/sh', ['-n', join(scripts, 'postinstall')]);

  const welcome = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;line-height:1.5;color:#1f2937}
h1{font-size:22px;margin-bottom:8px}.brand{color:#ea580c;font-weight:700}.card{background:#f7f7f8;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;margin-top:14px}small{color:#6b7280}
</style></head><body><h1><span class="brand">AWH Agent</span> สำหรับ ${xml(archLabel)}</h1>
<p>ตัวช่วยติดตั้งนี้จะติดตั้งหรืออัปเกรด AWH Agent ใน <b>/Applications</b> โดยรักษา pairing, credentials, Runtime state และข้อมูล AWH เดิมไว้</p>
<div class="card"><b>ไม่ล้างข้อมูลเดิม</b><br>ไม่ reset Keychain · ไม่ reset Accessibility/Screen Recording · ไม่ลบ ~/Library/Application Support/AWH · ไม่ลบ ~/.awh</div>
<p><small>เวอร์ชัน ${xml(version)} · ${xml(architecture)}</small></p></body></html>`;

  const readme = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;line-height:1.5;color:#1f2937}h2{font-size:20px}li{margin:7px 0}
</style></head><body><h2>ขั้นตอนของ AWH Setup</h2><ul>
<li>สำรอง AWH Agent เดิมชั่วคราว</li><li>ปิดเฉพาะตัวแอปก่อนอัปเดต</li><li>ติดตั้ง bundle ใหม่ลง /Applications</li>
<li>ตรวจ Bundle ID, executable และ code signature</li><li>เปิด AWH Agent ใหม่อัตโนมัติ</li><li>rollback แอปเดิมถ้าการตรวจหลังติดตั้งไม่ผ่าน</li>
</ul><p><b>ข้อมูลอุปกรณ์และสิทธิ์ระบบจะไม่ถูกล้างโดย Installer นี้</b></p></body></html>`;

  const conclusion = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;line-height:1.5;color:#1f2937}h1{font-size:22px;color:#166534}.next{background:#f7f7f8;border-radius:12px;padding:12px 14px;margin-top:14px}
</style></head><body><h1>ติดตั้ง AWH Agent เรียบร้อย</h1><p>AWH Agent ถูกเปิดให้อัตโนมัติแล้ว</p>
<div class="next"><b>เกณฑ์พร้อมใช้</b><br>Connection ต้อง ONLINE · AWH Device Runtime ต้อง READY · tunnel/heartbeat ต้อง recover ได้โดยไม่ล้าง permission</div>
</body></html>`;

  await writeFile(join(resources, 'welcome.html'), welcome, 'utf8');
  await writeFile(join(resources, 'readme.html'), readme, 'utf8');
  await writeFile(join(resources, 'conclusion.html'), conclusion, 'utf8');

  const component = join(work, 'AWH-Agent.pkg');
  run('/usr/bin/pkgbuild', [
    '--root', root,
    '--install-location', '/',
    '--identifier', identifier,
    '--version', version,
    '--scripts', scripts,
    '--ownership', 'recommended',
    component,
  ]);

  const distribution = `<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>AWH Agent</title>
  <welcome file="welcome.html" mime-type="text/html"/>
  <readme file="readme.html" mime-type="text/html"/>
  <conclusion file="conclusion.html" mime-type="text/html"/>
  <options customize="never" require-scripts="false" rootVolumeOnly="true" hostArchitectures="${hostArch}"/>
  <domains enable_localSystem="true" enable_currentUserHome="false" enable_anywhere="false"/>
  <choices-outline><line choice="awh-agent"/></choices-outline>
  <choice id="awh-agent" visible="false"><pkg-ref id="${xml(identifier)}"/></choice>
  <pkg-ref id="${xml(identifier)}" version="${xml(version)}" auth="Root">AWH-Agent.pkg</pkg-ref>
</installer-gui-script>`;
  const distributionPath = join(work, 'Distribution.xml');
  await writeFile(distributionPath, distribution, 'utf8');

  const args = ['--distribution', distributionPath, '--resources', resources, '--package-path', work];
  if (signingIdentity) args.push('--sign', signingIdentity);
  args.push(output);
  await rm(output, { force: true });
  run('/usr/bin/productbuild', args);
  run('/bin/test', ['-s', output]);
  console.log(`AWH_MACOS_WIZARD_INSTALLER=PASS arch=${architecture} version=${version} signed=${signingIdentity ? 'yes' : 'no'} output=${output}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
