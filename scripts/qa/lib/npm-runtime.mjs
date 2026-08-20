import { win32 } from 'node:path';

/** Return a shell-free launch specification, including the Windows npm.cmd path. */
export function npmLaunchSpec(candidate, nodeExecutable, platformName = process.platform) {
  const normalized = candidate.replaceAll('\\', '/').toLowerCase();
  if (normalized.endsWith('/npm-cli.js')) {
    return { path: candidate, executable: nodeExecutable, argsPrefix: [candidate], source: 'Node-adjacent npm CLI' };
  }
  if (platformName === 'win32' && normalized.endsWith('/npm.cmd')) {
    const npmDir = win32.dirname(candidate);
    return {
      path: candidate,
      executable: nodeExecutable,
      argsPrefix: [win32.join(npmDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')],
      source: 'Windows npm.cmd via Node-adjacent npm CLI',
    };
  }
  return { path: candidate, executable: candidate, argsPrefix: [], source: 'native executable' };
}
