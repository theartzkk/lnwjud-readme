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
- **Autopilot v0.5:** one local orchestration layer creates a bounded Task Contract, reloads Project Context, creates a recovery checkpoint, selects a reusable profile, runs only approved package scripts, retries one safe gate once, produces a bounded Artifact record, and records a continuity checkpoint.
- **Local capability discovery:** fixed internal capability names resolve through inherited PATH first, then bounded user/system locations appropriate to the host, including common macOS package-manager bins; no recursive or browser/remote executable discovery is exposed. The FFmpeg capability gate resolves both FFmpeg and FFprobe, validates both versions, runs a disposable frame-sequence → MP4 pipeline through fixed argv, and verifies output metadata and decoded frame order.
- **Artifact Center:** metadata and bounded payloads live in the active AWH data directory; references are relative and no absolute workspace path is returned.
- **Continuity:** device-local checkpoint metadata records portable projectId, source device UUID, Git revision/dirty state, bounded HANDOFF summary, task state and artifact refs. A copied checkpoint may be discovered on another device, but AWH does not silently overwrite dirty local work or sync `.git`.
- **First-run trust:** owner/device display metadata is stored in a strict local session record. It is not a password store and never contains a bearer credential; native device credentials remain under M3E OS credential adapters.
- **Local QA:** cross-platform Node-based QA engine with machine-readable results.
- **Release packaging:** package/version identity resolves to AWH 0.5.0; Forge reuses a checksum-verified local Electron artifact when available, while packaging output remains ignored local evidence until signing and field review.
- **Deployment preflight:** `deploy/awh-enrollment/preflight-production.sh` is a read-only SSH-alias-based VPS check; it resolves the effective DB authority and reports `DB_WRITE_READY`, `DB_WRITE_PROVISION_REQUIRED`, or `DB_WRITE_BLOCKED` without permission mutation. Mutation remains in the guarded deployment path and stops at explicit production approval.
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
- Signed/notarized distribution packaging and Windows Squirrel installer field validation.
- Real OpenAI Secure MCP Tunnel control-plane E2E verification.
- M3C2 hosting control-plane design and a separately reviewed deployment path.
- **AWH Web Control Center:** Home/Projects/Tasks/Artifacts/Devices/Builds/Audit are presentation sections. Web remains read/review-only; Local Autopilot execution is Desktop-only.
- **Desktop smoke:** the harness uses a temporary AWH data directory and safe child environment. A pre-marker macOS AppKit/LaunchServices failure from the Codex GUI sandbox, including `_RegisterApplication`/`SIGABRT` or LaunchServices `-10822`, is classified as `GUI_SANDBOX_BLOCKED`, not `AWH_APP_FAILED` and never PASS. A logged-in macOS GUI LaunchServices run outside Codex is the runtime proof and has produced a valid `stage: passed` marker with the primary UI paths and Cmd+K routing checked.

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
- First-owner bootstrap creates owner membership and one initial pairing code in
  the same transaction, then the local `EnrollmentClient` consumes that code for
  the first device. `prepareBootstrapNonce()` and
  `bootstrapAndEnroll()` share one OS-stored temporary nonce; the latter never
  silently generates a replacement. The approval-gated bootstrap orchestrator
  calls the existing provisioning/deployment engines in order and provisioning
  sends only a SHA-256 digest through fixed SSH stdin/argv; no bootstrap token is
  issued.
- The guarded deployment engine takes a SQLite-aware backup before any DB/parent
  metadata change. The minimum write provision makes `awh-hub` the owner while
  retaining the existing `www-data` read/traverse group and rejects broad group
  write. Rollback restores data and exact numeric metadata before symlink/Nginx/
  PHP-FPM restoration, validation, reload, and M3D health.
- Nginx enrollment insertion is implemented by
  `deploy/awh-enrollment/insert-nginx-include.php`, which requires exactly one
  authoritative HTTPS AWH server block and is idempotent; an HTTP redirect or
  ambiguous config fails closed.
- The isolated Nginx enrollment location disables only inherited Basic Auth for
  the Bearer API path; Basic Auth still protects all static preview assets and
  M3D browser reads. Enrollment rejects browser Origin and is not a browser UI.
- M3E status is READY FOR PRODUCTION VALIDATION, not CLOSED. Each real device
  must persist an independent OS credential and sanitized Hub Read must verify
  two enrolled devices before the milestone closes.

## AUTOPILOT SAFETY CONTRACT

- Goal text is bounded content, never a command. Secret-like goal text is rejected.
- The runner requires a registered portable project and canonical workspace match.
- Command selection comes from profile capabilities and `detectProject` approved
  scripts; user input never becomes executable, argv, cwd, env, or shell text.
- The runner is local-only and respects `AWH_ALLOW_EXEC`; disabled execution fails
  closed. Browser/Web has no task mutation or execution endpoint.
- Outputs are bounded, redacted in summaries, and not persisted as task metadata.
- Source mutation, production, destructive and credential tasks require explicit
  approval in the contract. Routine dogfood does not modify source memory.
- The runner persists only strict lifecycle metadata and can surface interrupted
  history for human review; it does not treat stale process metadata as live.
