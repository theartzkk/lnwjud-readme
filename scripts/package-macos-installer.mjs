#!/usr/bin/env node

import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
const keychain = process.env.AWH_MAC_KEYCHAIN?.trim() || '';
const releaseMode = process.env.AWH_MAC_RELEASE_MODE?.trim() === 'production';
if (releaseMode && !signingIdentity) throw new Error('AWH_MAC_INSTALLER_SIGN_IDENTITY_REQUIRED');
const work = await mkdtemp(join(tmpdir(), 'awh-macos-installer-'));

function run(executable, args, cwd = ROOT) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`${basename(executable)} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function inspect(executable, args, cwd = ROOT) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: result.status ?? -1, text: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
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
  if (releaseMode) {
    const appSignature = inspect('/usr/bin/codesign', ['-dv', '--verbose=4', app]);
    if (appSignature.code !== 0 || !/Authority=Developer ID Application:/i.test(appSignature.text)) {
      throw new Error('AWH_MACOS_DEVELOPER_ID_APP_SIGNATURE_REQUIRED');
    }
  }

  const root = join(work, 'Root');
  const scripts = join(work, 'Scripts');
  const resources = join(work, 'Resources');
  await mkdir(join(root, 'Applications'), { recursive: true });
  await mkdir(scripts, { recursive: true });
  await mkdir(resources, { recursive: true });
  run('/usr/bin/ditto', [app, join(root, 'Applications', 'AWH Agent.app')]);
  await cp(join(ROOT, 'logo-256x256.png'), join(resources, 'awh-logo.png'));

  const preinstall = `#!/bin/sh
set -eu
APP="/Applications/AWH Agent.app"
STATE_DIR="/Library/Application Support/AWH/Installer"
BACKUP="$STATE_DIR/AWH Agent.previous.app"
mkdir -p "$STATE_DIR"
chmod 755 "$STATE_DIR"
rm -rf "$BACKUP"
if [ -d "$APP" ]; then /usr/bin/ditto "$APP" "$BACKUP"; fi
# Stop only the currently installed AWH Agent bundle. Using a process
# signal avoids macOS Automation permission prompts from Installer.app.
# Fresh installs have no matching process, so this is a no-op.
if /usr/bin/pgrep -f "^/Applications/AWH Agent\.app/Contents/" >/dev/null 2>&1; then
  /usr/bin/pkill -TERM -f "^/Applications/AWH Agent\.app/Contents/" >/dev/null 2>&1 || true
  /bin/sleep 2
  if /usr/bin/pgrep -f "^/Applications/AWH Agent\.app/Contents/" >/dev/null 2>&1; then
    /usr/bin/pkill -KILL -f "^/Applications/AWH Agent\.app/Contents/" >/dev/null 2>&1 || true
  fi
