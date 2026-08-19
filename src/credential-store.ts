const CREDENTIAL_KEY = /^[a-z][a-z0-9._/-]{1,127}$/;
const MAX_CREDENTIAL_BYTES = 4096;

export const DEVICE_TOKEN_CREDENTIAL_KEY = 'awh/device-token';

export class CredentialStoreError extends Error {
  constructor(message: string, readonly code = 'CREDENTIAL_STORE_UNAVAILABLE') {
    super(message);
    this.name = 'CredentialStoreError';
  }
}

export interface CredentialStore {
  get(key: string): Promise<string | null>;
  set(key: string, secret: string): Promise<void>;
  delete(key: string): Promise<void>;
}

function validateKey(key: string): void {
  if (!CREDENTIAL_KEY.test(key)) throw new CredentialStoreError('Credential key is invalid', 'CREDENTIAL_KEY_INVALID');
}

function validateSecret(secret: string): void {
  if (typeof secret !== 'string' || !secret || Buffer.byteLength(secret, 'utf8') > MAX_CREDENTIAL_BYTES || /[\u0000-\u001f\u007f]/.test(secret)) throw new CredentialStoreError('Credential value is invalid', 'CREDENTIAL_VALUE_INVALID');
}

/** Test-only fake; production code must use an OS-backed adapter when available. */
export class InMemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> { validateKey(key); return this.values.get(key) ?? null; }
  async set(key: string, secret: string): Promise<void> { validateKey(key); validateSecret(secret); this.values.set(key, secret); }
  async delete(key: string): Promise<void> { validateKey(key); this.values.delete(key); }
}

/** Explicit fail-closed adapter until Keychain/Credential Manager is integrated. */
export class UnavailableCredentialStore implements CredentialStore {
  async get(_key: string): Promise<string | null> { throw new CredentialStoreError('No secure OS credential store adapter is configured'); }
  async set(_key: string, _secret: string): Promise<void> { throw new CredentialStoreError('No secure OS credential store adapter is configured'); }
  async delete(_key: string): Promise<void> { throw new CredentialStoreError('No secure OS credential store adapter is configured'); }
}

export function createProductionCredentialStore(): CredentialStore { return new UnavailableCredentialStore(); }
