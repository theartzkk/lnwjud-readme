import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  HUB_API_ROUTES,
  HubContractError,
  MAX_CONTENT_BLOB_BYTES,
  MAX_SOURCE_FILE_BYTES,
  sourceManifestHash,
  assertNoCredentialInRequestTarget,
  assertProjectAuthorization,
  deviceTokenState,
  pairingCodeState,
  validateAuthorizationHeader,
  validateBuildReleaseMetadata,
  validateConflictResponse,
  validateDeviceRegistration,
  validateAuditEvent,
  validateHubProject,
  validateHubUser,
  validateMemoryRevision,
  validateDeviceTokenRecord,
  validateOwnerBootstrapState,
  validatePairingCodeRecord,
  validatePairingEnrollmentRequest,
  validateProjectMembership,
  validateRelativeSourcePath,
  validateSmallContentBlob,
  validateSourceManifest,
  validateSourceRevision,
} from '../src/hub-contract.js';

const projectId = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
const deviceId = '223b45c0-23e1-408d-ae0f-ac5eca7f6900';
const revisionId = '323b45c0-23e1-408d-ae0f-ac5eca7f6900';
const parentRevisionId = '423b45c0-23e1-408d-ae0f-ac5eca7f6900';
const now = '2026-08-19T00:00:00.000Z';
const hash = 'a'.repeat(64);

function manifest() {
  return { schemaVersion: 1 as const, projectId, files: [{ relativePath: 'src/index.ts', sha256: hash, size: 12, kind: 'file' as const, mode: 0o644 }] };
}

test('Hub project payload preserves portable identity and rejects local identity fields', () => {
  assert.deepEqual(validateHubProject({ schemaVersion: 1, projectId, name: 'Art’s Workspace Hub', type: 'node', createdAt: now }), {
    schemaVersion: 1, projectId, name: 'Art’s Workspace Hub', type: 'node', createdAt: now,
  });
  assert.throws(() => validateHubProject({ schemaVersion: 1, projectId, name: 'Hub', type: 'node', createdAt: now, workspacePath: '/Users/mac/project' }), (error: unknown) => error instanceof HubContractError && error.code === 'SCHEMA_FIELDS');
  assert.throws(() => validateHubProject({ schemaVersion: 1, projectId, name: 'https://example.com', type: 'node', createdAt: now }), /portable/i);
  assert.throws(() => validateHubProject({ schemaVersion: 1, projectId: 'not-an-id', name: 'Hub', type: 'node', createdAt: now }), /UUID/i);
});

test('device identity is UUID-based and does not use hardware identifiers', () => {
  const device = validateDeviceRegistration({ schemaVersion: 1, userId: projectId, deviceId, displayName: 'Mac Home', platform: 'darwin', arch: 'arm64', appVersion: '0.5.0' });
  assert.equal(device.deviceId, deviceId);
  assert.throws(() => validateDeviceRegistration({ schemaVersion: 1, userId: projectId, deviceId: 'AA:BB:CC:DD:EE:FF', displayName: 'Mac', platform: 'darwin', arch: 'arm64', appVersion: '0.5.0' }), /UUID/i);
});

test('user, membership, and build metadata use bounded lifecycle contracts', () => {
  const user = validateHubUser({ schemaVersion: 1, userId: projectId, displayName: 'Art', createdAt: now, revokedAt: null });
  assert.equal(user.revokedAt, null);
  const membership = validateProjectMembership({ schemaVersion: 1, projectId, userId: projectId, role: 'owner', createdAt: now, revokedAt: null });
  assert.equal(membership.role, 'owner');
  const build = validateBuildReleaseMetadata({ schemaVersion: 1, buildId: revisionId, projectId, revisionId: parentRevisionId, deviceId, status: 'passed', version: '0.5.0', createdAt: now, completedAt: now, artifactRefs: ['sha256:' + hash] });
  assert.equal(build.status, 'passed');
  assert.throws(() => validateProjectMembership({ ...membership, role: 'administrator' }), /role/i);
});

