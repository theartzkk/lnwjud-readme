# KRUART UX Acceptance Contract

This contract turns the Golden production experience into release gates. It complements, and does not replace, security, data-integrity, architecture, migration, or deployment gates.

## Release blocker classes

- **P0:** broken primary task, unsafe/misleading state, inaccessible composer, lost work, wrong identity/data authority, mobile overflow/navigation obstruction, unrecoverable common failure.
- **P1:** material friction, inconsistent navigation/state, unreadable Thai text, important accessibility defect, duplicate controls, layout jump/flash, asset/logo mismatch.
- **P2:** polish that does not prevent successful work.

A release with an unresolved P0 fails. P1 requires explicit review/acceptance. P2 may be deferred with evidence.

## Required viewport matrix

Every material shared-UI change must be checked at:
- 390 px mobile
- 430 px mobile
- 820 px tablet
- 1366 px desktop
- 1440 px desktop

AWH authenticated composer changes also require a visual-viewport/keyboard check at 390 and 430 px.
## Universal gates

1. Page/surface renders meaningful content; no blank/error overlay.
2. Console/page errors are zero except documented expected auth probes.
3. Horizontal document overflow is zero.
4. Thai glyphs, vowels and tone marks are not clipped.
5. Text contrast is readable on every actual background state.
6. Header, sticky controls, sheets and bottom navigation do not cover content.
7. Only one navigation owner is visible for the active product context.
8. Loading, empty, offline, error and recovery states are deliberate and stable.
9. Modal/popover/dropdown stacking and focus ownership are deterministic.
10. Approved logos and semantic assets match the canonical registry.
11. The exact school spelling remains **โรงเรียนบ้านเอือดใหญ่**.
12. Long Thai names and long content do not force page-level overflow.
13. No first-paint session flash, stray component flash or unintended smooth-scroll/layout jump.
14. Touch interactions use appropriate targets; primary touch targets are at least 44 px.
15. Critical actions preserve recovery, provenance and data integrity.

## AWH-specific gates

- Root Portfolio remains distinct from signed-in AWH Workspace.
- Workspace mobile primary navigation remains Chat · My Work · Tools.
- Composer is real, resizable, keyboard-aware and preserves attachment/HEIC behavior.
- Enter/Shift+Enter and IME behavior remain correct for the active platform contract.
- Edit & resend does not rewrite history.
- Retry/restore/attachments preserve canonical behavior.
- Stop is shown only when the backend can safely cancel; never fake RUNNING cancellation.
- Profile/account/settings reuse canonical auth/profile authority; no duplicate profile source.
- Conversation context survives navigation/reload where the product contract promises it.
## BAY ecosystem gates

- BAY EXCUSE X remains school identity/roster/School SoT authority.
- LearnLab must not reintroduce direct BAY Core/master-table coupling into Product source.
- School Website stays public-friendly and must not inherit signed-in AWH shell/navigation.
- BAY Hub presents truthful ecosystem/release status; it does not become a second product authority.
- Official/frozen document geometry (including ปพ., timetable, substitute and cooperative print contracts) must not change from a visual-only task.
- Project identity may vary by overlay, but the shared family must retain KRUART typography, spacing, interaction and asset rules.

## Evidence required before merge/deploy

- exact source SHA
- deterministic test/contract results
- representative rendered screenshots or automated browser evidence
- console/page-error result
- overflow result
- affected critical-flow result
- asset/logo authority result when visuals changed
- rollback/deployment path for Production mutation

Fast-forward merges may reuse candidate visual evidence only when the merged tree is byte-identical to the tested candidate and post-merge exactness is proved.
