import { execCommand } from './process.js';

export interface GitHubProjectSource { provider: 'GITHUB'; repository: string; ref: string | null; }

function repositoryFromRemote(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const scp = /^git@github\.com:([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})(?:\.git)?$/i.exec(value);
  if (scp) return `${scp[1]}/${scp[2]!.replace(/\.git$/i, '')}`;
  try {
    const url = new URL(value);
    if (!['https:', 'ssh:'].includes(url.protocol) || url.hostname.toLowerCase() !== 'github.com' || url.username && url.username !== 'git' || url.password) return null;
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length !== 2) return null;
    const owner = parts[0]!; const repo = parts[1]!.replace(/\.git$/i, '');
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) return null;
    return `${owner}/${repo}`;
  } catch { return null; }
}

/** Read-only local provenance discovery. No fetch/pull/reset and no credential leaves the device. */
export async function discoverGitHubProjectSource(workspace: string): Promise<GitHubProjectSource | null> {
  const origin = await execCommand('git', ['config', '--get', 'remote.origin.url'], workspace, 10_000).catch(() => null);
  if (!origin || origin.code !== 0) return null;
  const repository = repositoryFromRemote(origin.stdout); if (!repository) return null;
  const remoteHead = await execCommand('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], workspace, 10_000).catch(() => null);
  let ref: string | null = null;
  if (remoteHead?.code === 0) {
    const value = remoteHead.stdout.trim();
    if (/^origin\/[A-Za-z0-9._\/-]{1,160}$/.test(value) && !value.includes('..')) ref = value.slice('origin/'.length);
  }
  return { provider: 'GITHUB', repository, ref };
}
