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
  };
  const forge = (await readFile(new URL('../forge.config.cjs', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const desktop = await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  const packagedMcpVerifier = await readFile(new URL('../.github/scripts/verify-packaged-mcp.ps1', import.meta.url), 'utf8');

  assert.equal(pkg.version, ART_AGENT_VERSION);
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
  assert.match(forge, /@electron-forge\/maker-squirrel/);
  assert.match(forge, /packagerConfig:\s*\{[\s\S]*?name:\s*'AWH Agent'/);
  assert.match(forge, /config:\s*\{[\s\S]*?name:\s*'AWH'/);
  assert.match(forge, /executableName:\s*'AWH'/);
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
  for (const artifact of ['/AWH-macOS-x64.zip', '/AWH-macOS-arm64.zip', '/AWH-Windows-x64.zip', '/AWH-macOS-arm64.release.json', '/AWH-Windows-x64.release.json', '/AWH-Agent-Beta-macOS-arm64.dmg', '/AWH-Agent-Beta-macOS-arm64.installer.json', '/SHA256SUMS.txt']) {
    assert.equal(isIgnored(artifact), true, `generated desktop release artifact must be excluded: ${artifact}`);
  }
  assert.equal(isIgnored('/ART_AI_WORKING_PROTOCOL.md'), false, 'required working context must remain packageable');
});

test('macOS Beta distribution uses a drag-to-Applications DMG with explicit evidence', async () => {
  const [pkgRaw, dmg, evidence, web] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/create-macos-dmg.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/release/create-desktop-installer-evidence.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../web/app.js', import.meta.url), 'utf8'),
  ]);
  const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
  assert.match(pkg.scripts?.['desktop:make:mac:arm64'] ?? '', /create-macos-dmg\.mjs arm64/);
  assert.match(pkg.scripts?.['desktop:make:mac:x64'] ?? '', /create-macos-dmg\.mjs x64/);
  assert.match(dmg, /AWH Agent Beta/);
  assert.match(dmg, /symlink\('\/Applications'/);
  assert.match(dmg, /hdiutil/);
  assert.match(dmg, /AWH-Agent-Beta-macOS-/);
  assert.match(evidence, /AWH_DESKTOP_INSTALLER_EVIDENCE/);
  assert.match(evidence, /channel: 'beta'/);
  assert.match(evidence, /ADHOC_BETA/);
  assert.match(web, /macOS Apple Silicon · Beta/);
  assert.match(web, /Beta สำหรับทดสอบ · Source\/Checksum ผ่าน/);
});

test('full AWH Device Runtime engine is pinned, bundled per platform and AWH-branded', async () => {
  const [manifestRaw, helper, forge, pkgRaw] = await Promise.all([
    readFile(new URL('../config/full-device-engine-release.json', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/desktop/prepare-full-device-engine.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../forge.config.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestRaw) as any;
  const pkg = JSON.parse(pkgRaw) as any;
  assert.equal(manifest.engine, 'lnwjud');
  assert.equal(manifest.version, '5.5.0');
  assert.equal(manifest.upstreamCommit, '25f79dd417b925285ec84fb3e46e9d029eaa9f29');
  assert.equal(manifest.minimumToolCount, 250);
  assert.equal(manifest.dataAuthority, 'AWH');
  assert.equal(manifest.headlessSecretPolicy.darwin, 'AWH_PRIVATE_FILE_0600');
  assert.equal(manifest.headlessSecretPolicy.win32, 'OS_SAFE_STORAGE');
  assert.equal(manifest.assets['darwin-arm64'].sha256, '69a4c0355bb5b2f8cf0c2af89210333e5682e86fa6a62996f49d9a8afe85b7d1');
  assert.equal(manifest.assets['darwin-x64'].sha256, '0264147848a4eea1df025573f8f3413380784ca88358c51d1be678da994330aa');
  assert.equal(manifest.assets['win32-x64'].sha256, '04a172af20e755346a31ff9d88e28fbeae8ac8d896fe278ea4aa8fb357363731');
  assert.equal(manifest.assets['darwin-arm64'].provenanceSha256, '866f102ada7a4a0df8b482fa3dea6adf818459918627e3aea234beb18ffb8518');
  assert.equal(manifest.assets['darwin-x64'].provenanceSha256, '2bf99ef70536e756e729b7b0984debead6d1ddbbb860e5f874be8f650a7dcd42');
  assert.equal(manifest.assets['win32-x64'].provenanceSha256, '4ba2d15eedd0a903893418d8016a37a24205d3264eb485baa0c144d1334f6f25');
  assert.match(helper, /AWH_DEVICE_RUNTIME_HEADLESS/);
  assert.match(helper, /engine-secret.key/);
  assert.match(helper, /mode: 384/);
  assert.match(helper, /AWHDeviceRuntime.exe/);
  assert.match(helper, /awh-mcp-stdio/);
  assert.match(helper, /codesign/);
  assert.match(helper, /sha256/);
  assert.match(helper, /verifyProvenance/);
  assert.match(helper, /fileURLToPath/);
  assert.match(helper, /document\.source\?\.commit!==manifest\.upstreamCommit/);
  assert.doesNotMatch(helper, /@latest|releases\/latest/);
  assert.match(forge, /extraResource:[\s\S]*awh-device-runtime/);
  assert.match(pkg.scripts?.['desktop:package:mac:arm64'] ?? '', /prepare-full-device-engine.mjs --platform=darwin --arch=arm64/);
  assert.match(pkg.scripts?.['desktop:package:mac:x64'] ?? '', /prepare-full-device-engine.mjs --platform=darwin --arch=x64/);
  assert.match(pkg.scripts?.['desktop:package:windows'] ?? '', /prepare-full-device-engine.mjs --platform=win32 --arch=x64/);
  assert.equal(pkg.devDependencies?.['@electron/asar'], '3.2.13');
  assert.match(helper, /\/usr\/bin\/ditto/);
  assert.doesNotMatch(helper, /extract-zip|extractZip/);
});

test('lightweight AWH Device Runtime is pinned, self-updating and rollback-safe', async () => {
  const [manifestRaw, updater, supervisor, installer, patch] = await Promise.all([
    readFile(new URL('../config/device-runtime-release.json', import.meta.url), 'utf8'),
    readFile(new URL('../deploy/remote-worker/macos/awh-runtime-update.sh', import.meta.url), 'utf8'),
    readFile(new URL('../deploy/remote-worker/macos/awh-remote-worker.sh', import.meta.url), 'utf8'),
    readFile(new URL('../deploy/remote-worker/macos/install.sh', import.meta.url), 'utf8'),
    readFile(new URL('../deploy/remote-worker/macos/runtime-hardening.patch', import.meta.url), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestRaw) as { version: string; npmIntegrity: string; package: string; capabilityProfile: string };
  assert.equal(manifest.version, '0.2.51');
  assert.equal(manifest.package, '@wonderwhy-er/desktop-commander');
  assert.match(manifest.npmIntegrity, /^sha512-/);
  assert.equal(manifest.capabilityProfile, 'full-device-v1');
  assert.equal((manifest as any).toolDiscoveryMode, 'runtime-native');
  assert.equal((manifest as any).workerInventoryLimit, 64);
  assert.equal((manifest as any).extensionRegistry, 'config/external-capabilities.json');
  assert.equal((manifest as any).unknownRuntimeToolPolicy, 'DISCOVER_ONLY_NO_AUTO_EXECUTION_AUTHORITY');
  assert.match(updater, /https:\/\/kruart\.online/);
  assert.match(updater, /release\.json/);
  assert.match(updater, /npmIntegrity/);
  assert.match(updater, /package-lock\.json/);
  assert.match(updater, /runtime\.previous/);
  assert.match(updater, /AWH_DEVICE_RUNTIME=UPDATED/);
  assert.doesNotMatch(updater, /@latest|npm\s+update/);
  assert.match(supervisor, /awh-runtime-update\.sh/);
  assert.match(supervisor, /UPDATE_INTERVAL=21600/);
  assert.match(installer, /EXPECTED=0\.2\.51/);
  assert.match(installer, /awh-runtime-update\.sh/);
  assert.match(installer, /\.local\/share\/bay-remote\/node_modules\/\.bin\/desktop-commander/);
  assert.match(updater, /\.local\/share\/bay-remote\/node_modules\/\.bin\/desktop-commander/);
  assert.match(installer, /ensure_compat_bin/);
  assert.match(updater, /ensure_compat_bin/);
  assert.match(installer, /ensure_awh_mcp_child/);
  assert.match(updater, /ensure_awh_mcp_child/);
  assert.match(installer, /awh-device-system/);
  assert.match(updater, /scripts=refreshed mcp_child=awh-device-system/);
  assert.ok(updater.indexOf('for asset in device-runtime') < updater.indexOf('AWH_DEVICE_RUNTIME=CURRENT'), 'signed runtime scripts must refresh before current-version exit');
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
  assert.equal(sha, 'c7255419c5c6c6f86a064d0fec676998e80823e4ecbdbc43fc4e312bf437e615', 'canonical visible AWH Agent icon must match the Owner-approved artwork');
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
