# Agent Design Rules

These rules apply to Codex and any AI/automation that changes KRUART/AWH/BAY presentation.

## Authority order

1. Platform/security/data-integrity constraints.
2. Product/data/identity architecture and current runtime Source of Truth.
3. Current task acceptance criteria.
4. `design/DESIGN.md` for shared visual/interaction language.
5. The matching file in `design/overlays/` for product-specific expression.
6. `config/kruart-visual-assets.json` for semantic image/logo slots.
7. Current implementation CSS/components when they do not conflict with the authorities above.

Never treat a screenshot, old branch, generated mockup, reference-only asset or model opinion as a higher authority than this chain.

## Before editing

- Resolve live remote HEAD, active branch/worktree, production revision and relevant runtime state.
- Identify the shared component/layout/state owner of the defect before creating page-specific CSS.
- Search the BAY ecosystem for an existing component/identity/API/asset/queue capability before building another one.
- Read the affected product overlay and UX acceptance contract.
- For visual assets, resolve a semantic slot before touching pixels.

## During editing

- Prefer the smallest shared/root-cause change that fixes all affected surfaces.
- Preserve business behavior, data authority and frozen print/document geometry.
- Do not migrate frameworks or introduce a second design system for visual consistency.
- Do not invent colors, spacing scales, radii or visual metaphors when tokens already cover the need.
- New tokens require a documented semantic need and deterministic tests.
- Keep Thai copy in accessible HTML unless an approved immutable brand lockup explicitly contains text.
## Approved anti-slop filter

- For UI/UX work, AWH may lazy-load the reviewed `design.antislop` capability as a filter after this design authority and the matching product overlay are resolved.
- Anti-slop may reject generic/template-like choices, invented claims, broken responsive behavior or decoration without purpose. It may not choose a new brand, palette, framework, navigation model or design authority.
- The upstream Anti Slop install wizard and DURING/AFTER setup question are disabled in AWH. Normal creation/editing uses DURING filtering automatically; AFTER mode is reserved for an explicit audit request.
- Hallmark, Anti Slop and other reviewers are complementary critics. Exact-revision rendered evidence and the KRUART UX acceptance contract remain the release gate.


## Forbidden drift

Agents must not:
- regenerate, redraw or approximate an approved logo
- change the canonical school spelling
- bulk-import `02_REFERENCE_ONLY`
- create a new visual asset registry that competes with `config/kruart-visual-assets.json`
- create duplicate school identity/login/database/queue/notification authority
- expose backend vocabulary in normal L1/L2 user UX
- hide a runtime/architecture failure behind cosmetic UI
- call a branch/source state “Production” before deployment and post-deploy evidence
- claim visual PASS from source inspection alone
- use blind retry to burn CI/token/runtime budget

## Review behavior

Impeccable/AIPass/other AI reviewers are critics, not authorities. Their findings become engineering input only after revision/evidence validation. Deterministic tests, exact-revision browser evidence and Owner acceptance remain the release authority.

## Definition of done for design work

A visual change is done only when:
- source is clean and exact
- shared design/overlay/asset authorities are satisfied
- deterministic tests pass
- required viewport matrix passes
- critical interactions pass
- Thai typography/contrast/overflow pass
- the exact reviewed revision is the revision proposed for merge/deploy
- rollback remains available
