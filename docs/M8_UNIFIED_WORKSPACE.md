# M8 Unified Workspace Contract

M8 is an additive v7-to-v8 Hub release. It projects the existing M4 task,
result, artifact and approval authorities and the M6/M7 Work/continuity
authorities into one durable owner-facing workspace. It never imports source
trees, filesystem paths, device credentials, cookies, private keys or secrets.

## Canonical boundaries

- `projects` and membership tables remain the Project Registry authority.
- `control_conversations` and `control_conversation_messages` are the durable
  Work thread and ordered message authority. M8 adds title/archive/origin and
  supports more than one thread per Project.
- `control_tasks`, events, artifacts and approvals remain task lifecycle
  authorities. Work renders their ordered human-readable projection; it does
  not parse arbitrary worker files to invent a final answer.
- `control_workspace_checkpoints` and `control_workspace_leases` remain the
  M7 continuation authority.
- `control_project_device_bindings` describes a device's safe ability to
  restore a portable Project, without receiving its path.
- `control_project_contexts` stores bounded structured current-view context.
- `control_product_settings` is validated configuration with revision history,
  not raw HTML/CSS injection.

## Browser contract

Authenticated browser routes use the existing secure session and same-origin
CSRF boundary. The M8 routes are intentionally narrow:

- list/create/update a Project's Work threads;
- submit one idempotent message to a named thread;
- retrieve a project-bound current context;
- read/update validated product configuration;
- export logical registry/thread/configuration metadata with an explicit
  no-secrets/no-local-paths/no-source-files marker.

The existing project-keyed conversation route remains as a compatibility view
for already-packaged Desktop clients. It returns the most recently active
thread; it does not create an independent desktop conversation store.

## Worker contract

The existing M3E device credential remains the only worker credential. A
worker publishes a project registration or binding only after its local
portable manifest has been validated. The payload carries the canonical ID,
safe display metadata and bounded capabilities—not a local path. If an older
Hub cannot accept the M8 binding contract, the claimed task moves safely back
to `WAITING_FOR_WORKER`; it is not executed against an unproven authority.

## MCP / external-client readiness

The canonical Hub routes above are the service boundary an eventual remote MCP
adapter must call for project/context/Work/task/result/approval operations.
That adapter still requires a separately deployed remote MCP endpoint plus
standards-compliant delegated OAuth authorization and server-enforced scopes.
The legacy local `remote-readonly` tunnel is deliberately not treated as this
adapter. It remains read-only and local-workspace bound.

No external client may use an owner password, browser session, device token or
raw worker command as an integration credential or action authority.
