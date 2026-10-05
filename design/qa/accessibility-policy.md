# Accessibility Policy

- Thai text must preserve glyph, vowel and tone-mark visibility.
- Normal text/background combinations target WCAG AA contrast.
- Focus must be visible for keyboard-operable controls.
- Status and error meaning must not rely on color alone.
- Primary touch targets are at least 44 px where intended for touch.
- Dialogs/sheets/popovers keep deterministic focus ownership and recovery.
- Reduced-motion preferences must not remove essential state communication.
- Content remains usable at the required viewport matrix without page-level horizontal scrolling.
- Projector/student/teacher surfaces keep the existing accessibility contracts and keyboard tests.
- Automated checks are a floor, not proof of complete accessibility; critical flows still require rendered/interaction review.
- Release browser QA uses the self-hosted pinned Playwright runtime plus pinned axe-core against real AWH surfaces. No cloud accessibility service is an authority or dependency.
- Automated WCAG AA findings block the candidate until fixed or explicitly reclassified with reproducible rendered evidence; baseline changes never auto-dismiss accessibility findings.
