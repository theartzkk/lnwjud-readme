# M3B Authentication Foundation

M3B defines the local credential boundary and abstract server contract. It does
not implement pairing, authentication, a Hub server, or network transport.

## First-owner bootstrap

The future Hub install creates the first owner through a protected local/admin
bootstrap command or first-run setup. Once an owner exists, bootstrap is
permanently closed. There is no public always-open `/register-owner` endpoint.
Normal devices use one-time owner-controlled pairing.

## Pairing / enrollment

1. The owner creates a high-entropy, short-lived, single-use pairing code from
   an authenticated Hub/admin context.
2. The server stores only a secure hash of the code where practical.
3. Desktop submits the code plus its generated device ID, display name,
   platform, arch, and app version over HTTPS.
4. The Hub validates the code, device metadata, and enrollment policy, then
   returns a device-scoped opaque credential once.
5. Desktop stores that credential only through `CredentialStore`.
6. The code is consumed/revoked and is never persisted by Desktop.

The shared contract models active, expired, consumed, and revoked pairing
states. M3B tests this state machine but does not claim end-to-end pairing.

## Device tokens

The Hub stores token metadata and a secure hash, never the plaintext secret:

- `tokenId`
- `deviceId` and `userId`
- `tokenHash`
- created/expiry/revocation/last-used timestamps
- rotation predecessor/successor IDs

Rotation is an authenticated atomic server operation. The server issues the
replacement, invalidates the old credential according to the rotation policy,
and Desktop replaces its local credential only after confirmed success. A
revoked or expired device cannot rotate or access project data, but remains in
device/audit history. Revoking one device does not revoke other devices.

## Request authentication

Future API requests use HTTPS bearer-style device credentials:

```text
Authorization: Bearer <device-scoped-credential>
```

Authentication occurs before project authorization. Credentials are forbidden
in URLs, query strings, fragments, logs, error messages, and audit payloads.
`requestId` is safe correlation metadata and is not a credential.

## Project authorization

Authentication alone never grants project access. Each endpoint checks:

```text
device/user identity
  → active device and user
  → active project membership/ownership
  → requested projectId
```

The shared validator rejects a membership mismatch or revoked membership. A
client-supplied `projectId` is never trusted by itself.

## Audit boundary

Allowed audit fields include device ID, user ID, token ID, action, outcome,
request ID, project ID, and timestamp. Pairing codes, bearer secrets, passwords,
Authorization headers, environment data, and credential-store contents are
forbidden. The contract permits `tokenId` as a reference but not token secret
material.

## Current vs future status

Current: local device metadata, in-memory test credential store, fail-closed
production credential adapter, and validators/tests.

Future: OS Keychain/Credential Manager integration, owner pairing UI, HTTPS Hub
transport, server-side hashed credentials, rotation/revocation persistence,
and end-to-end authorization. None of those are verified by M3B.
