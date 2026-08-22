# Handoff

## Current state

### Latest owner-auth closure evidence

The source release `055484d7ac9a4b9e5676ab5312518f8c722fd705` was attempted once
on ReadyIDC and rolled back safely at the owner-auth surface gate. The
post-rollback baseline is verified: SQLite v4, integrity/FK clean, one project,
one device, original control/web pointers, Nginx syntax, M3D and M4 healthy.
No source retry is authorized by this record.

The repeated failure is governed by the shared incident rule in
`ART_AI_WORKING_PROTOCOL.md`: route reachability, application auth, web file
access and post-reload behavior must be reported as distinct gates. The next
source candidate separates the owner route probe from the public web probe and
keeps the `www-data` read/traverse contract explicit. It must pass QA and receive
one new bounded production approval before mutation.

AWH `1.0.0-rc.1` is feature-complete in source/artifact scope. ReadyIDC production has the verified M3D/M3E/M4 control-plane baseline at SQLite schema v4 with one indexed project and one enrolled Mac.

The current source candidate adds owner username/password access as additive
`m5-owner-auth` (v4→v5). It reuses `control_sessions`, stores only password
and recovery hashes, and is not deployed. Basic Auth was not retried or
changed by this pass; optional Passkey remains deferred.

The first M4 activation attempt using release `062b18eb37c043f755099e4d3d40215c99edb33e` reached the web-release stage, then failed safely before Nginx activation. Automatic rollback passed and restored DB v3, M3D/M3E routes, pointers and service health.

Read-only inspection of the real ReadyIDC Nginx topology proved the root cause: the reused include inserter incorrectly treated the existing valid M3E enrollment include as a conflict with the new M4 control-plane include. Release `88834b5ad34ed35e7aa1f54c473307482e37feee` fixes that shared Nginx composition contract and passes targeted/local deployment regression. That SHA has not been retried in production.

## Durable owner working protocol

AWH now carries `ART_AI_WORKING_PROTOCOL.md` as the durable owner-level contract for ChatGPT/AWH/Codex work. `AGENTS.md` points agents to it, Project Context loads it before project memory, and the Desktop worker composes AI instructions in this order:

1. platform/security boundary;
2. Art ↔ AI Working Constitution;
3. canonical project identity + Project Memory;
4. current Goal;
5. current source/runtime evidence.

Core rule: **the Goal/symptom does not limit analysis scope — system-first, root-cause-first, one coherent pass, no parallel systems, preserve validated core, QA the real flow, report only what is proven.**

The owner-protocol integration is isolated on `awh/clean-foundation` / PR #8 for cross-platform QA before the release branch advances. It does not mutate ReadyIDC, Google Cloud, BAY production or user project source.

## Canonical project behavior

- Fresh AWH may contain zero user projects.
- User projects are added later through reusable Add Project/onboarding.
- Existing `.awh/project.json` identity is reused; duplicate available identities fail closed.
- BAY EXCUSE X and Teacher Evaluation Video are optional user projects/dogfood, never AWH-core or deployment dependencies.
- Project Memory remains `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `ARCHITECTURE.md`, `DECISIONS.md`.
- Heavy execution stays on trusted Mac/Windows workers; the VPS remains a lightweight, provider-portable control plane.

## Production safety state

- ReadyIDC M4: **not active**.
- ReadyIDC baseline after rollback: **restored and verified**.
- Google Cloud `awh-vps`: untouched legacy/backup authority.
- BAY production: untouched.
- M4 retry must use an exact reviewed SHA and whole-path production-parity evidence; do not retry by guessing at another isolated subcommand.
- Owner-auth v5 activation requires one bounded approval covering backup, additive migration, auth route, Nginx application-auth cutover, rollback and live login/session regression.

## Field gates after successful M4 activation

1. iPhone Safari/PWA trust + Control Panel + zero-project/real-project flow.
2. Live Goal → canonical task → worker claim → bounded AI/QA → Result/Artifact/Approval.
3. Logged-in Mac GUI field test with the final package.
4. Physical Windows pairing/Credential Manager/runtime field test.
5. Fix only verified field defects, then release stable `1.0.0`.

## Next action

Finish PR #8 cross-platform QA and reconcile it cleanly with the current release line. Then perform one whole-path production-readiness review of the final exact SHA, not only the previously failing Nginx step. Only after that review may one bounded ReadyIDC M4 retry be approved.

For owner authentication, the next production action is one reviewed v5
activation approval; this source pass performs no production mutation. The
activation must resolve the AWH PHP-FPM socket from the live enrollment
include, pass the origin as a FastCGI request parameter, verify the effective
Nginx generation, then allow the public auth route a short bounded convergence
window before evaluating application login/session. Only sanitized HTTP status
and attempt evidence may cross the deployment boundary.
