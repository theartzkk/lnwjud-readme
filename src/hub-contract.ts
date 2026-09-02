import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { assertNotSecret } from './security.js';

/** M3A is a contract-only boundary. It does not implement transport, storage, or sync. */
export const HUB_CONTRACT_SCHEMA_VERSION = 1 as const;
export const HUB_API_VERSION = 'v1' as const;
export const MAX_HUB_NAME_LENGTH = 120;
export const MAX_DEVICE_DISPLAY_NAME_LENGTH = 80;
export const MAX_SOURCE_MANIFEST_ENTRIES = 10_000;
export const MAX_SOURCE_FILE_BYTES = 256 * 1024;
export const MAX_CONTENT_BLOB_BYTES = 256 * 1024;
export const MAX_MEMORY_BLOB_BYTES = 256 * 1024;
export const MAX_METADATA_KEYS = 24;
export const MAX_METADATA_VALUE_LENGTH = 512;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const SAFE_TYPE = /^[a-z][a-z0-9-]{0,31}$/;
const ISO_DATE = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const MEMORY_FILE = /^(?:CURRENT_STATE|PROJECT|HANDOFF|TASKS|ARCHITECTURE|DECISIONS)\.md$/;
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', 'out', '.awh-local']);
const SECRET_FILE_NAMES = new Set(['.env', 'credentials.json', 'service-account.json', 'id_rsa', 'id_ed25519']);
const SECRET_SUFFIXES = ['.pem', '.key', '.p12', '.pfx'];
const MEDIA_CONTENT_TYPES = /^(?:image\/|video\/|audio\/|application\/pdf$)/i;
const SENSITIVE_METADATA_KEY = /(?:access|refresh)?token(?:secret|value)?$|secret|password|authorization|credential|api[-_]?key/i;
const PAIRING_CODE = /^[A-Za-z0-9_-]{32,128}$/;

export type HubPlatform = 'darwin' | 'win32' | 'linux';
export type HubProjectRole = 'owner' | 'member';
export type SourceFileKind = 'file';

