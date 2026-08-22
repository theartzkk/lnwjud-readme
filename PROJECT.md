# Art’s Workspace Hub — AWH

## Purpose

Art’s Workspace Hub is a personal multi-project workspace hub. It gives an AI
and its local tools one carefully selected project context while preserving
local control, explicit permissions, and recoverable changes.

## Product truth

- Tagline: **Your Projects. One Workspace. Anywhere.**
- AWH is one product; Art Agent is a legacy compatibility codename.
- AWH is local-first. GitHub is an optional mirror/CI path, not critical infrastructure.
- AI is a component/adapter of AWH, not the AWH product itself.
- Portable project identity is stored in `.awh/project.json`.
- Portable Project Memory is stored in `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `ARCHITECTURE.md`, and `DECISIONS.md`.
- Absolute workspace paths are device-local. `.git` is never synchronized by AWH.

## Current implementation status

### Current live owner-access state and field closure

- ReadyIDC is live at schema v5 with the M3E.1, M3E.2, M4 and M5 ledgers; integrity/FK checks, the existing project, and the enrolled Mac identity remain canonical production state.
- The iPhone field incident proved two shared release defects: a browser same-origin safe GET may omit `Origin` while sending `Sec-Fetch-Site: same-origin`, and a CONTROL web release must never inherit static Preview data from the repository build.
- The next release uses one shared browser-origin policy: mutations require the exact configured `Origin`; safe reads accept only an exact supplied origin, `same-origin` Fetch Metadata without an origin, or the legacy no-metadata path. Cross-site reads remain rejected.
- CONTROL PWA builds are generic account shells, not preinstalled-project previews. They are rebuilt from the exact release SHA, carry a release-specific app-shell cache, and are validated before the web pointer can move.
- Normal owner use is application login: remembered, revocable Secure/HttpOnly sessions; the authenticated Control Panel lets the existing owner set a memorable username and password. No normal browser flow depends on a Keychain password after that first sign-in.

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
- M3E.1, M3E.2, M4 control-plane, and M5 owner-auth migrations are deployed on the verified ReadyIDC production Hub; the database is at schema version 5 with the existing project and memory metadata preserved.
- M3E-FINAL is operational for the enrolled Mac: owner bootstrap is closed, the Mac credential is stored in macOS Keychain, and the owner-only pairing UI is ready for a separate Windows device. Browser Hub Read remains sanitized and read-only.
- ReadyIDC production is active with one enrolled Mac device (`devices=1`). The legacy Google Cloud host remains backup/legacy only and is not part of the current runtime path.
- Autopilot v0.5 local-first product path is implemented: first-run trusted-device metadata, goal-based Task Contract, reusable project profiles, bounded local runner, QA artifacts, continuity checkpoints, Artifact Center, and Desktop Task Center.
- M4 v1 is active as one canonical control plane: Hub tasks/events, HTTP-only mobile control sessions, CSRF/origin protection, project authorization, idempotent Goal submission, truthful WAITING_FOR_WORKER state, bounded worker heartbeat/lease/claim/update, Results/Artifacts/Approvals routes, scoped approval decisions, and the outbound Desktop worker runtime. It is the only browser/mobile task authority.
- Owner access v1 is active on the existing owner identity and canonical control sessions: username/password, secure password hashes, throttling, CSRF, remembered-session expiry, logout/revocation, password change, one-time hashed recovery codes, step-up verification, and sanitized audit events. Optional Passkey remains deferred.
- The web build has an explicit installable CONTROL/PWA mode (`npm run web:build:control`) for the same canonical project/task model. A CONTROL build is the only product web shell: it is generic and account-scoped, not a static preview or a serialized dashboard. App-shell caching excludes API/authenticated data and evicts older AWH shell releases.
- The normal browser interaction is deliberately project/work-first: sign in → select project → conversation-style Goal → truthful task/result/approval flow. Legacy preview/status-card UI is not a parallel product path. System diagnostics remain bounded under Advanced.
- iPhone canvas contract: `html`, `body`, and the application shell share one canonical graphite background (`#0b0d10`); overscroll and full-page capture must render the same canvas. Orange is an accent only, never a page background or compositing layer.
- A local end-to-end dogfood passed from goal through Project Context, checkpoint, allowlisted test/typecheck/build gates, QA artifact, continuity checkpoint, and discovery from a second device data directory.
- The registered real AWH project completed the `general-node` profile locally; test/typecheck/build gates passed, the disposable FFmpeg/FFprobe frame-sequence → MP4 E2E passed with 8 ordered frames at 5 FPS, H.264/yuv420p output, and completion continuity metadata is discoverable from a second data directory.
- The device-local registry contains the real BAY EXCUSE X (`php`) and Teacher Evaluation Video (`remotion`) manifests in addition to AWH. These are optional local registrations, not AWH-core or M4 activation dependencies; their portable manifests are path-independent and no duplicate identity was registered.
- Both real projects passed a read/QA-only AWH Autopilot dogfood: context binding, profile selection, fixed safe gates, bounded artifact creation, and continuity checkpoint creation. BAY passed PHP lint; Teacher passed its bounded `check` typecheck alias and FFmpeg/FFprobe probe. No project source was modified by dogfood.
- Release candidate identity `1.0.0-rc.1` is resolved from the package source of truth; local structural bundles are produced as `AWH.app` (darwin-x64) and `AWH.exe` inside the win32-x64 portable bundle. The Windows workflow now supports AWH branch/manual dispatch and has produced and verified `AWH.exe`/`AWHSetup.exe` in the successful Windows CI release run; physical Windows field validation remains pending.
- M3E remains open only for the Windows field device: the Mac is active, the Windows Credential Manager path still needs native Windows proof, and production `devices=2` has not yet been verified.

## Current limitations

- Windows field enrollment and independent Credential Manager verification, account sync, and source revision sync are not complete.
- The disposable native macOS Keychain probe reached `/usr/bin/security` but this session returned an OS authorization failure; no credential value was retained or logged. Windows native runtime remains unverified on Mac.
- ReadyIDC is the active M3D/M3E/M4/M5 authority at schema v5. The deployed compatibility refresh at `8c5ea0e79c96fb0796c643164a596aa8beabfa51` rebuilt the generic project/work PWA, refreshed the control/web pointers, and verified owner login → session → projects without changing schema, owner identity, projects, or enrollment data.
- Mac ↔ Hub ↔ Windows continuity is a goal, not a verified service.
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
