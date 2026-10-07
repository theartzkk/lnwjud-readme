import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ART_AGENT_VERSION } from '../src/version.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

test('AWH packaging configuration keeps Squirrel per-user behavior and public artifact names', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    version?: string;
    productName?: string;
    author?: string;
    description?: string;
    bin?: Record<string, string>;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    engines?: Record<string, string>;
  };
  const forge = (await readFile(new URL('../forge.config.cjs', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const desktop = await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  const packagedMcpVerifier = await readFile(new URL('../.github/scripts/verify-packaged-mcp.ps1', import.meta.url), 'utf8');

  assert.equal(pkg.version, ART_AGENT_VERSION);
  assert.equal(pkg.engines?.node, '>=22.12.0');
  assert.equal(pkg.productName, 'Art’s Workspace Hub');
  assert.equal(pkg.author, 'Art’s Workspace Hub');
  assert.match(pkg.description ?? '', /Art’s Workspace Hub/);
  assert.doesNotMatch(pkg.description ?? '', /Art Agent/);
  assert.equal(pkg.bin?.awh, 'dist/index.js');
  assert.equal(pkg.bin?.['art-agent'], 'dist/index.js');
  assert.equal(pkg.dependencies?.['electron-squirrel-startup'], '1.0.1');
  assert.equal(pkg.devDependencies?.['@electron-forge/maker-squirrel'], '7.11.2');
  assert.match(pkg.scripts?.['desktop:make'] ?? '', /prepare:windows-icon/);
  assert.match(pkg.scripts?.['desktop:package:windows'] ?? '', /prepare:windows-icon/);
  assert.match(pkg.scripts?.['desktop:package:mac:x64'] ?? '', /prepare:mac-icon/);
  assert.match(pkg.scripts?.['desktop:package:mac:x64'] ?? '', /sign-macos-adhoc/);
  assert.match(pkg.scripts?.['desktop:package:mac:arm64'] ?? '', /sign-macos-adhoc/);
  assert.match(pkg.scripts?.['desktop:installer:mac:x64'] ?? '', /package-macos-installer/);
  assert.match(pkg.scripts?.['desktop:installer:mac:arm64'] ?? '', /package-macos-installer/);
  assert.match(pkg.scripts?.['desktop:verify:installer:mac:x64'] ?? '', /verify-macos-installer/);
  assert.match(pkg.scripts?.['desktop:verify:installer:mac:arm64'] ?? '', /verify-macos-installer/);
  assert.match(forge, /@electron-forge\/maker-squirrel/);
  assert.match(forge, /packagerConfig:\s*\{[\s\S]*?name:\s*'AWH Agent'/);
  assert.match(forge, /config:\s*\{[\s\S]*?name:\s*'AWH'/);
  assert.match(forge, /executableName:\s*targetPlatform === 'darwin' \? 'AWH Agent' : 'AWH'/);
  assert.match(forge, /title:\s*'AWH Agent'/);
  assert.match(forge, /authors:\s*'Art’s Workspace Hub'/);
  assert.match(forge, /setupExe:\s*'AWHSetup\.exe'/);
  assert.match(forge, /exe:\s*'AWH\.exe'/);
  assert.doesNotMatch(forge, /title:\s*'Art Agent'|authors:\s*'Art Agent'|setupExe:\s*'ArtAgentSetup\.exe'/);
  assert.match(forge, /setupIcon:\s*windowsIcon/);
  assert.match(forge, /const icon = targetPlatform/);
  assert.match(forge, /\n    icon,\n/);
  assert.match(forge, /noMsi:\s*true/);
  assert.match(forge, /\^\\\/dist-web\(\$\|\\\/\)/);
  assert.match(forge, /\^\\\/out\(\$\|\\\/\)/);
  assert.match(forge, /\^\\\/\\\.awh\(\$\|\\\/\)/);
  assert.match(forge, /\^\\\/\\\.awh-local\(\$\|\\\/\)/);
  assert.match(forge, /\^\\\/\\\.git\(\$\|\\\/\)/);
  assert.match(desktop, /SQUIRREL_STARTUP/);
  assert.match(desktop, /electron-squirrel-startup/);
  assert.match(packagedMcpVerifier, /ELECTRON_RUN_AS_NODE/);
  assert.match(packagedMcpVerifier, /resources\/app\.asar/);
  assert.match(packagedMcpVerifier, /dist\/index\.js/);
  assert.doesNotMatch(packagedMcpVerifier, /--mcp-stdio/);
});

test('desktop packaging excludes generated cross-platform release artifacts from app bundles', () => {
  const forgeConfig = require('../forge.config.cjs') as { packagerConfig?: { ignore?: RegExp[] } };
  const ignore = forgeConfig.packagerConfig?.ignore ?? [];
  const isIgnored = (path: string) => ignore.some((pattern) => pattern.test(path));
  for (const artifact of ['/AWH-macOS-x64.zip', '/AWH-macOS-arm64.zip', '/AWH-macOS-x64-Installer.pkg', '/AWH-macOS-arm64-Installer.pkg', '/AWH-Windows-x64.zip', '/AWH-macOS-arm64.release.json', '/AWH-Windows-x64.release.json', '/SHA256SUMS.txt']) {
    assert.equal(isIgnored(artifact), true, `generated desktop release artifact must be excluded: ${artifact}`);
  }
  assert.equal(isIgnored('/ART_AI_WORKING_PROTOCOL.md'), false, 'required working context must remain packageable');
});

test('lightweight AWH Device Runtime is pinned, self-updating and rollback-safe', async () => {
  const [manifestRaw, updater, supervisor, installer, patch] = await Promise.all([
    readFile(new URL('../config/device-runtime-release.json', import.meta.url), 'utf8'),
    readFile(new URL('../deploy/remote-worker/macos/awh-runtime-update.sh', import.meta.url), 'utf8'),
    readFile(new URL('../deploy/remote-worker/macos/awh-remote-worker.sh', import.meta.url), 'utf8'),
    readFile(new URL('../deploy/remote-worker/macos/install.sh', import.meta.url), 'utf8'),
    readFile(new URL('../deploy/remote-worker/macos/runtime-hardening.patch', import.meta.url), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestRaw) as {
    version: string;
    npmIntegrity: string;
    package: string;
    capabilityProfile: string;
    nodeRuntime: { version: string; minimumVersion: string; sourceUrlTemplate: string; assets: Record<string,{nameTemplate:string;sha256:string}> };
    linuxConnector: { nodeRuntime: { version: string; minimumVersion: string; sourceUrlTemplate: string; asset: {nameTemplate:string;sha256:string} } };
    browserQa: { playwrightVersion: string; minimumNodeVersion: string };
  };
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.package, '@wonderwhy-er/desktop-commander');
  assert.match(manifest.npmIntegrity, /^sha512-/);
  assert.equal(manifest.capabilityProfile, 'full-device-v1');
  assert.match(manifest.nodeRuntime.version, /^\d+\.\d+\.\d+$/);
  assert.match(manifest.nodeRuntime.minimumVersion, /^\d+\.\d+\.\d+$/);
  assert.match(manifest.nodeRuntime.sourceUrlTemplate, /\{version\}.*\{asset\}/);
  assert.match(manifest.linuxConnector.nodeRuntime.asset.sha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.linuxConnector.nodeRuntime.sourceUrlTemplate, /\{version\}.*\{asset\}/);
  assert.match(manifest.browserQa.playwrightVersion, /^\d+\.\d+\.\d+$/);
  assert.match(updater, /https:\/\/kruart\.online/);
  assert.match(updater, /release\.json/);
  assert.match(updater, /npmIntegrity/);
  assert.match(updater, /package-lock\.json/);
  assert.match(updater, /runtime\.previous/);
  assert.match(updater, /AWH_DEVICE_RUNTIME=UPDATED/);
  assert.doesNotMatch(updater, /@latest|npm\s+update/);
  assert.match(supervisor, /awh-runtime-update\.sh/);
  assert.match(supervisor, /UPDATE_INTERVAL=21600/);
  assert.match(installer, /device-runtime-release\.json/);
  assert.match(installer, /process\.stdout\.write\(m\.version\)/);
  assert.doesNotMatch(installer, /^EXPECTED=\d+\.\d+\.\d+$/m);
  assert.match(installer, /awh-runtime-update\.sh/);
  assert.match(installer, /\.local\/share\/bay-remote\/node_modules\/\.bin\/desktop-commander/);
  assert.match(updater, /\.local\/share\/bay-remote\/node_modules\/\.bin\/desktop-commander/);
  assert.match(installer, /ensure_compat_bin/);
  assert.match(updater, /ensure_compat_bin/);
  assert.match(patch, /DC_REMOTE_DEVICE/);
  assert.match(patch, /previewForRemoteLog/);
});

test('packaged MCP PowerShell verifier parses on Windows', { skip: process.platform !== 'win32' }, () => {
  const command = [
    '$errors = $null',
    '$tokens = $null',
    "[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path '.github/scripts/verify-packaged-mcp.ps1'), [ref]$tokens, [ref]$errors) | Out-Null",
    "if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }",
  ].join('; ');
  const shell = process.env.AWH_TEST_POWERSHELL?.trim() || 'powershell.exe';
  const result = spawnSync(shell, ['-NoProfile', '-Command', command], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('canonical application artwork is AWH and cannot regress to the legacy lnwjud icon', async () => {
  const [png, svg] = await Promise.all([readFile(new URL('../logo-256x256.png', import.meta.url)), readFile(new URL('../assets/awh-logo.svg', import.meta.url), 'utf8')]);
  const sha = createHash('sha256').update(png).digest('hex');
  assert.notEqual(sha, 'c788bca8cbbdd153392d398102e7550db4b95d25ccfe45f6cf6edfc1a9577166');
  assert.match(svg, /aria-label="AWH"/);
  assert.match(svg, /#FF7A1A/i);
});

test('Windows icon preparation preserves the canonical AWH PNG payload', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'art-agent-icon-'));
  const target = join(temp, 'awh.ico');
  try {
    const result = spawnSync(process.execPath, ['scripts/prepare-windows-icon.mjs'], {
      cwd: repoRoot,
      env: { ...process.env, AWH_ICON_OUT: target },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const [ico, png] = await Promise.all([
      readFile(target),
      readFile(new URL('../logo-256x256.png', import.meta.url)),
    ]);
    assert.equal(ico.readUInt16LE(0), 0);
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 1);
    assert.equal(ico.readUInt8(6), 0); // 256 px
    assert.equal(ico.readUInt8(7), 0); // 256 px
    assert.equal(ico.readUInt16LE(10), 1);
    assert.equal(ico.readUInt16LE(12), 32);
    assert.equal(ico.readUInt32LE(14), png.length);
    assert.equal(ico.readUInt32LE(18), 22);
    assert.deepEqual(ico.subarray(22), png);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('macOS icon preparation converts the canonical AWH artwork without new branding', { skip: process.platform !== 'darwin' }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'awh-mac-icon-'));
  const target = join(temp, 'awh.icns');
  try {
    const result = spawnSync(process.execPath, ['scripts/prepare-macos-icon.mjs'], {
      cwd: repoRoot,
      env: { ...process.env, AWH_MAC_ICON_OUT: target },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const icns = await readFile(target);
    assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns');
    assert.ok(icns.length > 1_000);
  } finally { await rm(temp, { recursive: true, force: true }); }
});


test('macOS wizard installer preserves AWH state, verifies the payload, rolls back, and relaunches', async () => {
  const [builder, verifier, evidence] = await Promise.all([
    readFile(new URL('../scripts/package-macos-installer.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/qa/verify-macos-installer.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/release/create-macos-installer-evidence.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(builder, /pkgbuild/);
  assert.match(builder, /productbuild/);
  assert.match(builder, /--install-location', '\/'/);
  assert.match(builder, /online\.kruart\.awh\.agent/);
  assert.match(builder, /welcome\.html/);
  assert.match(builder, /readme\.html/);
  assert.match(builder, /conclusion\.html/);
  assert.match(builder, /AWH_MAC_INSTALLER_SIGN_IDENTITY/);
  assert.match(builder, /AWH Agent\.previous\.app/);
  assert.match(builder, /rollback/);
  assert.match(builder, /codesign --verify --deep --strict/);
  assert.match(builder, /open -a/);
  assert.match(builder, /Mac Apple Silicon/);
  assert.match(builder, /Mac Intel/);
  assert.doesNotMatch(builder, /tccutil\s+reset/i);
  assert.doesNotMatch(builder, /security\s+delete|delete-generic-password/i);
  assert.doesNotMatch(builder, /Application Support\/AWH\/Engines|\.awh\//i);

  assert.match(verifier, /--expand-full/);
  assert.match(verifier, /preservesAwhState: true/);
  assert.match(verifier, /preservesTcc: true/);
  assert.match(verifier, /rollback: true/);
  assert.match(verifier, /relaunch: true/);
  assert.match(verifier, /canonicalBrandDataUri/);
  assert.match(verifier, /installer page does not embed canonical AWH logo/);
  assert.match(verifier, /dangling external installer logo reference remains/);
  assert.match(verifier, /brandAsset: 'embedded-data-uri'/);
  assert.match(verifier, /canonicalBrandAsset: true/);

  assert.match(verifier, /\/bin\/sh/);
  assert.match(verifier, /codesign --verify --deep --strict/);

  assert.match(evidence, /AWH_MACOS_INSTALLER_RELEASE_EVIDENCE/);
  assert.match(evidence, /packageSha256/);
  assert.match(evidence, /preservesTccState: true/);
  assert.match(evidence, /rollbackOnVerificationFailure: true/);
  assert.match(evidence, /autoRelaunch: true/);
});


test('macOS wizard documents the fresh-machine bootstrap contract', async () => {
  const builder = await readFile(new URL('../scripts/package-macos-installer.mjs', import.meta.url), 'utf8');
  assert.match(builder, /Fresh install/);
  assert.match(builder, /สร้าง Device ID/);
  assert.match(builder, /Runtime\/bridge/);
  assert.match(builder, /ไม่ต้องมี Project ก่อน/);
  assert.match(builder, /device-owned workspace/);
});


test('macOS wizard remains legible in Light and Dark Mode', async () => {
  const builder = await readFile(new URL('../scripts/package-macos-installer.mjs', import.meta.url), 'utf8');
  assert.match(builder, /color-scheme:light dark/);
  assert.match(builder, /@media \(prefers-color-scheme:dark\)/);
  assert.match(builder, /\.card\{background:#2c2c2e;border-color:#48484a;color:#f5f5f7\}/);
  assert.match(builder, /\.next\{background:#2c2c2e;color:#f5f5f7\}/);
});


test('macOS installer never requests Automation permission to quit AWH Agent', async () => {
  const builder = await readFile(new URL('../scripts/package-macos-installer.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(builder, /osascript|tell application/i);
  assert.match(builder, /pkill -TERM/);
  assert.match(builder, /pkill -KILL/);
  assert.match(builder, /\/Applications\/AWH Agent\\\.app\/Contents/);
});


test('macOS wizard embeds the canonical AWH logo into every Installer page', async () => {
  const builder = await readFile(new URL('../scripts/package-macos-installer.mjs', import.meta.url), 'utf8');
  assert.ok(builder.includes("join(ROOT, 'logo-256x256.png')"));
  assert.match(builder, /const logoDataUri = `data:image\/png;base64,/);
  assert.ok(builder.includes('src="${logoDataUri}" alt="AWH Agent"'));
  assert.doesNotMatch(builder, /src="awh-logo\.(?:png|svg)"/);
  assert.match(builder, /KRUART Workspace Hub/);
});


test('connected bridge is platform-aware, Windows-desktop sized, and keeps versions out of normal UI', async () => {
  const [main, renderer, html, styles] = await Promise.all([
    readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../desktop/connect.js', import.meta.url), 'utf8'),
    readFile(new URL('../desktop/connect.html', import.meta.url), 'utf8'),
    readFile(new URL('../desktop/connect.css', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /width: process\.platform === 'win32' \? 920 : 420/);
  assert.match(main, /height: process\.platform === 'win32' \? 760 : 590/);
  assert.match(main, /let osReady = true/);
  assert.match(main, /permissionSetupComplete = process\.platform !== 'darwin'/);
  assert.match(main, /coreUpdateState === 'AVAILABLE' \? 'อัปเดต AWH Agent'/);
  assert.doesNotMatch(main, /อัปเดต AWH Agent →/);

  assert.match(renderer, /WINDOWS DEVICE CONTROL/);
  assert.match(renderer, /Windows ไม่ต้องเปิด Accessibility หรือ Screen Recording แบบ macOS/);
  assert.match(renderer, /settings\.hidden = !isMac/);
  assert.match(renderer, /Ctrl \+ Shift \+ F12/);
  assert.match(renderer, /AWH Full Device Control/);
  assert.doesNotMatch(renderer, /health\.agent\?\.version|health\.runtime\?\.version|candidateVersion|result\.candidate\?\.version|result\.version/);

  assert.match(html, /id="permission-eyebrow"/);
  assert.match(html, /id="permission-copy"/);
  assert.match(html, /id="emergency-shortcut"/);
  assert.doesNotMatch(html, /หาก macOS ยังอนุญาตอยู่/);
  assert.match(styles, /@media\(min-width:620px\)/);
  assert.match(styles, /overflow-x:hidden/);
  assert.match(styles, /grid-template-columns:minmax\(0,1\.08fr\) minmax\(0,\.92fr\)/);
  assert.match(styles, /grid-template-areas:/);
  assert.match(styles, /body\.setup-required \.activity-card,body\.setup-required \.health-card\{display:none\}/);
  assert.match(html, /OFF<span>เบื้องหลังเท่านั้น · ไม่คลิกหรือพิมพ์<\/span>/);
  assert.match(html, /ON<span>ใช้เครื่องร่วมกัน · ควบคุมเมื่อจำเป็น<\/span>/);
  assert.match(html, /LIVE<span>ให้ AWH ใช้เต็มที่ · คนกลับมาแล้วลดเป็น ON<\/span>/);
});


test('macOS production signing cannot fall back to ad-hoc identity', async () => {
  const signer = await readFile(new URL('../scripts/sign-macos-adhoc.mjs', import.meta.url), 'utf8');
  assert.match(signer, /@electron\/osx-sign/);
  assert.match(signer, /AWH_MAC_APP_SIGN_IDENTITY/);
  assert.match(signer, /AWH_MAC_RELEASE_MODE/);
  assert.match(signer, /Developer ID Application:/);
  assert.match(signer, /hardenedRuntime:\s*true/);
  assert.match(signer, /AWH_MAC_APP_SIGN_IDENTITY_REQUIRED/);
});

test('macOS production installer requires Developer ID Installer and notarization', async () => {
  const [builder, notarizer, evidence, gate] = await Promise.all([
    readFile(new URL('../scripts/package-macos-installer.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/release/notarize-macos-installer.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/release/create-macos-installer-evidence.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/qa/verify-macos-release-gate.mjs', import.meta.url), 'utf8'),
  ]);

  assert.match(builder, /AWH_MAC_INSTALLER_SIGN_IDENTITY_REQUIRED/);
  assert.match(builder, /AWH_MACOS_DEVELOPER_ID_APP_SIGNATURE_REQUIRED/);
  assert.match(builder, /Developer ID Installer:/);

  assert.match(notarizer, /notarytool/);
  assert.match(notarizer, /stapler.*staple/s);
  assert.match(notarizer, /stapler.*validate/s);
  assert.match(notarizer, /spctl/);
  assert.match(notarizer, /AWH_MACOS_NOTARY_CREDENTIALS_REQUIRED/);

  assert.match(evidence, /appSigningState/);
  assert.match(evidence, /notarizationState/);
  assert.match(evidence, /gatekeeperState/);
  assert.match(evidence, /freshInstallReady/);
  assert.match(evidence, /FRESH_INSTALL_BLOCKED/);
  assert.match(evidence, /READY_FOR_FRESH_INSTALL/);

  assert.match(gate, /--require-ready/);
  assert.match(gate, /AWH_MACOS_FRESH_INSTALL_BLOCKED/);
  assert.match(gate, /AWH_MACOS_RELEASE_GATE_FAIL_OPEN/);
});

test('macOS production workflow uses ephemeral certificate material and ready-only release gate', async () => {
  const workflow = await readFile(new URL('../.github/workflows/macos-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /AWH_MAC_RELEASE_MODE:\s*production/);
  assert.match(workflow, /AWH_MAC_APP_CERT_P12_BASE64/);
  assert.match(workflow, /AWH_MAC_INSTALLER_CERT_P12_BASE64/);
  assert.match(workflow, /AWH_APPLE_APP_SPECIFIC_PASSWORD/);
  assert.match(workflow, /desktop:notarize:mac:x64/);
  assert.match(workflow, /desktop:notarize:mac:arm64/);
  assert.match(workflow, /desktop:release-gate:mac:x64:ready/);
  assert.match(workflow, /desktop:release-gate:mac:arm64:ready/);
  assert.match(workflow, /security delete-keychain/);
});

test('ordinary CI marks macOS installer evidence through the non-publishing release gate', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /Verify macOS x64 fresh-install publication gate/);
  assert.match(workflow, /desktop:release-gate:mac:x64/);
  assert.match(workflow, /Verify macOS arm64 fresh-install publication gate/);
  assert.match(workflow, /desktop:release-gate:mac:arm64/);
  assert.doesNotMatch(workflow, /desktop:release-gate:mac:x64:ready/);
  assert.doesNotMatch(workflow, /desktop:release-gate:mac:arm64:ready/);
});
