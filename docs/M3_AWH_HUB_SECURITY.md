# M3A AWH Hub Security Contract

## Authentication and authorization

- HTTPS/TLS is mandatory; plaintext Hub URLs are rejected by deployment policy.
- A personal owner account is a normal user record, not a source-code bypass.
- Device enrollment uses a short-lived, one-time owner-approved enrollment
  flow. Desktop receives a per-device credential, never a permanent server
  administrator secret.
- The server stores a slow hash of the credential, rotates it, supports device
  revocation, and rejects revoked credentials.
- Every project, memory revision, source revision, blob, and device heartbeat is
  checked against authenticated user membership and project ID.
- Bearer/API clients use request IDs and replay-resistant rotation; a future
  browser dashboard must add a deliberate CSRF model rather than reusing a
  bearer endpoint blindly.

## Data and path boundaries

Portable Hub project payloads contain only `projectId`, `name`, `type`,
`createdAt`, and schema metadata. They never contain `workspacePath`, absolute
paths, folder names as identity, or GitHub repository URLs as identity.

Source manifests accept only normalized relative `/` paths. They reject
traversal, absolute paths, symlink targets as executable behavior, duplicate
entries, secret-like names, and these excluded trees:

`.git/`, `node_modules/`, `vendor/`, `dist/`, `build/`, `out/`, `.awh-local/`,
`.env`, `.env.*`, credential files, and secret files.

The shared contract reuses the existing AWH secret/path policy as a conceptual
base and applies stricter Hub-specific bounds for manifests and small content.
Images, video, audio, PDFs, and large creative files are never Hub blobs.

## API surface that is intentionally absent

The Hub has no public `exec`, `shell`, `spawn`, arbitrary filesystem path,
raw-SQL, MCP-tool-proxy, or remote execution endpoint. It cannot become a
remote development workstation. Build/release metadata is descriptive only;
builds remain local in M3A.

## Audit and privacy

Audit records contain action, outcome, request/device/user/project IDs, and
bounded safe metadata. Credential-like keys such as token, secret, password,
authorization, credential, and API key are rejected. Request bodies and raw
source content are not copied into audit logs. Error messages are bounded and
must not echo bearer tokens or server secrets.

## Availability and recovery

Hub failure is an unavailable optional coordination service, not a Desktop
failure. Desktop keeps local editing, Project Memory, Git, builds, QA, and
checkpoints available offline. Server writes use parent-checked optimistic
concurrency and restart-safe transactions. Backups and SQLite file protection
are deployment responsibilities; M3A does not claim a production backup or
end-to-end cloud verification.
