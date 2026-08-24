import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ART_AGENT_VERSION } from '../src/version.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

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
  assert.match(forge, /@electron-forge\/maker-squirrel/);
  assert.match(forge, /name:\s*'AWH'/);
  assert.match(forge, /executableName:\s*'AWH'/);
  assert.match(forge, /title:\s*'Art’s Workspace Hub'/);
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
  assert.match(desktop, /SQUIRREL_STARTUP/);
  assert.match(desktop, /electron-squirrel-startup/);
  assert.match(packagedMcpVerifier, /ELECTRON_RUN_AS_NODE/);
  assert.match(packagedMcpVerifier, /resources\/app\.asar/);
  assert.match(packagedMcpVerifier, /dist\/index\.js/);
  assert.doesNotMatch(packagedMcpVerifier, /--mcp-stdio/);
});

test('packaged MCP PowerShell verifier parses on Windows', { skip: process.platform !== 'win32' }, () => {
  const command = [
    '$errors = $null',
    '$tokens = $null',
    "[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path '.github/scripts/verify-packaged-mcp.ps1'), [ref]$tokens, [ref]$errors) | Out-Null",
    "if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }",
  ].join('; ');
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
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
