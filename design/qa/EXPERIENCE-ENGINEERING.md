# KRUART Experience Engineering Gate

This is the executable control plane for the existing KRUART design authority. It does not create a second design system.

## Authority order
1. `design/DESIGN.md`
2. `design/foundations.json` (DTCG tokens)
3. `design/UX-ACCEPTANCE.md`
4. product overlay under `design/overlays/`
5. `design/qa/visual-matrix.json`

## Merge gate
`npm run design:gate` is the deterministic repository-level gate. It validates token/design governance plus ecosystem coverage, keyboard-critical surfaces and universal experience assertions.

Rendered evidence remains mandatory for material UI changes. Source inspection alone never proves visual PASS.

## Browser enforcement contract
The browser runner is expected to consume `visual-matrix.json` and prove, for affected scenarios: successful meaningful render; zero unexpected page/console errors; zero horizontal overflow; visible primary action; >=44px primary touch targets; deterministic focus/overlay ownership; deliberate loading/error/recovery; safe long Thai content; and role-correct navigation.

For mobile keyboard-critical surfaces, 390px and 430px checks are mandatory. Browser emulation is not sufficient proof of the real iOS software keyboard: release evidence for keyboard/composer changes also requires a physical iPhone Safari or approved real-device run.

## Accessibility
Automated accessibility is a release floor, not full acceptance. Browser automation should run axe-core against affected rendered scenarios. Serious/critical findings fail; lower-severity findings require triage against `design/qa/accessibility-policy.md`.

## Visual regression
Screenshot baselines are exact-revision evidence. A changed screenshot is not automatically a defect, but unexplained diffs cannot be silently accepted. Hosted visual-diff services may project this evidence; GitHub remains the authority.

## Cross-product regression rule
When a defect class is discovered in one product (keyboard obstruction, Thai clipping, overflow, role confusion, dead loading state, hidden primary action), add or strengthen the shared assertion before applying a page-local workaround.
