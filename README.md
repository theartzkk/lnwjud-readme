<p align="center">
  <img src="/logo-256x256.png" width="140" alt="Art’s Workspace Hub logo" />
</p>

# Art’s Workspace Hub (AWH)

**Your Projects. One Workspace. Anywhere.**

AWH is an Anywhere-first, Cloud-first workspace: the ReadyIDC control plane owns durable Projects, conversations, memory, tasks, approvals and capability routing so the same work can continue from iPhone, Mac, Windows or any modern browser. AWH Desktop remains an optional execution provider for work that genuinely needs a personal device; it is never required for normal Cloud work.

> Compatibility note: Art Agent is the legacy codename. Package, installer, MCP protocol, data-directory, and `ART_AGENT_*` identifiers remain temporarily for upgrade and runtime compatibility.

> Current architecture: **M13 Anywhere Execution & Capability Fabric candidate** over the canonical M12 Project Authority. ReadyIDC is the always-on control plane; OpenAI API is the native AI provider; optional Desktop/lnwjud/Codex/burst workers plug into one capability fabric. Production activation remains approval-gated until deployment, rollback and field QA pass.

## Security posture

AWH is deliberately narrow:

- one canonical workspace, not all drives;
- secret paths denied by default;
- writes opt-in with `AWH_ALLOW_WRITE=1` (legacy `ART_AGENT_ALLOW_WRITE=1` remains supported);
- execution opt-in with `AWH_ALLOW_EXEC=1` (legacy `ART_AGENT_ALLOW_EXEC=1` remains supported);
- Codex delegation separately opt-in with `AWH_ALLOW_CODEX=1` (legacy `ART_AGENT_ALLOW_CODEX=1` remains supported);
- desktop renderer is sandboxed with context isolation and no Node integration;
- persistent local settings contain only workspace/permission preferences, never API keys;
- persisted task history contains metadata only — no logs, command arguments, cwd, environment, stdin, or prompts;
- no destructive Git tools;
- no arbitrary shell or generic HTTP/network tool;
- recovery restore and task stop require explicit `userConfirmed=true`;
- historical tasks from a previous runtime cannot be stopped or queried for logs by a new runtime.

See [`docs/SECURITY.md`](docs/SECURITY.md) for the full boundary and [`docs/V04_CONTEXT_ECONOMY.md`](docs/V04_CONTEXT_ECONOMY.md) for the v0.4 context contract.

## MCP tools

| Tool | Default | Purpose |
| --- | --- | --- |
| `health` | allow | runtime health + effective permissions |
| `workspace_info` | allow | workspace + safe project profile + Git status |
| `workspace_tree` | allow | bounded project tree |
| `read_file` | allow | paged guarded UTF-8 read + digest suppression |
| `search_text` | allow | bounded recursive search with capped snippets |
| `write_file` | **disabled** | direct workspace write |
| `checkpoint_create` | allow | snapshot existing non-secret text files |
| `checkpoint_list` | allow | list recovery checkpoints without contents |
| `checkpoint_restore` | **disabled + confirm** | restore a checkpoint |
| `apply_patch` | **disabled** | exact-text patch with automatic pre-write checkpoint |
| `git_status` | allow | hardened read-only Git status |
| `git_diff` | allow | paged/path-selectable secret-filtered Git diff |
| `git_log` | allow | recent Git history |
| `project_command` | **disabled** | synchronous `test/lint/typecheck/build` |
| `project_task_start` | **disabled** | background approved project task |
| `task_status` | allow | current or persisted task metadata, without logs |
| `task_list` | allow | bounded current + persisted task metadata |
| `task_logs` | allow | bounded stdout/stderr for a current-runtime-owned task |
| `task_stop` | **disabled + confirm** | stop only a current-runtime-owned task |
| `codex_status` | allow | local Codex CLI discovery/version only |
| `codex_run` | **disabled** | sandboxed local Codex delegation with JSONL logs |
| `audit_tail` | allow | recent security/audit decisions |

## Context economy

`read_file` defaults to 200 lines per response and supports `startLine`, `maxLines`, and whole-file SHA-256 `knownDigest`. If the digest still matches, AWH returns `unchanged: true` and omits content. Omit `knownDigest` when intentionally requesting the next page.

`git_diff` applies the same bounded-page/digest pattern and can target a single safe changed path. Secret-path filtering remains the same Source of Truth as before.

`workspace_tree` defaults to 100 entries, `search_text` defaults to 25 matches, and each search snippet is capped at 500 characters around the match.

## Project and task continuity

`workspace_info` detects a small safe profile for Node.js, PHP, Python, Rust, and Go projects. For Node.js it exposes only package-manager identity and the approved script names `test`, `lint`, `typecheck`, and `build`; dependency lists and arbitrary script commands are not returned.

Task history is stored under the legacy `.art-agent` data directory as bounded metadata. Finished task IDs remain discoverable after restart. A task that was running when another runtime takes over is shown as `unknown_after_restart`; the new runtime does not gain control over that process.

