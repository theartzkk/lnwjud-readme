# Art’s Workspace Hub — AWH

## Current visible product checkpoint — 2026-08-29 P1-B Tasks and Executions

- The isolated candidate `codex/finish-first-p0` is now at `e9055e8` after a bounded P1-B Tasks/Executions slice. Home uses the existing canonical control projections to show a human-readable task list/detail view with filters, truthful execution journey, result/continuation context, approval handoff and validated artifact downloads.
- The slice also fixes the task-present Home refresh defect caused by undefined `STATUS_LABELS` and `executionPlace` references; it now reuses `executionStatus()` rather than introducing another status vocabulary.
- Evidence: focused P1 checks `4/4 PASS`; full product `315 PASS / 0 FAIL / 1 platform SKIP` across 316 tests; typecheck/build/CONTROL preview/`qa:fast`/diff check PASS. Browser/iPhone UAT, Desktop enrollment/field proof, CI/review, push and Production deployment are not claimed.

## Current visible product checkpoint — 2026-08-29

- P1-A Home now has a compact real-data command-center pulse for projects, active work, results and attention. It is additive over the existing canonical control projections and gives each card an obvious next action.
- Role-aware rule: device readiness is an Owner-only detail; teacher/staff Home remains outcome-first and does not expose runtime/provider controls. The cards are mobile-safe and keyboard-focusable.
- P1-A implementation is `e39bd0ed9e95f161bf5b7aab46e38899b821f9e7` on `codex/finish-first-p0`; subsequent docs-only checkpoints keep the candidate unpushed. Focused `2/2` and full `313/0/1` source evidence passed. Browser/iPhone UAT, push/CI/review, Desktop enrollment and Production deployment remain open gates.

## Current verified checkpoint — 2026-08-29

- Canonical source was freshly verified at `awh/api-independence` `2caf9242d589d6f1463b8d063045eb86e5084c40`; the isolated P0 candidate is `codex/finish-first-p0` `f1844b6447c039c5e4c4f4f0d2d94e32bfe0f0df` and has not been deployed.
- Desktop enrollment now fails closed unless the device credential can be read back exactly after login/pair/rotate. The worker and restart-equivalent fresh-store check use that same credential boundary; passwords are never persisted.
- The existing `control_task_executions.checkpoint_json` is projected as bounded continuation metadata so field verification can prove VPS `project.read`, root completion, automatic continuation, and same `rootTaskId` without a second queue or authority. Negated high-impact words no longer misclassify an explicitly read-only inspection request.
- Local proof: focused `21/21 PASS`, full product `311 PASS / 0 FAIL / 1 platform SKIP`, Hub/PHP contract, typecheck, build and `qa:fast` PASS. `qa:local`/`qa:full` source gates pass but overall status remains blocked by unpushed exact-upstream state; Electron smoke is `GUI_SANDBOX_BLOCKED` under Codex.
- Field/production boundary: the real Auto-Chain operation stopped at `DEVICE_NOT_ENROLLED` because this machine's private session-credential directory is empty. ReadyIDC read-only evidence is enrollment `m3e2-457696d`, Control/Web `m16-6e8217ab6cd5`, SQLite v16 with integrity `ok` and FK 0, Nginx topology PASS, internal health PASS and public read routes 401. These observations do not prove the candidate is deployed.
- Push/PR was not completed because the safety gate could not verify authorization to send source to `theartzkk/lnwjud-readme`; no workaround is allowed. Production mutation remains blocked pending exact-SHA review/approval.

## Purpose

Art’s Workspace Hub is a personal multi-project workspace hub. It gives an AI
and its local tools one carefully selected project context while preserving
local control, explicit permissions, and recoverable changes.

## Product truth

