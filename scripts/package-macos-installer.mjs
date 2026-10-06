#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
const signingIdentity = process.env.AWH_MAC_INSTALLER_SIGN_IDENTITY?.trim() || '';
const work = await mkdtemp(join(tmpdir(), 'awh-macos-installer-'));

function run(executable, args, cwd = ROOT) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    throw new Error(`${executable} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
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
  run('/usr/bin/test', ['-d', app]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);

  const resources = join(work, 'Resources');
  await mkdir(resources, { recursive: true });
  await copyFile(join(ROOT, 'logo-256x256.png'), join(resources, 'AWH.png'));

  const welcome = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;line-height:1.5;color:#1f2937}
h1{font-size:22px;margin-bottom:8px}.brand{color:#ea580c;font-weight:700}
.card{background:#f7f7f8;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;margin-top:14px}
small{color:#6b7280}
</style></head><body>
<h1><span class="brand">AWH Agent</span> สำหรับ Mac Intel</h1>
<p>ตัวช่วยติดตั้งนี้จะติดตั้งหรืออัปเกรด AWH Agent ในโฟลเดอร์ <b>/Applications</b> โดยเก็บการจับคู่อุปกรณ์ การตั้งค่า credentials และข้อมูล AWH เดิมไว้ทั้งหมด</p>
<div class="card"><b>สิ่งที่ Installer จะไม่ทำ</b><br>ไม่ลบ ~/Library/Application Support/AWH · ไม่ reset pairing · ไม่ล้างสิทธิ์ Accessibility/Screen Recording · ไม่เปลี่ยน Device Runtime identity โดยไม่จำเป็น</div>
<p><small>เวอร์ชัน ${xml(version)} · Intel x64</small></p>
</body></html>`;

  const conclusion = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;line-height:1.5;color:#1f2937}
h1{font-size:22px;color:#166534}.next{background:#f7f7f8;border-radius:12px;padding:12px 14px;margin-top:14px}
</style></head><body>
<h1>ติดตั้ง AWH Agent เรียบร้อย</h1>
<p>เปิด <b>AWH Agent</b> จาก Applications ได้เลย หากเป็นการติดตั้งใหม่ macOS อาจขอ Accessibility และ Screen Recording หนึ่งครั้ง การอัปเกรดจากเครื่องที่อนุญาตไว้แล้วไม่ควรถูกบังคับให้อนุญาตซ้ำ</p>
<div class="next"><b>หลังเปิดแอป</b><br>Connection ต้องกลับ ONLINE และ AWH Device Runtime ต้อง READY โดย tunnel/heartbeat ทำงานแยกจาก permission probe</div>
</body></html>`;

  await writeFile(join(resources, 'welcome.html'), welcome, 'utf8');
  await writeFile(join(resources, 'conclusion.html'), conclusion, 'utf8');

  const component = join(work, 'AWH-Agent.pkg');
  run('/usr/bin/pkgbuild', [
    '--component', app,
    '--install-location', '/Applications',
    '--identifier', identifier,
    '--version', version,
    '--ownership', 'recommended',
    component,
  ]);

  const distribution = `<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>AWH Agent</title>
  <welcome file="welcome.html" mime-type="text/html"/>
  <conclusion file="conclusion.html" mime-type="text/html"/>
  <background file="AWH.png" alignment="left" scaling="proportional" mime-type="image/png"/>
  <options customize="never" require-scripts="false" rootVolumeOnly="true" hostArchitectures="${hostArch}"/>
  <domains enable_localSystem="true" enable_currentUserHome="false" enable_anywhere="false"/>
  <choices-outline>
    <line choice="default">
      <line choice="awh-agent"/>
    </line>
  </choices-outline>
  <choice id="default"/>
  <choice id="awh-agent" visible="false">
    <pkg-ref id="${xml(identifier)}"/>
  </choice>
  <pkg-ref id="${xml(identifier)}" version="${xml(version)}" auth="Root">AWH-Agent.pkg</pkg-ref>
</installer-gui-script>
`;
  const distributionPath = join(work, 'Distribution.xml');
  await writeFile(distributionPath, distribution, 'utf8');

  const args = ['--distribution', distributionPath, '--resources', resources, '--package-path', work];
  if (signingIdentity) args.push('--sign', signingIdentity);
  args.push(output);
  await rm(output, { force: true });
  run('/usr/bin/productbuild', args);
  run('/usr/bin/test', ['-s', output]);
  console.log(`AWH_MACOS_WIZARD_INSTALLER=PASS arch=${architecture} version=${version} signed=${signingIdentity ? 'yes' : 'no'} output=${output}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
