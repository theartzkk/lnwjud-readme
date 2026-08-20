import { DEVICE_TOKEN_CREDENTIAL_KEY, CredentialStore } from './credential-store.js';
import { DeviceIdentity, loadOrCreateDeviceIdentity } from './device-identity.js';

const MAX_RESPONSE_BYTES = 64 * 1024;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class EnrollmentClientError extends Error {
  constructor(message: string, readonly code = 'ENROLLMENT_CLIENT_FAILED') {
    super(message);
    this.name = 'EnrollmentClientError';
  }
}

export interface SanitizedEnrollmentState {
  enrolled: boolean;
  deviceId: string;
  displayName: string;
  platform: DeviceIdentity['platform'];
  credentialStored: boolean;
  expiresAt: string | null;
  projectCount: number | null;
}

function apiRoot(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new EnrollmentClientError('Enrollment API URL is invalid', 'API_URL_INVALID'); }
  if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new EnrollmentClientError('Enrollment API requires HTTPS', 'API_URL_INSECURE');
  if (url.search || url.hash || !url.pathname.endsWith('/api/v1')) throw new EnrollmentClientError('Enrollment API path is invalid', 'API_URL_INVALID');
  url.pathname = url.pathname.replace(/\/$/, '');
  return url;
}

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) throw new EnrollmentClientError('Enrollment response is too large', 'RESPONSE_TOO_LARGE');
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new EnrollmentClientError('Enrollment response is invalid', 'RESPONSE_INVALID'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EnrollmentClientError('Enrollment response is invalid', 'RESPONSE_INVALID');
  const record = value as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message : 'Enrollment request was rejected';
  const code = typeof record.code === 'string' ? record.code : 'ENROLLMENT_REJECTED';
  if (!response.ok) throw new EnrollmentClientError(message, code);
  return value as Record<string, unknown>;
}

export class EnrollmentClient {
  private readonly root: URL;

  constructor(private readonly apiBase: string, private readonly dataDir: string, private readonly credentialStore: CredentialStore, private readonly fetchImpl: typeof fetch = fetch) {
    this.root = apiRoot(apiBase);
  }

  async state(): Promise<SanitizedEnrollmentState> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    const token = await this.credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY);
    return { enrolled: Boolean(token), deviceId: identity.deviceId, displayName: identity.displayName, platform: identity.platform, credentialStored: Boolean(token), expiresAt: null, projectCount: null };
  }

  async pair(pairingCode: string): Promise<SanitizedEnrollmentState> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (typeof pairingCode !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(pairingCode)) throw new EnrollmentClientError('Pairing code is invalid', 'PAIRING_CODE_INVALID');
    const response = await this.post('/enrollment/devices', {
      schemaVersion: 1, pairingCode, deviceId: identity.deviceId, displayName: identity.displayName, platform: identity.platform, arch: identity.arch, appVersion: 'local',
    });
    if (typeof response.accessToken !== 'string' || typeof response.expiresAt !== 'string') throw new EnrollmentClientError('Enrollment response did not contain a credential', 'RESPONSE_INVALID');
    await this.credentialStore.set(DEVICE_TOKEN_CREDENTIAL_KEY, response.accessToken);
    return this.sanitize(identity, response);
  }

  async rotate(): Promise<SanitizedEnrollmentState> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    const token = await this.credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY);
    if (!token) throw new EnrollmentClientError('Device is not enrolled', 'DEVICE_NOT_ENROLLED');
    const response = await this.post('/enrollment/token/rotate', { schemaVersion: 1, deviceId: identity.deviceId }, token);
    if (typeof response.accessToken !== 'string' || typeof response.expiresAt !== 'string') throw new EnrollmentClientError('Rotation response did not contain a credential', 'RESPONSE_INVALID');
    await this.credentialStore.set(DEVICE_TOKEN_CREDENTIAL_KEY, response.accessToken);
    return this.sanitize(identity, response);
  }

  private async post(path: string, payload: Record<string, unknown>, token?: string): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await this.fetchImpl(new URL(`${this.root.toString()}/${path.replace(/^\//, '')}`), { method: 'POST', headers, body: JSON.stringify(payload), credentials: 'omit', cache: 'no-store' });
    return jsonResponse(response);
  }

  private sanitize(identity: DeviceIdentity, response: Record<string, unknown>): SanitizedEnrollmentState {
    return { enrolled: true, deviceId: identity.deviceId, displayName: identity.displayName, platform: identity.platform, credentialStored: true, expiresAt: typeof response.expiresAt === 'string' ? response.expiresAt : null, projectCount: typeof response.projectCount === 'number' ? response.projectCount : null };
  }
}

export function isEnrollmentDeviceId(value: string): boolean { return UUID_V4.test(value); }
