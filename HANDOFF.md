# Handoff

## Current milestone

M2B — Initialize AWH as the first real AWH Project.

## Completed

M1.1 Local QA Engine; M1.2 Product Identity Migration; M1.3A Safe Data
Migration Engine; M1.3B Active Data Directory Policy; M2A Project Registry +
Project Memory Foundation.

## Source of Truth

- Branch: `awh/v0.1-migration`
- Local HEAD: `abaae0ad423ecd5386f203a4c9974481b91b8b16`
- Verification before M2B initialization: `qa:fast PASS`, `qa:local PASS`, `dirty=false`
- Current work: this repository is being initialized as the first real AWH Project.

## Next action

Run the final M2B project, context, and local QA checks; review the uncommitted
portable project files; then commit locally only after review approval.

## Blockers and warnings

- AWH Hub, Google VPS, source sync, device registry, and Mac ↔ Hub ↔ Windows continuity are future work.
- GitHub Actions is optional and not part of the local critical path.
- The GitHub remote may be behind this local Source of Truth. Do not use the remote as the authority for this work.
