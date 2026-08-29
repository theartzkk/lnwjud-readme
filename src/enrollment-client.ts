import { randomBytes } from 'node:crypto';
import { BOOTSTRAP_NONCE_CREDENTIAL_KEY, DEVICE_TOKEN_CREDENTIAL_KEY, CredentialStore, CredentialStoreError } from './credential-store.js';
import { DeviceIdentity, loadOrCreateDeviceIdentity } from './device-identity.js';
import { RELEASE_VERSION } from './version.js';

const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOOTSTRAP_NONCE = /^[A-Za-z0-9_-]{43}$/;

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

export interface OwnerPairingCode {
  pairingCode: string;
  expiresAt: string;
  projectCount: number;
}

export async function readLocalEnrollmentState(dataDir: string, credentialStore: CredentialStore): Promise<SanitizedEnrollmentState> {
  const identity = await loadOrCreateDeviceIdentity(dataDir);
  const token = await credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY);
  return { enrolled: Boolean(token), deviceId: identity.deviceId, displayName: identity.displayName, platform: identity.platform, credentialStored: Boolean(token), expiresAt: null, projectCount: null };
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

/** A successful HTTP response is not enough: the worker must be able to
 * retrieve the exact credential after the store reports a successful write. */
async function persistDeviceToken(credentialStore: CredentialStore, token: string): Promise<void> {
  await credentialStore.set(DEVICE_TOKEN_CREDENTIAL_KEY, token);
  const persisted = await credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY);
  if (persisted !== token) throw new CredentialStoreError('Enrollment credential could not be verified after saving', 'CREDENTIAL_PERSISTENCE_FAILED');
}

async function deleteDeviceToken(credentialStore: CredentialStore): Promise<void> {
  await credentialStore.delete(DEVICE_TOKEN_CREDENTIAL_KEY);
  const remaining = await credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY);
  if (remaining !== null) throw new CredentialStoreError('Enrollment credential could not be removed', 'CREDENTIAL_PERSISTENCE_FAILED');
}

export class EnrollmentClient {
  private readonly root: URL;

