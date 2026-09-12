# Visual Regression Policy

Visual baselines are evidence for an exact source revision, not timeless truth.

- Capture baselines only from clean exact-SHA builds or verified Production revisions.
- Compare the same scenario and viewport before/after.
- A fast-forward merge may reuse candidate evidence only when tree identity is unchanged and exactness is proved.
- Any change to shared tokens, layout primitives, navigation, composer, asset slots or KRUART system CSS requires representative cross-surface review.
- Expected auth 401 probes may be documented; unexpected console/page errors block.
- Horizontal page overflow blocks at every required viewport.
- Screenshot similarity alone never overrides functional, accessibility, architecture or data-integrity failures.
- Baseline updates require a reviewed intentional change; never auto-accept a changed screenshot to make CI green.
- Production post-deploy smoke is mandatory for a deployed visual revision.