- Tagline: **Your Projects. One Workspace. Anywhere.**
- AWH is one product; Art Agent is a legacy compatibility codename.
- AWH is Hub-first for durable project/task/memory continuity, with trusted Mac/Windows workers for device-bound execution. GitHub is a source mirror/CI and collaboration path, not the runtime task authority.
- AI is a component/adapter of AWH, not the AWH product itself.
- Portable project identity is stored in `.awh/project.json`.
- Portable Project Memory is stored in `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `ARCHITECTURE.md`, and `DECISIONS.md`.
- Absolute workspace paths are device-local. `.git` is never synchronized by AWH.

## Current implementation status

### Current live owner-access state and field closure

- ReadyIDC is the active production authority at SQLite **schema v12**. Production runtime is pinned to `9b5970f3a29213d79550b068805bd0b23c84674a` with pointer `m12-9b5970f3a292`; integrity/FK, Nginx/PHP-FPM, native executor timer, Project Vault, artifact storage, task workspace/transfer permissions, owner/auth and rollback contracts have been field-verified.
- M6 through M12 are deployed history, not pending architecture. M12 adds Central Project Vault, immutable project revisions, isolated task workspaces, durable execution, artifact object storage, bounded VPS-native execution, worker/Codex transfer foundations and revision/concurrency guards while preserving the canonical task/project authorities.
- Source of Truth order for field work is: **current source → actual production read-only evidence → current DB/release pointers → durable project docs**. Durable docs must be reconciled after verified field changes and must never override newer runtime evidence.
- The current field-debug scope is the OpenAI Responses API path. Production has a configured write-only key and enabled provider policy, but the deployed conversation path can false-succeed when a provider call fails. Source work closes the request-schema defect, sanitized provider diagnostics, real Responses connection probe, truthful durable failure/retry state, usage/cost guards and UI error mapping. Production remains unchanged until an exact candidate SHA is explicitly approved.
- AWH product closure still requires a real iPhone field turn after that approved deployment: `จำได้ไหมว่าเราสร้าง AWH ขึ้นมาทำไม?` must return a genuine model answer grounded in Founding/Project Memory, not a deterministic failure fallback.
- Normal owner use is application login with remembered, revocable Secure/HttpOnly sessions. The authenticated Control Panel owns provider settings and account changes behind step-up verification; provider secrets remain server-side and write-only.

- M1.1 Local QA Engine: closed.
- M1.2 Product Identity Migration: closed.
- M1.3A Safe Data Migration Engine: closed.
- M1.3B Active Data Directory Policy: closed.
- M2A Project Registry + Project Memory Foundation: closed.
- M2B initialized this repository as the first real AWH Project.
- Local Project Registry and bounded Project Context builder are implemented.
- Local MCP, security boundaries, checkpoints, task/runtime engine, Git context, and desktop foundation are implemented.
- M3C0 browser-safe static Remote Read-Only Preview is implemented; M3D field verification confirms the read-only preview path over HTTPS on desktop and iPhone.
- M3C1 PHP/SQLite Hub read foundation and M3D same-origin web gateway are operational on the VPS; field verification confirms live HTTPS access on desktop and iPhone.
- M3D field state: Connected read-only, one indexed project, and PHP-FPM + SQLite + Nginx gateway operational.
- M3C2 hosting foundation and VPS bootstrap are documented design/templates only.
- M3E.1 through M12 migrations/capabilities are deployed on the verified ReadyIDC production Hub; the database is at schema version 12 with owner/project/memory identity preserved through additive migrations.
- M3E-FINAL is operational for the enrolled Mac: owner bootstrap is closed, the Mac credential is stored in macOS Keychain, and the owner-only pairing UI is ready for a separate Windows device. Browser Hub Read remains sanitized and read-only.
- ReadyIDC production is active with one enrolled Mac device (`devices=1`). The legacy Google Cloud host remains backup/legacy only and is not part of the current runtime path.
- Autopilot v0.5 local-first product path is implemented: first-run trusted-device metadata, goal-based Task Contract, reusable project profiles, bounded local runner, QA artifacts, continuity checkpoints, Artifact Center, and Desktop Task Center.
- M4 v1 is active as one canonical control plane: Hub tasks/events, HTTP-only mobile control sessions, CSRF/origin protection, project authorization, idempotent Goal submission, truthful WAITING_FOR_WORKER state, bounded worker heartbeat/lease/claim/update, Results/Artifacts/Approvals routes, scoped approval decisions, and the outbound Desktop worker runtime. It is the only browser/mobile task authority.
- Owner access v1 is active on the existing owner identity and canonical control sessions: username/password, secure password hashes, throttling, CSRF, remembered-session expiry, logout/revocation, password change, one-time hashed recovery codes, step-up verification, and sanitized audit events. Optional Passkey remains deferred.
- The web build has an explicit installable CONTROL/PWA mode (`npm run web:build:control`) for the same canonical project/task model. A CONTROL build is the only product web shell: it is generic and account-scoped, not a static preview or a serialized dashboard. App-shell caching excludes API/authenticated data and evicts older AWH shell releases.
- The normal browser interaction is deliberately project/work-first: sign in → select project → conversation-style Goal → truthful task/result/approval flow. Legacy preview/status-card UI is not a parallel product path. System diagnostics remain bounded under Advanced.
- The normal Work stream shows the owner message immediately, coalesced truthful progress, natural Thai results, approval actions, safe cancellation only before a worker has claimed work, and meaningful artifact names. Raw task IDs, payloads and worker protocol remain Advanced/Audit metadata.
- iPhone canvas contract: `html`, `body`, and the application shell share one canonical graphite background (`#0b0d10`); overscroll and full-page capture must render the same canvas. Orange is an accent only, never a page background or compositing layer.
- A local end-to-end dogfood passed from goal through Project Context, checkpoint, allowlisted test/typecheck/build gates, QA artifact, continuity checkpoint, and discovery from a second device data directory.
- The registered real AWH project completed the `general-node` profile locally; test/typecheck/build gates passed, the disposable FFmpeg/FFprobe frame-sequence → MP4 E2E passed with 8 ordered frames at 5 FPS, H.264/yuv420p output, and completion continuity metadata is discoverable from a second data directory.
- The device-local registry contains the real BAY EXCUSE X (`php`) and Teacher Evaluation Video (`remotion`) manifests in addition to AWH. These are optional local registrations, not AWH-core or M4 activation dependencies; their portable manifests are path-independent and no duplicate identity was registered.
- Both real projects passed a read/QA-only AWH Autopilot dogfood: context binding, profile selection, fixed safe gates, bounded artifact creation, and continuity checkpoint creation. BAY passed PHP lint; Teacher passed its bounded `check` typecheck alias and FFmpeg/FFprobe probe. No project source was modified by dogfood.
- Release candidate identity `1.0.0-rc.1` is resolved from the package source of truth; local structural bundles are produced as `AWH.app` (darwin-x64) and `AWH.exe` inside the win32-x64 portable bundle. The Windows workflow now supports AWH branch/manual dispatch and has produced and verified `AWH.exe`/`AWHSetup.exe` in the successful Windows CI release run; physical Windows field validation remains pending.
- M3E remains open only for the Windows field device: the Mac is active, the Windows Credential Manager path still needs native Windows proof, and production `devices=2` has not yet been verified.

