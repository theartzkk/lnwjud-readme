# AWH Product Evolution Roadmap

Status: Durable product-development plan
Applies after: AWH v1 production activation / field entry
Owner principle: AWH must keep improving as a product while continuing to do real project work.

## Product model

AWH has two parallel lanes that must never block each other unnecessarily.

### Product Lane — improve AWH itself

Owns:
- Control Panel UX/UI
- iPhone/PWA experience
- Mac/Windows desktop experience
- Add Project/onboarding
- Tasks/Work experience
- Results/Artifacts
- Approvals
- Devices/workers
- automation/orchestration
- ChatGPT/AWH integration
- install/update lifecycle
- reliability/recovery
- security/privacy
- diagnostics/observability
- performance
- infrastructure portability/scaling

### Project Lane — use AWH to do real work

Examples include BAY EXCUSE X, Teacher Evaluation Video, school website, documents, graphics, video, Apps Script and future projects.

Product Lane must not become a permanent prerequisite for Project Lane. Once a project workflow is safe and usable, real work continues while AWH improvements are developed independently.

## Continuous dogfood loop

Real project usage is the primary source of AWH product improvement.

Flow:

1. Art uses AWH for real work.
2. AWH records bounded task/result/diagnostic state without collecting secrets or unnecessary content.
3. Friction, repeated manual steps, confusing UX, duplicate workflows and reliability failures become Product Lane candidates.
4. Before fixing a symptom, apply `ART_AI_WORKING_PROTOCOL.md`: system-first, root-cause-first, adjacent-defect audit.
5. Ship one coherent product improvement with regression protection.
6. Return immediately to real project work.

Do not create feature work merely because it is technically interesting. Prioritize improvements that reduce Art's effort, increase reliability or unlock important real work.

## Release stages

### Stage A — v1 Field Closure

Goal: make the existing RC genuinely usable in daily life.

Required evidence:
- ReadyIDC M4 production activation
- iPhone live login/pairing
- Control Panel usable on iPhone
- zero-project empty state works
- Add Project/onboarding works with durable identity
- Goal submission reaches canonical task system
- truthful WAITING_FOR_WORKER / RUNNING / QA / APPROVAL / COMPLETED states
- Results/Artifacts usable
- Mac worker live field test
- Windows worker + native Credential Manager field test
- no duplicate task/project/auth state
- recovery after app/service restart

Only field bugs/root causes discovered here should block v1 stable.

### Stage B — Experience / UX System

Goal: make AWH feel like one polished product rather than a collection of technical surfaces.

Focus:
- owner-first Control Panel information hierarchy
- Thai-first copy with concise technical detail under Advanced
- coherent graphite/orange design system
- consistent spacing, typography, cards, status language and feedback states
- mobile safe-area/keyboard/touch behavior
- no horizontal overflow
- polished empty/loading/offline/error states
- clear project switching
- faster Add Project flow
- universal command composer as the primary action
- task timeline understandable without developer vocabulary
- Results/Artifacts preview/download/open/share actions appropriate to platform
- approvals that explain exactly what will change
- Devices shown as simple Ready / Offline / Working / Needs attention
- accessibility and keyboard navigation on desktop

UX work must be tested on real iPhone plus desktop, not judged from source/screenshots alone.

### Stage C — Daily Workflow Automation

Goal: reduce repeated user interaction.

Focus:
- reusable task recipes without exposing shell commands
- remember safe project-level working preferences through Project Memory
- one-click / one-command rerun of approved workflows
- automatic context recovery when returning to a project
- task continuation across devices
- notifications for approval/result/failure where useful
- background worker availability / reconnect behavior
- bounded retry for transient failures
- queue prioritization and cancellation
- richer artifact indexing without duplicating source files

Automation must remain explicit around destructive, publish, production and credential boundaries.

### Stage D — ChatGPT ↔ AWH First-Class Integration

Goal: ChatGPT and AWH App become equivalent control surfaces over the same backend contract.

Canonical intent-level operations should include:
- list projects
- get project context
- submit goal
- get task status
- list results/artifacts
- request/inspect approval
- approve bounded action
- inspect device/worker readiness

Do not expose raw shell, arbitrary paths, server argv or permanent credentials as the product API.

ChatGPT must consume the same Owner Working Constitution and Project Memory as AWH rather than creating a parallel memory model.

### Stage E — Product Maintenance / Update Experience

Goal: AWH can evolve without manual reinstall/reconfiguration pain.

Focus:
- clear version/channel model (stable / RC where needed)
- signed/notarized distribution when distribution maturity warrants it
- safe application update flow
- release integrity verification
- migration preflight and rollback
- portable configuration
- backup/restore UX
- automatic detection of stale/incompatible local worker versions
- owner-friendly release notes focused on what changed for daily use

Updates must preserve project identities, OS credentials and durable project memory.

### Stage F — Scale and Infrastructure Portability

Goal: AWH can grow without redesign when VPS capacity changes.

The ReadyIDC server is infrastructure, not product identity.

AWH must preserve these contracts across resize/migration/provider change:
- project IDs and memberships
- owner/device identity
- task/event state
- artifact metadata
- approvals
- Project Memory authority
- HTTPS/control-plane API contract
- worker protocol

Scale only from evidence. Monitor bounded signals such as:
- CPU saturation
- memory pressure/swap churn
- disk usage and DB growth
- SQLite lock/contention behavior
- request latency/error rate
- queue depth
- concurrent workers/tasks
- backup duration/size

Possible future infrastructure steps, only when justified:
- larger ReadyIDC instance
- additional storage/asset tier
- stronger backup retention
- database/runtime evolution if SQLite becomes a measured bottleneck
- multiple workers for heavy jobs

Never migrate architecture merely because a larger VPS is available.

## Product backlog priority model

Every AWH improvement should be classified in this order:

1. Safety / data-loss / security
2. Blocks real work
3. Repeated friction or manual steps
4. Reliability / recovery
5. UX clarity / mobile usability
6. Performance
7. Quality-of-life automation
8. Visual polish
9. Optional advanced capability

A visually attractive feature must not outrank a data-loss or workflow blocker, but UX is still a product requirement and receives continuous investment rather than being postponed indefinitely.

## Hygiene contract

At the end of each Product Lane pass:
- remove obsolete temporary paths when safe
- reconcile Handoff/Tasks/Decisions to actual state
- avoid duplicate implementations
- keep compatibility layers only when still required
- leave branches/PRs/artifacts in an understandable state
- preserve rollback path for risky changes
- do not leave TODOs that represent hidden release blockers
- distinguish backlog ideas from required work

History belongs in Git; active Project Memory should remain concise and current.

## Product-success definition

AWH succeeds when Art can use it as a long-lived everyday workspace where:

- a new installation starts clean with zero projects;
- any project can be added later;
- Art can work from iPhone, Mac or Windows;
- Art states an outcome once and AI handles the technical system thinking;
- tasks remain understandable and recoverable;
- results are easy to find;
- approvals are bounded and clear;
- the system keeps getting easier and more capable over time;
- AWH development does not prevent Art from doing the actual school/project work it exists to support.

## Immediate product sequence after the current production retry

1. Activate M4 and complete iPhone field test.
2. Add/use the first real project through the normal Add Project path.
3. Do real work immediately; do not wait for more AWH features.
4. Capture genuine friction from that usage.
5. Run one consolidated v1 field-stabilization pass if necessary.
6. Close v1 stable when iPhone/Mac/Windows real flows are proven.
7. Begin the Experience / UX System pass while Project Lane continues normally.

This sequence is intentionally continuous: **use AWH and improve AWH at the same time.**
