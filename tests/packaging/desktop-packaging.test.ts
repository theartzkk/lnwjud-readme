import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const desktopRoot = path.resolve(import.meta.dirname, '..', '..', 'apps', 'desktop');
const repositoryRoot = path.resolve(desktopRoot, '..', '..');

describe('AWH desktop packaging', () => {
  it('pins the product release to v4.9.1', async () => {
    const rootPackage = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8')) as { version?: unknown };
    const desktopPackage = JSON.parse(await readFile(path.join(desktopRoot, 'package.json'), 'utf8')) as { version?: unknown };
    expect(rootPackage.version).toBe('4.9.1');
    expect(desktopPackage.version).toBe('4.9.1');
  });

  it('publishes complete desktop application metadata', async () => {
    const desktopPackage = JSON.parse(await readFile(path.join(desktopRoot, 'package.json'), 'utf8')) as {
      description?: unknown;
      author?: unknown;
      homepage?: unknown;
      repository?: { type?: unknown; url?: unknown };
    };

    expect(desktopPackage.description).toBe('Art’s Workspace Hub — local execution, project continuity, and secure control-plane integration.');
    expect(desktopPackage.author).toBe('Art’s Workspace Hub');
    expect(desktopPackage.homepage).toBe('https://github.com/theartzkk/lnwjud-readme#readme');
    expect(desktopPackage.repository).toEqual({ type: 'git', url: 'https://github.com/theartzkk/lnwjud-readme.git' });
  });

  it('declares the AWH x64 NSIS distribution while preserving internal lnwjud runtime launchers', async () => {
    const configPath = path.join(desktopRoot, 'electron-builder.yml');
    const config = await readFile(configPath, 'utf8');

    expect(config).toContain('productName: Art’s Workspace Hub');
    expect(config).toContain('appId: th.theartzkk.awh');
    expect(config).toContain('owner: theartzkk');
    expect(config).toContain('repo: lnwjud-readme');
    expect(config).toContain('artifactName: AWH-Setup-${version}.${ext}');
    expect(config).toContain('output: dist/installers');
    expect(config).toContain('target: nsis');
    expect(config).toContain('- x64');
    expect(config).toContain('icon: build/icon.ico');
    expect(config).toContain('signAndEditExecutable: true');
    expect(config).not.toContain('signAndEditExecutable: false');
    expect(config).toContain('createStartMenuShortcut: false');
    expect(config).not.toMatch(/[A-Z]:\\Users\\[^\r\n]+/i);
    const installerScript = await readFile(path.join(desktopRoot, 'build', 'installer.nsh'), 'utf8');
    expect(installerScript).toContain('CreateShortCut "$SMPROGRAMS\\${PRODUCT_FILENAME}.lnk" "$INSTDIR\\${APP_EXECUTABLE_FILENAME}"');
    expect(installerScript).toContain('SetOutPath "$INSTDIR"');
    expect(installerScript).toContain('RMDir /r "$APPDATA\\${PRODUCT_FILENAME}"');
    expect(installerScript).toContain('IfSilent keepData');
    expect(installerScript).not.toContain('lnwjud.lnk');
    expect(installerScript).not.toContain('$INSTDIR\\lnwjud.exe');
    expect(installerScript).not.toContain('$APPDATA\\lnwjud');
    expect(installerScript).not.toContain('$LOCALAPPDATA\\lnwjud');
    expect(installerScript).not.toMatch(/[A-Z]:\\Users\\[^\r\n]+/i);
    expect(config).toContain('extraResources:');
    expect(config).toContain('windows-capability-bridge.ps1');
    expect(config).toContain('build/lnwjud-node.exe');
    expect(config).toContain('to: lnwjud-node.exe');
    // Internal launcher/profile names intentionally stay lnwjud-* where they
    // are protocol/runtime compatibility identifiers, but user shortcuts must
    // always resolve to the branded Electron application executable.
    expect(installerScript).toContain('${APP_EXECUTABLE_FILENAME}');
  });

  it('packages Windows without requiring winCodeSign symlink privileges', async () => {
    const packagingScript = await readFile(path.join(repositoryRoot, 'scripts', 'package-windows.ps1'), 'utf8');
    expect(packagingScript).toContain("$winCodeSignVersion = '2.6.0'");
    expect(packagingScript).toContain("$resourceProductName = 'Art’s Workspace Hub'");
    expect(packagingScript).toContain('Join-Path $unpackedDirectory "$resourceProductName.exe"');
    expect(packagingScript).not.toContain('Expected exactly one AWH application executable');
    expect(packagingScript).toContain("$rceditSha256 = 'ab53500d556fd824636621bca7dbecd8583ba181891c3e9efdcf16b72a28b0cd'");
    expect(packagingScript).toContain("'--set-icon' $iconPath");
    expect(packagingScript).toContain('--win --dir --x64');
    expect(packagingScript).toContain('--config.win.signAndEditExecutable=false');
    expect(packagingScript).toContain('--prepackaged $unpackedDirectory');
    expect(packagingScript).toContain('AWH_INSTALLER_SHA256=');
    expect(packagingScript).not.toContain("--filter '@lnwjud/desktop' package:windows");

    const config = await readFile(path.join(desktopRoot, 'electron-builder.yml'), 'utf8');
    expect(config).toContain('signAndEditExecutable: true');
    expect(config).not.toContain('signAndEditExecutable: false');
  });

  it('defines a safe native Windows package verifier', async () => {
    const verifier = await readFile(path.join(repositoryRoot, 'scripts', 'verify-windows-package.ps1'), 'utf8');
    const rootPackage = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };

    expect(rootPackage.scripts?.['verify:windows-package']).toContain('scripts/verify-windows-package.ps1');
    expect(verifier).toContain("$productName = 'Art’s Workspace Hub'");
    expect(verifier).toContain('AWH_INSTALLER_SHA256=');
    expect(verifier).toContain('AWH_LAUNCH_SMOKE=PASS');
    expect(verifier).toContain('[switch]$InstallSmoke');
    expect(verifier).toContain('Install smoke refused because an AWH Start Menu shortcut already exists');
    expect(verifier).toContain("Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait -PassThru");
    expect(verifier).toContain('AWH_INSTALL_LAUNCH_UNINSTALL_SMOKE=PASS');
    expect(verifier).toContain('Remove-Item Env:LNWJUD_DATA_PATH');
  });

  it.skipIf(process.platform !== 'win32')('verifies built Windows runtime bundles', async () => {
    await access(path.join(desktopRoot, 'build', 'lnwjud-node.exe'));
    const stdioLauncher = await readFile(path.join(desktopRoot, 'build', 'lnwjud-mcp-stdio.cmd'), 'utf8');
    expect(stdioLauncher).toContain('lnwjud-node.exe');
    expect(stdioLauncher).toContain('no system Node.js is required');
    expect(stdioLauncher).not.toContain(path.win32.join('%ProgramFiles%', 'nodejs'));
    expect(stdioLauncher).not.toContain(path.win32.join('%LOCALAPPDATA%', 'Programs', 'nodejs'));
    expect(stdioLauncher).not.toContain('set "NODE_EXE=node"');
    await access(path.join(desktopRoot, 'dist', 'main', 'main.js'));
    await access(path.join(desktopRoot, 'dist', 'preload', 'index.cjs'));
    await access(path.join(desktopRoot, 'dist', 'renderer', 'index.html'));

    const mainBundle = await readFile(path.join(desktopRoot, 'dist', 'main', 'main.js'), 'utf8');
    const windowBundle = await readFile(path.join(desktopRoot, 'dist', 'main', 'window.js'), 'utf8');
    const tunnelBundle = await readFile(path.join(desktopRoot, 'dist', 'main', 'tunnel-controller.js'), 'utf8');
    expect(windowBundle).toContain('webSecurity: true');
    expect(windowBundle).not.toContain('webSecurity: false');
    expect(mainBundle).toMatch(/setName\(["']Art’s Workspace Hub["']|setName\(PRODUCT_DISPLAY_NAME\)/);
    expect(tunnelBundle).toContain('LNWJUD_DATA_PATH');
    expect(tunnelBundle).toContain('LNWJUD_UNRESTRICTED');
    expect(mainBundle).toMatch(/setPath\(["']userData["']/);
  });

  it.skipIf(process.platform !== 'win32')('runs the stdio launcher with the bundled Node runtime even when PATH contains no system Node', async () => {
    const dataPath = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-packaged-stdio-'));
    const launcher = path.join(desktopRoot, 'build', 'lnwjud-mcp-stdio.cmd');
    const systemRoot = process.env.SystemRoot ?? path.win32.join(`C:${path.win32.sep}`, 'Windows');
    const commandProcessor = process.env.ComSpec ?? path.join(systemRoot, 'System32', 'cmd.exe');
    const child = spawn(commandProcessor, ['/d', '/c', 'call', launcher, '--workspace', repositoryRoot], {
      cwd: desktopRoot,
      env: {
        ...process.env,
        PATH: [path.join(systemRoot, 'System32'), path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'), path.join(systemRoot, 'System32', 'Wbem')].join(path.delimiter),
        LNWJUD_DATA_PATH: dataPath,
      },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`stdio launcher did not become ready: ${stderr}`)), 20_000);
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk: string) => {
          stderr += chunk;
          if (!stderr.includes('lnwjud MCP stdio ready ')) return;
          clearTimeout(timer);
          resolve();
        });
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('exit', (code) => {
          if (stderr.includes('lnwjud MCP stdio ready ')) return;
          clearTimeout(timer);
          reject(new Error(`stdio launcher exited early with ${String(code)}: ${stderr}`));
        });
      });
      expect(stderr).toContain('lnwjud MCP stdio ready ');
    } finally {
      if (child.exitCode === null && child.pid !== undefined) {
        const taskkill = spawn(path.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        await new Promise<void>((resolve) => taskkill.once('exit', () => resolve()));
        if (child.exitCode === null) await new Promise<void>((resolve) => child.once('exit', () => resolve()));
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      await rm(dataPath, { recursive: true, force: true });
    }
  }, 30_000);

});