## Current limitations

- Windows field enrollment and independent Credential Manager verification are not complete.
- The disposable native macOS Keychain probe reached `/usr/bin/security` but this session returned an OS authorization failure; no credential value was retained or logged. Windows native runtime remains unverified on Mac.
- ReadyIDC is the active M12 authority at schema v12. Earlier v5 compatibility releases remain historical evidence only; the current production pointer/SHA and read-only runtime evidence take precedence.
- Mac ↔ Hub ↔ Windows WIP continuity foundations through M12 are deployed, but physical Windows field validation remains open. Offline/unsynced work must still be represented truthfully and never claimed as transferable without a verified checkpoint/revision.
- Large assets require a future separate asset layer.
- Local macOS x64 and Windows x64 portable packaging is complete structurally, but the Mac app is unsigned/not notarized, Windows runtime/installer QA requires Windows/CI, and no production distribution claim is made.
- Under the Codex launch context, the installed Electron 43.2.0 x64 binary has a real native AppKit abort before app startup (`EXC_CRASH/SIGABRT` at `_RegisterApplication`); `/usr/bin/open` additionally returns LaunchServices `-10822`. The smoke harness safely isolates temporary data and classifies that pre-marker Codex GUI failure as `GUI_SANDBOX_BLOCKED`, never as an AWH application failure or PASS. A separately authorized logged-in macOS GUI LaunchServices launch produced a valid AWH marker with `stage: passed`, `apiReady: true`, `requiredDom: true`, all Overview/Projects/Autopilot/Artifacts/Memory paths active, and `cmdKReady: true`; the local Mac bundle now passes non-GUI structural/runtime verification. Windows runtime, Squirrel installer, and signing/notarization remain field gates.
- FFmpeg capability detection is fixed for reduced GUI PATHs. The real disposable frame-sequence → MP4 E2E passes through FFmpeg and FFprobe, including ordering/count/duration/FPS/timebase/codec/pixel-format checks; Remotion readiness remains unverified because no AWH-registered Remotion project is selected.
- OpenAI Secure MCP Tunnel control-plane end-to-end connectivity is not claimed.
- AI provider adapters are local integration points; no AWH-owned model is bundled.
- VPS live behavior is recorded from field verification; credentials, passwords, public IPs, and SSH details remain intentionally outside Project Memory.
- M3D Hub Read remains read-only. M3E does not enable source writes, remote execution, synchronization, browser bearer tokens, or MCP proxying.
- M3E-FINAL preserves those boundaries; Windows field enrollment is the remaining device gate.
- Autopilot does not make GitHub Actions, browser shell, remote execution, source synchronization, MCP proxying, or unrestricted commands available. Browser tasks/artifacts remain review-only placeholders until a future sanitized Hub read contract exists.
- AWH is locally usable for bounded routine work on the two real projects. Production publish, DB/control-plane migration, destructive operations, credential changes, and Project Memory writes remain explicit human-approval work.
- iPhone control is live as a public AWH login/PWA shell. Field confirmation still requires Art to sign in on iPhone, select the existing project, submit one safe Goal, and observe the truthful worker state. The browser never stores a permanent device credential; it uses a Secure/HttpOnly server session.
- The normal browser owner path is username/password plus Remember this device. After the first sign-in, the owner should change the bootstrap password to a memorable value in Account; Keychain is a bootstrap delivery boundary, not normal daily login. Basic Auth remains only on technical routes.
