# Handoff

## Current milestone

M3C1 — AWH Hub Read Foundation + M3C2 Hosting Foundation Design.

## Completed

M1.1 Local QA Engine; M1.2 Product Identity Migration; M1.3A Safe Data
Migration Engine; M1.3B Active Data Directory Policy; M2A Project Registry +
Project Memory Foundation; M2B first real AWH Project; M2C Desktop Projects UX;
M3A Hub contract; M3B device identity foundation; M3C0 static browser preview.

## Source of Truth

- Branch: `awh/v0.1-migration`
- Local HEAD before this uncommitted M3C1/M3C2 work: `8e245146589f7dada632a2ba388752fcf8bb7049`
- Current working tree: intentionally dirty with uncommitted M3C0/M3C1/M3C2 local changes.
- Latest verified M3C0 baseline: `qa:fast PASS`, `qa:local PASS`, `git diff --check PASS`.
- M3C1 PHP syntax passed; full PHP SQLite behavior test is pending a PHP runtime with `pdo_sqlite`.
- No VPS, DNS, firewall, SSH, GitHub, production, or shared-hosting action has been performed.

## Next action

Review the uncommitted M3C0/M3C1/M3C2 changes, install/enable `pdo_sqlite` only
in a controlled local development runtime if desired, rerun PHP Hub tests and
all local QA, then decide whether to commit locally.

## Blockers and warnings

- Real Hub deployment, M3B secure credential storage, project membership, source sync, and Mac ↔ Hub ↔ Windows continuity are future work.
- Caddy/HTTPS, VPS bootstrap, firewall, DNS, databases, and migration plans are documented but unexecuted.
- GitHub Actions is optional and not part of the local critical path.
- The GitHub remote may be behind this local Source of Truth. Do not use the remote as the authority for this work.
