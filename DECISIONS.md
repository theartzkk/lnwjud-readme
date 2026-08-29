# Authoritative supersession — 2026-08-30 Product completion candidate

- Web and Desktop are one AWH product surface. Common visual tokens and semantic aliases belong in `web/awh-design-system.css`; platform-specific markup may adapt layout but must not introduce a competing palette or navigation vocabulary.
- The canonical Tasks/Executions authority is reused on Desktop. Home command submission only transfers the command into the existing Work composer; it does not create a second task queue.
- Owner Activity and Morning Brief are projections over existing task/event/artifact/health authorities. A brief without durable persistence or scheduler evidence must be labeled `SNAPSHOT_ONLY`; unknown recovery counts remain unknown, and absent progress is rendered as phase/state rather than `0%`.
- Candidate `533185e` is source/QA-ready only. Production remains at `m16-06a7277063f8`; exact-SHA approval is required before any activation. Visual parity and iPhone behavior cannot be certified by source tests or Desktop DOM smoke alone.

# Authoritative supersession — 2026-08-30 Source/Production reconciliation

- The canonical branch must include the source line that Production actually runs. Because `codex/finish-first-p0` was a fast-forward descendant of `awh/api-independence` and ReadyIDC pointed to `m16-06a7277063f8`, the safe reconciliation was a fast-forward, not a duplicate implementation or a cherry-picked parallel authority.
- Production disk health remains evidence-based: the shared policy reports `HEALTHY` at 20% or more free space, `WARNING` below 20%, and `CRITICAL` below 10%. M11 tests must validate that policy contract rather than assume the developer machine is healthy.
- The reconciliation commit `74556a1` is test-only and was pushed to `origin/awh/api-independence`; it does not authorize a Production deployment or alter the active M16 runtime.

# Authoritative supersession — 2026-08-29 Responses tool-loop contract

- The shared native-agent Responses payload must contain only fields supported by the provider contract. `max_tool_calls` is not supported by the current Responses API and is therefore removed from both initial and follow-up tool-loop requests.
- Tool-call safety remains enforced locally: the service bounds the loop to three rounds and rejects more than six accumulated function calls. Removing the unsupported provider hint does not widen executor, tool, capability, credential or deployment authority.
- The regression uses a fixture adapter to execute one bounded `project_read_text` call followed by a final response and asserts that both captured payloads omit `max_tool_calls`. This protects sibling tool-mediated governance routes without weakening fail-closed capability registration.
- Production remains pinned to the previously approved and deployed `903d128…` until a new exact candidate is pushed, CI-reviewed, readiness-verified and separately approved for typed M16 activation.

# Authoritative supersession — 2026-08-29 Auto-Chain governance-routing contract

- Provider capability registration is an interface contract, not a replacement for canonical task capability. For bounded tool-mediated project work, governance may match `project.read`, `project.search` or `project.mutate.assisted` to a tool-capable `agent.conversation` provider row; it must preserve the canonical capability in route evidence and continue enforcing executor/tool allowlists.
- No blanket alias is allowed for deterministic mutation, artifact, specialist or other unregistered capabilities. Those routes remain fail-closed until explicitly registered by the existing authority.
- The permanent fix belongs in shared governance candidate eligibility so both single-provider and cross-provider routing obey the same contract. Planner failure must not be “fixed” by a second queue or by weakening continuation safety.

# Authoritative supersession — 2026-08-29 finish-first continuation / backup authority

- `HubBackupService::latestMetadata()` is the single backup metadata authority for Owner Control Plane and Database Studio. Database Studio must not independently scan backup directories or select a file by timestamp, because that can display an unverified/corrupt snapshot and drift from the Control Plane evidence contract.
- Candidate `c427d9dd575dd53556ee6a7e184916e7a971cbc3` is pushed in PR #57 with CI run `33248726861` terminal `5/5 PASS`; the PR is not merged and Production is not deployed. Field proof remains blocked at `DEVICE_NOT_ENROLLED`, and browser local-preview UAT is blocked by the browser URL policy without workaround.

# Authoritative supersession — 2026-08-29 Finish-First / Visible Production

