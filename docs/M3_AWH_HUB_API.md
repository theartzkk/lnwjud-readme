# M3A AWH Hub API Contract

The API is versioned under `/api/v1`. M3A defines JSON shapes and validation;
it does not implement an HTTP server or call a cloud service.

## Common rules

- JSON request and response bodies use `schemaVersion: 1`.
- Every request has a server-issued or verified `requestId` (UUID v4) for
  support and audit correlation.
- Bearer authentication is required except for deliberately public health/TLS
  termination infrastructure, which is outside this contract.
- Payloads, manifest entry counts, paths, text sizes, and metadata keys are
  bounded by the shared TypeScript contract.
- Error responses use `{ schemaVersion, error, code, requestId, message }`;
  `message` is safe diagnostic text and never contains a token or secret.

## Authentication and devices

| Method and path | Purpose |
| --- | --- |
| `POST /api/v1/auth/device/register` | Register a generated device ID after a short-lived owner enrollment step; returns a per-device token once |
| `POST /api/v1/auth/token/rotate` | Rotate the device credential; old credential becomes invalid after a bounded overlap window |
| `POST /api/v1/auth/logout` | Revoke the current credential/device session |
| `POST /api/v1/devices/{deviceId}/heartbeat` | Update last-seen state after project/user authorization |

The Desktop never contains a long-lived administrator secret. The server stores
only a slow hash of the device credential and supports revocation. Token values
are response-only secrets and are excluded from logs and audit metadata.

## Projects, memory, and source revisions

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/v1/projects` | bounded pagination cursor | portable project summaries and local-independent membership state |
| `GET /api/v1/projects/{projectId}` | none | one validated portable project plus membership summary |
| `PUT /api/v1/projects/{projectId}` | `HubProject` with matching ID | created/updated portable project summary; no workspace path |
| `GET /api/v1/projects/{projectId}/revisions` | bounded cursor/filter | revision summaries and parent links |
| `POST /api/v1/projects/{projectId}/revisions` | `SourceRevision` | accepted revision or `REVISION_CONFLICT` |
| `GET /api/v1/projects/{projectId}/memory` | bounded cursor | memory file identities and latest revision summaries |
| `POST /api/v1/projects/{projectId}/memory/revisions` | `MemoryRevision` | accepted memory revision or conflict |
| `GET /api/v1/projects/{projectId}/sync-status` | none | current revision, device observations, pending/conflict state |

The project ID in the URL, body, manifest, and authenticated membership must
agree. A source revision includes a parent revision and a full validated file
manifest. A memory revision names only one of the five canonical memory files.

## Small content blobs

| Method and path | Purpose |
| --- | --- |
| `HEAD /api/v1/blobs/{sha256}` | check whether a bounded small-source blob exists |
| `GET /api/v1/blobs/{sha256}` | retrieve a validated small-source blob after authorization |
| `PUT /api/v1/blobs/{sha256}` | upload a bounded UTF-8 source blob whose content hash matches the path |

The shared contract caps small blobs and rejects image, video, audio, and PDF
content types. Media is referenced through the separate Asset Layer.

## Conflict example

If the Hub current revision is `R105` and a client submits a revision whose
parent is `R105`, the first accepted write becomes `R106`. A later different
write with parent `R105` receives:

```json
{
  "schemaVersion": 1,
  "error": "CONFLICT",
  "code": "REVISION_CONFLICT",
  "requestId": "…",
  "projectId": "…",
  "current": { "revisionId": "…", "parentRevisionId": "…", "deviceId": "…", "createdAt": "…", "manifestHash": "…" },
  "submitted": { "revisionId": "…", "parentRevisionId": "…", "deviceId": "…", "createdAt": "…", "manifestHash": "…" }
}
```

No last-write-wins behavior is permitted.
