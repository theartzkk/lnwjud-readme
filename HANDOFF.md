# Handoff

## Current milestone

M3D — AWH Hub Live Read Connection — CLOSED.

## Completed

M1.1 Local QA Engine; M1.2 Product Identity Migration; M1.3A Safe Data
Migration Engine; M1.3B Active Data Directory Policy; M2A Project Registry +
Project Memory Foundation; M2B first real AWH Project; M2C Desktop Projects UX;
M3A Hub contract; M3B device identity foundation; M3C0 static browser preview;
M3D live Hub read over HTTPS verified on VPS and iPhone.

## Source of Truth

- Branch: `awh/v0.1-migration`
- Current local HEAD is recorded by Git; this M3D closeout remains uncommitted.
- Current working tree: intentionally dirty with the M3D closeout changes.
- Field verification: Connected read-only, one indexed project, PHP-FPM + SQLite + Nginx gateway operational, HTTPS works on VPS and iPhone.
- No VPS, DNS, firewall, SSH, GitHub, production, or shared-hosting action has been performed.

## Next action

Review the M3D closeout diff and commit locally only after the normal review.

## Blockers and warnings

- M3B secure credential storage, project membership, source sync, and Mac ↔ Hub ↔ Windows continuity are future work.
- Caddy/HTTPS, VPS bootstrap, firewall, DNS, databases, and migration plans are documented but unexecuted.
- GitHub Actions is optional and not part of the local critical path.
- The GitHub remote may be behind this local Source of Truth. Do not use the remote as the authority for this work.
