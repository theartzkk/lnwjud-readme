import { readTextFile } from './files.js';
import { resolveForRead } from './security.js';

export type ProjectEcosystem = 'node' | 'php' | 'python' | 'rust' | 'go';

export interface ProjectProfile {
  primary: ProjectEcosystem | 'unknown';
  ecosystems: ProjectEcosystem[];
  manifests: string[];
  packageManager: string | null;
  approvedScripts: string[];
  /** Safe semantic aliases, e.g. a project's `check` script as typecheck. */
  approvedScriptAliases?: Partial<Record<'typecheck', 'check'>>;
  warnings: string[];
}

const APPROVED_NODE_SCRIPTS = ['test', 'lint', 'typecheck', 'build'] as const;
const PHP_ROOT_MARKERS = ['index.php', 'public/index.php'] as const;

async function safeExists(workspace: string, path: string): Promise<boolean> {
  try {
    await resolveForRead(workspace, path);
    return true;
  } catch {
    return false;
  }
}

function packageManagerName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().split('@', 1)[0]?.toLowerCase();
  return name === 'npm' || name === 'pnpm' || name === 'yarn' ? name : null;
}

export async function detectProject(workspace: string): Promise<ProjectProfile> {
  const ecosystems: ProjectEcosystem[] = [];
  const manifests: string[] = [];
  const warnings: string[] = [];
  let packageManager: string | null = null;
  let approvedScripts: string[] = [];
  let approvedScriptAliases: ProjectProfile['approvedScriptAliases'] = {};

  if (await safeExists(workspace, 'package.json')) {
    ecosystems.push('node');
    manifests.push('package.json');
    try {
      const parsed = JSON.parse(await readTextFile(workspace, 'package.json', 512 * 1024)) as {
        packageManager?: unknown;
        scripts?: Record<string, unknown>;
      };
      packageManager = packageManagerName(parsed.packageManager);
      approvedScripts = APPROVED_NODE_SCRIPTS.filter((name) => typeof parsed.scripts?.[name] === 'string');
      if (typeof parsed.scripts?.typecheck !== 'string' && typeof parsed.scripts?.check === 'string') {
        approvedScriptAliases = { typecheck: 'check' };
      }
    } catch {
      warnings.push('package.json is present but could not be parsed safely');
    }

    if (!packageManager) {
      if (await safeExists(workspace, 'pnpm-lock.yaml')) packageManager = 'pnpm';
      else if (await safeExists(workspace, 'yarn.lock')) packageManager = 'yarn';
      else if (await safeExists(workspace, 'package-lock.json')) packageManager = 'npm';
    }
  }

  if (await safeExists(workspace, 'composer.json')) {
    ecosystems.push('php');
    manifests.push('composer.json');
  }
  if (!ecosystems.includes('php')) {
    for (const marker of PHP_ROOT_MARKERS) {
      if (await safeExists(workspace, marker)) {
        ecosystems.push('php');
        manifests.push(marker);
        break;
      }
    }
  }
  if (await safeExists(workspace, 'pyproject.toml')) {
    ecosystems.push('python');
    manifests.push('pyproject.toml');
  } else if (await safeExists(workspace, 'requirements.txt')) {
    ecosystems.push('python');
    manifests.push('requirements.txt');
  }
  if (await safeExists(workspace, 'Cargo.toml')) {
    ecosystems.push('rust');
    manifests.push('Cargo.toml');
  }
  if (await safeExists(workspace, 'go.mod')) {
    ecosystems.push('go');
    manifests.push('go.mod');
  }

  return {
    primary: ecosystems[0] ?? 'unknown',
    ecosystems,
    manifests,
    packageManager,
    approvedScripts,
    ...(Object.keys(approvedScriptAliases).length > 0 ? { approvedScriptAliases } : {}),
    warnings,
  };
}
