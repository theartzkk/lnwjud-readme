import os from 'node:os';
import path from 'node:path';

export interface DataPathEnvironment {
  readonly AWH_DATA_PATH?: string;
  readonly LNWJUD_DATA_PATH?: string;
  readonly APPDATA?: string;
  readonly USERPROFILE?: string;
  readonly HOME?: string;
}


/**
 * Resolve the canonical AWH per-user data directory.
 *
 * AWH_DATA_PATH is authoritative for AWH builds. LNWJUD_DATA_PATH remains an
 * explicit compatibility override for operators that intentionally co-locate
 * the upstream core data. We do not silently import or merge a legacy lnwjud
 * directory: migration must be explicit and backup/rollback guarded.
 */
export function resolveAwhDataPath(
  environment: DataPathEnvironment = process.env,
  roamingAppDataFallback?: string,
): string {
  const configured = firstConfigured(environment.AWH_DATA_PATH, environment.LNWJUD_DATA_PATH);
  if (configured !== undefined) return path.resolve(configured);

  const appData = firstNonEmpty(
    environment.APPDATA,
    roamingAppDataFallback,
    environment.USERPROFILE ? path.join(environment.USERPROFILE, 'AppData', 'Roaming') : undefined,
    environment.HOME ? path.join(environment.HOME, 'AppData', 'Roaming') : undefined,
    path.join(os.homedir(), 'AppData', 'Roaming'),
  );
  return path.resolve(appData, 'Art’s Workspace Hub');
}

/** Resolve the per-user lnwjud data directory without embedding a developer profile path. */
export function resolveLnwjudDataPath(
  environment: DataPathEnvironment = process.env,
  roamingAppDataFallback?: string,
): string {
  const configured = environment.LNWJUD_DATA_PATH?.trim();
  if (configured) return path.resolve(configured);

  const appData = firstNonEmpty(
    environment.APPDATA,
    roamingAppDataFallback,
    environment.USERPROFILE ? path.join(environment.USERPROFILE, 'AppData', 'Roaming') : undefined,
    environment.HOME ? path.join(environment.HOME, 'AppData', 'Roaming') : undefined,
    path.join(os.homedir(), 'AppData', 'Roaming'),
  );
  return path.resolve(appData, 'lnwjud');
}

function firstConfigured(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function firstNonEmpty(...values: readonly (string | undefined)[]): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return path.join(os.homedir(), 'AppData', 'Roaming');
}
