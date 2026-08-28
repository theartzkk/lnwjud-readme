# AWH World-Class Platform Contract

## North Star
A user states the desired outcome once. AWH understands context, plans bounded work, chooses the cheapest capable route, executes, verifies, returns usable artifacts, records provenance, and can resume or undo without requiring the user to understand the infrastructure.

## One Authority Rule
Do not create parallel authorities.

- AWH Control Plane owns users, sessions, projects, tasks, executions, conversations, memory, artifacts, approvals, workers, automations, AI usage and platform audit.
- Action Graph is a planning/execution projection over existing AWH tasks/executions, not a second task queue.
- Artifact Graph links existing artifacts; it is not a second file store.
- Skill Registry describes capabilities; it does not execute work itself.
- Connector Fabric adapts external authorities through READ / SEARCH / ACTION boundaries.
- BAY remains authoritative for school operational/student data.
- The public school website remains a presentation/public-information surface.
- ReadyIDC is the central infrastructure/control authority, not a second business-data authority.

## Product Layers
1. Experience — Home, AI/Chat, Create, Projects, Files, Tasks, Automations, Owner.
2. Intelligence — Intent, Context, Planner, Action Graph, AI Router, Memory.
3. Execution — Native executor, lnwjud runtime, Windows/Mac workers, browser/connector actions.
4. Capabilities — Docs, Office, PDF, Image, Video, QR, Code, Research, BAY, Website.
5. Authority — Projects, Tasks, Executions, Artifacts, Approvals, Audit, Usage.
6. Reliability — Backup, Restore, Health, Security, Rollback, CI, Evals.

## World-Class Kernels
### Action Graph
- DAG only; bounded nodes and edges.
- Every node declares capability, cost class, approval requirement and undo policy.
- Planner creates a graph; existing task/execution authorities perform it.
- Default bounded autonomy: plan -> specialists -> verify -> output.

### Skills
Every skill declares:
- input/output kinds
- required capability
- deterministic/local/paid cost class
- approval requirement
- undo/recovery policy

### Connectors
Every connector supports only declared READ, SEARCH and/or ACTION operations.
- READ_ONLY connectors cannot mutate.
- ACTION requires bounded write authority and approval by default.
- No connector may create a shadow copy of another system's source of truth.

### Artifact Graph
Artifacts may be linked as DERIVED_FROM, USES, EXPORT_OF, EVIDENCE_FOR or REVISION_OF.
This provides provenance without duplicating artifact payloads.

### Memory
Memory hierarchy: Personal -> Project -> Organization -> Procedural -> Evidence.
Source of Truth always outranks memory, and memory always outranks model guesses.

### Trust Center
Explain in human language what AWH read, changed, sent externally, which provider/device acted, cost, approval, backup and security status.
No secrets, server paths or raw privileged logs cross the browser boundary.

### Evals
Release-blocking capability evaluations cover important real workflows, not model trivia.
A regression in a release-blocking eval prevents release until explained and approved.

### Undo / Replay
- REVERSIBLE actions record the inverse/revert reference.
- SNAPSHOT_REQUIRED actions checkpoint before mutation.
- Deploy/restore/security mutations use guarded approval and rollback.
- A completed Action Graph can be replayed with new inputs through the same contracts.

### Proactive AWH
Proactive recommendations are advisory by default. AWH may surface risks, deadlines and repeated workflows, but mutation still obeys normal approval and authority boundaries.

## Cost Rule
Route in this order whenever capability and quality permit:
DETERMINISTIC / ZERO_TOKEN -> LOCAL_FREE -> cheap/fast provider -> stronger paid provider.
Do not make an AI call merely to acknowledge a task that AWH already created deterministically.

## UX Rule
The product is simple first and deep on demand.
- Chat is the primary entry point.
- Users do not choose lnwjud, Codex, VPS workers or provider internals for normal work.
- Owner technical surfaces live under Infrastructure / Advanced.
- Web, Mobile and Desktop use one AWH product language and canonical branding.
- Do not add CSS/JS overlay generations to repair canonical UI. Fix canonical markup/components/styles.

## Infrastructure Rule
AWH is the GUI for ReadyIDC.
Infrastructure exposes sanitized telemetry for CPU, RAM, storage, services, projects, domains/SSL, deployment, backup, security, workers and AI usage.
There is no arbitrary browser terminal or free-form shell endpoint.
Reuse the existing native executor for bounded telemetry refresh; do not add a parallel daemon when the existing authority can perform the work safely.

## Parallel Development Rule
Parallel branches are encouraged only when they own distinct surfaces.
- Foundation/Platform: canonical Web/Desktop design, branding, Infrastructure, platform contracts, reliability gates.
- Agent/Cost: planner/router, cost saver, multi-agent execution and lnwjud convergence.
- School/Creative: BAY/Website connectors, teacher workflows, document/media skills.

Before merge, every branch must rebase on canonical, reuse the same authorities above, pass full tests, and prove no duplicated queue/database/provider/connector authority was introduced.

## Definition of Done
A capability is done only when the real path passes:
Ask -> Plan -> Execute -> Verify -> Artifact/Result -> Resume -> Recover/Undo (where applicable).
UI-only, backend-only, or architecture-only completion is not a finished product capability.
