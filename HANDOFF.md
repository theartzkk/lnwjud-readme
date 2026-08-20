# Handoff

## Current milestone

M3D — AWH Hub Live Read Connection foundation (local-only) + M3C2 Hosting Foundation Design.

## Completed

M1.1 Local QA Engine; M1.2 Product Identity Migration; M1.3A Safe Data
Migration Engine; M1.3B Active Data Directory Policy; M2A Project Registry +
Project Memory Foundation; M2B first real AWH Project; M2C Desktop Projects UX;
M3A Hub contract; M3B device identity foundation; M3C0 static browser preview;
operator-reported field static preview behind Nginx Basic Auth.

## Source of Truth

- Branch: `awh/v0.1-migration`
- Current local HEAD before the uncommitted M3D work is recorded by Git; refresh it after review.
- Current working tree: intentionally dirty with uncommitted M3D local changes.
- M3C0/M3C1 baseline and current PHP SQLite behavior tests pass with local `pdo_sqlite`.
- No VPS, DNS, firewall, SSH, GitHub, production, or shared-hosting action has been performed.

## Next action

Review the uncommitted M3D gateway, adapter, Nginx template, and tests; then
review the rendered Nginx configuration on the VPS before any deployment.

## Blockers and warnings

- Real Hub deployment, M3B secure credential storage, project membership, source sync, and Mac ↔ Hub ↔ Windows continuity are future work.
- Caddy/HTTPS, VPS bootstrap, firewall, DNS, databases, and migration plans are documented but unexecuted.
- GitHub Actions is optional and not part of the local critical path.
- The GitHub remote may be behind this local Source of Truth. Do not use the remote as the authority for this work.