- Until Production v1 closes, architecture expansion is frozen unless it directly reduces Production Complete FAILs. Existing authorities are extended before any CREATE.
- Owner Control Tower is the existing Infrastructure surface, not a new dashboard authority. It reads sanitized projections from canonical telemetry, tasks/executions/events, M16 AI governance, backup/database state and release pointers.
- Production Complete is deliberately truthful: source capability alone does not turn Mobile, Deploy or Smoke Test into PASS; live visible evidence is required.
- A healthy Production DB16 must not be downgraded merely because Control/Web remain M15 during a partial cutover. Complete-forward is preferred when compatibility evidence remains healthy.

# Current supersession — 2026-08-29 Continuous Auto-Chain V1

- Continuous execution is an opt-in behavior over the existing `control_tasks` / `control_task_executions` authority, not a scheduler or shadow queue. Explicit autonomy wording is required; ordinary tasks never silently become continuous.
- A completed VPS task may ask the existing provider fabric for exactly one next safe milestone using bounded Project Vault Source of Truth. Follow-up creation is delegated back to `HubControlPlaneService`, preserving canonical task/idempotency/lease rules.
- Auto-chain is hard-bounded to at most 8 steps (default 6), stops on repeated goals, pending approvals, high-impact Production/destructive/billing/permission/secret/schema goals, or planner/provider failure. The existing systemd timer remains only the wake-up/recovery mechanism.
- Planner access is read-only Project Vault context/tools; it receives no shell, deploy, credential, permission, billing or canonical promotion authority.

# Current supersession — 2026-08-29

- ReadyIDC Production truth is M15 / SQLite v15, not the older M12/v12 or M5 snapshots retained below for history. Current continuation must always verify Production read-only before using historical memory.
- Continuous Work Supervisor V1 is an orchestration behavior of the existing `HubDurableExecutionService` and native systemd tick, **not** a new scheduler, daemon, queue or task authority.
- A timer interval is not a retry policy. Retry eligibility is deterministic from the existing execution attempt/error/update state so transient provider outages and lease expiry cannot hot-loop.
- Lease recovery is cross-authority consistency work: if an execution lease expires, `control_task_executions` and its canonical `control_tasks` row must be reconciled together. A terminal execution cannot leave the user-visible task falsely RUNNING.
- Backlog throughput is bounded per one-shot tick. The service remains `Type=oneshot`, preserves systemd non-overlap and all existing approval/revision gates, and never becomes an unbounded background shell/process runner.
- Candidate QA must never infer PASS from workspace capture alone. VPS-native edits may claim deterministic syntax PASS only for formats validated in-process; unsupported syntax is explicitly `NOT_RUN`/`REVIEW_REQUIRED`, and malformed PHP/JSON fails closed before any promotion approval is created.
- Promotion approval must re-verify the candidate evidence at decision time. New evidence-v2 approvals bind task, project, base revision, candidate revision, QA status, artifact metadata and object checksum; missing/tampered/mismatched evidence fails closed before Vault promotion. Legacy approval scopes remain compatible without silently inventing evidence.
- Candidate Secret Gate V1 is pre-Vault safety policy, not post-hoc redaction. VPS-assisted writes and candidate QA reject high-confidence credential material before candidate capture/promotion evidence. `CANDIDATE_SECRET_CONTENT` is terminal/non-retryable so unsafe provider output cannot hot-loop or become an auditable candidate revision. Placeholder configuration and environment-variable references remain allowed to avoid false positives.
- Native code discovery remains a read projection over immutable Project Vault content, not a new index. `project_search` may inspect bounded text content (maximum 512 files / 16 MiB per call), returns deterministic path/content match evidence, skips binary/oversized/restricted paths through existing Vault guards, and grants no execution or mutation authority.
- VPS Root-Cause Inspection V1 uses that same read authority end-to-end: new reconciled inspection work requests `project.search`, the executor remains backward-compatible with historical `project.read`, and the native agent is explicitly required to search source content for the relevant symbol/error/behavior, then read exact matching files before concluding. Evidence must name concrete paths/line context; inspection cannot mutate source, deploy, or claim device execution.
- Inspection evidence is an artifact projection over existing task/Vault authority, not a new evidence database. A completed `PROJECT_INSPECTION` stores one immutable `project-inspection` object bound to exact task/execution/project/Vault revision/content hash. It records bounded search path/line/snippet evidence plus read hashes/size/line counts, never whole copied source payloads; credential-looking snippets and summaries fail safe through the shared secret-content policy.

