<p align="center">
  <img src="/logo-256x256.png" width="140" alt="Art Agent logo" />
</p>

# Art Agent

**Safe-by-default local Windows MCP development agent for ChatGPT and Codex.**

Art Agent turns one selected local project folder into a tightly scoped MCP workspace so an AI can inspect the current source of truth, review Git state, patch files with recovery checkpoints, run approved verification tasks, inspect bounded process logs, and optionally delegate to a local Codex CLI.

> Status: **v0.3.0 Control Center MVP**. Local stdio MCP plus a sandboxed Electron Control Center are implemented. Remote Secure MCP Tunnel, browser control, Office integration, clipboard access, and arbitrary shell access remain intentionally disabled.

## Security posture

Art Agent is deliberately narrower than the README-only prototype it replaced:

- one canonical workspace, not all drives;
- secret paths denied by default;
- writes opt-in with `ART_AGENT_ALLOW_WRITE=1`;
- execution opt-in with `ART_AGENT_ALLOW_EXEC=1`;
- Codex delegation separately opt-in with `ART_AGENT_ALLOW_CODEX=1`;
- desktop renderer is sandboxed with context isolation and no Node integration;
- persistent local settings contain only workspace/permission preferences, never API keys;
- no destructive Git tools;
- no arbitrary shell or generic HTTP/network tool;
- recovery restore and task stop require explicit `userConfirmed=true`.

See [`docs/SECURITY.md`](docs/SECURITY.md) for the full boundary.

## MCP tools

| Tool | Default | Purpose |
| --- | --- | --- |
| `health` | allow | runtime health + effective permissions |
| `workspace_info` | allow | workspace + Git status |
| `workspace_tree` | allow | bounded project tree |
| `read_file` | allow | guarded UTF-8 file read |
| `search_text` | allow | bounded recursive text search |
| `write_file` | **disabled** | direct workspace write |
| `checkpoint_create` | allow | snapshot existing non-secret text files |
| `checkpoint_list` | allow | list recovery checkpoints without contents |
| `checkpoint_restore` | **disabled + confirm** | restore a checkpoint |
| `apply_patch` | **disabled** | exact-text patch with automatic pre-write checkpoint |
| `git_status` | allow | hardened read-only Git status |
| `git_diff` | allow | hardened read-only Git diff |
| `git_log` | allow | recent Git history |
| `project_command` | **disabled** | synchronous `test/lint/typecheck/build` |
| `project_task_start` | **disabled** | background approved project task |
| `task_status` | allow | status for an Art Agent-owned task |
| `task_logs` | allow | bounded stdout/stderr for an owned task |
| `task_stop` | **disabled + confirm** | stop only an Art Agent-owned task |
| `codex_status` | allow | local Codex CLI discovery/version only |
| `codex_run` | **disabled** | sandboxed local Codex delegation with JSONL logs |
| `audit_tail` | allow | recent security/audit decisions |

## Windows Control Center

The v0.3 desktop app provides a Thai-first local dashboard for workspace, Git, permissions, Codex availability, checkpoints, audit history, and Doctor diagnostics. Workspace and permission changes are written to `~/.art-agent/settings.json` and take effect after restart so permissions do not mutate silently in the middle of an agent task.

```powershell
npm run desktop
```

To package the Windows x64 desktop application:

```powershell
npm run desktop:package
```

The renderer loads only local files, uses a restrictive Content Security Policy, has `nodeIntegration=false`, `contextIsolation=true`, and Chromium sandboxing enabled. The preload exposes only fixed Art Agent IPC operations instead of the raw Electron IPC surface.

## Requirements

- Windows 10/11 recommended; Ubuntu is also exercised by CI for security regressions
- Node.js 20+; Node 24 recommended
- Git for Git tools
- npm, pnpm, or yarn for project commands
- optional local Codex CLI for `codex_status` / `codex_run`

## Install and verify

```powershell
npm install
npm run typecheck
npm test
npm run build
```

## Run locally

Read-only safe mode:

```powershell
node dist/index.js --workspace "D:/Projects/MyProject"
```

Enable workspace patch/write operations for a trusted session:

```powershell
$env:ART_AGENT_ALLOW_WRITE = '1'
node dist/index.js --workspace "D:/Projects/MyProject"
```

Enable approved project execution:

```powershell
$env:ART_AGENT_ALLOW_EXEC = '1'
node dist/index.js --workspace "D:/Projects/MyProject"
```

Enable local Codex delegation separately:

```powershell
$env:ART_AGENT_ALLOW_EXEC = '1'
$env:ART_AGENT_ALLOW_CODEX = '1'
node dist/index.js --workspace "D:/Projects/MyProject"
```

`codex_run` defaults to a `read-only` Codex sandbox. Its `workspace-write` mode additionally requires `ART_AGENT_ALLOW_WRITE=1`. Art Agent forces Codex web search and workspace-write network access off, does not use a sandbox-bypass flag, sends the task prompt over stdin, and does not record that prompt in the Art Agent audit log. Generic `OPENAI_API_KEY` / `CODEX_API_KEY` environment variables are not forwarded to the Codex child; use the normal local Codex login/credential store if delegation is enabled.

## Local MCP configuration

```json
{
  "mcpServers": {
    "art-agent": {
      "command": "node",
      "args": [
        "D:/Tools/art-agent/dist/index.js",
        "--workspace",
        "D:/Projects/MyProject"
      ]
    }
  }
}
```

Do **not** put API keys in this configuration.

## v0.2 workflow contract

### Patch and rollback

`apply_patch` validates every exact-text guard before any write. If all guards pass it snapshots every affected file under the Art Agent data directory, then writes. If a write fails, Art Agent attempts automatic restore from that checkpoint. Manual `checkpoint_restore` is confirmation-gated.

### Managed tasks

Only approved project scripts and Codex processes launched by Art Agent receive task IDs. Logs are bounded in memory, and `task_stop` can target only a task known to the current Art Agent runtime.

### Codex bridge

The bridge follows the current OpenAI Codex non-interactive interface: `codex exec`, structured JSONL output, working-directory and sandbox arguments, and prompt input over stdin. The bridge is disabled by default and intentionally does not expose arbitrary Codex CLI flags to MCP callers.

## Roadmap

### v0.3 — Windows Control Center ✅
- desktop UI and workspace picker
- persistent permission toggles with restart gate
- Git/checkpoint/audit visibility
- system tray
- Doctor diagnostics
- Windows packaging gate in CI

### v0.4 — Context economy + richer Git/project workflow
- structured/paged diff and file reads
- duplicate-content suppression
- project detection profiles
- persistent task/checkpoint metadata

### v0.5 — Remote connection
- OpenAI Secure MCP Tunnel integration
- outbound-only tunnel lifecycle
- explicit remote permission profile
- remote-safe secrets policy
- connection/session audit

Browser/Windows UI/Office/clipboard capabilities will be added individually behind separate permissions only after threat-model review.
