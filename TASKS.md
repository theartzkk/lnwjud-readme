# Tasks

## NOW

- Review M3E-FINAL and Autopilot v0.5 local implementations; keep production deployment, device pairing, publish, destructive actions and memory writes human-gated.

## NEXT

- Deploy the reviewed M3E-FINAL package once, then pair Mac and Windows independently.
- Verify sanitized Hub device read shows exactly two devices and no shared credential before closing M3E.
- Review Autopilot Task Center/Artifact Center UX and test the normal Desktop flow with a real project goal.
- Add the next explicit approval action for Project Memory checkpoint updates after human review.
- Re-run desktop smoke and macOS packaging on a supported/native Electron environment with network access approved separately; the Codex-context AppKit `_RegisterApplication` abort / `-10822` is explicitly `GUI_SANDBOX_BLOCKED`, not an AWH source failure or PASS.
- Confirm Home, Projects, Autopilot, Artifacts, Cmd/Ctrl+K and Continuity visually from the logged-in macOS GUI path; the current GUI smoke marker already proves AWH main startup and renderer DOM readiness.
- Register/initialize the real BAY EXCUSE X and Teacher Video projects through the explicit Project workflow before claiming their Autopilot profiles are field-ready; do not modify either project in this milestone.
- M3C2 hosting foundation implementation only after infrastructure review.
- M4 Mac ↔ Hub ↔ Windows continuity and explicit conflict handling.

## BACKLOG

- Assets layer.
- Creative/Remotion workspace.
- Device registry.
- Source revision sync.
- Conflict resolution UX.
- macOS packaging.
- Optional GitHub mirror/CI.
- AI provider adapters.
- Browser Hub task/artifact read contract and authenticated review state.
- Production device pair and cross-device continuation field validation.

## DONE

- M1.1 Local QA Engine.
- M1.2 Product Identity Migration.
- M1.3A Safe Data Migration Engine.
- M1.3B Active Data Directory Policy.
- M2A Project Registry + Project Memory Foundation.
- M2B first real AWH Project initialization.
- M2C AWH Desktop Projects UX.
- M3A Hub API/schema contract.
- M3B local device identity foundation.
- M3C0 browser-safe static Remote Read-Only Preview.
- M3C1 PHP/SQLite Hub read foundation.
- M3D AWH Hub Live Read: HTTPS, Nginx Basic Auth, PHP-FPM, SQLite, Connected read-only, one indexed project, desktop and iPhone verified.
- M3E Secure Device Enrollment Foundation: local-only domain/schema/tests complete; no deployment or browser mutation route.
- M3E.1 Enrollment Production Migration Safety: local migration, verification, rollback runbook and tests complete; VPS migration remains pending human review.
- M3E.2 Secure Enrollment API + Local Device Client: local implementation complete; production deployment remains human-gated.
- M3E-FINAL: local implementation READY FOR PRODUCTION VALIDATION; not closed until real Mac and Windows enrollment, credential persistence, rotation/revocation, and sanitized `devices = 2` are verified.
- AWH Autopilot v0.5 local-first product flow and dogfood acceptance scenario.
- AWH video pipeline blocker closure: real FFmpeg/FFprobe discovery, disposable frame-sequence → MP4 E2E, metadata validation, decoded ordering verification, and corrupt/missing-frame regressions.