# Decisions

## Current production supersession (2026-08-22)

- ReadyIDC is the active M3D/M3E/M4/M5 authority at SQLite schema v5. The
  `8c5ea0e79c96fb0796c643164a596aa8beabfa51` compatibility refresh updated
  only exact release/web/Nginx/PHP-FPM pointers after backup and capability
  checks; it did not replay migrations or alter the canonical owner, project,
  device or enrollment records.
- The normal web product is one public owner-login → project → work → Goal
  surface. Old static Preview/dashboard output is not a fallback. A release
  identifier versions all shell assets and the service worker uses network-first
  shell retrieval, so an old PWA generation cannot combine with new HTML.
- AWH's local Secure MCP Tunnel is a restricted local workspace adapter, not a
  private ReadyIDC control-plane gateway. A future ChatGPT integration must use
  one canonical control-plane contract plus server-enforced OAuth/mTLS and
  scoped authorization; it must not reuse the owner password or browser session.
- M6 Native Assistant Workstream and M7 Workspace Continuity are prepared additive capabilities, not live-production claims. They raise the shared Hub database from v5 to v7 only after a new exact release approval. M6 durable conversation is an ordered projection over M4 tasks/events/artifacts/approvals, not another assistant memory, project registry, task engine or result store.
- Natural-language Work is classified conservatively: low-risk status/help requests answer from canonical project/task state; other requests create a bounded idempotent task and stay subject to the existing worker, checkpoint, execution and approval policy. “ตรวจอย่างเดียว ห้ามแก้” remains non-mutation; no chat convenience changes an execution permission.
- A worker lease is an ownership mechanism, not a visual state. The worker renews a bounded active lease, stale leases are requeued without creating a new task, and task/event/conversation/worker state changes commit atomically. Cancellation only applies before a worker has claimed work; AWH must never claim it killed an arbitrary running process or rolled back work it did not actually reverse.
- M7 treats Git as the content authority and the Hub as checkpoint/lease metadata authority. A WIP checkpoint is a bounded private Git ref based on a known revision, not a main-branch commit or a copied machine folder. Only regular non-secret text files inside the registered workspace may enter it; caches, binaries, `.git`, private keys and credentials are excluded. The target claims a single writer lease before reconstructing, verifies the exact base/tree/file hashes, preserves its local workspace on mismatch, and resets to the base only after safely restoring WIP. An unpublished/offline WIP state is `UNSYNCED`, never “synced”.

