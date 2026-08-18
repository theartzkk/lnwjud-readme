<p align="center">
  <img src="/logo-256x256.png" width="140" alt="Art Agent logo" />
</p>

# Art Agent

**Safe-by-default local Windows MCP development agent for ChatGPT and Codex.**

Art Agent turns a selected local project folder into a tightly scoped MCP workspace. The goal is to let an AI inspect the current source of truth, review Git state, search and edit project files, run approved verification commands, and keep an audit trail — without exposing the whole Windows machine by default.

> Status: **v0.1.0 MVP**. Local stdio MCP is implemented. Remote Secure MCP Tunnel, Windows UI automation, browser control, Office integration, and arbitrary shell access are intentionally not enabled yet.

## Why Art Agent exists

The original repository contained a detailed concept/README for a Windows-first MCP gateway but not the implementation source. Art Agent is a new implementation built around a stricter security model:

- workspace-scoped instead of all-drives access;
- secrets denied by default;
- writes opt-in;
- execution opt-in and limited to named project scripts;
- no destructive Git tools;
- no arbitrary shell or network exfiltration surface in the MVP.

## Implemented MCP tools

| Tool | Default | Purpose |
| --- | --- | --- |
| `health` | allow | runtime health + effective permissions |
| `workspace_info` | allow | workspace + Git status |
| `workspace_tree` | allow | bounded project tree |
| `read_file` | allow | UTF-8 reads inside workspace |
| `search_text` | allow | recursive bounded text search |
| `write_file` | **disabled** | workspace write when explicitly enabled |
| `git_status` | allow | read-only Git status with secret paths suppressed |
| `git_diff` | allow | read-only Git diff for non-secret paths |
| `git_log` | allow | recent Git history |
| `project_command` | **disabled** | `test`, `lint`, `typecheck`, `build` only |
| `audit_tail` | allow | recent security/audit decisions |

## Requirements

- Windows 10/11 recommended (the core is cross-platform for CI/testing)
- Node.js 20+; Node 24 LTS recommended
- Git for Git tools
- npm, pnpm, or yarn for `project_command`

The MCP implementation uses the official `@modelcontextprotocol/server` v2 package.

## Install

```powershell
npm install
npm run build
```

## Run locally

Read-only safe mode:

```powershell
node dist/index.js --workspace "D:/Projects/MyProject"
```

Development mode:

```powershell
npm run dev -- --workspace "D:/Projects/MyProject"
```

Enable workspace writes for a trusted session:

```powershell
$env:ART_AGENT_ALLOW_WRITE = '1'
node dist/index.js --workspace "D:/Projects/MyProject"
```

Enable approved verification commands too:

```powershell
$env:ART_AGENT_ALLOW_WRITE = '1'
$env:ART_AGENT_ALLOW_EXEC = '1'
node dist/index.js --workspace "D:/Projects/MyProject"
```

## Local MCP configuration example

Use the built JS entrypoint from an MCP-capable client:

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

## Security

See [`docs/SECURITY.md`](docs/SECURITY.md). Secret files, traversal, symlink escapes, automatic search, and Git diff/status are guarded. Remote tunneling will only be added after local security and regression tests are expanded.

## Verification

```powershell
npm run typecheck
npm test
npm run build
```

## Roadmap

### v0.2 — Project workflow
- patch/checkpoint primitive
- richer project detection
- bounded process logs
- structured Git diff/status
- content-economy/duplicate suppression

### v0.3 — Windows Control Center
- desktop UI
- workspace picker
- permission controls
- live audit/log viewer
- system tray
- Doctor diagnostics

### v0.4 — Local Codex bridge
- discover Codex CLI without reading credentials
- delegate tasks
- poll logs/status
- require final Git diff + verification before completion

### v0.5 — Remote connection
- OpenAI Secure MCP Tunnel integration
- outbound-only tunnel lifecycle
- explicit remote permission profile
- remote-safe secrets policy
- connection/session audit

### Later capabilities
Browser/Windows UI/Office/clipboard capabilities will be added individually behind separate permissions after threat-model review. They will not silently inherit full machine access.
