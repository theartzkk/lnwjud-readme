# AWH AI Self-Sufficient Workspace Architecture

Status: Canonical design contract for post-blocker development
Baseline source: `402ff72ba41deaf120cee366d273c41f17188ad5`
Production evidence at kickoff: schema 15, block-free durable AI execution baseline

## North Star

AWH is a VPS-first, provider-neutral AI orchestration, workspace and execution platform.
ReadyIDC remains the central authority for durable identity, projects, context, work state and evidence.
AI providers, Mac/Windows workers, Codex, MCP tools and external systems are replaceable capabilities.

The default outcome is:

`Understand → Retrieve → Plan → Route → Execute → Verify → Artifact → Learn`

The user should not need to know which provider, tool or worker completed the task.

## VPS-first rule

Use already-paid VPS capability before external spend when it is technically and economically appropriate.
Routing evaluates deterministic VPS tools, cache/reuse, lightweight local work, trusted devices,
free quota, cheap paid AI, premium AI and specialists by capability rather than a fixed ladder.
VPS-first never means forcing large local models onto hardware where API total cost is lower.
## Existing authority — KEEP

| Concern | Canonical authority |
| --- | --- |
| Identity / sessions / step-up | Hub Owner Auth + existing Hub users |
| RBAC / project access | memberships + `control_project_capabilities` |
| Projects / source revision | `projects` + Project Vault |
| Conversations | `control_conversations` + messages/attachments |
| Durable memory | `HubFoundingMemoryService` + memory records/revisions |
| Tasks | `control_tasks` |
| Executions / queue / lease / retry | `control_task_executions` + `HubDurableExecutionService` |
| Capability discovery | M13 Capability Fabric |
| Execution provider envelope | `control_execution_envelopes` |
| Artifacts | `control_artifacts` + object store |
| Approvals | `control_approvals` |
| Workers / devices | enrollment + `control_workers` |
| Automations | `control_automations`, materialized through canonical tasks |
| Provider pricing / usage | M14 pricing + `control_provider_usage` |
| Backup / recovery | `HubBackupService` + verified timer |
| Infrastructure telemetry | `HubInfrastructureService` + native executor refresh |
| Trust projection | existing audit/approval/artifact/checkpoint authorities |

M16 MUST NOT create second project, conversation, memory, task, queue, artifact, approval,
worker, automation or credential authorities.
## Existing authority — EXTEND / REFACTOR

- Capability Fabric: extend model/provider evidence and scoring; keep execution provider identity.
- Provider policy/pricing/usage: extend beyond OpenAI and monthly-only budgeting.
- `HubNativeAgentService`: refactor static OpenAI transport into replaceable adapter boundary.
- Durable Memory: keep authority; add better retrieval/dedup/search indexes without transcript dumping.
- Artifacts: keep object authority; add provenance/QA/model/policy linkage where required.
- Trust/Observability: project route, tool, model, cost and QA evidence from existing executions.
- Approvals: extend action policy; do not create a new approval engine.

## Missing capabilities to add incrementally

1. provider/model registry metadata and controlled lifecycle;
2. qualification/benchmark evidence and shadow evaluation;
3. capability/outcome-based AI routing;
4. reliability score and circuit breaker state;
5. multi-dimensional cost governor and runaway protection;
6. savings ledger and premium-baseline comparison;
7. per-execution routing/prompt/policy/tool-version evidence;
8. data classification and provider privacy eligibility;
9. unified permission-aware search;
10. context dedup/cache and durable handoff references;
11. generalized QA evidence and Plus-Replacement readiness metrics.

## M16 — Self-Sufficient AI Foundation

M16 is additive over schema 15. It introduces evidence/configuration required to make the existing
provider path neutral and measurable; it does not replace the durable execution baseline.
### M16 data responsibilities

- model catalog: capabilities, context window, modalities, tool/structured support, privacy/data ceiling;
- model lifecycle: DISCOVERED → REGISTERED → BENCHMARKING → SANDBOX → APPROVED → PRODUCTION;
- qualification evidence: benchmark suite/version, score, latency, estimated cost, pass/fail;
- model health: success/error/rate-limit/timeout/malformed/tool-failure counters and circuit state;
- route decision: task/execution, capability, provider/model, rationale, estimated cost and policy versions;
- outcome evidence: success, QA result, retries, latency, correction/rework and final cost;
- budget policy: bounded scopes and maximum task/retry cost;
- savings evidence: premium baseline versus actual completed route.

All outcome records reference existing task/execution/project/user identities.
All provider/model selection is advisory until the existing durable executor claims the canonical task.

## Routing invariants

1. Deterministic zero-token capability wins when it can satisfy acceptance criteria.
2. Data classification can eliminate providers before quality/cost ranking.
3. Circuit-open or unqualified models cannot receive production work.
4. Historical success and QA evidence outrank provider marketing claims.
5. Cost optimization targets cost per successful task, not raw token price.
6. Multi-agent work is opt-in by task risk/value and bounded by cost/retry policy.
7. Destructive/high-impact actions still pass through existing approval authority.
8. A provider failure never changes ownership of the canonical task or conversation.
## Delivery sequence after M16

- M17 Context/Search: unified permission-aware search, semantic dedup, context cache and handoff references.
- M18 Outcome Learning: shadow routing, benchmark promotion and cheapest-passing-model learning.
- M19 Trust/QA: generalized QA records, data classification enforcement and advanced execution trace.
- M20 Daily Driver: Plus-Replacement readiness, task-completion/user-touch/rework/cost metrics.

Sequence numbers are design labels only until exact migration/release contracts are reviewed.
A later milestone may combine steps when doing so reduces migration and operational risk.

## Success metrics

- Task Completion Rate
- User Touch per successful task
- Cost per Successful Task
- Time to Useful Result
- Rework Rate
- Provider/Model Reliability
- External AI Spend avoided by deterministic/VPS/local/free routes
- VPS Useful Work contribution

## Permanent-fix requirement

Every defect found while building this architecture follows `ART_AI_WORKING_PROTOCOL.md`:
root cause → canonical fix → regression/prevention → real-flow evidence → durable lesson.
Temporary workarounds are not final closure.
