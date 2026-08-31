# AWH Canonical Authority Map

Status: **Normative architecture contract**

This document prevents shadow authorities as AWH expands. New Cloud, Hosting, Account, AI, Tool, Document, Automation, Worker, or deployment features must integrate with the canonical authorities below instead of creating parallel control planes.

## Core rule

**AWH/ReadyIDC is the control plane. External systems provide capabilities or compute; they do not become product authorities.**

A new feature may add bounded metadata that belongs uniquely to its domain, but it must not duplicate identity, authentication, project ownership, work scheduling, execution state, credential storage, artifact ownership, approval, or release authority.

## Canonical authority table

| Domain | Canonical authority | Allowed extension | Forbidden shadow authority |
|---|---|---|---|
| Human identity | existing Hub users / owner-auth authority | profile or membership metadata keyed by canonical `user_id` | separate Hosting/Cloud customer login database |
| Authentication / sessions | existing human auth + control session authority | bounded account-request workflow | second password/session/token authority for Hosting |
| Roles / permissions | canonical project/product capability and membership authority | domain capability rows | duplicated Hosting RBAC or UI-only authorization |
| Projects | existing `projects` + project memberships | new project type / hosting metadata keyed by `project_id` | independent hosting-site project registry acting as owner |
| Source revisions | Project source metadata + Project Vault | provider/deploy observations tied to exact revision | provider branch/head treated as source of truth |
| Project Vault | Central Project Vault | immutable external evidence referencing a Vault revision | Cloud/Hosting source store that can override Vault |
| Memory | Founding/Durable Memory authority | scoped domain memory through existing policy | Hosting notes/customer DB becoming memory authority |
| Conversations | canonical control conversations | domain-specific messages/events | separate Hosting support conversation authority |
| Tasks | `control_tasks` | new typed goal/capability | `cloud_jobs`, `hosting_jobs`, provider task queues as product authority |
| Executions | `control_task_executions` + execution envelope/leases/checkpoints | new executor/provider adapter | second execution state machine or scanner-owned queue |
| Capabilities / providers | Capability Registry | `qa.cloud`, `review.visual`, typed hosting capabilities | provider-local capability database driving product state |
| AI routing / budget | AI Governance / provider policy authority | model/provider adapters | per-feature AI policy databases |
| Credentials | `HubProviderCredentialStore` / approved credential boundary | provider-specific secret namespace | secrets in SQLite task/checkpoint rows, browser payloads, source, logs or artifacts |
| Approvals | canonical approvals authority | new typed approval action/scope | modal/local approval flag that can authorize mutations alone |
| Attachments | canonical attachment authority | new accepted MIME/use cases | ad-hoc uploaded-file store exposed by a feature |
| Artifacts / results | `control_artifacts` + `control_artifact_objects` + Artifact Store | new artifact kind | GitHub/Hosting provider artifact store as final product result authority |
| Automations | canonical Automation Registry materializing canonical tasks/conversations | new schedule/condition definitions | scheduler-owned execution queue |
| Hosting sites | **Project-backed domain projection** keyed by canonical `project_id` | site/domain/runtime metadata that cannot exist without canonical project ownership | autonomous customer/site/project identity hierarchy |
| Hosting provisioning/deploy | canonical Task → Execution → typed Hosting capability | provider operation id as observation/checkpoint only | hosting worker queue / arbitrary root-shell job DB |
| Hosting customer | canonical Hub user/member | optional customer/account profile keyed by canonical `user_id` | second user/auth authority |
| DNS/TLS/panel credentials | canonical Credential Store | scoped provider credential records | credentials in hosting tables or browser-local storage |
| Cloud QA / Visual Review | canonical Task → Execution using Cloud provider capability | GitHub workflow/run id as execution observation | GitHub Actions run treated as AWH task authority |
| Visual review findings | validated evidence attached to canonical revision/task | review/triage artifact metadata | AiPASS findings as independent issue/source-of-truth database |
| Production release | existing typed release/deployment authority + exact revision identity | provider deployment evidence | hosting/provider dashboard state alone declaring Production truth |
| Backup / recovery | canonical backup/recovery mechanisms | domain backup metadata | feature-specific destructive backup/restore authority |

## Hosting invariants

Hosting is **a capability set and project projection on the existing control plane**, not a second SaaS backend inside AWH.

