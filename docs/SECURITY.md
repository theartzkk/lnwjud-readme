# Art Agent security model

Art Agent is designed to be **safe by default**. v0.2 adds recovery checkpoints, managed process logs, and an optional Codex bridge without widening the default machine boundary.

## Defaults

- One explicitly selected canonical workspace only.
- Reads are allowed only inside that workspace root.
- Writes are disabled unless `ART_AGENT_ALLOW_WRITE=1`.
- Approved project execution is disabled unless `ART_AGENT_ALLOW_EXEC=1`.
- Local Codex delegation is separately disabled unless `ART_AGENT_ALLOW_CODEX=1` and execution is also enabled.
- No arbitrary shell tool is exposed.
- No generic HTTP fetch/upload tool is exposed.
- No Windows UI, clipboard, Office, child MCP, or browser-control capability is exposed.
- Destructive Git operations are not exposed.

## Secret deny policy

The following are blocked by Art Agent file/search/patch/checkpoint/Git surfaces even when writes are enabled:

- `.env`, `.env.*`
- `*.pem`, `*.key`, `*.p12`, `*.pfx`
- `id_rsa`, `id_ed25519`
- `.ssh/**`, `.aws/**`, `.gnupg/**`
- `credentials.json`, `service-account.json`

Automatic text search skips the same secret paths. Git status suppresses secret-path entries and Git diff only requests content for non-secret changed paths. Git diff also disables external diff and text-conversion drivers.

## Path boundary

Existing read targets are canonicalized with `realpath` before access. Existing write targets are also canonicalized before overwrite. New write targets are checked against the canonical workspace and the nearest existing parent is canonicalized to prevent traversal and symlink/junction escapes.

Fixed project metadata such as `package.json` is read through the same workspace guard rather than by an unchecked filesystem path.

## Patch and checkpoint boundary

`apply_patch` accepts bounded exact-text replacement operations only. Every guard must match exactly once before any workspace write begins. Art Agent then creates a checkpoint of all affected existing files. A mid-write failure triggers an attempted automatic restore.

Checkpoint manifests live under the Art Agent data directory, include SHA-256 integrity data, and do not appear in normal workspace search. Restore re-applies the normal workspace/secret/symlink guards. Manual restore requires writes enabled plus explicit `userConfirmed=true`.

v0.2 checkpoints intentionally snapshot existing text files only; they do not implement delete-based rollback for newly created files.

## Executable resolution and approved project commands

Art Agent resolves executable names from `PATH` itself and launches the resulting absolute path, rather than allowing the workspace directory to win executable lookup.

Project execution only accepts `test`, `lint`, `typecheck`, or `build`. The package manager is selected from a fixed set (`npm`, `pnpm`, `yarn`) and no free-form command string is accepted from the MCP caller.

On Windows, npm/pnpm/yarn are commonly `.cmd` shims. Art Agent does **not** pass those shims to a general command shell. It resolves a known JavaScript CLI layout next to the package-manager shim and invokes that CLI with the current `node.exe`. If no recognized safe launcher is found, the operation fails closed.

Package scripts are executable project code and inherit the Art Agent process environment, so this capability remains opt-in.

## Managed task boundary

Background task tools operate only on processes launched by the current Art Agent runtime. Each receives an opaque task ID and bounded stdout/stderr. Unknown task IDs are rejected. Stop is confirmation-gated and targets the owned process tree (Windows `taskkill /T` by owned PID; Unix process group termination).

## Codex bridge boundary

`codex_status` only resolves the local Codex executable and asks for its version. It does not inspect Codex credentials.

`codex_run` requires both `ART_AGENT_ALLOW_EXEC=1` and `ART_AGENT_ALLOW_CODEX=1`. `workspace-write` additionally requires `ART_AGENT_ALLOW_WRITE=1`. The caller may choose only `read-only` or `workspace-write`; arbitrary Codex flags are not exposed.

The bridge uses Codex non-interactive exec with structured JSONL, prompt input over stdin, an explicit working directory and sandbox, ephemeral mode, web search disabled, workspace-write network access disabled, and no sandbox-bypass flag. Generic `OPENAI_API_KEY` and `CODEX_API_KEY` environment variables are not forwarded to the Codex child. The prompt is deliberately omitted from Art Agent audit entries.

Important: once Codex is explicitly enabled, Codex itself operates within its sandbox and workspace. Art Agent's per-file secret deny policy is not a substitute for the Codex sandbox. Keep credentials outside project workspaces and enable delegation only for trusted projects.

## Git hardening

Read-only Git operations disable the pager, filesystem monitor, submodule recursion, external diff, and textconv where applicable. Secret paths are removed before diff content is requested.

## Audit

Security-sensitive reads, writes, patches, restores, task starts/stops, and Codex delegation decisions are recorded as bounded JSONL audit entries under the user data directory (default `~/.art-agent/audit.jsonl`). Art Agent does not intentionally log file contents, environment secrets, or Codex task prompts.

## Verification

CI runs on Windows and Ubuntu. Windows covers the primary deployment platform and package/task behavior; Ubuntu ensures symlink-escape tests execute even when Windows symlink creation is privilege-restricted.

## Remote access gate

Do not expose Art Agent through a Secure MCP Tunnel yet. Remote transport remains gated behind a separate threat-model phase after the local workflow and control-center layers stabilize.
