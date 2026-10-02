import { ControlPlaneWorkerError } from './control-plane-worker-client.js';

export function isRecoverableWorkerCredentialError(error: unknown): boolean {
  return error instanceof ControlPlaneWorkerError && error.code === 'TOKEN_REJECTED';
}

export async function runWithWorkerCredentialRecovery<T>(
  run: () => Promise<T>,
  rotate: () => Promise<unknown>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isRecoverableWorkerCredentialError(error)) throw error;
    await rotate();
    return run();
  }
}
