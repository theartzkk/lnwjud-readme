# Handoff

## Current milestone

M3D — AWH Hub Live Read Connection — CLOSED; M3E-FINAL — READY FOR PRODUCTION VALIDATION; AWH Autopilot v0.5 — LOCAL DOGFOOD PASS; AWH 0.5.0 release closure — local packaging PASS, production approval gates hardened locally.

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
Release identity 0.5.0 is now AWH-facing. `AWH.app` and the win32-x64 portable
bundle containing `AWH.exe` were built locally and verified structurally; the
Mac packaged non-GUI remote-readonly probe passed. The Squirrel installer,
Windows execution, and signing/notarization remain platform/field gates.

## Source of Truth

- Branch: `awh/v0.1-migration`
- Release-freeze baseline before this gate: `e38f848e812c1c5f3088410bd960c40f65de0a03`; this gate freezes the corrected one-nonce bootstrap orchestration without performing production mutation.
- Working tree state is expected to be clean after the selective release commit; no production mutation has occurred.
- Field verification: Connected read-only, one indexed project, PHP-FPM + SQLite + Nginx gateway operational, HTTPS works on VPS and iPhone.
- M3E local tests cover owner bootstrap closure, pairing expiry/replay, device binding, token rotation/revocation, project authorization, and sanitized device reads.
- M3E.1 tests cover M3D metadata preservation, empty bootstrap, idempotent rerun, partial/interrupted recovery, schema mismatch, constraints, and secret-free migration state.
- M3E.2 tests cover origin separation, bootstrap closure, replay, forged identity, rate limiting, token rotation/revocation, and local client secret isolation.
- M3E-FINAL tests cover native adapter argv/stdin isolation, missing/malformed OS credential records, platform selection, self-revoke, Desktop enrollment IPC, M3E.2 additive migration, first-owner-to-first-device bootstrap, one-nonce bootstrap orchestration, compiled helper runtime, protected external perimeter/internal health contract, digest-only provisioning, two-server Nginx insertion, deployment isolation, rollback metadata/order, and secret-free templates.
- Native macOS probe attempted only with a disposable QA account and cleanup; the current session returned Keychain authorization failure. No credential value was logged. Windows Credential Manager requires a Windows field run.
- Autopilot local dogfood: goal → context → checkpoint → approved gates → QA artifact → continuity checkpoint → second-device discovery PASS. No source mutation was performed by the dogfood run.
- Real AWH project profile validation: `general-node` bound to the registered project; `test`, `typecheck`, and `build` passed; Git/Node/PHP/FFmpeg and local browsers were detected; FFmpeg and FFprobe both passed the disposable 8-frame sequence → MP4 E2E with ordering/count/duration/FPS/timebase/codec/pixel-format verification.
- Completion continuity metadata records `COMPLETED`, the committed HEAD, dirty-state protection, source device, project/task IDs, bounded HANDOFF and relative artifact references. Another device must use the committed release only; uncommitted local changes are never a continuation source.
- The device-local registry currently contains only the real AWH project. BAY EXCUSE X and Teacher Video are present locally but are not registered/portable AWH projects; no school website workspace is registered.
- No VPS mutation, DNS, firewall, GitHub, production, or shared-hosting action has been performed. A read-only SSH reconciliation through `awh-vps` resolved `/var/lib/awh-hub/awh.sqlite` from effective Nginx configuration; integrity is `ok`, FK check is empty, `user_version=2`, ledger `m3e.1-enrollment`, and the one indexed project is the canonical AWH project. Backup is `BACKUP_PROVISION_REQUIRED`, enrollment is `FIRST_DEPLOY_EXPECTED`, and the current database is safely classified as `DB_WRITE_PROVISION_REQUIRED` because it is `root:www-data 640`; the future `awh-hub` service account, route, and pool are absent as first-deploy provisioning states.

## Next action

Freeze the corrected one-nonce bootstrap orchestration release, then execute the approval-gated one-shot orchestrator only in a reviewed production window. Pair Mac and Windows independently and verify sanitized `devices = 2`.

## Blockers and warnings

- Real OS credential persistence on the Mac Keychain and Windows Credential Manager, VPS deployment, and Mac ↔ Hub ↔ Windows continuity remain field validation work.
- Desktop source/security readiness passes. Direct Electron 43.2.0 x64 launch from the Codex context produces a real native AppKit `SIGABRT` before AWH application startup, and non-GUI `/usr/bin/open` returns LaunchServices `-10822`. The smoke harness isolates temp data and classifies that pre-marker Codex GUI failure as `GUI_SANDBOX_BLOCKED`, not `AWH_APP_FAILED` and never PASS; the local Mac bundle passes non-GUI structural/runtime verification. Windows runtime and Squirrel installer remain Windows-only checks, and the Mac bundle is unsigned/not notarized.
- Caddy/HTTPS, firewall, DNS, production DB/enrollment migration, and service mutation remain unexecuted. The read-only VPS reconciliation passed the effective Nginx/PHP-FPM/SQLite authority checks but did not mutate the database, backup destination, route, pool, or services.
- GitHub Actions is optional and not part of the local critical path.
- The GitHub remote may be behind this local Source of Truth. Do not use the remote as the authority for this work.
- M3E remains READY FOR PRODUCTION VALIDATION, not CLOSED, until both real devices are enrolled with independent credentials.
- Autopilot v0.5 does not claim production deployment, browser execution, real-time sync, automatic Project Memory mutation, or full native Windows packaging on this Mac.
