# Handoff

## Current state

### Current live state — browser/runtime closure deployed

ReadyIDC is active at SQLite schema v5 with M3E.1, M3E.2, M4 and M5 ledgers,
one existing project and one enrolled Mac device. The exact release
`8c5ea0e79c96fb0796c643164a596aa8beabfa51` is deployed through the bounded
M5 compatibility refresh. It rebuilt the PWA from its exact source and passed
the deployed login → session → projects gate without replaying a migration or
changing the owner, projects, device or enrollment state.

The previous iPhone incident was a shared release boundary: a stale Preview
artifact could be served beside CONTROL configuration, and Safari's valid
same-origin safe GET could omit `Origin`. The deployed product now has one
generic account shell, project picker, conversation-style work stream and Goal
composer. Its `html`, `body` and app shell use the same graphite canvas;
release-specific asset URLs and a network-first app-shell cache prevent mixed
generations. Orange is accent-only.

Normal owner use is username/password plus a revocable remembered session.
The Keychain value is only bootstrap delivery. After signing in, Art should set
a memorable password in Account. Basic Auth remains only on technical routes.

### Pending source release — M6 Native Assistant Workstream + M7 Workspace Continuity

The next source candidate adds two additive capabilities, `m6-assistant-workstream` and `m7-workspace-continuity`. It is intentionally not deployed in the current live v5 state. M6 makes the existing Work surface a durable ordered conversation per project by projecting existing canonical tasks, task events, artifacts and approvals into one work stream; it does not introduce another project/task/memory/result authority. M7 adds only WIP checkpoint metadata and a single project workspace-writer lease to that same Hub authority.

M6/M7 have local cross-version fixtures for M3E.1 → M3E.2 → owner/device → M4 → M5 → M6 → M7, browser session, conversation-only response, idempotent Work submission, task lease recovery, safe cancellation, clean/WIP Mac↔Windows handoff, reverse handoff, source-offline/unsynced truthfulness and no-secret/cache transfer. Git is the WIP content authority through a private `refs/awh/wip/<project>/<checkpoint>` ref; the Hub never receives paths or source content. The target claims its workspace lease before restoring and fails closed on a dirty workspace, base-revision mismatch, conflict or unavailable source. Deployment remains one new exact-SHA approval with backup, v5→v7 idempotence, pointer/Nginx/PHP checks and rollback to the verified v5 backup.

The first M4 activation attempt is historical evidence only: it failed before
Nginx activation and rollback restored the v3 baseline. Subsequent reviewed
releases closed that include-composition boundary; the active v5 state above is
authoritative.

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

- ReadyIDC M3D/M3E/M4/M5: **active and verified after the 8c5ea compatibility refresh**.
- DB: schema v5; integrity/FK, M3D perimeter, M3E post-schema and M4 control gates passed.
- Google Cloud `awh-vps`: untouched legacy/backup authority.
- BAY production: untouched.
- Future release changes require an exact reviewed SHA and whole-path
  production-parity evidence; do not reopen an incident by guessing at an
  isolated subcommand.

## Remaining field gates

1. Approve and activate the exact M6/M7 source release; do not deploy the uncommitted/current tree.
2. iPhone Safari/PWA: sign in → select existing project → ask a normal question → submit one safe read-only Work request → see the same worker/result/continuity stream.
3. Logged-in Mac GUI field test with the final package, worker restart/reconnect and one clean/WIP handoff to Windows.
4. Physical Windows pairing/Credential Manager/runtime field test.
5. Fix only verified field defects, then release stable `1.0.0`.

## Next action

Use AWH on iPhone: open the ReadyIDC URL, sign in as the existing owner, change
the bootstrap password in Account if desired, select the existing project and
send one real, safe Goal. Do not begin another infrastructure rewrite before
that field evidence. A private ChatGPT MCP gateway requires a separately
approved OAuth/mTLS production boundary; the current local Secure MCP Tunnel
remains read-only and is not that gateway.
