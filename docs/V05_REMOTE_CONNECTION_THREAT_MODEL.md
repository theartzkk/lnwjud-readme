# Art Agent v0.5 — Remote Connection Threat Model

## Decision

Art Agent will use OpenAI Secure MCP Tunnel for private remote connectivity. It will **not** expose a new public HTTP MCP listener or open inbound firewall ports.

The existing `serveStdio()` MCP factory remains the Source of Truth. The tunnel is transport only.

## Required architecture

1. `ArtAgent.exe --mcp-stdio` must start the same guarded MCP server used by `dist/index.js`, without starting the Electron Control Center UI.
2. OpenAI `tunnel-client` runs inside the same local trust boundary and launches the packaged stdio mode.
3. `tunnel-client` initiates outbound HTTPS to OpenAI and forwards MCP JSON-RPC locally over stdio.
4. The Electron renderer never gets network access. Its CSP remains `connect-src 'none'`; tunnel lifecycle belongs in the main process or an owned child process.
5. No parallel filesystem, Git, checkpoint, task, or MCP engine is introduced.

## Security gates before tunnel launch is implemented

### Remote tool surface

The first remote profile must expose a narrow read-only allowlist rather than inheriting the local permission profile. Initial target tools:

- `health`
- `workspace_info`
- `workspace_tree`
- `read_file`
- `search_text`
- `git_status`
- `git_diff`
- `git_log`

Write, patch, checkpoint restore/create, project execution, task control/logs, Codex delegation/status, and audit-history tools stay absent from the first remote tool scan.

A later release may add remote write actions only behind a separate remote permission profile, explicit confirmation policy, and regression tests. Local `allowWrite`, `allowExec`, and `allowCodex` settings must never automatically widen remote permissions.

### Credentials

- Do not store runtime or admin API keys in `settings.json`, audit logs, task metadata, command arguments, or Git-tracked files.
- Runtime tunnel operation uses a restricted runtime key with the minimum tunnel permissions required by OpenAI.
- Admin credentials for tunnel CRUD are outside Art Agent's long-lived runtime path.
- The first implementation may consume a runtime key through the environment or a secret reference supported by `tunnel-client`; persistent secret UX requires a separate OS-credential-storage review.
- Logs and UI must report key presence/readiness only, never key values.

### Process ownership

- Art Agent may manage only a `tunnel-client` process that it launched in the current runtime.
- Stop/restart operations target only that owned process tree.
- No arbitrary executable, shell, free-form arguments, or generic proxy surface is exposed to the renderer or MCP callers.
- Tunnel process state persisted across restart is metadata only; a new runtime must not assume ownership of an old process.

### Network boundary

- No inbound listener is required for the private MCP path.
- The expected external path is outbound HTTPS from `tunnel-client` to OpenAI.
- Local health/admin endpoints from `tunnel-client` must bind to loopback only if Art Agent consumes them.
- Art Agent does not weaken the Electron renderer CSP or add generic HTTP fetch capability.

### Workspace boundary

Remote access remains scoped to the same single canonical workspace and existing secret-path deny policy. The tunnel must not add drive enumeration, unrestricted filesystem access, destructive Git, arbitrary shell, browser, clipboard, Office, or generic network tools.

## Release sequence

### Phase 1 — packaged stdio foundation
- shared stdio runtime module
- `ArtAgent.exe --mcp-stdio` dispatcher
- Node-level MCP initialize regression test
- packaged Windows MCP initialize smoke test before any tunnel feature is considered ready

### Phase 2 — remote read-only server profile
- explicit remote connection mode
- registration-time read-only tool allowlist
- tests proving local permissions cannot widen remote tools
- stable tool metadata for ChatGPT tool scanning

### Phase 3 — tunnel-client readiness and lifecycle
- resolve an approved `tunnel-client` binary without shell lookup from the workspace
- version/doctor/readiness diagnostics
- non-secret tunnel ID/profile settings
- runtime key presence only; no key persistence
- owned start/stop lifecycle and bounded/redacted logs

### Phase 4 — Control Center UX
- Remote Connection section with Disabled / Not Ready / Ready / Connected states
- Doctor output explains binary, tunnel ID, runtime-key presence, downstream MCP readiness, and tunnel readiness separately
- no secret value is rendered or persisted
- connection changes require explicit user action and safe rollback

## Release gate

v0.5 cannot be called remote-ready until the packaged Windows executable is exercised through the actual stdio entrypoint, the remote tool allowlist is proven narrower than local mode, and tunnel readiness is verified without creating public ingress.
