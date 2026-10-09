# Ecosystem UX QA adoption and release contract

This document explains how to **apply** the existing KRUART Design System without replacing individual product/release authorities. It is not proof that every product has already adopted a live browser gate.

## Single design authority

- Shared rules: [DESIGN.md](../DESIGN.md), [AGENT-DESIGN-RULES.md](../AGENT-DESIGN-RULES.md), [UX-ACCEPTANCE.md](../UX-ACCEPTANCE.md).
- Product identity/layout: matching [overlays](../overlays) and [visual-matrix.json](visual-matrix.json); approved photography/logos only from `config/kruart-visual-assets.json`.
- Existing project **owns** its source, auth, school records, database, rollout and rollback. AWH cannot silently release or rewrite a project because a shared design test passes.
- Never add a second design-token authority, CI engine, account system or Production database. New project -> register it in the canonical experience/release contracts and add its overlay plus tests in its **own** release track.

## Mandatory when a product changes visual behaviour

1. Identify affected screens/flows and exact Git SHA. Protect real student/staff data: fixtures must be deterministic and anonymized; live login tests must use explicitly authorized test identities only.
2. Keep one product-owned navigation vocabulary; preserve drafts, visible pressed/busy/result/error states, keyboard focus and recovery. Minimum primary touch area 44px; account for iOS viewport and safe area.
3. Render affected screens at 390, 430, 820, 1366 and 1440 px, and verify 320px fallback. Use actual web viewports, not a model-generated mockup.
4. Capture at least one screenshot of meaningful **settled** content per affected scenario and viewport. Explicitly check overflow, Thai glyphs, typography, real imagery, no fake loading or stale status; inspect Error/Empty/Offline/Loading separately.
5. Run actual critical interactions, console/page errors, CSP and WCAG A/AA axe or equivalent. A browser test may not claim native Windows/macOS, LINE WebView, scanner camera or printer acceptance.
6. Store artifact hashes, passed/failed checks, actual reviewer findings and **the same immutable source SHA**. A report that merely sets `requireVisualVerificationForVisualChanges` is not an executed test.
7. New or materially redesigned UI needs Owner visual acceptance. P0 fails; unresolved P1 needs scoped acceptance. Production runs only through the **product's existing release authority**, with rollback and post-deploy parity.

## Existing AWH Control Panel pilot (candidate only)

- `playwright.ui.config.mjs`: Chrome/Chromium viewport matrix and in-memory fixture.
- `test/ui/control-panel.visual.spec.mjs`: Control Panel menu/keyboard/search/CSP/layout and main WCAG A/AA smoke. **This does not exercise real Owner login, all pages, or iPhone Safari.**
- `scripts/qa/visual-evidence-gate.mjs`: checks all ten Playwright cases, real image/metrics/axe attachments, empty errors, clean checkout, expected HEAD and embedded exact SHA. Rejects partial/flaky/skipped/wrong-revision evidence.
- `.github/workflows/ci.yml` `visual-ui-qa`: runs for affected UI pull requests and on main/manual runs, outside the VPS. `scripts/qa/verify-ci-policy.mjs` verifies it cannot silently disappear. **CI candidate changes are not themselves deployed.**
- Required follow-through: run this workflow successfully on clean pushed SHA; require `visual-ui-qa` on protected AWH release branches/Release Center; review screenshots with Owner; verify live Safari and Production after a governed release. Do not claim these are completed by local fixture tests.

## Adoption per independent product

| Track | Native/specialized QA **in addition** to browser evidence |
| --- | --- |
| AWH / Control Panel / Chat | Safari keyboard and IME, draft/attachment preservation, owner action/step-up, session, exact-device identity; Mac/Windows Desktop requires native smoke |
| BAY EXCUSE X | Teacher/student permissions, Thai rosters, attendance forms, QR/card states and authorized anonymized school fixtures |
| BAY Assessment | Camera scanner focus/rotation, scanned student identity, visible scores, A4 half-sheet objective/written paper and print/PDF exact geometry |
| BAY LearnLab | Draw/answer gestures, autosave offline/recovery, assignment, A4 printing and no data loss |
| BAY Cooperative | Bluetooth HID, offline purchase queue, monetary reconciliation, daily grouped reports and touch POS ergonomics |
| LINE OA / Parent Connect | Real LIFF/LINE in-app browser, permissions, rich-menu routing and handoff without leaking protected data |
| School Website | Real school imagery, accurate non-mock content, Thai typography, Pagefind/PWA/mobile accessibility |
| Computer Lab | Windows boot/login workflow, session rotation, network reconnection, staff override and ordinary Windows use |
| AWH Agent/Desktop | macOS Intel/Apple Silicon and Windows native permissions, self-heal/restart and native UI after signing |
| Student Cards / ปพ. / printing | Exact official template PDF/print, correct font shaping, quiet-zone/QR scan and real paper test |

**Adoption status:** only the AWH Control Panel pilot has implemented Playwright + axe inside this candidate. The other tracks have existing design overlays/contract references but their *own pipelines and specialized acceptance evidence are not certified by this document*. Integrate one track at a time using its existing project writer and release authority; do not start duplicate project worktrees or mutate live project sources across tracks.

## CI and budget policy

- Run lightweight token/contract/unit QA on ordinary backend changes; run browser/native visual QA only when UI-affecting files/flows change or at a governed release boundary.
- Browser rendering runs on an isolated pinned CI runner; do not install continuous rendering services on ReadyIDC.
- Pin browser/version, Thai font and fixture locale; do not automatically update baselines just to make red tests green.
- Maintain evidence retention and one artifact per SHA/track. Do not reuse evidence across source changes without a proven byte-identical tree.
- If the test runner is unavailable, report **BLOCKED**; never silently substitute a contract check for a real screenshot.

## Release-readiness statement

A product is `VISUAL_READY` only with clean exact-SHA evidence, its own critical-flow checks, required print/native/WebView checks, zero P0, applicable Owner sign-off, and a configured *enforced* CI/release gate. Without any one of these, status is `READY_FOR_QA` or `READY_FOR_RELEASE` with explicit blockers — not `Production Complete`.