1. `hosting_customer` MUST NOT become a new human identity. If domain-specific profile data is needed, it references canonical `user_id` and cannot authenticate independently.
2. A managed site MUST have one canonical AWH `project_id`. Hosting-specific metadata may describe domain, runtime, plan, provider, environment, health, and external ids, but project ownership stays in `projects` + memberships.
3. Provision, deploy, backup, restore, domain, TLS, migration, rollback, and health-remediation work MUST materialize through `control_tasks` and `control_task_executions`.
4. Hosting providers are typed capabilities/executors. Provider operation ids are checkpoint/evidence, never a second task id.
5. DNS, panel, cloud, deployment, or registrar credentials MUST use the existing credential boundary and MUST NOT be stored in Hosting SQL rows, task goals, checkpoints, browser responses, artifacts, or logs.
6. Hosting artifacts such as deployment reports, backups, audit reports, exports, and logs intended for the user MUST enter the canonical Artifact Store.
7. Destructive hosting mutations require the existing approval/release boundary appropriate to risk. A Hosting UI button is not authorization by itself.
8. Arbitrary root shell is not a product capability. Hosting operations must be typed and bounded.
9. A provider outage cannot corrupt canonical project/task state. Fail closed and preserve the last verified Production/release identity.
10. Billing/plan metadata, if later introduced, must not silently become user authorization or execution authority.

## Cloud-first invariants

1. GitHub Actions is ON_DEMAND compute only.
2. `qa.cloud` and `review.visual` remain Capability Registry entries, not new queue types.
3. Cloud work originates from canonical `control_tasks` + `control_task_executions`.
4. Exact Git revision is required and must remain identical through dispatch, checkout, evidence, artifact import, and task completion.
5. `qa.cloud` and `review.visual` route to separate workflows.
6. Workflow/run ids are observations stored in execution checkpoint metadata only.
7. Long-running remote jobs must respect canonical lease, cancellation, idempotency, and late-result rules.
8. Successful user-facing evidence must be imported into the canonical Artifact Store before AWH reports a review artifact as available.
9. GitHub credential stays in `HubProviderCredentialStore`; workflow inputs contain only non-secret bounded execution parameters.
10. Cloud failure must never mutate project source or silently report success.

## Feature review gate

Before merging a new subsystem, answer all questions below. Any **No** blocks merge until architecture is mapped back to the canonical authority.

- Does every human actor resolve to a canonical AWH `user_id`?
- Does every project/site resolve to one canonical `project_id`?
- Does every user-visible work item resolve to one `control_tasks.task_id`?
- Does every execution resolve to one `control_task_executions.execution_id`?
- Are provider/job ids observations only, not product identities?
- Are all secrets confined to the approved credential boundary?
- Do produced user-visible files land in the canonical Artifact Store?
- Do privileged mutations use canonical permissions/approval/release gates?
- Can the external provider disappear without losing AWH's canonical state?
- Can the subsystem be removed without migrating users/projects/tasks/artifacts into a new authority?

## Schema rule

Creating a domain-specific table is not automatically forbidden. It is allowed only when all of the following are true:

1. the table stores metadata unique to the domain;
2. it references canonical ids (`user_id`, `project_id`, `task_id`, `execution_id`, or artifact/provider ids as appropriate);
3. it cannot authenticate a human independently;
4. it cannot schedule/claim/complete work independently;
5. it cannot store plaintext/provider credentials;
6. it cannot declare project source or Production release truth independently;
7. deletion of the extension table does not destroy the canonical identity/work/artifact history.

## Migration numbering note

Migration filename sequence and SQLite `PRAGMA user_version` are related but are **not required to be numerically identical** in the current repository convention. Example: `015_self_sufficient_ai.sql` advances the database to `user_version = 16`. Therefore a later `016_...sql` may legitimately advance to user version 17. Review migration ordering, dependency, ledger checksum, and actual Production version rather than renaming solely to match `user_version`.

## Security note for redirects and workflow inputs

- Remote artifact downloads that follow redirects must have tests proving credentials are not forwarded cross-host. Current libcurl defaults protect `Authorization` across host changes unless unrestricted auth is enabled, but AWH should make this invariant explicit in tests and transport design.
- Workflow-dispatch inputs are not secret storage. Only bounded non-secret values such as exact revision and review profile may be passed as inputs. Secrets remain in the credential store / provider authentication boundary.

## Merge policy

Cloud-first and Managed Hosting changes must cite this document in their PR description and explicitly list:

- canonical user authority used;
- canonical project authority used;
- canonical task/execution authority used;
- credential boundary used;
- artifact authority used;
- approval/release boundary used;
- any new domain tables and why they do not duplicate authority.

If a proposed design cannot answer these fields unambiguously, it is not ready to merge.
