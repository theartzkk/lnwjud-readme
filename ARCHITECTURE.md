# Architecture

## DOMAIN TRUTH

- AWH is a durable personal multi-project workspace hub: ReadyIDC owns canonical Hub task/project/memory/revision state, while trusted Mac/Windows workers provide device-bound execution when needed.
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
- **M4 control plane (local/prepared):** one additive PHP/SQLite Hub model owns canonical task state/events, idempotency, worker presence and leases, bounded artifact metadata, and scoped approval metadata. Browser control uses a same-origin HttpOnly session cookie and CSRF token obtained after one owner-issued pairing code; it reuses existing `hub_users`, project memberships, pairing hashes, and device-token auth. `ControlPlaneWorkerClient` is a Node-side outbound client for enrolled Desktop devices; it never exposes the token to renderer/browser code and never accepts a shell command.
- **Owner authentication v1:** additive `m5-owner-auth` extends the canonical `control_sessions` with username/password, remembered-session and step-up state. It adds only password/recovery hashes, login throttles and sanitized audit metadata. Browser login uses Secure, HttpOnly, SameSite cookies and CSRF; no password or permanent bearer credential enters browser storage. Passkey is an optional deferred extension.
- **Local capability discovery:** fixed internal capability names resolve through inherited PATH first, then bounded user/system locations appropriate to the host, including common macOS package-manager bins; no recursive or browser/remote executable discovery is exposed. The FFmpeg capability gate resolves both FFmpeg and FFprobe, validates both versions, runs a disposable frame-sequence → MP4 pipeline through fixed argv, and verifies output metadata and decoded frame order.
- **Artifact Center:** metadata and bounded payloads live in the active AWH data directory; references are relative and no absolute workspace path is returned.
- **Continuity:** device-local checkpoint metadata records portable projectId, source device UUID, Git revision/dirty state, bounded HANDOFF summary, task state and artifact refs. M7 adds a canonical Hub projection for durable WIP metadata plus one workspace-writer lease per project. Git is the content authority: a bounded temporary private `refs/awh/wip/<project>/<checkpoint>` commit represents allowed changed text files, while the Hub stores no source paths/blobs. A target claims the lease before restore, verifies the base/tree/file hashes, restores only into a clean matching registered workspace, and returns it to uncommitted WIP. Secret-like files, `.git`, dependency/build caches, binaries and oversized files are excluded; unsynced/offline work remains truthfully non-transferable.
- **First-run trust:** owner/device display metadata is stored in a strict local session record. It is not a password store and never contains a bearer credential; native device credentials remain under M3E OS credential adapters.
- **Local QA:** cross-platform Node-based QA engine with machine-readable results.
- **Release packaging:** package/version identity resolves to AWH `1.0.0-rc.1`; Forge reuses a checksum-verified local Electron artifact when available. Mac package structural/runtime evidence is local; native Windows installer evidence is now produced and verified by the Windows CI release run, while signing remains a separate distribution gate and physical field validation remains pending.
- **Deployment preflight:** the one-shot enrollment path first locks the clean approved HEAD, validates the canonical local deployment assets and compiled `dist` runtime, runs `deploy/awh-enrollment/deploy-enrollment.sh --dry-run`, then runs the external/internal Hub checks and `preflight-production.sh`; only those read-only gates can precede nonce provisioning. The preflight resolves the effective DB authority and reports `DB_WRITE_READY`, `DB_WRITE_PROVISION_REQUIRED`, or `DB_WRITE_BLOCKED` without permission mutation. Mutation remains in the guarded deployment path and stops at explicit production approval.
- **Hub health contract:** external HTTPS Hub Read checks expect the reviewed Basic Auth perimeter to return `401` for health/status/projects; trusted health invokes the existing deployed PHP read front controller through fixed SSH/PHP argv and accepts only sanitized `schemaVersion=1`, `status=ok`, `awh-hub-read-foundation` JSON.
- **MCP / remote-readonly AI adapter:** local stdio MCP and restricted remote-readonly profile; remote tunnel E2E is not claimed.
- **M3C0/M4 Web Surface:** browser-only presentation adapter with strict CSP and bounded sanitized data. Static preview remains the default; `web:build:control` produces an explicit same-origin CONTROL mode for the shared Hub task/project model. No permanent bearer credential enters browser storage, and no browser route exposes shell, filesystem, source editing, MCP, or arbitrary execution.
- **M3C1/M3D Hub Read Foundation:** PHP-FPM-compatible front controller and web gateway, SQLite metadata schema, query-only HTTP connection, Bearer-auth service boundary, same-origin Nginx perimeter adapter, and a local metadata-only indexer.
- **M3E enrollment:** the existing `HubEnrollmentService`/router owns bounded pairing, owner bootstrap closure, device binding, token rotation/revocation, rate limiting, and project membership. `hub/public/enrollment.php` is a separate mutation front controller and is never dispatched by browser Hub Read.
- **M3E-FINAL credential boundary:** macOS uses `/usr/bin/security` Keychain commands with fixed argv and secret stdin; Windows uses a fixed native Credential Manager P/Invoke script through non-interactive PowerShell with request data on stdin. Unsupported platforms fail closed; there is no plaintext-file fallback.
- **M3E-FINAL Desktop boundary:** preload exposes only enrollment state/pair/rotate/revoke high-level IPC. Renderer receives sanitized device metadata and never receives a credential, filesystem access, shell, environment, or raw process surface.
- **Real-project Desktop workflow:** the device-local registry can map portable manifests such as the real BAY EXCUSE X (`php`) and Teacher Evaluation Video (`remotion`) manifests to local workspaces. These are optional user projects, not AWH core dependencies; selection updates the stored workspace immediately, and the Desktop reloads the same runner/context without a restart before routing the user to the bounded Goal entry point.
- **Project-specific safe gates:** Teacher's existing `check` script is recognized only as a semantic `typecheck` alias and invoked through the existing fixed package-manager argv path. BAY uses the bounded PHP lint gate. User Goal text never becomes a command.
- **Current operational state:** ReadyIDC is active at DB schema version **12**. Production SHA `9b5970f3a29213d79550b068805bd0b23c84674a` / pointer `m12-9b5970f3a292` is the deployed runtime authority. M12 adds Central Project Vault, immutable revisions, one-to-one durable task executions, isolated task workspaces, artifact object storage, bounded VPS-native execution and worker/specialist transfer foundations. Owner/auth/project identity is preserved; Google Cloud legacy is not in the runtime path.
- **Current provider boundary:** OpenAI credentials are server-side/write-only. Conversation generation uses `/v1/responses`; historical assistant turns must use `output_text`, user turns `input_text`. Provider errors are classified into sanitized auth/permission/model/request/rate-limit/quota/temporary categories without storing raw bodies, headers or request payloads. A provider failure is never an assistant result. Temporary failures may retry the same durable task only within a fixed bound; budget/quota/manual conditions pause truthfully. The durable executor requires outbound HTTPS to the fixed provider adapter; systemd therefore keeps `NoNewPrivileges`, `PrivateTmp`, `PrivateDevices`, `ProtectSystem=strict` and bounded writable roots while allowing only `AF_UNIX`, `AF_INET` and `AF_INET6`. This is provider transport capability, not a browser shell or arbitrary remote-command surface.
- **Source-of-truth precedence:** actual current source, then actual production read-only runtime evidence and DB/release pointers, then durable docs. Repository documentation may describe historical migrations but cannot override current production state.

