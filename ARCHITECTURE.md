# Architecture

## DOMAIN TRUTH

- AWH is a local-first personal multi-project workspace hub.
- `.awh/project.json` is portable project identity and display metadata.
- `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `ARCHITECTURE.md`, and `DECISIONS.md` are portable Project Memory truth.
- Canonical workspace paths, local availability, and UI state are device-local.
- `.git` is local project history and is never synchronized by AWH.

## STABLE CONTRACT

- One active AWH data directory is selected by the shared resolver; consumers do not choose their own data path.
- The local Project Registry maps portable `projectId` to a canonical local workspace path and local state.
- Project identity is generated once by explicit initialization and is never derived from an absolute path.
- Filesystem reads/writes use the existing canonical workspace, secret-path, and containment guards.
- Writes remain permission-gated, bounded, and recoverable through checkpoints where applicable.
- Local QA is the source of truth for local verification; GitHub is optional.

## CURRENT IMPLEMENTATION

- **AWH Desktop:** existing sandboxed Electron Control Center and local settings flow.
- **Active data-directory resolver:** one policy for AWH/legacy compatibility and clean installation.
- **Local Project Registry:** device-local `projects.json` under the resolved AWH data directory.
- **Project manifest:** `.awh/project.json` with portable UUID, name, type, and creation metadata.
- **Project Memory:** explicit, non-overwriting portable Markdown initialization and bounded context reads.
- **Git/local history:** read-only Git status, diff, log, and local project context.
- **Filesystem/security boundary:** canonical workspace resolution, secret-path protection, and containment checks.
- **Checkpoints:** bounded local recovery manifests for guarded workspace changes.
- **Task/runtime engine:** approved task execution with bounded runtime metadata and logs.
- **Local QA:** cross-platform Node-based QA engine with machine-readable results.
- **MCP / remote-readonly AI adapter:** local stdio MCP and restricted remote-readonly profile; remote tunnel E2E is not claimed.
- **M3C0 Web Surface:** browser-only static presentation adapter with strict CSP, bounded sanitized data, and a separate future same-origin Hub-read mode.
- **M3C1/M3D Hub Read Foundation:** PHP-FPM-compatible front controller and web gateway, SQLite metadata schema, query-only HTTP connection, Bearer-auth service boundary, same-origin Nginx perimeter adapter, and a local metadata-only indexer.
- **M3E enrollment:** the existing `HubEnrollmentService`/router owns bounded pairing, owner bootstrap closure, device binding, token rotation/revocation, rate limiting, and project membership. `hub/public/enrollment.php` is a separate mutation front controller and is never dispatched by browser Hub Read.
- **M3E-FINAL credential boundary:** macOS uses `/usr/bin/security` Keychain commands with fixed argv and secret stdin; Windows uses a fixed native Credential Manager P/Invoke script through non-interactive PowerShell with request data on stdin. Unsupported platforms fail closed; there is no plaintext-file fallback.
- **M3E-FINAL Desktop boundary:** preload exposes only enrollment state/pair/rotate/revoke high-level IPC. Renderer receives sanitized device metadata and never receives a credential, filesystem access, shell, environment, or raw process surface.

## FUTURE COMPONENTS

- AWH Hub API expansion and field enrollment validation.
- Device registry expansion.
- Source revision synchronization.
- Separate assets layer.
- Creative/Remotion workspace.
- macOS packaged app.
- Real OpenAI Secure MCP Tunnel control-plane E2E verification.
- M3C2 hosting control-plane design and a separately reviewed deployment path.

## HUB DATA BOUNDARY

- The Hub stores portable project metadata and rebuildable memory-file metadata only.
- `workspacePath`, local registry mappings, Git credentials, source contents, and device credentials remain outside Hub responses.
- Project Memory remains canonical in the five portable Markdown files; the Hub read foundation stores status, hash, size, provenance, and observation time only.
- AWH Web defaults to static preview. Hub-connected mode is same-origin, GET-only, and reuses only the reviewed web perimeter session; it does not receive a browser bearer token.

## WEB READ DEPLOYMENT BOUNDARY

- Nginx Basic Auth protects all preview assets and `/api/v1/*`.
- Nginx passes a server-controlled trust parameter to PHP-FPM over a Unix socket.
- `hub/public/web-gateway.php` reuses the same read router/model with SQLite
  query-only access; it exposes no write, sync, execution, filesystem, or
  arbitrary-file route.
- The direct Bearer-token API remains a separate service-client boundary.
- A Hub read failure is rendered as offline/degraded static preview, never as
  a false online state.
- M3D is field-verified live over HTTPS on the VPS and iPhone. The operational
  path is Nginx Basic Auth → PHP-FPM Unix socket → query-only SQLite Hub read;
  the verified state is Connected read-only with one indexed project.

## DEVICE ENROLLMENT BOUNDARY

- M3B device identity remains local and UUID-based; every device has an
  independent credential.
- M3E stores only pairing-code and token hashes in SQLite. Pairing is bounded,
  expiring, single-use, and atomically consumed.
- Owner bootstrap closes permanently after initialization. Enrollment binds
  user, device, and explicit project memberships.
- Token authentication checks device binding, expiry, revocation, and active
  enrollment before project authorization.
- `/api/v1/devices` returns sanitized metadata only. Enrollment mutations are
  not connected to the browser read gateway.
- M3E.1 migrates existing M3D databases additively in one transaction, records
  a checksum-backed migration ledger and schema version, and never replays the
  full fresh-install schema against production.
- M3E.2 keeps enrollment mutations in a separate PHP front controller and
  local client. The browser read gateway never dispatches enrollment routes;
  all mutation requests are bounded POST/JSON and require owner/device
  authentication or the one-time bootstrap approval boundary.
- M3E.2 production migration is additive: `m3e.2-enrollment-api` creates only
  `enrollment_rate_limits`, moves SQLite `user_version` from 2 to 3, records a
  checksum ledger row, and fails closed on partial/untracked state.
- The isolated Nginx enrollment location disables only inherited Basic Auth for
  the Bearer API path; Basic Auth still protects all static preview assets and
  M3D browser reads. Enrollment rejects browser Origin and is not a browser UI.
- M3E status is READY FOR PRODUCTION VALIDATION, not CLOSED. Each real device
  must persist an independent OS credential and sanitized Hub Read must verify
  two enrolled devices before the milestone closes.
