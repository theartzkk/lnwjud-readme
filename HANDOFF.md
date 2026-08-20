# Handoff

## Current milestone

M3D — AWH Hub Live Read Connection — CLOSED; M3E-FINAL — READY FOR PRODUCTION VALIDATION; AWH Autopilot v0.5 — LOCAL DOGFOOD PASS.

## Completed

M1.1 Local QA Engine; M1.2 Product Identity Migration; M1.3A Safe Data
Migration Engine; M1.3B Active Data Directory Policy; M2A Project Registry +
Project Memory Foundation; M2B first real AWH Project; M2C Desktop Projects UX;
M3A Hub contract; M3B device identity foundation; M3C0 static browser preview;
M3D live Hub read over HTTPS verified on VPS and iPhone.
M3E local PHP/SQLite enrollment domain foundation is implemented and tested;
no enrollment endpoint is deployed or exposed through the browser gateway.
M3E.1 migration runner, additive SQL, fixtures, and VPS runbook are implemented
and locally tested; the production database has not been modified.
M3E.2 enrollment API/router and local client are implemented locally. M3E-FINAL
adds the dedicated migration runner, macOS Keychain adapter, Windows Credential
Manager adapter, Desktop enrollment UX, isolated Nginx/PHP-FPM templates, and
the reviewed production runbook. No deployment or real device pair has run.
AWH v0.5 adds the first usable local product flow: trusted-device first-run
metadata, bounded Task Contract, reusable BAY/Remotion/School Website/Node
profiles, local allowlisted runner, artifacts, and cross-device continuity
checkpoint discovery. The local dogfood path passed end-to-end.

## Source of Truth

- Branch: `awh/v0.1-migration`
- Current local HEAD is recorded by Git; M3E-FINAL changes are intentionally uncommitted.
- Current working tree: intentionally dirty for review.
- Field verification: Connected read-only, one indexed project, PHP-FPM + SQLite + Nginx gateway operational, HTTPS works on VPS and iPhone.
- M3E local tests cover owner bootstrap closure, pairing expiry/replay, device binding, token rotation/revocation, project authorization, and sanitized device reads.
- M3E.1 tests cover M3D metadata preservation, empty bootstrap, idempotent rerun, partial/interrupted recovery, schema mismatch, constraints, and secret-free migration state.
- M3E.2 tests cover origin separation, bootstrap closure, replay, forged identity, rate limiting, token rotation/revocation, and local client secret isolation.
- M3E-FINAL tests cover native adapter argv/stdin isolation, missing/malformed OS credential records, platform selection, self-revoke, Desktop enrollment IPC, M3E.2 additive migration, deployment isolation, and secret-free templates.
- Native macOS probe attempted only with a disposable QA account and cleanup; the current session returned Keychain authorization failure. No credential value was logged. Windows Credential Manager requires a Windows field run.
- Autopilot local dogfood: goal → context → checkpoint → approved gates → QA artifact → continuity checkpoint → second-device discovery PASS. No source mutation was performed by the dogfood run.
- Real AWH project profile validation: `general-node` bound to the registered project; `test`, `typecheck`, and `build` passed; Git/Node/PHP/FFmpeg and local browsers were detected; FFmpeg and FFprobe both passed the disposable 8-frame sequence → MP4 E2E with ordering/count/duration/FPS/timebase/codec/pixel-format verification.
- Completion continuity metadata records `COMPLETED`, the committed HEAD, dirty-state protection, source device, project/task IDs, bounded HANDOFF and relative artifact references. The real workspace is currently dirty, so another device must review local changes before continuation.
- The device-local registry currently contains only the real AWH project. BAY EXCUSE X and Teacher Video are present locally but are not registered/portable AWH projects; no school website workspace is registered.
- No VPS, DNS, firewall, SSH, GitHub, production, or shared-hosting action has been performed.

## Next action

Review the uncommitted M3E-FINAL + Autopilot v0.5 diff, then separately and human-gated validate native Keychain, deploy enrollment once, pair Mac and Windows independently, and verify sanitized `devices = 2`.

## Blockers and warnings

- Real OS credential persistence on the Mac Keychain and Windows Credential Manager, VPS deployment, and Mac ↔ Hub ↔ Windows continuity remain field validation work.
- Desktop source/security readiness passes. Direct Electron 43.2.0 x64 launch from the Codex context produces a real native AppKit `SIGABRT` before AWH application startup, and non-GUI `/usr/bin/open` returns LaunchServices `-10822`. The smoke harness isolates temp data and classifies that pre-marker Codex GUI failure as `GUI_SANDBOX_BLOCKED`, not `AWH_APP_FAILED` and never PASS; a separately authorized logged-in macOS GUI LaunchServices run produced `stage: passed`, `apiReady: true`, `requiredDom: true`, all Overview/Projects/Autopilot/Artifacts/Memory paths active, and `cmdKReady: true`. That interactive proof remains required for `MAC_DESKTOP_RUNTIME_PASS`. macOS Forge packaging is configured but cannot complete offline because it attempts an Electron artifact lookup on github.com.
- Caddy/HTTPS, VPS bootstrap, firewall, DNS, databases, and migration plans are documented but unexecuted.
- GitHub Actions is optional and not part of the local critical path.
- The GitHub remote may be behind this local Source of Truth. Do not use the remote as the authority for this work.
- M3E remains READY FOR PRODUCTION VALIDATION, not CLOSED, until both real devices are enrolled with independent credentials.
- Autopilot v0.5 does not claim production deployment, browser execution, real-time sync, automatic Project Memory mutation, or full native Windows packaging on this Mac.