## FUTURE COMPONENTS

- AWH Hub API expansion and field enrollment validation.
- Device registry expansion.
- Source revision synchronization.
- Separate assets layer.
- Creative/Remotion workspace.
- Signed/notarized distribution packaging and Windows Squirrel installer field validation.
- Real OpenAI Secure MCP Tunnel control-plane E2E verification.
- M3C2 hosting control-plane design and a separately reviewed deployment path.
- **AWH Web Control Center:** the deployed authenticated mobile/control surface
  is one project/work-first flow over canonical Hub projects/tasks. It queues
  Goals and reports WAITING_FOR_WORKER until an enrolled worker claims them.
  Owner username/password access is live; static Preview is historical only.
- **Desktop smoke:** the harness uses a temporary AWH data directory and safe child environment. A pre-marker macOS AppKit/LaunchServices failure from the Codex GUI sandbox, including `_RegisterApplication`/`SIGABRT` or LaunchServices `-10822`, is classified as `GUI_SANDBOX_BLOCKED`, not `AWH_APP_FAILED` and never PASS. A logged-in macOS GUI LaunchServices run outside Codex is the runtime proof and has produced a valid `stage: passed` marker with the primary UI paths and Cmd+K routing checked.

## HUB DATA BOUNDARY

- The Hub stores portable project metadata and rebuildable memory-file metadata only.
- `workspacePath`, local registry mappings, Git credentials, source contents, and device credentials remain outside Hub responses.
- Project Memory remains canonical in the five portable Markdown files; the Hub read foundation stores status, hash, size, provenance, and observation time only.
- Historical M3 static-preview and HUB_READ adapters remain bounded compatibility components, but are not a normal AWH product surface. M4 CONTROL is the one account-scoped browser/PWA product path; it uses same-origin server sessions and never receives a browser bearer token.