- Art Agent is a legacy codename only.
- There is one AWH product; no parallel ArtAgent product is created.
- AWH is local-first.
- GitHub is optional and is not critical infrastructure.
- Portable project identity lives in `.awh/project.json`.
- `projectId` is stable across devices.
- Absolute workspace paths are device-local only.
- Project Memory files are portable truth.
- `.git` is never synchronized by AWH.
- Large assets use a separate future asset layer.
- AI providers are adapters/components, not the AWH product.
- Remote execution remains restricted.
- AWH Hub must not become a single point of failure.
- M3C1 uses PHP-FPM-compatible routing with SQLite metadata because the M3A contract targets a lightweight Ubuntu deployment; the repository's Node tooling remains the local development/QA toolchain.
- Hub HTTP reads are fail-closed, Bearer-authenticated except health, query-only, bounded, and free of arbitrary paths, SQL, shell, MCP, and execution capabilities.
- Project Memory is not duplicated into a second editable database; only rebuildable status/hash/size/provenance metadata may be indexed.
- M3C0 static browser preview is the default. Future Hub-read mode must consume sanitized same-origin GET responses without browser credential injection.
- ReadyIDC M3D/M3E/M4/M5 production is active and remains the current runtime authority at schema v5. M6 assistant-workstream activation is not performed without one bounded exact-release approval; legacy Google Cloud `awh-vps` is not mutated.
- The verified ReadyIDC database has M3E.1/M3E.2/M4/M5 ledger state, clean integrity/FK checks, one existing project and one enrolled Mac. No duplicate Hub database is created; future shared-schema changes remain additive reviewed packages.
- M3D uses a same-origin PHP web gateway behind Nginx Basic Auth for the read-only browser perimeter; it does not put a Bearer token in JavaScript and does not replace M3B device/account authorization.
- The web gateway trusts only a reviewed Nginx FastCGI parameter, never a client HTTP header; PHP-FPM uses a Unix socket and SQLite remains query-only for HTTP reads.
- The normal browser product has one authenticated CONTROL surface, not a static-preview fallback. An unavailable control service fails closed with a truthful unavailable/sign-in state and does not render stale project/task data.
- M3D is closed on field evidence: the read-only Hub is live over HTTPS on the VPS and iPhone, with one indexed project and operational Nginx → PHP-FPM → SQLite routing. This does not authorize writes, sync, or production migration.
- M3E reuses M3B device UUIDs and auth contracts instead of creating a second identity system. Pairing and token secrets are hash-only server state; device credentials remain independent per device.
- Enrollment is a server/domain foundation only. The browser Hub Read perimeter remains read-only, and no enrollment, write, sync, execution, or MCP proxy route is enabled.
- M3E.1 uses a dedicated additive migration with preflight, backup, integrity verification, checksum ledger, idempotent rerun, and backup restore recovery. Its capability remains present and compatible on the current ReadyIDC schema v5 database, preserving the M3D tables.
- M3E.2 keeps enrollment mutations separate from browser Hub Read and stores rate-limit state in a dedicated additive migration. The live enrollment runtime remains a distinct protected service path.
- M3E-FINAL uses native OS credential stores: macOS Keychain through fixed-argv `security` with stdin prompting, Windows Credential Manager through fixed native P/Invoke, and fail-closed Linux behavior. Plaintext credential files are not an allowed fallback.
- M3E-FINAL keeps credential lifecycle in `EnrollmentClient` and `HubEnrollmentService`; Desktop only exposes sanitized enrollment state plus explicit pair, rotate, and revoke actions through fixed IPC.
- M3E.2 deployment is a separate additive migration from M3E.1: `enrollment_rate_limits` and its migration ledger row are applied only after backup/preflight, then an isolated enrollment release is switched atomically. The M3D browser read path remains unchanged.
- First-owner bootstrap creates the owner, requested project memberships, closed bootstrap marker, and one bounded pairing-code hash in a single transaction. The plaintext initial code is returned once to the explicit local client and is immediately consumed through the existing device enrollment path; bootstrap never returns a permanent bearer token.
- Bootstrap provisioning uses the existing OS `CredentialStore` under the bounded `awh/bootstrap-nonce` key. A reviewed helper hashes the local nonce and sends only the digest over fixed SSH argv/stdin to a root-owned `0600` server file; nonce values, hashes, and tokens remain outside logs, source, and Project Memory.
- A `root:www-data 640` Hub DB is not automatically treated as a source failure. Read-only preflight classifies it as `DB_WRITE_PROVISION_REQUIRED` when owner-only DB/parent write can be provisioned without group-write, while preserving `www-data` read/traverse access and exact metadata rollback.
- Enrollment Nginx insertion parses the effective file and requires exactly one HTTPS server block containing the AWH DB marker and web gateway marker. It refuses ambiguous/missing blocks and never inserts into the HTTP redirect block.
- Guarded rollback order is fixed: verified SQLite restore, exact DB/parent owner/group/mode restore, release symlink, Nginx, PHP-FPM, validation, then service reload and M3D health. Any restore failure reports `ROLLBACK: FAIL`.
- M3E is operational but not fully closed: Mac is enrolled with Keychain persistence; closure requires independent Windows Credential Manager persistence, safe lifecycle proof, and sanitized `devices = 2`.
- AWH v0.5 uses one local Autopilot orchestration layer rather than separate per-project runners. It owns the Task Contract and delegates filesystem safety, checkpoints, project detection, package invocation and audit to existing engines.
- Task goals are content, not commands. Only fixed allowlisted package scripts selected by a reusable project profile can execute; browser Hub remains review-only.
- Autopilot creates a checkpoint before local gates, emits a bounded QA artifact, and records continuity metadata. It never silently overwrites dirty local work and does not synchronize `.git`.
- Project Memory updates are not implicit in the v0.5 dogfood path. A later explicit approval action may update concise HANDOFF/TASKS state after review; no large logs or secrets may enter Project Memory.
- The first-run experience stores only bounded owner/device trust metadata. M3E device credentials remain separate, native-OS-backed and fail-closed; a trusted session does not bypass sensitive-action confirmation.
- AWH release candidate `1.0.0-rc.1` uses AWH-facing package/artifact names while preserving legacy package/storage/env/protocol compatibility. Local bundles and the Windows CI workflow are evidence only until platform field validation and signing are complete.
- Real project registration is device-local state: BAY EXCUSE X uses a stable portable `php` manifest and Teacher Evaluation Video uses a stable portable `remotion` manifest. The second Teacher clone is intentionally not registered. Their local `.awh/project.json` files are not copied into AWH and should be committed to the respective source repositories only after review.
- AWH does not silently initialize Project Memory for a newly registered real project. Missing canonical files remain visible and the existing explicit non-overwriting initialization action is the only path that creates them.
- The first real-project dogfood uses the existing Autopilot runner with `allowWrite=false`: BAY PHP lint and Teacher typecheck/FFmpeg probes passed, bounded artifacts were created, and continuity checkpoints recorded the real project IDs plus dirty-state protection. No source file was changed by dogfood.
- M4 keeps one canonical task/worker/control model in the Hub instead of creating a mobile database or a second task engine. Its additive schema 3→4 package is deployed and compatible at current schema v5; M6 extends that same authority rather than creating another task engine.
- Owner authentication v1 uses username/password as the primary normal-user path. It attaches to the existing owner identity and reuses `control_sessions`; it does not create a parallel user/session system. The additive `m5-owner-auth` migration targets schema v5 and is capability/ledger based, never an exact-version check.
- Owner passwords use `password_hash` with Argon2id when available and a secure supported fallback otherwise. Recovery codes are generated once and stored only as hashes; login throttling, CSRF, session revocation, step-up and sanitized audit records are server-side.
- Basic Auth remains temporary technical perimeter scaffolding only. The source deployment template prepares a public AWH shell plus application login while retaining Basic Auth for technical/read paths until one explicit production cutover approval; the Basic Auth rotation primitive is not part of owner-auth work.
- iPhone control uses the existing owner pairing-code authority only once to establish an HTTPS same-origin Secure/HttpOnly session with CSRF rotation and server-side hashes. Permanent Mac/Windows device credentials are never exposed to browser JavaScript or browser storage.
- Desktop worker communication is an outbound bounded client over the existing M3E device-token contract. A worker can heartbeat, claim one project-authorized task under an immediate SQLite transaction, and report bounded progress/result; no remote shell, arbitrary command, source editor, or inbound worker server is introduced.
- A task submitted while no eligible worker is online remains `WAITING_FOR_WORKER`; the UI must not claim running or completed execution. The local fixture proves session → real canonical project → Goal → queue → claim → bounded completion, while live iPhone/task execution remains an M4 activation and field-validation gate.
- M4 v1 RC keeps Results, Artifacts and scoped Approval decisions in the same canonical control-plane service. The browser uses HttpOnly session cookies plus CSRF/origin checks; the Desktop worker uses the existing device credential boundary. A bounded Codex adapter receives a Goal as one argv value inside the existing sandbox policy; it never exposes shell commands as the product contract.
- The M4 deployment package is executable only after an explicit `--deploy --approve` release lock. It creates a verified SQLite backup, stages the exact release, applies migration 003 idempotently, verifies an empty project-onboarding input, switches exact pointers, inserts the control route only into the authoritative HTTPS server, validates M3D/control health, and restores the verified baseline on failure. It never seeds a user project; later Add Project/onboarding passes validated portable manifest metadata to the same reusable registration service. This package is prepared locally and has not been run against ReadyIDC.
- Repeated deployment failures must be closed at the shared contract, not by guessing from the last stage label. Owner-auth activation keeps separate gates for effective Nginx loading, PHP route reachability, application login/session, web release access, and technical perimeter protection. The verifier must treat expected application errors as application evidence, never as Basic Auth evidence, and every failed attempt with rollback must update the diagnosis before another approval.
- The ReadyIDC web release contract is `awh-hub:www-data` with directory mode `0750` and file mode `0640` for Nginx read/traverse access. Deployment verifies `www-data` access before switching the web pointer; it must not solve permission failures with `0755`/`0777`.
- Owner-auth activation resolves its FastCGI authority from the active M3E enrollment include, because that include is the reviewed `awh-hub` service boundary. It never derives control/auth traffic from the generic read-gateway PHP socket or a hard-coded PHP version. Browser-origin validation prefers the fixed FastCGI request parameter and only falls back to process environment, so PHP-FPM `clear_env` cannot silently break the same-origin contract. After reload, the route gate waits a bounded period for the new Nginx worker generation and reports only sanitized route status/attempt diagnostics.
- A release pointer switch is a PHP runtime transition, not only an Nginx transition. The owner-auth deployment derives the exact AWH PHP-FPM service from the active enrollment socket, reloads it after moving `control-plane-current`, and reloads it again after restoring that pointer on rollback. This prevents a cached M4 runtime with an exact v4 capability check from evaluating a newly migrated v5 database.
- Browser-origin checks are a shared product/security contract. A browser safe GET must not be rejected merely because Safari omits `Origin` on a same-origin request; mutations still require the exact configured origin, and cross-site Fetch Metadata is rejected. This rule lives once in `HubBrowserOriginPolicy`, not as copied router conditions.
- CONTROL PWA builds must be produced from the exact release source during deployment. `web-config=CONTROL` is insufficient if `data.json` still says Preview: CONTROL output must be generic, project-free and preview-free, and its service-worker shell cache must carry the release identifier so a field device cannot remain on an incompatible stale client.
- Web UI root-cause rule: do not stack a new Control panel onto legacy dashboard markup. Replace the unused surface, preserve the canonical control-plane API/state, and maintain one project/work-first interaction flow. The canvas is defined once at `html`/`body`/app-shell in graphite; orange is reserved for accents so normal iOS viewport and full-page capture cannot diverge through background compositing.
- An already-active v5 owner-auth deployment uses a compatibility refresh rather than migration replay. It validates M4/M5 capability/ledger state and refreshes only release, PHP-FPM, web and Nginx pointers with verified rollback; it never modifies owner identity/password, projects or schema.

- M16 Multi-Provider Qualification V1 reuses the existing provider registry, model catalog, qualification evidence, canonical task/execution rows, budget policy, health circuit and route-decision tables. New providers/models cannot become PRODUCTION without qualification evidence from the latest suite version; production promotion requires at least three passing task types, >=70% passing-score average, and no failing evidence in that suite version.
- AI routing capability is authority-bound: the requested routing capability must exactly match `control_task_executions.required_capability`, and provider eligibility must come from `control_execution_provider_capabilities`. Cross-provider selection may optimize quality/cost/reliability only after those authority, data-classification, circuit and budget gates pass; it never creates a parallel task, queue, approval or execution system.

- M16 Provider Execution Fabric V1 keeps `HubNativeAgentService` as the sole native reasoning boundary while allowing a bounded runtime set of already-qualified provider adapters. The selected provider from M16 governance owns the adapter, credential store, pricing quote and usage evidence for that turn; no provider-specific task or conversation pipeline is created.
- Runtime fallback must preserve provider identity end-to-end. A single eligible non-primary provider is routed through cross-provider governance rather than the legacy primary-only fast path. The primary-only path is valid only when the sole eligible runtime provider is the configured primary provider.
