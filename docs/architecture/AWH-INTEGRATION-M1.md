# AWH Integration M1 — ChatGPT/MCP Convergence Foundation

Status: additive feature-branch foundation on `awh/mcp-plugin-gateway`. No production deploy, schema migration, or production mutation is authorized by this milestone.

## Objective

Connect ChatGPT/Plugin/MCP and future AI clients to AWH without creating a parallel AWH. The integration layer must reuse existing authorities, expose read-only capabilities first, fail closed on mutation, and preserve the production branch as the deployment source of truth until convergence is explicitly verified.

## Audit result: reuse before build

The repository already contains most of the hard primitives required by the world-class North Star. M1 therefore converges them rather than rebuilding them.

| Need | Existing authority / primitive | M1 decision |
| --- | --- | --- |
| MCP server | `src/server.ts` | Reuse. Existing `remote-readonly` profile remains the first external surface. |
| OpenAI tunnel bridge | `src/tunnel.ts` | Reuse. It validates the OpenAI tunnel client and strips write/exec/Codex/API-key environment state for remote mode. |
| Device identity | `src/device-identity.ts`, enrollment flow | Reuse. Do not create Plugin-specific device identities. |
| Worker connectivity | `src/control-plane-worker-client.ts`, `src/control-plane-worker-runtime.ts` | Reuse. Workers remain outbound clients of AWH. |
| Worker tool discovery | `src/worker-capability-discovery.ts` | Reuse as inventory only; discovery never grants execution. |
| Capability/provider routing | `hub/src/HubCapabilityRegistryService.php` + M13 tables | Canonical authority. M1 explicitly forbids a second provider-scoring engine. |
| Durable execution | `hub/src/HubDurableExecutionService.php` + existing control tasks | Canonical task/execution authority. Integration Intent is only an adapter input. |
| Artifacts | `hub/src/HubArtifactStore.php` | Reuse; Evidence Bundle stores references, not duplicate artifact bytes. |
| Memory | existing project/founding memory services | Reuse; integration provenance points at source truth. |
| Provider cost/usage | M14 cost-aware AI + provider pricing services | Reuse when AI Gateway is connected. |
| Audit | existing local and Hub audit facilities | Reuse; privileged integrations must emit durable audit references. |

This audit changes the implementation strategy: AWH does **not** need a second MCP core, task queue, capability registry, worker scheduler, auth database, artifact store, or memory database.

## Added in M1

### 1. Integration contracts

`src/integration/contracts.ts` defines vendor-neutral adapter contracts for:

- Integration Intent
- AWH-native Workspace Scope
- capability demands
- policy actions and decisions
- provenance observations
- Evidence Bundle references
- authoritative route requests/results

These contracts deliberately point into existing AWH authorities rather than taking ownership of persistence or execution.

### 2. Fail-closed boundary policy

`src/integration/policy.ts` provides a deterministic pre-authority guard:

- unauthenticated requests denied
- project operations require AWH Workspace Scope
- required read/write/execute permission checked before delegation
- raw unrestricted shell denied even to owner integrations
- restricted-data external transfer denied
- production mutation escalates to `privileged`
- high/critical or destructive actions require privilege
- privileged actions require owner/admin, an ephemeral grant, and approval
- break-glass requires owner + explicit break-glass grant + approval
- safe preview/staging mutations still require an ephemeral grant

This is defense in depth. Existing AWH RBAC/approval remains authoritative.

### 3. One Plugin/MCP capability catalog

`src/integration/plugin-catalog.ts` describes the external surface and prevents accidental privilege expansion.

M1 defaults ON only the already-existing read-only MCP tools:

- health
- workspace info/tree/search
- bounded file read
- Git status/diff/log

Known Hub reads are cataloged as `adapter-required` until the authenticated Hub-to-MCP adapter is implemented. Known mutation tools are cataloged but hard-disabled by default.

### 4. Authoritative routing adapter

`src/integration/routing.ts` does **not** choose a provider. It builds and validates a request for `HubCapabilityRegistryService`, keeping provider availability/cost/quality routing in one authority.

### 5. Machine-readable integration policy

`config/awh-integration-contract.json` records security defaults, authority ownership, read-only exposure, disabled mutations, routing invariants, evidence requirements, and convergence constraints.

## ChatGPT path after M1

Current safe path:

```text
ChatGPT / Plugin
      |
      v
OpenAI MCP tunnel / remote MCP
      |
      v
AWH packaged MCP (`remote-readonly`)
      |
      +--> scoped workspace read / Git read
      |
      +--> audit
```

Next additive path (M2):

```text
ChatGPT / Plugin
      |
      v
AWH Integration adapter
      |
      +--> existing MCP read tools
      +--> authenticated Hub read routes
                |
                +--> Projects / Devices / Builds / Releases / Capability status
```

No OpenAI API key is required inside AWH for the owner-driven ChatGPT-to-MCP path. This does not turn a ChatGPT subscription into an inference backend for other AWH users; staff AI remains a separate AI Gateway concern.

## World-class convergence sequence

1. **M1 — safe contracts/catalog/policy**: this milestone.
2. **M2 — authenticated Hub read adapter**: expose central AWH status through MCP without duplicating auth or data stores.
3. **M3 — Intent → existing control task adapter**: compile user outcome into the canonical task authority; no new queue.
4. **M4 — Evidence projection**: bind execution, artifact, audit, exact revision and field verification into one Evidence Bundle.
5. **M5 — privileged action bridge**: only after current production branch is synchronized; use approval + ephemeral grants + idempotency + backup/rollback.
6. **M6 — State Graph / Digital Twin projection**: build from authoritative observations, never cached conversation guesses.
7. **M7 — AI Gateway convergence**: deterministic/free/local first, metered providers only by policy.
8. **M8 — Outcome workflows + Thai Document Engine**.
9. **M9 — OpenTelemetry-compatible flight recorder, rehearsal and guarded self-healing**.
10. **A2A later**: adapter only after internal contracts are stable.

## Merge and parallel-work safety

This branch must not modify production state. Before convergence with the active AWH production work:

1. fetch the actual current production branch/HEAD;
2. compare common ancestor and changed paths;
3. identify overlapping shared-core edits;
4. prefer the newer production authority if semantics conflict;
5. rebase/cherry-pick only the isolated integration changes that still apply;
6. run Windows + Ubuntu CI on the exact candidate SHA;
7. run real runtime/Plugin read-only verification;
8. only then consider enabling Hub adapters;
9. privileged write/deploy actions remain disabled until separately approved and rollback-proven.

## M1 success criteria

- TypeScript source typechecks under repository CI.
- Existing tests remain green.
- Integration policy tests cover read allow, raw-shell denial, production mutation approval, safe scoped mutation, restricted-data exfiltration denial, and authoritative routing drift.
- Default external catalog contains no enabled mutation tool.
- No schema migration is added.
- No deploy config is changed.
- No production action is executed.
- No duplicate task/capability/auth/artifact/memory authority is introduced.

## Next implementation target

M2 should implement the smallest authenticated **Hub Read Adapter** needed by the Plugin/MCP surface, beginning with status/projects/devices/builds/releases. It must reuse current Hub authentication and route contracts, add bounded responses and audit, and remain read-only. Do not widen to task execution or deployment until the production branch has converged and the approval/evidence path is field-tested.
