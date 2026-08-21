# Handoff

## Current milestone

M3D — AWH Hub Live Read Connection — CLOSED; M3E-FINAL — Mac active / Windows field pending; AWH real-project unblock — LOCAL DOGFOOD PASS.

## Completed

M1.1 Local QA Engine; M1.2 Product Identity Migration; M1.3A Safe Data
Migration Engine; M1.3B Active Data Directory Policy; M2A Project Registry +
Project Memory Foundation; M2B first real AWH Project; M2C Desktop Projects UX;
M3A Hub contract; M3B device identity foundation; M3C0 static browser preview;
M3D live Hub read over HTTPS verified on VPS and iPhone.
M3E local PHP/SQLite enrollment domain foundation is implemented and tested;
no enrollment endpoint is deployed or exposed through the browser gateway.
M3E.1 additive migration and M3E.2 enrollment API are live on ReadyIDC at schema
version 3. The Mac owner device is enrolled and its permanent credential is in
macOS Keychain; bootstrap is closed. Windows enrollment remains a separate field
test with an independent Credential Manager credential.
AWH v0.5 adds the first usable local product flow: trusted-device first-run
metadata, bounded Task Contract, reusable BAY/Remotion/School Website/Node
profiles, local allowlisted runner, artifacts, and cross-device continuity
checkpoint discovery. The local dogfood path passed end-to-end.
Release identity 0.5.0 is now AWH-facing. `AWH.app` and the win32-x64 portable
bundle containing `AWH.exe` were built locally and verified structurally; the
Mac packaged non-GUI remote-readonly probe passed. The Squirrel installer,
Windows execution, and signing/notarization remain platform/field gates.

## Source of Truth

- Branch: `awh/v0.1-migration`
- Release-freeze baseline before this gate: `e38f848e812c1c5f3088410bd960c40f65de0a03`; this gate freezes the corrected one-nonce bootstrap orchestration without performing production mutation.
- The AWH repository was clean at the start of this pass; source changes are now intentionally under review. No new production mutation occurred.
- Field verification: Connected read-only, one indexed project, PHP-FPM + SQLite + Nginx gateway operational, HTTPS works on VPS and iPhone.
- M3E local tests cover owner bootstrap closure, pairing expiry/replay, device binding, token rotation/revocation, project authorization, and sanitized device reads.
- M3E.1 tests cover M3D metadata preservation, empty bootstrap, idempotent rerun, partial/interrupted recovery, schema mismatch, constraints, and secret-free migration state.
- M3E.2 tests cover origin separation, bootstrap closure, replay, forged identity, rate limiting, token rotation/revocation, and local client secret isolation.
- M3E-FINAL tests cover native adapter argv/stdin isolation, missing/malformed OS credential records, platform selection, self-revoke, Desktop enrollment IPC, M3E.2 additive migration, first-owner-to-first-device bootstrap, one-nonce bootstrap orchestration, canonical deployment path, local deployment dry-run, clean release/asset gate, pre-mutation failure ordering, compiled helper runtime, protected external perimeter/internal health contract, digest-only provisioning, two-server Nginx insertion, deployment isolation, rollback metadata/order, and secret-free templates.
- Native macOS probe attempted only with a disposable QA account and cleanup; the current session returned Keychain authorization failure. No credential value was logged. Windows Credential Manager requires a Windows field run.
- Autopilot local dogfood: goal → context → checkpoint → approved gates → QA artifact → continuity checkpoint → second-device discovery PASS. No source mutation was performed by the dogfood run.
- Real AWH project profile validation: `general-node` bound to the registered project; `test`, `typecheck`, and `build` passed; Git/Node/PHP/FFmpeg and local browsers were detected; FFmpeg and FFprobe both passed the disposable 8-frame sequence → MP4 E2E with ordering/count/duration/FPS/timebase/codec/pixel-format verification.
- Real-project validation: BAY EXCUSE X is registered as `php` and passed bounded PHP lint; Teacher Evaluation Video is registered as `remotion` and passed the existing `check` typecheck alias plus FFmpeg/FFprobe probe. Both completed with bounded artifacts and continuity checkpoints while preserving dirty local work.
- Completion continuity metadata records `COMPLETED`, the committed HEAD, dirty-state protection, source device, project/task IDs, bounded HANDOFF and relative artifact references. Another device must use the committed release only; uncommitted local changes are never a continuation source.
- The device-local registry contains AWH, BAY EXCUSE X (`d1e48976-cfde-479d-9a9c-f3b0ab5ec4fc`), and Teacher Evaluation Video (`dad35312-06d6-488b-9ed2-f4886d5394ac`). The second Teacher clone is intentionally not registered, so there is no duplicate identity.
- No new M4/control-plane mutation was performed. ReadyIDC remains the active production Hub with DB v3, clean integrity/FK state, one indexed project, one enrolled Mac, and active enrollment runtime; Google Cloud `awh-vps` remains untouched legacy/backup infrastructure.

## Next action

Open AWH Desktop, select BAY EXCUSE X or Teacher Evaluation Video, enter a real
Goal, and review the bounded artifact/continuity result. Tomorrow, pair the
Windows device independently and verify sanitized `devices = 2`.

## Blockers and warnings

- Windows Credential Manager persistence, Windows runtime/installer proof, and Mac ↔ Hub ↔ Windows continuity remain field validation work.
- Desktop source/security readiness passes. Direct Electron 43.2.0 x64 launch from the Codex context produces a real native AppKit `SIGABRT` before AWH application startup, and non-GUI `/usr/bin/open` returns LaunchServices `-10822`. The smoke harness isolates temp data and classifies that pre-marker Codex GUI failure as `GUI_SANDBOX_BLOCKED`, not `AWH_APP_FAILED` and never PASS; the local Mac bundle passes non-GUI structural/runtime verification. Windows runtime and Squirrel installer remain Windows-only checks, and the Mac bundle is unsigned/not notarized.
- New M4 task/worker/mobile control-plane routes are not deployed; any production schema/API change remains a single future approval-gated package.
- GitHub Actions is optional and not part of the local critical path.
- The GitHub remote may be behind this local Source of Truth. Do not use the remote as the authority for this work.
- M3E is operational but not fully closed: Mac is active; milestone closure still requires the independent Windows device and sanitized `devices = 2`.
- Autopilot v0.5 does not claim browser execution, real-time sync, automatic Project Memory mutation, or full native Windows packaging on this Mac. Its real-project local dogfood is read/QA-only and completed for both registered projects.