fi
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
:root{color-scheme:light dark}
body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;line-height:1.52;color:#1f2937;background:transparent;margin:0;padding:4px 8px}
.hero{display:flex;align-items:center;gap:16px;padding:4px 0 14px;border-bottom:1px solid #e5e7eb;margin-bottom:14px}.hero img{width:72px;height:72px;border-radius:18px}.hero h1{font-size:26px;line-height:1.15;margin:0;letter-spacing:-.3px}.hero p{margin:5px 0 0;color:#6b7280;font-size:13px}.brand{color:#ea580c;font-weight:750}.intro{margin:0 0 12px;color:#4b5563}.card{background:#f7f7f8;border:1px solid #e5e7eb;border-radius:13px;padding:12px 14px;margin-top:10px;color:#1f2937}.card strong{font-size:15px}.card.primary{border-color:#fdba74;background:#fff7ed}.tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.2px;color:#c2410c;margin-bottom:4px}.meta{margin:12px 0 0;color:#6b7280;font-size:11px}
@media (prefers-color-scheme:dark){body{color:#f5f5f7}.hero{border-color:#3a3a3c}.intro{color:#d1d1d6}.card{background:#2c2c2e;border-color:#48484a;color:#f5f5f7}.card.primary{background:#33261d;border-color:#8a4b16}.tag{color:#ff9f0a}.meta,.hero p{color:#c7c7cc}.brand{color:#ff9f0a}}
</style></head><body><div class="hero"><img src="awh-logo.png" alt="AWH"><div><h1><span class="brand">AWH Agent</span></h1><p>KRUART Workspace Hub · ${xml(archLabel)}</p></div></div>
<p class="intro">ติดตั้ง AWH Agent สำหรับเครื่องใหม่ หรืออัปเกรดเวอร์ชันเดิมใน <b>/Applications</b> โดยรักษาข้อมูลและสิทธิ์ที่มีอยู่</p>
<div class="card primary"><span class="tag">ติดตั้งใหม่</span><br><strong>พร้อมใช้งานตั้งแต่ครั้งแรก</strong><br>เปิดแอปอัตโนมัติ → สร้าง Device ID → ติดตั้ง Runtime/bridge ที่ pin + verify SHA → Login/Enroll → ขอ Accessibility และ Screen Recording ครั้งแรก → เชื่อม tunnel/heartbeat โดยไม่ต้องมี Project ก่อน</div>
<div class="card"><span class="tag">อัปเกรด</span><br><strong>รักษาสถานะเดิมของเครื่อง</strong><br>รักษา pairing, credentials, Runtime state และสิทธิ์เดิม · ไม่ reset Keychain · ไม่ reset Accessibility/Screen Recording · ไม่ลบ ~/Library/Application Support/AWH · ไม่ลบ ~/.awh</div>
<p class="meta">AWH Agent ${xml(version)} · ${xml(architecture)}</p></body></html>`;

  const readme = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
:root{color-scheme:light dark}body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;line-height:1.5;color:#1f2937;background:transparent}h2{font-size:20px}li{margin:7px 0}@media (prefers-color-scheme:dark){body{color:#f5f5f7}}
</style></head><body><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px"><img src="awh-logo.png" alt="AWH" style="width:44px;height:44px;border-radius:11px"><div><b>AWH Agent</b><br><span style="font-size:12px">KRUART Workspace Hub</span></div></div><h2>ขั้นตอนของ AWH Setup</h2><ul>
<li>ตรวจว่าเป็น Intel หรือ Apple Silicon จากแพ็กเกจที่เลือก</li><li>ถ้ามี AWH Agent เดิม จะสำรองชั่วคราวก่อนอัปเดต</li><li>ติดตั้ง bundle ใหม่ลง /Applications</li>
<li>ตรวจ Bundle ID, executable และ code signature</li><li>เปิด AWH Agent ใหม่อัตโนมัติ</li><li>เครื่องใหม่จะสร้าง Device ID/Runtime/bridge จาก first-run ของ Agent และเชื่อม Hub หลัง Login</li><li>remote tunnel มี device-owned workspace จึงไม่ต้องเลือก Project ก่อน</li><li>rollback แอปเดิมถ้าการตรวจหลังติดตั้งไม่ผ่าน</li>
</ul><p><b>ข้อมูลอุปกรณ์และสิทธิ์ระบบจะไม่ถูกล้างโดย Installer นี้ และเครื่องใหม่จะขอสิทธิ์ macOS เฉพาะครั้งแรกตามที่ระบบปฏิบัติการกำหนด</b></p></body></html>`;

  const conclusion = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
:root{color-scheme:light dark}body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;line-height:1.5;color:#1f2937;background:transparent}h1{font-size:22px;color:#166534}.next{background:#f7f7f8;border-radius:12px;padding:12px 14px;margin-top:14px;color:#1f2937}@media (prefers-color-scheme:dark){body{color:#f5f5f7}h1{color:#63d471}.next{background:#2c2c2e;color:#f5f5f7}}
</style></head><body><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px"><img src="awh-logo.png" alt="AWH" style="width:48px;height:48px;border-radius:12px"><div><b>AWH Agent</b><br><span style="font-size:12px">KRUART Workspace Hub</span></div></div><h1>ติดตั้ง AWH Agent เรียบร้อย</h1><p>AWH Agent ถูกเปิดให้อัตโนมัติแล้ว</p>
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
  if (signingIdentity) {
    args.push('--sign', signingIdentity);
    if (keychain) args.push('--keychain', keychain);
  }
  args.push(output);
  await rm(output, { force: true });
  run('/usr/bin/productbuild', args);
  run('/bin/test', ['-s', output]);
  const packageSignature = inspect('/usr/sbin/pkgutil', ['--check-signature', output]);
  const developerInstallerSigned = packageSignature.code === 0 && /Developer ID Installer:/i.test(packageSignature.text);
  if (releaseMode && !developerInstallerSigned) throw new Error('AWH_MACOS_DEVELOPER_ID_INSTALLER_SIGNATURE_REQUIRED');
  console.log(`AWH_MACOS_WIZARD_INSTALLER=PASS arch=${architecture} version=${version} signed=${developerInstallerSigned ? 'developer-id' : signingIdentity ? 'other' : 'no'} output=${output}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