## M4 CONTROL-PLANE BOUNDARY

### M6 assistant work-stream and M7 workspace continuity extensions (deployed historical foundation)

- M6 is a single additive v5→v6 capability: `control_conversations` records one authorized project conversation and `control_conversation_messages` records immutable ordered user/assistant/progress/approval/result/failure turns. Existing `control_tasks`, task events, artifacts, approvals, checkpoints, memberships and Project Memory remain authoritative.
- A single user idempotency key creates one logical Work message and at most one canonical task. Low-risk questions are answered from the existing project/task state without scheduling a worker. Follow-ups use the selected project plus prior task lineage; an ambiguous project remains fail-closed at the existing project-membership boundary.
- Task updates, event-to-conversation projection, approval creation and worker release occur inside one SQLite immediate transaction. Artifact insertion is idempotent and serialized. A worker renews a bounded lease while working; only expired leases are requeued, retaining the same task/conversation identity. Safe cancellation is limited to unclaimed/waiting work so no generic remote process termination is claimed.
- Browser and Desktop read/write the same routes and data shape. Browser mutations retain existing same-origin + CSRF + HttpOnly session rules; Desktop calls the same bounded service only from Electron main through the already-enrolled device credential. Neither surface receives a shell endpoint, workspace path, raw token or worker payload as product UI.
- M7 is a single additive v6→v7 capability. `control_workspace_checkpoints`, `control_workspace_leases` and events preserve WIP lineage, source/base/tree revision, bounded safe-file hashes and artifact references. Browser clients see only sanitized sync/handoff state; trusted workers receive the private Git ref and source device identity through the existing device credential boundary. Lease acquisition uses SQLite immediate transactions; another active writer blocks handoff, an expired owner is reported offline, and ambiguity/conflict fails closed rather than overwriting a workspace.

### Browser runtime origin and release contract

- Owner Auth and Control share `HubBrowserOriginPolicy`; they do not maintain
  copied origin logic. State-changing browser requests require the exact
  FastCGI-configured `Origin`. Safe GETs with a supplied origin must match it;
  normal same-origin browser GETs may omit `Origin` only when Fetch Metadata
  says `same-origin`. Cross-site metadata fails closed.
- A CONTROL web release is an account-scoped generic PWA shell. It contains no
  static project identity, Preview wording, credential, or authenticated data.
  The deployment engine builds it from the exact release SHA and substitutes a
  release identity into the app-shell cache before staging the web pointer.
