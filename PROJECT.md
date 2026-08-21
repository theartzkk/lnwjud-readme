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
- M3E Secure Device Enrollment Foundation and M3E.1 production migration safety are implemented and tested.
- M3E.1 additive SQLite migration safety is implemented locally with preflight, ledger, idempotent rerun, rollback testing, and a reviewed VPS runbook; it has not been run on the VPS.
- M3E.2 Secure Enrollment API and local device client are implemented locally only; the API is separate from browser Hub Read.
- M3E-FINAL local implementation is READY FOR PRODUCTION VALIDATION: macOS Keychain and Windows Credential Manager adapters, Desktop enrollment UX, additive M3E.2 migration package, isolated Nginx/PHP-FPM templates, and rollback runbook are present and locally tested.
- M3E production approval gates are locally hardened: first-owner bootstrap now creates owner membership and one initial pairing code atomically; the local client closes that code into first-device enrollment; bootstrap hash provisioning uses the existing OS credential store and SSH stdin; preflight distinguishes `DB_WRITE_READY`, `DB_WRITE_PROVISION_REQUIRED`, and `DB_WRITE_BLOCKED`; Nginx insertion is restricted to one authoritative HTTPS server block; and rollback restores verified SQLite data and exact filesystem metadata before validation/reload.
- Autopilot v0.5 local-first product path is implemented: first-run trusted-device metadata, goal-based Task Contract, reusable project profiles, bounded local runner, QA artifacts, continuity checkpoints, Artifact Center, and Desktop Task Center.
- A local end-to-end dogfood passed from goal through Project Context, checkpoint, allowlisted test/typecheck/build gates, QA artifact, continuity checkpoint, and discovery from a second device data directory.
- The registered real AWH project completed the `general-node` profile locally; test/typecheck/build gates passed, the disposable FFmpeg/FFprobe frame-sequence → MP4 E2E passed with 8 ordered frames at 5 FPS, H.264/yuv420p output, and completion continuity metadata is discoverable from a second data directory.
- Release identity 0.5.0 is resolved from the package source of truth; local structural bundles were produced as `AWH.app` (darwin-x64) and `AWH.exe` inside the win32-x64 portable bundle. Packaged ASAR/runtime identity and the Mac non-GUI remote-readonly probe passed; Windows execution and Squirrel installer creation remain Windows field gates.
- M3E is not CLOSED: no real Mac/Windows pair has been performed in this local milestone, and the verified production device count is not yet `2`.

## Current limitations

- Real VPS enrollment deployment, field Keychain/Credential Manager verification, account sync, and source revision sync are not complete.
- The disposable native macOS Keychain probe reached `/usr/bin/security` but this session returned an OS authorization failure; no credential value was retained or logged. Windows native runtime remains unverified on Mac.
- No VPS mutation or deployment has occurred. A read-only `awh-vps` reconciliation resolved the effective Nginx DB authority to `/var/lib/awh-hub/awh.sqlite`: integrity is `ok`, foreign-key check is empty, `user_version=2`, ledger `m3e.1-enrollment`, and the one indexed project matches the canonical AWH identity. The current `root:www-data 640` database is classified as `DB_WRITE_PROVISION_REQUIRED` (not a source failure); the `awh-hub` service account, backup destination, enrollment route, and pool are first-deploy provisioning states, with backup classified `BACKUP_PROVISION_REQUIRED`.
- Mac ↔ Hub ↔ Windows continuity is a goal, not a verified service.
- Large assets require a future separate asset layer.
- Local macOS x64 and Windows x64 portable packaging is complete structurally, but the Mac app is unsigned/not notarized, Windows runtime/installer QA requires Windows, and no production distribution claim is made.
- Under the Codex launch context, the installed Electron 43.2.0 x64 binary has a real native AppKit abort before app startup (`EXC_CRASH/SIGABRT` at `_RegisterApplication`); `/usr/bin/open` additionally returns LaunchServices `-10822`. The smoke harness safely isolates temporary data and classifies that pre-marker Codex GUI failure as `GUI_SANDBOX_BLOCKED`, never as an AWH application failure or PASS. A separately authorized logged-in macOS GUI LaunchServices launch produced a valid AWH marker with `stage: passed`, `apiReady: true`, `requiredDom: true`, all Overview/Projects/Autopilot/Artifacts/Memory paths active, and `cmdKReady: true`; the local Mac bundle now passes non-GUI structural/runtime verification. Windows runtime, Squirrel installer, and signing/notarization remain field gates.
- FFmpeg capability detection is fixed for reduced GUI PATHs. The real disposable frame-sequence → MP4 E2E passes through FFmpeg and FFprobe, including ordering/count/duration/FPS/timebase/codec/pixel-format checks; Remotion readiness remains unverified because no AWH-registered Remotion project is selected.
- OpenAI Secure MCP Tunnel control-plane end-to-end connectivity is not claimed.
- AI provider adapters are local integration points; no AWH-owned model is bundled.
- VPS live behavior is recorded from field verification; credentials, passwords, public IPs, and SSH details remain intentionally outside Project Memory.
- M3D Hub Read remains read-only. M3E does not enable source writes, remote execution, synchronization, browser bearer tokens, or MCP proxying.
- M3E-FINAL preserves those boundaries; production validation is the next human-gated action.
- Autopilot does not make GitHub Actions, browser shell, remote execution, source synchronization, MCP proxying, or unrestricted commands available. Browser tasks/artifacts remain review-only placeholders until a future sanitized Hub read contract exists.
- AWH v0.5 is locally usable for bounded routine project QA, but production publish, DB migration, destructive operations, credential changes, and Project Memory writes remain explicit human-approval work.