test('source manifests require relative paths and enforce exclusions, hashes, and bounds', () => {
  assert.deepEqual(validateSourceManifest(manifest()).files[0]?.relativePath, 'src/index.ts');
  for (const unsafe of ['/absolute/file.ts', 'C:\\project\\file.ts', '../outside.ts', '.git/config', 'node_modules/pkg/index.js', '.env.production', 'credentials.json', 'dist/app.js']) {
    assert.throws(() => validateRelativeSourcePath(unsafe), (error: unknown) => error instanceof HubContractError && (error.code === 'PATH_INVALID' || error.code === 'PATH_EXCLUDED'));
  }
  assert.throws(() => validateSourceManifest({ ...manifest(), files: [{ relativePath: 'src/index.ts', sha256: hash, size: MAX_SOURCE_FILE_BYTES + 1, kind: 'file' }] }), /bounded size/i);
  assert.throws(() => validateSourceManifest({ ...manifest(), files: [...manifest().files, ...manifest().files] }), /Duplicate|fields/i);
});

test('source revisions use a parent DAG and verify the manifest hash', () => {
  const sourceManifest = manifest();
  const revision = validateSourceRevision({ schemaVersion: 1, revisionId, projectId, parentRevisionId: null, deviceId, createdAt: now, manifestHash: sourceManifestHash(sourceManifest), manifest: sourceManifest });
  assert.equal(revision.parentRevisionId, null);
  assert.throws(() => validateSourceRevision({ ...revision, manifestHash: hash }), /Manifest hash/i);
  assert.throws(() => validateSourceRevision({ ...revision, parentRevisionId: revisionId }), /parent itself/i);
});

test('small blobs validate content-addressed hash, bounded size, and asset separation', () => {
  const content = 'small source text';
  const contentHash = createHash('sha256').update(content).digest('hex');
  const blob = validateSmallContentBlob({ schemaVersion: 1, sha256: contentHash, size: Buffer.byteLength(content), contentType: 'text/plain', content });
  assert.equal(blob.sha256, contentHash);
  assert.throws(() => validateSmallContentBlob({ schemaVersion: 1, sha256: hash, size: 1, contentType: 'text/plain', content: 'x' }), /hash/i);
  assert.throws(() => validateSmallContentBlob({ schemaVersion: 1, sha256: hash, size: MAX_CONTENT_BLOB_BYTES + 1, contentType: 'text/plain', content: 'x' }), /bounded size/i);
  assert.throws(() => validateSmallContentBlob({ schemaVersion: 1, sha256: hash, size: 1, contentType: 'video/mp4', content: 'x' }), /Asset Layer/i);
});

test('memory revisions and conflict responses are explicit, bounded schemas', () => {
  const content = '# Handoff\nNext action';
  const contentHash = createHash('sha256').update(content).digest('hex');
  const memory = validateMemoryRevision({ schemaVersion: 1, revisionId, projectId, memoryFile: 'HANDOFF.md', parentRevisionId: parentRevisionId, deviceId, createdAt: now, sha256: contentHash, size: Buffer.byteLength(content), content });
  assert.equal(memory.memoryFile, 'HANDOFF.md');
  const current = validateMemoryRevision({ schemaVersion: 1, revisionId: parentRevisionId, projectId, memoryFile: 'CURRENT_STATE.md', parentRevisionId: null, deviceId, createdAt: now, sha256: contentHash, size: Buffer.byteLength(content), content });
  assert.equal(current.memoryFile, 'CURRENT_STATE.md');
  const conflict = validateConflictResponse({ schemaVersion: 1, error: 'CONFLICT', code: 'REVISION_CONFLICT', requestId: revisionId, projectId, current: { revisionId, parentRevisionId: null, deviceId, createdAt: now, manifestHash: hash }, submitted: { revisionId: parentRevisionId, parentRevisionId: revisionId, deviceId, createdAt: now, manifestHash: hash } });
  assert.equal(conflict.code, 'REVISION_CONFLICT');
});

