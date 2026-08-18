# Art Agent security model

Art Agent is designed to be **safe by default**. The initial implementation deliberately exposes fewer capabilities than the README-only prototype it replaces.

## Defaults

- One explicitly selected workspace only.
- Reads are allowed only inside the canonical workspace root.
- Writes are disabled unless `ART_AGENT_ALLOW_WRITE=1`.
- Executable project commands are disabled unless `ART_AGENT_ALLOW_EXEC=1`.
- No arbitrary shell tool is exposed.
- No HTTP fetch/upload tool is exposed in v0.1.0.
- No Windows UI, clipboard, Office, child MCP, or browser-control capability is exposed in v0.1.0.
- Destructive Git operations are not exposed.

## Secret deny policy

The following are blocked even when writes are enabled:

- `.env`, `.env.*`
- `*.pem`, `*.key`, `*.p12`, `*.pfx`
- `id_rsa`, `id_ed25519`
- `.ssh/**`, `.aws/**`, `.gnupg/**`
- `credentials.json`, `service-account.json`

Automatic text search skips the same secret paths. Git status suppresses secret-path entries and Git diff only runs against non-secret changed paths.

## Path boundary

Existing read targets are canonicalized with `realpath` before access. Existing write targets are also canonicalized before overwrite. New write targets are checked against the canonical workspace and the nearest existing parent is canonicalized to prevent traversal and symlink/junction escapes.

## Execution

`project_command` only accepts one of `test`, `lint`, `typecheck`, or `build`, discovers the matching package script, and launches the package manager with `shell: false`. It is not a general shell.

Execution is still powerful: package scripts can run arbitrary project code and inherit the process environment. For that reason execution is opt-in and remote transport is not enabled in the MVP.

## Audit

Security-sensitive reads, writes, and command executions are recorded as bounded JSONL audit entries under the user data directory (default `~/.art-agent/audit.jsonl`). Art Agent does not intentionally log file contents or environment secrets.

## Remote access gate

Do not expose Art Agent through a Secure MCP Tunnel until the local test suite and a separate threat-model review pass. Remote transport is intentionally outside the v0.1.0 MVP.