  constructor(private readonly apiBase: string, private readonly dataDir: string, private readonly credentialStore: CredentialStore, private readonly fetchImpl: typeof fetch = fetch, private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    this.root = apiRoot(apiBase);
    if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 120_000) throw new EnrollmentClientError('Enrollment request timeout is invalid', 'REQUEST_TIMEOUT_INVALID');
  }

  async state(): Promise<SanitizedEnrollmentState> {
    return readLocalEnrollmentState(this.dataDir, this.credentialStore);
  }

  /**
   * Prepare the one bootstrap nonce in the existing OS credential store.
   * Returning only whether an existing valid nonce was reused keeps the
   * secret out of UI state, logs, and orchestration results.
   */
  async prepareBootstrapNonce(): Promise<{ reused: boolean }> {
    const existing = await this.credentialStore.get(BOOTSTRAP_NONCE_CREDENTIAL_KEY);
    if (existing !== null) {
      if (!BOOTSTRAP_NONCE.test(existing)) throw new EnrollmentClientError('Stored bootstrap nonce is invalid', 'BOOTSTRAP_NONCE_INVALID');
      return { reused: true };
    }
    await this.credentialStore.set(BOOTSTRAP_NONCE_CREDENTIAL_KEY, rfc4648Nonce());
    return { reused: false };
  }

  async login(username: string, password: string): Promise<SanitizedEnrollmentState> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    const normalized = typeof username === 'string' ? username.trim().toLowerCase() : '';
    if (!/^[a-z][a-z0-9._-]{2,63}$/.test(normalized) || typeof password !== 'string' || password.length < 1 || password.length > 512) throw new EnrollmentClientError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'AUTH_FAILED');
    const response = await this.post('/enrollment/password', {
      schemaVersion: 1, username: normalized, password, deviceId: identity.deviceId, displayName: identity.displayName, platform: identity.platform, arch: identity.arch, appVersion: 'desktop',
    });
    if (typeof response.accessToken !== 'string' || typeof response.expiresAt !== 'string') throw new EnrollmentClientError('AWH login response did not contain a session token', 'RESPONSE_INVALID');
    await persistDeviceToken(this.credentialStore, response.accessToken);
    return this.sanitize(identity, response);
  }

  async pair(pairingCode: string): Promise<SanitizedEnrollmentState> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (typeof pairingCode !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(pairingCode)) throw new EnrollmentClientError('Pairing code is invalid', 'PAIRING_CODE_INVALID');
    const response = await this.post('/enrollment/devices', {
      schemaVersion: 1, pairingCode, deviceId: identity.deviceId, displayName: identity.displayName, platform: identity.platform, arch: identity.arch, appVersion: RELEASE_VERSION,
    });
    if (typeof response.accessToken !== 'string' || typeof response.expiresAt !== 'string') throw new EnrollmentClientError('Enrollment response did not contain a credential', 'RESPONSE_INVALID');
    await persistDeviceToken(this.credentialStore, response.accessToken);
    return this.sanitize(identity, response);
  }

  /**
   * Issue one short-lived pairing code for projects owned by this device's
   * owner. The code is intentionally returned to the immediate caller only;
   * it is never written to the credential store or local settings.
   */
  async issuePairingCode(projectIds: string[], ttlSeconds = 600): Promise<OwnerPairingCode> {
    const token = await this.credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY);
    if (!token) throw new EnrollmentClientError('Device is not enrolled', 'DEVICE_NOT_ENROLLED');
    const projectScope = Array.isArray(projectIds) ? [...new Set(projectIds)] : [];
    if (!Array.isArray(projectIds) || projectScope.length > 16 || projectScope.some((projectId) => !UUID_V4.test(projectId))) {
      throw new EnrollmentClientError('Project scope is invalid', 'PROJECT_SCOPE_INVALID');
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 600) throw new EnrollmentClientError('Pairing expiry is invalid', 'PAIRING_TTL_INVALID');
    const response = await this.post('/enrollment/pairing-codes', { schemaVersion: 1, projectIds: projectScope, ttlSeconds }, token);
    const pairingCode = typeof response.pairingCode === 'string' ? response.pairingCode : '';
    const expiresAt = typeof response.expiresAt === 'string' ? response.expiresAt : '';
    const projectCount = typeof response.projectCount === 'number' ? response.projectCount : 0;
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(pairingCode) || !Number.isInteger(projectCount) || projectCount < 0 || projectCount !== projectScope.length || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
      throw new EnrollmentClientError('Pairing response is invalid', 'RESPONSE_INVALID');
    }
    return { pairingCode, expiresAt, projectCount };
  }

  /**
   * Bootstrap the first owner and immediately consume the one-time pairing
   * code for this device. A nonce must already have been prepared in the OS
   * credential store; this method never silently creates a replacement nonce.
   * The nonce is removed only after first-device enrollment succeeds.
   */
  async bootstrapAndEnroll(projectIds: string[], displayName?: string, userId?: string): Promise<SanitizedEnrollmentState> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir, displayName);
    const ownerId = userId ?? identity.deviceId;
    if (!isEnrollmentDeviceId(ownerId)) throw new EnrollmentClientError('Owner identity is invalid', 'OWNER_ID_INVALID');
    const nonce = await this.credentialStore.get(BOOTSTRAP_NONCE_CREDENTIAL_KEY);
    if (nonce === null) throw new EnrollmentClientError('Bootstrap nonce is not prepared in the secure credential store', 'BOOTSTRAP_NONCE_MISSING');
    if (!BOOTSTRAP_NONCE.test(nonce)) throw new EnrollmentClientError('Stored bootstrap nonce is invalid', 'BOOTSTRAP_NONCE_INVALID');
    const response = await this.post('/enrollment/bootstrap', {
      schemaVersion: 1, userId: ownerId, displayName: identity.displayName, projectIds,
    }, undefined, { 'X-AWH-Bootstrap-Nonce': nonce });
    if (response.bootstrapClosed !== true || typeof response.initialPairingCode !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(response.initialPairingCode)) {
      throw new EnrollmentClientError('Bootstrap response did not contain a bounded pairing code', 'RESPONSE_INVALID');
    }
    if (typeof response.initialPairingExpiresAt !== 'string') throw new EnrollmentClientError('Bootstrap response expiry is invalid', 'RESPONSE_INVALID');
    const state = await this.pair(response.initialPairingCode);
    await this.credentialStore.delete(BOOTSTRAP_NONCE_CREDENTIAL_KEY);
    return state;
  }

  async rotate(): Promise<SanitizedEnrollmentState> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    const token = await this.credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY);
    if (!token) throw new EnrollmentClientError('Device is not enrolled', 'DEVICE_NOT_ENROLLED');
    const response = await this.post('/enrollment/token/rotate', { schemaVersion: 1, deviceId: identity.deviceId }, token);
    if (typeof response.accessToken !== 'string' || typeof response.expiresAt !== 'string') throw new EnrollmentClientError('Rotation response did not contain a credential', 'RESPONSE_INVALID');
    await persistDeviceToken(this.credentialStore, response.accessToken);
    return this.sanitize(identity, response);
  }

  async revoke(): Promise<SanitizedEnrollmentState> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    const token = await this.credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY);
    if (!token) throw new EnrollmentClientError('Device is not enrolled', 'DEVICE_NOT_ENROLLED');
    const response = await this.post('/enrollment/token/revoke', { schemaVersion: 1, deviceId: identity.deviceId }, token);
    if (response.revoked !== true) throw new EnrollmentClientError('Credential revocation was not confirmed', 'RESPONSE_INVALID');
    await deleteDeviceToken(this.credentialStore);
    return { enrolled: false, deviceId: identity.deviceId, displayName: identity.displayName, platform: identity.platform, credentialStored: false, expiresAt: null, projectCount: null };
  }

  private async post(path: string, payload: Record<string, unknown>, token?: string, extraHeaders: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders };
    if (token) headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(new URL(`${this.root.toString()}/${path.replace(/^\//, '')}`), { method: 'POST', headers, body: JSON.stringify(payload), credentials: 'omit', cache: 'no-store', signal: controller.signal });
      return await jsonResponse(response);
    } catch (error) {
      if (controller.signal.aborted) throw new EnrollmentClientError('การเชื่อมต่อ AWH ใช้เวลานานเกินไป กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่', 'REQUEST_TIMEOUT');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private sanitize(identity: DeviceIdentity, response: Record<string, unknown>): SanitizedEnrollmentState {
    return { enrolled: true, deviceId: identity.deviceId, displayName: identity.displayName, platform: identity.platform, credentialStored: true, expiresAt: typeof response.expiresAt === 'string' ? response.expiresAt : null, projectCount: typeof response.projectCount === 'number' ? response.projectCount : null };
  }
}

export function isEnrollmentDeviceId(value: string): boolean { return UUID_V4.test(value); }

function rfc4648Nonce(): string {
  return randomBytes(32).toString('base64url');
}
