const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function requestedOption(name) {
  const equals = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (equals) return equals.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function findElectronZipDir(platform, arch) {
  const version = require('./node_modules/electron/package.json').version;
  const filename = `electron-v${version}-${platform}-${arch}.zip`;
  const roots = [
    process.env.AWH_ELECTRON_ZIP_DIR,
    process.env.ELECTRON_CACHE,
    path.join(os.homedir(), 'Library', 'Caches', 'electron'),
    path.join(os.homedir(), '.cache', 'electron'),
    path.join(os.homedir(), 'AppData', 'Local', 'electron', 'Cache'),
  ].filter(Boolean);
  const visited = new Set();

  function search(directory, depth) {
    let realDirectory;
    try {
      realDirectory = fs.realpathSync(directory);
    } catch {
      return undefined;
    }
    if (visited.has(realDirectory) || depth < 0) return undefined;
    visited.add(realDirectory);
    const direct = path.join(realDirectory, filename);
    if (fs.existsSync(direct)) return realDirectory;
    let entries;
    try {
      entries = fs.readdirSync(realDirectory, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const match = search(path.join(realDirectory, entry.name), depth - 1);
        if (match) return match;
      }
    }
    return undefined;
  }

  for (const root of roots) {
    const match = search(root, 3);
    if (match) return match;
  }
  return undefined;
}

const platformEquals = process.argv.find((value) => value.startsWith('--platform='))?.slice('--platform='.length);
const platformIndex = process.argv.indexOf('--platform');
const targetPlatform = platformEquals ?? (platformIndex >= 0 ? process.argv[platformIndex + 1] : undefined);
const targetArch = requestedOption('arch') ?? process.arch;
const electronZipDir = targetPlatform ? findElectronZipDir(targetPlatform, targetArch) : undefined;
const windowsIcon = path.join(__dirname, '.awh-build', 'awh.ico');
const macIcon = path.join(__dirname, '.awh-build', 'awh.icns');
const icon = targetPlatform === 'darwin' ? macIcon : windowsIcon;

module.exports = {
  packagerConfig: {
    name: 'AWH',
    executableName: 'AWH',
    icon,
    ...(electronZipDir ? { electronZipDir } : {}),
    asar: true,
    overwrite: true,
    ignore: [
      /^\/src($|\/)/,
      /^\/test($|\/)/,
      /^\/Screenshot($|\/)/,
      /^\/dist-web($|\/)/,
      /^\/out($|\/)/,
      /^\/\.github($|\/)/,
      /^\/\.art-agent-build($|\/)/,
      /^\/\.awh-build($|\/)/,
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'AWH',
        title: 'Art’s Workspace Hub',
        authors: 'Art’s Workspace Hub',
        description: 'Art’s Workspace Hub — a safe-by-default local workspace for projects, memory and approved automation.',
        exe: 'AWH.exe',
        setupExe: 'AWHSetup.exe',
        setupIcon: windowsIcon,
        noMsi: true,
      },
    },
  ],
};
