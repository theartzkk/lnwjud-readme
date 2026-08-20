# Handoff

## Current milestone

M3D — AWH Hub Live Read Connection — CLOSED; M3E Secure Device Enrollment Foundation — LOCAL-ONLY.

## Completed

M1.1 Local QA Engine; M1.2 Product Identity Migration; M1.3A Safe Data
Migration Engine; M1.3B Active Data Directory Policy; M2A Project Registry +
Project Memory Foundation; M2B first real AWH Project; M2C Desktop Projects UX;
M3A Hub contract; M3B device identity foundation; M3C0 static browser preview;
M3D live Hub read over HTTPS verified on VPS and iPhone.
M3E local PHP/SQLite enrollment domain foundation is implemented and tested;
no enrollment endpoint is deployed or exposed through the browser gateway.
M3E.1 migration runner, additive SQL, fixtures, and VPS runbook are implemented
and locally tested; the production database has not been modified.

## Source of Truth

- Branch: `awh/v0.1-migration`
- Current local HEAD is recorded by Git; this M3D closeout remains uncommitted.
- Current working tree: intentionally dirty with the M3D closeout changes.
- Field verification: Connected read-only, one indexed project, PHP-FPM + SQLite + Nginx gateway operational, HTTPS works on VPS and iPhone.
- M3E local tests cover owner bootstrap closure, pairing expiry/replay, device binding, token rotation/revocation, project authorization, and sanitized device reads.
- M3E.1 tests cover M3D metadata preservation, empty bootstrap, idempotent rerun, partial/interrupted recovery, schema mismatch, constraints, and secret-free migration state.
- No VPS, DNS, firewall, SSH, GitHub, production, or shared-hosting action has been performed.

## Next action

Review the uncommitted M3E schema/service/tests and commit locally only after the normal review.

## Blockers and warnings

- M3B secure credential storage, project membership, source sync, and Mac ↔ Hub ↔ Windows continuity are future work.
- Caddy/HTTPS, VPS bootstrap, firewall, DNS, databases, and migration plans are documented but unexecuted.
- GitHub Actions is optional and not part of the local critical path.
- The GitHub remote may be behind this local Source of Truth. Do not use the remote as the authority for this work.
