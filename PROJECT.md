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
- M3E.1 additive SQLite migration and M3E.2 enrollment API are deployed on the verified ReadyIDC production Hub; the database is at schema version 3 with the M3D project and memory metadata preserved.
- M3E-FINAL is operational for the enrolled Mac: owner bootstrap is closed, the Mac credential is stored in macOS Keychain, and the owner-only pairing UI is ready for a separate Windows device. Browser Hub Read remains sanitized and read-only.
- ReadyIDC production is active with one enrolled Mac device (`devices=1`). The legacy Google Cloud host remains backup/legacy only and is not part of the current runtime path.
- Autopilot v0.5 local-first product path is implemented: first-run trusted-device metadata, goal-based Task Contract, reusable project profiles, bounded local runner, QA artifacts, continuity checkpoints, Artifact Center, and Desktop Task Center.
- M4 v1 RC foundation is implemented as one additive package: canonical Hub tasks/events, HTTP-only mobile control sessions, CSRF/origin protection, project authorization, idempotent Goal submission, truthful WAITING_FOR_WORKER state, bounded worker heartbeat/lease/claim/update, Results/Artifacts/Approvals routes, scoped approval decisions, an outbound Desktop worker runtime, and a safe Codex adapter behind the existing task boundary. It is not activated on ReadyIDC.
- The web build has an explicit installable CONTROL/PWA mode (`npm run web:build:control`) for the same canonical project/task model; the ordinary web build remains the safe static preview. App-shell caching excludes API/authenticated data and evicts older AWH shell releases. Local fixtures prove phone session → project → Goal → queue → worker claim → bounded completion plus Results/Approval state, but no live iPhone task submission is claimed before the one M4 activation approval.
- A local end-to-end dogfood passed from goal through Project Context, checkpoint, allowlisted test/typecheck/build gates, QA artifact, continuity checkpoint, and discovery from a second device data directory.
- The registered real AWH project completed the `general-node` profile locally; test/typecheck/build gates passed, the disposable FFmpeg/FFprobe frame-sequence → MP4 E2E passed with 8 ordered frames at 5 FPS, H.264/yuv420p output, and completion continuity metadata is discoverable from a second data directory.
- The device-local registry now contains BAY EXCUSE X (`d1e48976-cfde-479d-9a9c-f3b0ab5ec4fc`, type `php`) and Teacher Evaluation Video (`dad35312-06d6-488b-9ed2-f4886d5394ac`, type `remotion`) in addition to AWH. Their portable manifests are path-independent and no duplicate identity was registered.
- Both real projects passed a read/QA-only AWH Autopilot dogfood: context binding, profile selection, fixed safe gates, bounded artifact creation, and continuity checkpoint creation. BAY passed PHP lint; Teacher passed its bounded `check` typecheck alias and FFmpeg/FFprobe probe. No project source was modified by dogfood.
- Release candidate identity `1.0.0-rc.1` is resolved from the package source of truth; local structural bundles are produced as `AWH.app` (darwin-x64) and `AWH.exe` inside the win32-x64 portable bundle. The Windows workflow now supports AWH branch/manual dispatch and validates `AWH.exe`/`AWHSetup.exe`; the native CI artifact still requires a Windows run.
- M3E remains open only for the Windows field device: the Mac is active, the Windows Credential Manager path still needs native Windows proof, and production `devices=2` has not yet been verified.

## Current limitations

- Windows field enrollment and independent Credential Manager verification, account sync, and source revision sync are not complete.
- The disposable native macOS Keychain probe reached `/usr/bin/security` but this session returned an OS authorization failure; no credential value was retained or logged. Windows native runtime remains unverified on Mac.
- M4 production activation has not occurred. ReadyIDC remains the active M3D/M3E production authority with DB v3, clean integrity/FK state, one indexed project, and one enrolled Mac; the additive M4 schema/API/PWA CONTROL release and executable rollback package are prepared locally and require one bounded production approval.
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
- iPhone control is a built, installable PWA artifact but not field-live: the first browser trust uses one owner-issued pairing code, then an HttpOnly Secure session cookie; permanent native device credentials are never placed in browser storage. Without an online eligible worker, the canonical task remains WAITING_FOR_WORKER.