test('pairing is bounded, single-use/expiring, and owner bootstrap closes permanently', () => {
  const pairing = validatePairingEnrollmentRequest({ schemaVersion: 1, pairingCode: 'A'.repeat(40), deviceId, displayName: 'Mac Home', platform: 'darwin', arch: 'arm64', appVersion: '0.5.0' });
  assert.equal(pairing.deviceId, deviceId);
  assert.throws(() => validatePairingEnrollmentRequest({ ...pairing, pairingCode: 'short' }), /pairing code/i);
  const active = validatePairingCodeRecord({ schemaVersion: 1, pairingCodeId: revisionId, codeHash: hash, issuedAt: now, expiresAt: '2026-08-20T00:00:00.000Z', consumedAt: null, revokedAt: null });
  assert.equal(pairingCodeState(active, new Date(now)), 'active');
  assert.equal(pairingCodeState({ ...active, consumedAt: now }, new Date(now)), 'consumed');
  assert.equal(pairingCodeState({ ...active, expiresAt: '2026-08-18T00:00:00.000Z' }, new Date(now)), 'expired');
  assert.deepEqual(validateOwnerBootstrapState({ schemaVersion: 1, ownerUserId: null, initializedAt: null, bootstrapClosed: false }).ownerUserId, null);
  assert.equal(validateOwnerBootstrapState({ schemaVersion: 1, ownerUserId: projectId, initializedAt: now, bootstrapClosed: true }).bootstrapClosed, true);
  assert.throws(() => validateOwnerBootstrapState({ schemaVersion: 1, ownerUserId: null, initializedAt: null, bootstrapClosed: true }), /bootstrap/i);
});

test('device token rotation/revocation and project authorization are server-side contract checks', () => {
  const token = validateDeviceTokenRecord({ schemaVersion: 1, tokenId: revisionId, userId: projectId, deviceId, tokenHash: hash, createdAt: now, expiresAt: '2026-08-20T00:00:00.000Z', revokedAt: null, lastUsedAt: null, rotatedFromTokenId: null, replacedByTokenId: null });
  assert.equal(deviceTokenState(token, new Date(now)), 'active');
  assert.equal(deviceTokenState({ ...token, revokedAt: now }, new Date(now)), 'revoked');
  const membership = validateProjectMembership({ schemaVersion: 1, projectId, userId: projectId, role: 'owner', createdAt: now, revokedAt: null });
  const device = { deviceId, userId: projectId, revokedAt: null } as const;
  assert.doesNotThrow(() => assertProjectAuthorization({ schemaVersion: 1, userId: projectId, deviceId, projectId }, membership, device));
  assert.throws(() => assertProjectAuthorization({ schemaVersion: 1, userId: deviceId, deviceId, projectId }, membership, device), /membership/i);
  assert.throws(() => assertProjectAuthorization({ schemaVersion: 1, userId: projectId, deviceId, projectId }, membership, { ...device, userId: deviceId }), /membership/i);
});

test('request auth forbids URL credentials and returns no bearer secret', () => {
  assert.equal(validateAuthorizationHeader('Bearer opaque-secret-value'), 'Bearer');
  assert.equal(assertNoCredentialInRequestTarget('/api/v1/projects/abc'), '/api/v1/projects/abc');
  assert.throws(() => assertNoCredentialInRequestTarget('/api/v1/projects/abc?access_token=secret'), /URLs|query/i);
  assert.throws(() => validateAuthorizationHeader('Basic abc'), /bearer/i);
});

test('audit validation rejects credential fields and contract routes expose no execution API', async () => {
  const audit = validateAuditEvent({ schemaVersion: 1, eventId: revisionId, requestId: parentRevisionId, userId: projectId, deviceId, projectId, tokenId: revisionId, action: 'revision.create', outcome: 'allowed', occurredAt: now, metadata: { revisionCount: 1 } });
  assert.equal(audit.tokenId, revisionId);
  assert.doesNotMatch(JSON.stringify(audit), /accessToken|tokenSecret|secret|password|authorization/i);
  assert.throws(() => validateAuditEvent({ ...audit, metadata: { accessToken: 'do-not-log' } }), /credential-like/i);
  assert.equal(Object.values(HUB_API_ROUTES).some((route) => /(?:exec|shell|spawn)/i.test(route)), false);
  const contractSource = await readFile(new URL('../src/hub-contract.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(contractSource, /ipcMain|child_process|execFile|spawn\(/);
});
