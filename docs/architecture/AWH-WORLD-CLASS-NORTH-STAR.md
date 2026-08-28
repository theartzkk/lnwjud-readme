# AWH World-Class North Star

Status: architecture direction for `awh/mcp-plugin-gateway`; non-production, no deploy.

## Product thesis
AWH is not another AI chat UI. It is a policy-driven AI operating/control plane that turns user intent into verified outcomes across cloud services, VPS, GitHub, files, school systems, and authorized Mac/Windows workers.

The user should not need to choose a model, API, machine, path, or agent. AWH selects the safest and cheapest route, executes with evidence, verifies the real result, and exposes rollback/audit.

## Core invariants
- AWH is the single source of truth for users, permissions, tasks, executions, approvals, artifacts, memory, worker capabilities, audit, and policy.
- MCP/Plugin, web UI, automations, Codex, and future agents are adapters into the same execution contracts; no duplicated business logic.
- Default deny; read-only first; outbound-only workers; no raw unrestricted shell as a normal tool.
- Privileged actions use least privilege, short-lived grants, idempotency, approval policy, backup/rollback, and immutable evidence.
- No production mutation from this branch until synchronized with the active production branch and verified.

## World-class architecture pillars

### 1. Intent Compiler
Convert natural-language requests or UI workflows into a typed `Intent` and an execution contract: goal, scope, project, risk, capabilities, expected artifacts, acceptance tests, budget, and rollback strategy. The compiler must not directly execute.

### 2. Universal Task + Transactional Execution
Every request becomes one task model regardless of origin (ChatGPT/MCP, AWH Web, teacher workflow, automation, Codex). Each side effect carries an idempotency key. Multi-step actions support compensating actions and resumability rather than blind retry.

### 3. Capability Registry + Worker Mesh
Workers advertise typed capabilities, OS, tool versions, allowed workspaces, online/last-seen status, trust tier, and current load. The scheduler chooses VPS/Mac/Windows/browser/external service automatically. Workers connect outbound to AWH; inbound exposure is not required.

### 4. Policy & Trust Engine
Evaluate user role, project scope, data class, action risk, device trust, time/context, and requested capability. Support four trust tiers: Observe, Safe Action, Privileged Action, Break-glass. Use ephemeral grants and explicit review for destructive/irreversible operations.

### 5. Digital Twin / State Graph
Maintain a live, provenance-backed graph of AWH services, repositories/branches/SHAs, deployments, databases/schemas, domains, workers, artifacts, backups, dependencies, and health. Planning compares desired state with observed state before execution.

### 6. Rehearsal / Shadow Mode
For risky workflows, simulate plan + policy + affected resources before mutation. Produce a diff of intended changes and rollback points. Where possible, run in sandbox/staging or dry-run mode first.

### 7. Evidence-First QA
Every execution emits a machine-readable Evidence Bundle: inputs, exact revisions, tool calls, logs, tests, screenshots/renders when relevant, artifact hashes, production checks, and rollback pointer. Command success is never equivalent to field-ready success.

### 8. Artifact Registry + Time Travel
Treat generated files, exports, backups, releases, and important outputs as versioned artifacts with checksum, creator, source task, retention, and relationships. Allow users to answer: “which exact file/revision produced this result?” and recover prior known-good states.

### 9. Provenance Memory
Separate durable project facts from transient conversational context. Every durable memory has source/provenance, confidence, scope, owner, timestamp, and optional TTL. Current source state overrides stale memory.

### 10. AI Gateway / Model Router
Route by task quality, Thai-language quality, privacy, latency, quota, cost, and provider health. Prefer deterministic tools, templates, cached outputs, or local compute before paid inference when appropriate. Paid APIs are fallback rather than the default path.

### 11. Outcome Workflows
Teachers/staff should normally choose outcomes (official letter, lesson plan, worksheet, PDF cleanup, PR post, assessment pack) instead of selecting models/prompts. Workflows collect structured inputs, reuse school data, invoke AI only where useful, validate, and return final artifacts.

### 12. Open Interoperability
Expose AWH capabilities through standards rather than vendor-specific coupling. MCP is the tool/data/app adapter; A2A can be supported later for agent-to-agent delegation without granting agents direct access to each other’s private memory/tools. Internal contracts remain vendor-neutral.

### 13. Observability / Flight Recorder
Instrument tasks, tool calls, worker hops, model calls, retries, policy decisions, latency, cost, and failures using trace/log/metric conventions compatible with OpenTelemetry. Provide one owner-facing timeline from intent to final artifact.

### 14. Security & Data Governance
- secret vault; never source-control credentials
- encrypted transport and authenticated workers
- per-project workspace scopes rather than global filesystem access
- PII/data classification and exfiltration guards
- configurable retention and redaction
- append-only audit for privileged actions
- tested backup/restore and disaster recovery

### 15. Self-Healing With Guardrails
AWH may automatically recover only pre-authorized low-risk conditions (restart unhealthy stateless service, reconnect worker, rotate temporary job, retry an idempotent fetch). It must stop and escalate on integrity uncertainty, repeated failure, data migration, secret issues, production divergence, or ambiguous state.

## Protocol alignment
- Target current MCP architecture rather than binding AWH to legacy session assumptions. Keep AWH application state server-side while MCP transport remains replaceable/stateless where supported.
- Treat UI/apps, tasks, routing, authorization, and tool catalogs as adapters/extensions around AWH contracts.
- Do not model AWH workspace permissions as protocol-specific “roots”; maintain an AWH-native Workspace Scope policy so protocol evolution does not force a security redesign.

## UX North Star
Owner: “Tell AWH what outcome you want; it chooses the route and shows evidence.”
Teacher: “Choose the job you need done; AWH produces the finished artifact.”

The owner dashboard should answer in one screen: Is AWH healthy? What is running? What changed? What failed? What costs money? What needs approval? Can I roll it back?

## Build order
1. MCP/Plugin adapter + read-only capability discovery
2. Workspace Scope + Worker outbound bridge + device identity
3. Universal Task + execution states + idempotency
4. Policy/Approval Engine + audit receipts
5. State Graph + evidence bundles + artifact registry
6. AI Gateway/model router + quota/cost controls
7. Outcome workflows + Thai document engine
8. OpenTelemetry-compatible flight recorder
9. Rehearsal/shadow mode + guarded self-healing
10. Optional A2A adapter after internal contracts stabilize

## Explicit non-goals now
No Kubernetes, no gratuitous microservices, no large LLM on the 2 GB VPS, no agent swarm for its own sake, no duplicated databases/business logic, no unrestricted remote shell, and no production deploy from this architecture branch.