Checkpoint persistence was already implemented with SHA-256 snapshot integrity, so v0.4 reuses that existing checkpoint store instead of creating a parallel database.

## Windows Control Center and installer

The AWH Desktop app provides a Thai-first local dashboard for workspace, Git, permissions, Codex availability, checkpoints, audit history, and Doctor diagnostics. Workspace and permission changes remain written to `~/.art-agent/settings.json` for compatibility and take effect after restart so permissions do not mutate silently in the middle of an agent task.

The recommended Windows path is the per-user Squirrel installer produced by CI. See [`docs/WINDOWS_INSTALL.md`](docs/WINDOWS_INSTALL.md) for UI-first installation and integrity verification.

Run the Control Center from source:

```powershell
npm run desktop
```

Create the Windows x64 installer set:

```powershell
npm run desktop:make
```

The renderer loads only local files, uses a restrictive Content Security Policy, has `nodeIntegration=false`, `contextIsolation=true`, and Chromium sandboxing enabled. The preload exposes only seven fixed AWH Desktop IPC operations instead of the raw Electron IPC surface.

## Requirements

- Windows 10/11 recommended; Ubuntu is also exercised by CI for security/runtime regressions
- Node.js 20+; Node 24 is the CI baseline
- Git for Git tools
- npm, pnpm, or yarn for project commands
- optional local Codex CLI for `codex_status` / `codex_run`

## Develop and verify from source

```powershell
npm install
npm run typecheck
npm test
npm run build
```

## Run local MCP directly

Read-only safe mode:

```powershell
node dist/index.js --workspace "D:/Projects/MyProject"
```

Enable workspace patch/write operations for a trusted session:

```powershell
$env:AWH_ALLOW_WRITE = '1'
node dist/index.js --workspace "D:/Projects/MyProject"
```

Enable approved project execution:

```powershell
$env:AWH_ALLOW_EXEC = '1'
node dist/index.js --workspace "D:/Projects/MyProject"
```

Enable local Codex delegation separately:

```powershell
$env:AWH_ALLOW_EXEC = '1'
$env:AWH_ALLOW_CODEX = '1'
node dist/index.js --workspace "D:/Projects/MyProject"
```

`codex_run` defaults to a `read-only` Codex sandbox. Its `workspace-write` mode additionally requires `AWH_ALLOW_WRITE=1` or the legacy `ART_AGENT_ALLOW_WRITE=1`. AWH forces Codex web search and workspace-write network access off, does not use a sandbox-bypass flag, sends the task prompt over stdin, and does not record that prompt in the AWH audit log. Generic `OPENAI_API_KEY` / `CODEX_API_KEY` environment variables are not forwarded to the Codex child; use the normal local Codex login/credential store if delegation is enabled.

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

The `art-agent` MCP key and server identity remain legacy compatibility identifiers during the migration.

## Workflow contract

### Patch and rollback

`apply_patch` validates every exact-text guard before any write. If all guards pass it snapshots every affected file under the legacy `.art-agent` data directory, then writes. If a write fails, AWH attempts automatic restore from that checkpoint. Manual `checkpoint_restore` is confirmation-gated.

### Managed tasks

Only approved project scripts and Codex processes launched by the current AWH runtime are controllable. Logs remain bounded in memory. Persisted task history is metadata-only, and `task_stop`/`task_logs` refuse historical tasks from another runtime.

### Codex bridge

The bridge follows the current OpenAI Codex non-interactive interface: `codex exec`, structured JSONL output, working-directory and sandbox arguments, and prompt input over stdin. The bridge is disabled by default and intentionally does not expose arbitrary Codex CLI flags to MCP callers.

## Roadmap

### v0.3 — Windows Control Center ✅
- desktop UI and workspace picker
- persistent permission toggles with restart gate
- Git/checkpoint/audit visibility
- system tray and Doctor diagnostics

### v0.3.1 — Windows installer ✅
- per-user Squirrel.Windows installer
- deterministic legacy ArtAgent Windows icon for upgrade compatibility
- installer integrity checks and CI artifacts

### v0.4 — Context economy + richer Git/project workflow ✅
- structured/paged diff and file reads
- duplicate-content suppression
- bounded search snippets and discovery defaults
- safe project detection profiles
- persistent task metadata while reusing existing checkpoint persistence
- superseded CI run cancellation

### M1.2 — Product identity migration foundation
- AWH public product identity with legacy package/installer/MCP compatibility
- `AWH_*` configuration aliases with legacy `ART_AGENT_*` fallback
- documentation and security-boundary identity alignment

Remote Connection readiness and local remote-readonly isolation exist in source, but OpenAI Secure MCP Tunnel control-plane end-to-end verification is not claimed by this repository.

Browser/Windows UI/Office/clipboard capabilities will be added individually behind separate permissions only after threat-model review.