export interface HubUser {
  schemaVersion: 1;
  userId: string;
  displayName: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface HubDevice {
  schemaVersion: 1;
  deviceId: string;
  userId: string;
  displayName: string;
  platform: HubPlatform;
  arch: string;
  appVersion: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

/** Portable project truth. It intentionally contains no workspacePath or repository URL. */
export interface HubProject {
  schemaVersion: 1;
  projectId: string;
  name: string;
  type: string;
  createdAt: string;
}

export interface ProjectMembership {
  schemaVersion: 1;
  projectId: string;
  userId: string;
  role: HubProjectRole;
  createdAt: string;
  revokedAt: string | null;
}

export interface MemoryRevision {
  schemaVersion: 1;
  revisionId: string;
  projectId: string;
  memoryFile: string;
  parentRevisionId: string | null;
  deviceId: string;
  createdAt: string;
  sha256: string;
  size: number;
  content: string | null;
}

export interface SourceManifestEntry {
  relativePath: string;
  sha256: string;
  size: number;
  kind: SourceFileKind;
  mode?: number;
}

export interface SourceManifest {
  schemaVersion: 1;
  projectId: string;
  files: SourceManifestEntry[];
}

export interface SourceRevision {
  schemaVersion: 1;
  revisionId: string;
  projectId: string;
  parentRevisionId: string | null;
  deviceId: string;
  createdAt: string;
  manifestHash: string;
  manifest: SourceManifest;
}

export interface ContentBlobReference {
  schemaVersion: 1;
  sha256: string;
  size: number;
  contentType: string;
}

export interface BuildReleaseMetadata {
  schemaVersion: 1;
  buildId: string;
  projectId: string;
  revisionId: string;
  deviceId: string;
  status: 'queued' | 'running' | 'passed' | 'failed';
  version: string;
  createdAt: string;
  completedAt: string | null;
  artifactRefs: string[];
}

export interface AuditEvent {
  schemaVersion: 1;
  eventId: string;
  requestId: string;
  userId: string | null;
  deviceId: string | null;
  projectId: string | null;
  tokenId: string | null;
  action: string;
  outcome: 'allowed' | 'denied' | 'error';
  occurredAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface RevisionSummary {
  revisionId: string;
  parentRevisionId: string | null;
  deviceId: string;
  createdAt: string;
  manifestHash: string;
}

export interface RevisionConflictResponse {
  schemaVersion: 1;
  error: 'CONFLICT';
  code: 'REVISION_CONFLICT';
  requestId: string;
  projectId: string;
  current: RevisionSummary;
  submitted: RevisionSummary;
}

export interface DeviceRegistrationRequest {
  schemaVersion: 1;
  userId: string;
  deviceId: string;
  displayName: string;
  platform: HubPlatform;
  arch: string;
  appVersion: string;
}

export interface PairingCodeRecord {
  schemaVersion: 1;
  pairingCodeId: string;
  codeHash: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
}

export interface PairingEnrollmentRequest {
  schemaVersion: 1;
  pairingCode: string;
  deviceId: string;
  displayName: string;
  platform: HubPlatform;
  arch: string;
  appVersion: string;
}

export interface DeviceTokenRecord {
  schemaVersion: 1;
  tokenId: string;
  userId: string;
  deviceId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  rotatedFromTokenId: string | null;
  replacedByTokenId: string | null;
}

export interface TokenRotationRequest {
  schemaVersion: 1;
  tokenId: string;
  deviceId: string;
}

export interface ProjectAuthorizationInput {
  schemaVersion: 1;
  userId: string;
  deviceId: string;
  projectId: string;
}

export interface OwnerBootstrapState {
  schemaVersion: 1;
  ownerUserId: string | null;
  initializedAt: string | null;
  bootstrapClosed: boolean;
}

export type PairingCodeState = 'active' | 'expired' | 'consumed' | 'revoked';
export type DeviceTokenState = 'active' | 'expired' | 'revoked';

export interface TokenEnvelope {
  schemaVersion: 1;
  accessToken: string;
  expiresAt: string;
  tokenType: 'Bearer';
}

export const HUB_API_ROUTES = Object.freeze({
  health: 'GET /api/v1/health',
  status: 'GET /api/v1/status',
  deviceRegister: 'POST /api/v1/auth/device/register',
  tokenRotate: 'POST /api/v1/auth/token/rotate',
  logout: 'POST /api/v1/auth/logout',
  projectsList: 'GET /api/v1/projects',
  projectGet: 'GET /api/v1/projects/{projectId}',
  devicesList: 'GET /api/v1/devices',
  buildsList: 'GET /api/v1/builds',
  releasesList: 'GET /api/v1/releases',
  projectRegister: 'PUT /api/v1/projects/{projectId}',
  revisionsList: 'GET /api/v1/projects/{projectId}/revisions',
  revisionCreate: 'POST /api/v1/projects/{projectId}/revisions',
  memoryGet: 'GET /api/v1/projects/{projectId}/memory',
  memoryRevisionCreate: 'POST /api/v1/projects/{projectId}/memory/revisions',
  blobGet: 'GET /api/v1/blobs/{sha256}',
  blobHead: 'HEAD /api/v1/blobs/{sha256}',
  blobPut: 'PUT /api/v1/blobs/{sha256}',
  deviceHeartbeat: 'POST /api/v1/devices/{deviceId}/heartbeat',
  syncStatus: 'GET /api/v1/projects/{projectId}/sync-status',
} as const);

export class HubContractError extends Error {
  constructor(message: string, readonly code: string, readonly field?: string) {
    super(message);
    this.name = 'HubContractError';
  }
}

function record(value: unknown, code = 'INVALID_OBJECT'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HubContractError('Expected an object', code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const expected = [...allowed].sort().join(',');
  const actual = Object.keys(value).sort().join(',');
  if (actual !== expected) throw new HubContractError('Payload contains unknown or missing fields', 'SCHEMA_FIELDS');
}

function text(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new HubContractError(`${field} is invalid`, 'FIELD_INVALID', field);
  }
  return value;
}

function contentText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new HubContractError(`${field} is invalid`, 'FIELD_INVALID', field);
  }
  return value;
}

function uuid(value: unknown, field: string): string {
  const result = text(value, field, 64);
  if (!UUID_V4.test(result)) throw new HubContractError(`${field} must be a UUID v4`, 'ID_INVALID', field);
  return result;
}

function sha(value: unknown, field: string): string {
  const result = text(value, field, 64).toLowerCase();
  if (!SHA256.test(result)) throw new HubContractError(`${field} must be sha256`, 'HASH_INVALID', field);
  return result;
}

function date(value: unknown, field: string): string {
  if (!ISO_DATE(value)) throw new HubContractError(`${field} must be an ISO timestamp`, 'DATE_INVALID', field);
  return value;
}

function nullableDate(value: unknown, field: string): string | null {
  return value === null ? null : date(value, field);
}

function boundedSize(value: unknown, field: string, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw new HubContractError(`${field} exceeds its bounded size`, 'SIZE_INVALID', field);
  return value;
}

function nullableUuid(value: unknown, field: string): string | null {
  return value === null ? null : uuid(value, field);
}

function portableName(value: unknown, field: string, max: number): string {
  const result = text(value, field, max).trim();
  if (!result || /[\\/]/.test(result) || isAbsolute(result) || /^(?:[A-Za-z]:[\\/]|~[\\/])/.test(result) || /^https?:\/\//i.test(result)) {
    throw new HubContractError(`${field} must be portable`, 'PORTABILITY_INVALID', field);
  }
  return result;
}

export function validateProjectId(value: unknown): string { return uuid(value, 'projectId'); }
export function validateDeviceId(value: unknown): string { return uuid(value, 'deviceId'); }
export function validateUserId(value: unknown): string { return uuid(value, 'userId'); }
export function validateRevisionId(value: unknown): string { return uuid(value, 'revisionId'); }

export function validateHubUser(input: unknown): HubUser {
  const value = record(input);
  exactKeys(value, ['createdAt', 'displayName', 'revokedAt', 'schemaVersion', 'userId']);
  if (value.schemaVersion !== 1) throw new HubContractError('Unsupported user schema', 'SCHEMA_VERSION');
  return { schemaVersion: 1, userId: validateUserId(value.userId), displayName: portableName(value.displayName, 'displayName', MAX_DEVICE_DISPLAY_NAME_LENGTH), createdAt: date(value.createdAt, 'createdAt'), revokedAt: nullableDate(value.revokedAt, 'revokedAt') };
}

export function validateProjectMembership(input: unknown): ProjectMembership {
  const value = record(input);
  exactKeys(value, ['createdAt', 'projectId', 'revokedAt', 'role', 'schemaVersion', 'userId']);
  if (value.schemaVersion !== 1) throw new HubContractError('Unsupported membership schema', 'SCHEMA_VERSION');
  const role = text(value.role, 'role', 16);
  if (role !== 'owner' && role !== 'member') throw new HubContractError('Membership role is invalid', 'FIELD_INVALID', 'role');
  return { schemaVersion: 1, projectId: validateProjectId(value.projectId), userId: validateUserId(value.userId), role, createdAt: date(value.createdAt, 'createdAt'), revokedAt: nullableDate(value.revokedAt, 'revokedAt') };
}

export function validateHubProject(input: unknown): HubProject {
  const value = record(input);
  exactKeys(value, ['createdAt', 'name', 'projectId', 'schemaVersion', 'type']);
  if (value.schemaVersion !== HUB_CONTRACT_SCHEMA_VERSION) throw new HubContractError('Unsupported project schema', 'SCHEMA_VERSION');
  return {
    schemaVersion: 1,
    projectId: validateProjectId(value.projectId),
    name: portableName(value.name, 'name', MAX_HUB_NAME_LENGTH),
    type: (() => {
      const result = text(value.type, 'type', 32).trim().toLowerCase();
      if (!SAFE_TYPE.test(result)) throw new HubContractError('type is invalid', 'FIELD_INVALID', 'type');
      return result;
    })(),
    createdAt: date(value.createdAt, 'createdAt'),
  };
}

export function validateDeviceRegistration(input: unknown): DeviceRegistrationRequest {
  const value = record(input);
  exactKeys(value, ['appVersion', 'arch', 'deviceId', 'displayName', 'platform', 'schemaVersion', 'userId']);
  if (value.schemaVersion !== 1) throw new HubContractError('Unsupported device schema', 'SCHEMA_VERSION');
  const platform = text(value.platform, 'platform', 16);
  if (!['darwin', 'win32', 'linux'].includes(platform)) throw new HubContractError('Unsupported platform', 'FIELD_INVALID', 'platform');
  return {
    schemaVersion: 1,
    userId: validateUserId(value.userId),
    deviceId: validateDeviceId(value.deviceId),
    displayName: portableName(value.displayName, 'displayName', MAX_DEVICE_DISPLAY_NAME_LENGTH),
    platform: platform as HubPlatform,
    arch: text(value.arch, 'arch', 32),
    appVersion: text(value.appVersion, 'appVersion', 32),
  };
}

export function validatePairingEnrollmentRequest(input: unknown): PairingEnrollmentRequest {
  const value = record(input);
  exactKeys(value, ['appVersion', 'arch', 'deviceId', 'displayName', 'pairingCode', 'platform', 'schemaVersion']);
  if (value.schemaVersion !== 1) throw new HubContractError('Unsupported pairing schema', 'SCHEMA_VERSION');
  const pairingCode = text(value.pairingCode, 'pairingCode', 128);
  if (!PAIRING_CODE.test(pairingCode)) throw new HubContractError('Pairing code is invalid or too weakly bounded', 'PAIRING_CODE_INVALID', 'pairingCode');
  const platform = text(value.platform, 'platform', 16);
  if (!['darwin', 'win32', 'linux'].includes(platform)) throw new HubContractError('Unsupported platform', 'FIELD_INVALID', 'platform');
  return { schemaVersion: 1, pairingCode, deviceId: validateDeviceId(value.deviceId), displayName: portableName(value.displayName, 'displayName', MAX_DEVICE_DISPLAY_NAME_LENGTH), platform: platform as HubPlatform, arch: text(value.arch, 'arch', 32), appVersion: text(value.appVersion, 'appVersion', 32) };
}

export function validatePairingCodeRecord(input: unknown): PairingCodeRecord {
  const value = record(input);
  exactKeys(value, ['codeHash', 'consumedAt', 'expiresAt', 'issuedAt', 'pairingCodeId', 'revokedAt', 'schemaVersion']);
  if (value.schemaVersion !== 1) throw new HubContractError('Unsupported pairing record schema', 'SCHEMA_VERSION');
  return { schemaVersion: 1, pairingCodeId: validateRevisionId(value.pairingCodeId), codeHash: sha(value.codeHash, 'codeHash'), issuedAt: date(value.issuedAt, 'issuedAt'), expiresAt: date(value.expiresAt, 'expiresAt'), consumedAt: nullableDate(value.consumedAt, 'consumedAt'), revokedAt: nullableDate(value.revokedAt, 'revokedAt') };
}

export function pairingCodeState(record: PairingCodeRecord, at = new Date()): PairingCodeState {
  if (record.revokedAt !== null) return 'revoked';
  if (record.consumedAt !== null) return 'consumed';
  return Date.parse(record.expiresAt) <= at.getTime() ? 'expired' : 'active';
}

export function validateDeviceTokenRecord(input: unknown): DeviceTokenRecord {
  const value = record(input);
  exactKeys(value, ['createdAt', 'deviceId', 'expiresAt', 'lastUsedAt', 'replacedByTokenId', 'revokedAt', 'rotatedFromTokenId', 'schemaVersion', 'tokenHash', 'tokenId', 'userId']);
  if (value.schemaVersion !== 1) throw new HubContractError('Unsupported device token schema', 'SCHEMA_VERSION');
  const tokenId = validateRevisionId(value.tokenId);
  const rotatedFromTokenId = value.rotatedFromTokenId === null ? null : validateRevisionId(value.rotatedFromTokenId);
  const replacedByTokenId = value.replacedByTokenId === null ? null : validateRevisionId(value.replacedByTokenId);
  if (rotatedFromTokenId === tokenId || replacedByTokenId === tokenId) throw new HubContractError('Token rotation chain is invalid', 'TOKEN_ROTATION_INVALID');
  return { schemaVersion: 1, tokenId, userId: validateUserId(value.userId), deviceId: validateDeviceId(value.deviceId), tokenHash: sha(value.tokenHash, 'tokenHash'), createdAt: date(value.createdAt, 'createdAt'), expiresAt: date(value.expiresAt, 'expiresAt'), revokedAt: nullableDate(value.revokedAt, 'revokedAt'), lastUsedAt: nullableDate(value.lastUsedAt, 'lastUsedAt'), rotatedFromTokenId, replacedByTokenId };
}

export function deviceTokenState(record: DeviceTokenRecord, at = new Date()): DeviceTokenState {
  if (record.revokedAt !== null) return 'revoked';
  return Date.parse(record.expiresAt) <= at.getTime() ? 'expired' : 'active';
}

export function validateOwnerBootstrapState(input: unknown): OwnerBootstrapState {
  const value = record(input);
  exactKeys(value, ['bootstrapClosed', 'initializedAt', 'ownerUserId', 'schemaVersion']);
  if (value.schemaVersion !== 1 || typeof value.bootstrapClosed !== 'boolean') throw new HubContractError('Invalid owner bootstrap state', 'BOOTSTRAP_STATE_INVALID');
  const ownerUserId = nullableUuid(value.ownerUserId, 'ownerUserId');
  const initializedAt = nullableDate(value.initializedAt, 'initializedAt');
  if ((ownerUserId === null) !== (initializedAt === null) || value.bootstrapClosed !== (ownerUserId !== null)) throw new HubContractError('Owner bootstrap state is not closed consistently', 'BOOTSTRAP_STATE_INVALID');
  return { schemaVersion: 1, ownerUserId, initializedAt, bootstrapClosed: value.bootstrapClosed };
}

export function validateTokenRotationRequest(input: unknown): TokenRotationRequest {
  const value = record(input);
  exactKeys(value, ['deviceId', 'schemaVersion', 'tokenId']);
  if (value.schemaVersion !== 1) throw new HubContractError('Unsupported token rotation schema', 'SCHEMA_VERSION');
  return { schemaVersion: 1, tokenId: validateRevisionId(value.tokenId), deviceId: validateDeviceId(value.deviceId) };
}

/** Validate the safe Authorization shape without returning or serializing the bearer secret. */
export function validateAuthorizationHeader(input: unknown): 'Bearer' {
  if (typeof input !== 'string' || !/^Bearer\s+[^\s]+$/i.test(input) || /[\u0000-\u001f\u007f]/.test(input)) throw new HubContractError('Authorization must be a bearer credential', 'AUTHORIZATION_INVALID');
  return 'Bearer';
}

export function assertNoCredentialInRequestTarget(input: unknown): string {
  const target = text(input, 'requestTarget', 2048);
  if (/[?#].*(?:token|secret|password|authorization|credential)/i.test(target) || /(?:^|[?&])(access_token|refresh_token|token|secret|password|authorization)=/i.test(target)) throw new HubContractError('Credentials are forbidden in URLs and query strings', 'AUTHORIZATION_IN_URL');
  return target;
}

/** Authentication must be followed by this project/user/device membership check. */
export function assertProjectAuthorization(input: ProjectAuthorizationInput, membership: ProjectMembership, device: Pick<HubDevice, 'deviceId' | 'userId' | 'revokedAt'>): void {
  const request = record(input);
  exactKeys(request, ['deviceId', 'projectId', 'schemaVersion', 'userId']);
  if (request.schemaVersion !== 1) throw new HubContractError('Unsupported authorization schema', 'SCHEMA_VERSION');
  const userId = validateUserId(request.userId);
  const projectId = validateProjectId(request.projectId);
  const deviceId = validateDeviceId(request.deviceId);
  if (membership.revokedAt !== null || membership.userId !== userId || membership.projectId !== projectId || device.deviceId !== deviceId || device.userId !== userId || device.revokedAt !== null) throw new HubContractError('Project membership does not authorize this request', 'PROJECT_FORBIDDEN');
}

function excludedSourcePath(value: string): boolean {
  const parts = value.split('/');
  const leaf = parts.at(-1)?.toLowerCase() ?? '';
  if (parts.some((part) => EXCLUDED_DIRECTORIES.has(part.toLowerCase()))) return true;
  if (leaf.startsWith('.env') || SECRET_FILE_NAMES.has(leaf) || SECRET_SUFFIXES.some((suffix) => leaf.endsWith(suffix))) return true;
  return /(?:credential|secret|password|token)/i.test(leaf);
}

export function validateRelativeSourcePath(value: unknown): string {
  const result = text(value, 'relativePath', 512);
  if (!result || result.includes('\\') || isAbsolute(result) || /^(?:[A-Za-z]:|~(?:\/|$))/.test(result)) throw new HubContractError('Source path must be relative and use / separators', 'PATH_INVALID', 'relativePath');
  const parts = result.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..') || excludedSourcePath(result)) throw new HubContractError('Source path is excluded or unsafe', 'PATH_EXCLUDED', 'relativePath');
  try { assertNotSecret(result); } catch { throw new HubContractError('Source path is secret-like', 'PATH_EXCLUDED', 'relativePath'); }
  return result;
}

export function validateSourceManifest(input: unknown): SourceManifest {
  const value = record(input);
  exactKeys(value, ['files', 'projectId', 'schemaVersion']);
  if (value.schemaVersion !== 1) throw new HubContractError('Unsupported source manifest schema', 'SCHEMA_VERSION');
  const projectId = validateProjectId(value.projectId);
  if (!Array.isArray(value.files) || value.files.length > MAX_SOURCE_MANIFEST_ENTRIES) throw new HubContractError('Source manifest is too large', 'MANIFEST_BOUNDED');
  const paths = new Set<string>();
  const files = value.files.map((raw, index) => {
    const entry = record(raw, 'MANIFEST_ENTRY_INVALID');
    const keys = Object.keys(entry);
    if (!(keys.length === 4 || keys.length === 5) || !keys.includes('relativePath') || !keys.includes('sha256') || !keys.includes('size') || !keys.includes('kind') || (keys.length === 5 && !keys.includes('mode'))) throw new HubContractError('Source manifest entry fields are invalid', 'MANIFEST_ENTRY_INVALID');
    const relativePath = validateRelativeSourcePath(entry.relativePath);
    if (paths.has(relativePath)) throw new HubContractError(`Duplicate source path at index ${index}`, 'MANIFEST_DUPLICATE_PATH');
    paths.add(relativePath);
    const kind = text(entry.kind, 'kind', 16);
    if (kind !== 'file') throw new HubContractError('Unsupported source entry kind', 'MANIFEST_ENTRY_INVALID', 'kind');
    const result: SourceManifestEntry = { relativePath, sha256: sha(entry.sha256, 'sha256'), size: boundedSize(entry.size, 'size', MAX_SOURCE_FILE_BYTES), kind: kind as SourceFileKind };
    if ('mode' in entry) {
      if (typeof entry.mode !== 'number' || !Number.isSafeInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) throw new HubContractError('mode is invalid', 'FIELD_INVALID', 'mode');
      result.mode = entry.mode;
    }
    return result;
  });
  return { schemaVersion: 1, projectId, files };
}

function canonicalManifest(manifest: SourceManifest): string {
  return JSON.stringify({ schemaVersion: 1, projectId: manifest.projectId, files: [...manifest.files].sort((a, b) => a.relativePath.localeCompare(b.relativePath)) });
}

export function sourceManifestHash(manifest: SourceManifest): string {
  return createHash('sha256').update(canonicalManifest(manifest), 'utf8').digest('hex');
}

export function validateSourceRevision(input: unknown): SourceRevision {
  const value = record(input);
  exactKeys(value, ['createdAt', 'deviceId', 'manifest', 'manifestHash', 'parentRevisionId', 'projectId', 'revisionId', 'schemaVersion']);
  if (value.schemaVersion !== 1) throw new HubContractError('Unsupported source revision schema', 'SCHEMA_VERSION');
  const projectId = validateProjectId(value.projectId);
  const manifest = validateSourceManifest(value.manifest);
  if (manifest.projectId !== projectId) throw new HubContractError('Manifest project id does not match revision', 'PROJECT_ID_MISMATCH', 'manifest.projectId');
  const manifestHash = sha(value.manifestHash, 'manifestHash');
  if (manifestHash !== sourceManifestHash(manifest)) throw new HubContractError('Manifest hash does not match content', 'MANIFEST_HASH_MISMATCH', 'manifestHash');
  const revisionId = validateRevisionId(value.revisionId);
  const parentRevisionId = nullableUuid(value.parentRevisionId, 'parentRevisionId');
  if (parentRevisionId === revisionId) throw new HubContractError('Revision cannot parent itself', 'REVISION_PARENT_INVALID', 'parentRevisionId');
  return { schemaVersion: 1, revisionId, projectId, parentRevisionId, deviceId: validateDeviceId(value.deviceId), createdAt: date(value.createdAt, 'createdAt'), manifestHash, manifest };
}

export function validateMemoryRevision(input: unknown): MemoryRevision {
  const value = record(input);
  exactKeys(value, ['content', 'createdAt', 'deviceId', 'memoryFile', 'parentRevisionId', 'projectId', 'revisionId', 'schemaVersion', 'sha256', 'size']);
  if (value.schemaVersion !== 1) throw new HubContractError('Unsupported memory revision schema', 'SCHEMA_VERSION');
  const content = value.content === null ? null : contentText(value.content, 'content', MAX_MEMORY_BLOB_BYTES);
  const size = boundedSize(value.size, 'size', MAX_MEMORY_BLOB_BYTES);
  if (content !== null && Buffer.byteLength(content, 'utf8') !== size) throw new HubContractError('Memory content size does not match', 'SIZE_MISMATCH', 'size');
  const hash = sha(value.sha256, 'sha256');
  if (content !== null && createHash('sha256').update(content, 'utf8').digest('hex') !== hash) throw new HubContractError('Memory content hash does not match', 'HASH_MISMATCH', 'sha256');
  const memoryFile = text(value.memoryFile, 'memoryFile', 32);
  if (!MEMORY_FILE.test(memoryFile)) throw new HubContractError('Unsupported Project Memory file', 'MEMORY_FILE_INVALID', 'memoryFile');
  const revisionId = validateRevisionId(value.revisionId);
  const parentRevisionId = nullableUuid(value.parentRevisionId, 'parentRevisionId');
  if (parentRevisionId === revisionId) throw new HubContractError('Revision cannot parent itself', 'REVISION_PARENT_INVALID', 'parentRevisionId');
  return { schemaVersion: 1, revisionId, projectId: validateProjectId(value.projectId), memoryFile, parentRevisionId, deviceId: validateDeviceId(value.deviceId), createdAt: date(value.createdAt, 'createdAt'), sha256: hash, size, content };
}

export function validateContentBlobReference(input: unknown): ContentBlobReference {
  const value = record(input);
  exactKeys(value, ['contentType', 'schemaVersion', 'sha256', 'size']);
  if (value.schemaVersion !== 1) throw new HubContractError('Unsupported content blob schema', 'SCHEMA_VERSION');
  const contentType = text(value.contentType, 'contentType', 96).toLowerCase();
  if (MEDIA_CONTENT_TYPES.test(contentType)) throw new HubContractError('Media blobs belong to the separate Asset Layer', 'MEDIA_BLOB_UNSUPPORTED', 'contentType');
  return { schemaVersion: 1, sha256: sha(value.sha256, 'sha256'), size: boundedSize(value.size, 'size', MAX_CONTENT_BLOB_BYTES), contentType };
}

export function validateTokenEnvelope(input: unknown): TokenEnvelope {
  const value = record(input);
  exactKeys(value, ['accessToken', 'expiresAt', 'schemaVersion', 'tokenType']);
  if (value.schemaVersion !== 1 || value.tokenType !== 'Bearer') throw new HubContractError('Invalid token envelope', 'AUTH_TOKEN_INVALID');
  return { schemaVersion: 1, accessToken: text(value.accessToken, 'accessToken', 2048), expiresAt: date(value.expiresAt, 'expiresAt'), tokenType: 'Bearer' };
}

export function validateBuildReleaseMetadata(input: unknown): BuildReleaseMetadata {
  const value = record(input);
  exactKeys(value, ['artifactRefs', 'buildId', 'completedAt', 'createdAt', 'deviceId', 'projectId', 'revisionId', 'schemaVersion', 'status', 'version']);
  if (value.schemaVersion !== 1) throw new HubContractError('Unsupported build metadata schema', 'SCHEMA_VERSION');
  const status = text(value.status, 'status', 16);
  if (!['queued', 'running', 'passed', 'failed'].includes(status)) throw new HubContractError('Build status is invalid', 'FIELD_INVALID', 'status');
  if (!Array.isArray(value.artifactRefs) || value.artifactRefs.length > 16) throw new HubContractError('Artifact references are not bounded', 'SIZE_INVALID', 'artifactRefs');
  const artifactRefs = value.artifactRefs.map((item) => text(item, 'artifactRefs', 256));
  return { schemaVersion: 1, buildId: validateRevisionId(value.buildId), projectId: validateProjectId(value.projectId), revisionId: validateRevisionId(value.revisionId), deviceId: validateDeviceId(value.deviceId), status: status as BuildReleaseMetadata['status'], version: text(value.version, 'version', 32), createdAt: date(value.createdAt, 'createdAt'), completedAt: nullableDate(value.completedAt, 'completedAt'), artifactRefs };
}

export function validateSmallContentBlob(input: unknown): ContentBlobReference {
  const value = record(input);
  exactKeys(value, ['content', 'contentType', 'schemaVersion', 'sha256', 'size']);
  const reference = validateContentBlobReference({ schemaVersion: value.schemaVersion, sha256: value.sha256, size: value.size, contentType: value.contentType });
  const content = contentText(value.content, 'content', MAX_CONTENT_BLOB_BYTES);
  if (Buffer.byteLength(content, 'utf8') !== reference.size) throw new HubContractError('Blob content size does not match', 'SIZE_MISMATCH', 'size');
  if (createHash('sha256').update(content, 'utf8').digest('hex') !== reference.sha256) throw new HubContractError('Blob content hash does not match', 'HASH_MISMATCH', 'sha256');
  return reference;
}

export function validateConflictResponse(input: unknown): RevisionConflictResponse {
  const value = record(input);
  exactKeys(value, ['code', 'current', 'error', 'projectId', 'requestId', 'schemaVersion', 'submitted']);
  if (value.schemaVersion !== 1 || value.error !== 'CONFLICT' || value.code !== 'REVISION_CONFLICT') throw new HubContractError('Invalid conflict response', 'CONFLICT_INVALID');
  const summary = (raw: unknown): RevisionSummary => {
    const item = record(raw, 'CONFLICT_SUMMARY_INVALID');
    exactKeys(item, ['createdAt', 'deviceId', 'manifestHash', 'parentRevisionId', 'revisionId']);
    return { revisionId: validateRevisionId(item.revisionId), parentRevisionId: nullableUuid(item.parentRevisionId, 'parentRevisionId'), deviceId: validateDeviceId(item.deviceId), createdAt: date(item.createdAt, 'createdAt'), manifestHash: sha(item.manifestHash, 'manifestHash') };
  };
  return { schemaVersion: 1, error: 'CONFLICT', code: 'REVISION_CONFLICT', requestId: uuid(value.requestId, 'requestId'), projectId: validateProjectId(value.projectId), current: summary(value.current), submitted: summary(value.submitted) };
}

export function validateAuditEvent(input: unknown): AuditEvent {
  const value = record(input);
  exactKeys(value, ['action', 'deviceId', 'eventId', 'metadata', 'occurredAt', 'outcome', 'projectId', 'requestId', 'schemaVersion', 'tokenId', 'userId']);
  if (value.schemaVersion !== 1) throw new HubContractError('Unsupported audit schema', 'SCHEMA_VERSION');
  const metadata = record(value.metadata, 'AUDIT_METADATA_INVALID');
  const keys = Object.keys(metadata);
  if (keys.length > MAX_METADATA_KEYS || keys.some((key) => SENSITIVE_METADATA_KEY.test(key))) throw new HubContractError('Credential-like audit metadata is forbidden', 'AUDIT_SECRET_FIELD');
  const safeMetadata: AuditEvent['metadata'] = {};
  for (const key of keys) {
    const item = metadata[key];
    if (!(item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') || (typeof item === 'string' && item.length > MAX_METADATA_VALUE_LENGTH)) throw new HubContractError('Audit metadata value is invalid', 'AUDIT_METADATA_INVALID', key);
    safeMetadata[key] = item;
  }
  const outcome = text(value.outcome, 'outcome', 16);
  if (!['allowed', 'denied', 'error'].includes(outcome)) throw new HubContractError('Audit outcome is invalid', 'FIELD_INVALID', 'outcome');
  return { schemaVersion: 1, eventId: uuid(value.eventId, 'eventId'), requestId: uuid(value.requestId, 'requestId'), userId: nullableUuid(value.userId, 'userId'), deviceId: nullableUuid(value.deviceId, 'deviceId'), projectId: nullableUuid(value.projectId, 'projectId'), tokenId: nullableUuid(value.tokenId, 'tokenId'), action: text(value.action, 'action', 80), outcome: outcome as AuditEvent['outcome'], occurredAt: date(value.occurredAt, 'occurredAt'), metadata: safeMetadata };
}

/** Queue state is local-only in M3A; this contract describes status without executing work. */
export type OfflineSyncState = 'offline' | 'pending' | 'synced' | 'conflict';