- A v5 compatibility refresh revalidates M4/M5 ledgers/capabilities and the
  existing owner binding, then atomically refreshes runtime/web/Nginx pointers.
  It does not replay migrations, seed projects, create an owner, or replace an
  owner password; rollback restores pointers/Nginx and leaves DB v5 intact.

- The Hub remains a lightweight coordinator: SQLite stores task state/events, worker leases/presence, scoped approvals, sanitized artifact metadata and the password/recovery hashes required for owner auth; it never stores plaintext credentials, source content, workspace paths, large media, or a second Project Memory.
- Browser session exchange accepts username/password and creates only a bounded server-side session hash plus CSRF hash. The pairing exchange remains compatibility-only. Cookies are Secure, HttpOnly where appropriate, SameSite=Strict, no-store, origin-bound, rate-limited, revocable, and never copied to localStorage/sessionStorage.
- Goal submission is exact-schema, project-membership checked, bounded, and idempotent. A queued task cannot become RUNNING until an enrolled worker claims it under BEGIN IMMEDIATE; stale worker presence is shown as offline and leases are bounded.
- Worker requests are outbound HTTPS POSTs through `ControlPlaneWorkerClient`, using the existing device credential only in a fixed Authorization header inside the Node main/runtime boundary. The client accepts only bounded task metadata; it does not accept or construct arbitrary commands.
- `003_m4_control_plane.sql` through the M12 central-project-authority migration are deployed lineage on ReadyIDC schema v12. The older v5→v7 activation procedure is historical only; every future production mutation requires an exact reviewed SHA, backup/rollback evidence, migration compatibility where applicable, service health and regression checks against the current v12 authority.

## WEB READ DEPLOYMENT BOUNDARY

- Current production Nginx Basic Auth protects all preview assets and `/api/v1/*`; the reviewed owner-auth deployment include prepares the application shell/login cutover while explicit technical/read locations retain their own Basic Auth directives. The current perimeter is not changed by this source pass.
- Nginx passes a server-controlled trust parameter to PHP-FPM over a Unix socket.
- `hub/public/web-gateway.php` reuses the same read router/model with SQLite
  query-only access; it exposes no write, sync, execution, filesystem, or
  arbitrary-file route.
- The direct Bearer-token API remains a separate service-client boundary.
- A Control failure is rendered as an unavailable sign-in/control state, never
  as a false project, task, worker, or preview state.
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
  validates the canonical `deploy/awh-enrollment` assets and clean release lock,
  runs the local deployment dry-run, verifies the protected external perimeter
  and trusted internal Hub health, and runs the read-only VPS preflight before
  calling the existing provisioning/deployment engines. Provisioning sends only
  a SHA-256 digest through fixed SSH stdin/argv; no bootstrap token is issued.
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
- M3E is operational for the enrolled Mac and remains open only for the
  independent Windows field device; closure still requires native Windows
  Credential Manager proof and sanitized `devices = 2`.

## AUTOPILOT SAFETY CONTRACT

- Goal text is bounded content, never a command. Secret-like goal text is rejected.
- The runner requires a registered portable project and canonical workspace match.
- Command selection comes from profile capabilities and `detectProject` approved
  scripts; user input never becomes executable, argv, cwd, env, or shell text.
- Both asynchronous `start()` and synchronous dogfood `runNow()` enforce the
  `allowExec` permission before any project gate executes.
- The runner is local-only and respects `AWH_ALLOW_EXEC`; disabled execution fails
  closed. Browser/Web has no task mutation or execution endpoint.
- Outputs are bounded, redacted in summaries, and not persisted as task metadata.
- Source mutation, production, destructive and credential tasks require explicit
  approval in the contract. Routine dogfood does not modify source memory.
- The runner persists only strict lifecycle metadata and can surface interrupted
  history for human review; it does not treat stale process metadata as live.
