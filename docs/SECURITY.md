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

Automatic text search skips the same secret paths. Git status suppresses secret-path entries and Git diff only runs against non-secret changed paths. Git diff also disables external diff and text-conversion drivers.

## Path boundary

Existing read targets are canonicalized with `realpath` before access. Existing write targets are also canonicalized before overwrite. New write targets are checked against the canonical workspace and the nearest existing parent is canonicalized to prevent traversal and symlink/junction escapes.

Fixed project metadata such as `package.json` is read through the same workspace guard rather than by an unchecked filesystem path.

## Executable resolution and project commands

Art Agent resolves executable names from `PATH` itself and launches the resulting absolute path, rather than allowing the workspace directory to win executable lookup.

`project_command` only accepts one of `test`, `lint`, `typecheck`, or `build`. The package manager is selected from a fixed set (`npm`, `pnpm`, `yarn`) and no free-form command string is accepted from the MCP caller.

On Windows, npm/pnpm/yarn are commonly `.cmd` shims. Art Agent therefore uses the system `cmd.exe` only as an internal fixed launcher for the resolved package-manager shim. The package-manager name and script name are not arbitrary user strings. No general `cmd`, PowerShell, or shell MCP tool is exposed.

Package scripts themselves are executable project code and inherit the Art Agent process environment. For that reason execution is opt-in and remote transport is not enabled in the MVP.

## Git hardening

Read-only Git operations disable the pager, filesystem monitor, submodule recursion, external diff, and textconv where applicable. Secret paths are removed before diff content is requested.

## Audit

Security-sensitive reads, writes, and command executions are recorded as bounded JSONL audit entries under the user data directory (default `~/.art-agent/audit.jsonl`). Art Agent does not intentionally log file contents or environment secrets.

## Verification

CI runs on both Windows and Ubuntu. Windows verifies the primary target platform and approved package-script launcher; Ubuntu ensures symlink-escape regression tests actually execute instead of being skipped by Windows symlink privilege restrictions.

## Remote access gate

Do not expose Art Agent through a Secure MCP Tunnel until the local test suite and a separate threat-model review pass. Remote transport is intentionally outside the v0.1.0 MVP.
