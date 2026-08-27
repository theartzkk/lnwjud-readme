# AWH Product V1.3 — Owner Control Center

Status: IMPLEMENTATION CONTRACT
Base: `b8902016503f14d501a7afb5c07726c9c442cd61`

## Goal

Turn the existing Owner shortcuts into one coherent control center without turning the default Home into an admin dashboard and without creating any new Project, task, memory, user, provider, approval, worker or database authority.

Owner keeps the same simple AWH Home as Teacher/Staff. Technical and administrative depth opens only after Owner chooses a control-center entry point.

## Existing authorities to reuse

V1.3 must compose the surfaces that already exist:

- Projects → canonical Project sheet / control-plane projects.
- Multi Chat → canonical conversation sheet and selected Project/Conversation context.
- Tasks & Executions → canonical durable tasks, executions, execution events and artifacts.
- Approvals → canonical control approvals already surfaced by Work/Dashboard.
- Memory & Data → existing `data` settings surface and canonical memory records/revisions.
- AI Providers, routing, quotas and costs → existing `ai` settings surface and provider policy/routing/usage APIs.
- Devices & Workers → existing `devices` settings surface and canonical workers/device bindings.
- Users, roles and project access → existing `people` settings surface.
- Security & sessions → existing `account` settings surface, step-up and recovery/session APIs.
- System & Database Studio → existing `system` settings surface and Database Studio.

Automations must not receive a fake card until a durable automation authority actually exists.

## Owner Home contract

The Owner section on Home remains a compact launcher, not a wall of admin metrics.

It should expose these outcome-oriented entries:

1. Projects
2. Multi Chat
3. Tasks & Approvals
4. Memory & Data
5. AI & Costs
6. Devices & Workers
7. People & Access
8. Security
9. System & Database

Each entry routes to an existing canonical surface. No entry may duplicate forms, provider keys, user records or database controls inside Dashboard.

## Owner status summary

Where useful, the Owner section may show bounded summaries derived from already-loaded canonical data, for example:

- project count
- active task count
- pending approval count
- ready/offline worker count
- provider enabled/available state

Summary data is presentation-only. It must not create storage, polling endpoints or a second state model.

Sensitive values are forbidden from summary events and DOM text: API keys, passwords, session cookies, bearer/device tokens, pairing codes, recovery codes and provider credentials.

## Teacher isolation

Teacher/Staff must never see Owner controls or technical labels. The existing role gate remains authoritative.

Teacher-facing UI must continue to avoid terms such as VPS, executor, runtime, CLI, provider key, migration, database schema and worker protocol.

## Correctness cleanup bundled with V1.3

### Login → Dashboard reset

Current Dashboard uses `document.body.dataset.awhDashboardVisited` to avoid reopening Home after a user intentionally enters Work. On an unauthenticated transition/logout, that marker must be cleared.

Acceptance:
- first login → Dashboard
- Dashboard → Work stays in Work
- logout → marker cleared
- next login → Dashboard again
- no localStorage/sessionStorage authority added

### GIF truthfulness

The current image tool accepts GIF while Canvas processing emits only a single raster frame. Silent animation loss is not acceptable.

V1.3 must reject GIF input for resize/convert unless a future animation-aware implementation is present.

Acceptance:
- local image processing supports PNG/JPEG/WebP
- GIF selection receives a clear Thai message that animated GIF is not supported by this tool
- no output is generated from GIF through the Canvas path
- no network upload or AI token is introduced

## Implementation boundaries

Preferred implementation is presentation-only changes in the existing Dashboard/tool registry plus regression tests.

Do not:
- add new backend routes merely for Owner Center
- add a new users/roles store
- add a new provider/quota store
- add another task or approval queue
- create a second device/worker registry
- expose secrets to Dashboard
- enable M13/M14 migration as a side effect

## Required tests

Product/dashboard contract tests must verify:

- Owner launcher includes AI & Costs, People & Access, Security and System & Database in addition to existing Project/Multi Chat/Memory/Task/Device functions.
- New Owner actions route to existing settings tabs/sheets rather than network calls.
- Teacher role still hides the Owner section.
- Dashboard remains presentation-only: no direct `fetch`, XHR, WebSocket, Authorization or Bearer handling.
- unauthenticated transition clears `awhDashboardVisited`.
- GIF is rejected before Canvas processing; PNG/JPEG/WebP remain supported.
- production web build includes all modified presentation assets.

## Release gates

1. targeted dashboard/web tests
2. full GitHub CI on Windows/macOS/Linux
3. exact canonical merge
4. no database migration for this presentation slice
5. Production backup/readiness/dry-run as normal
6. iPhone visual QA when a physical device is available
7. Owner navigation smoke and Teacher isolation smoke

## Completion definition

P4 first slice is complete when Owner can reach every existing administrative authority from one coherent, role-gated center while Teacher Home stays simple, and when the two correctness issues above are regression-locked.
