# TeamAI Harness Integration — AWH P0

Status: **projection-only / disabled for runtime mutation**

Base AWH source for this lane: `b49cc221f698acd28abb5a951a9ee6d0f1622e1d` on canonical `main`.

Pinned TeamAI upstream for the initial compatibility contract:

- repository: `Tencent/teamai-cli`
- package version: `0.22.0`
- exact inspected upstream SHA: `6dc1b9919ef1856717c381d6559bb7738089075e`

## Goal

Use TeamAI as an **agent knowledge/rules distribution and recall harness** without creating a second AWH control plane.

AWH remains the authority for source, Project Memory, tasks, executions, approvals, owner identity, artifacts, runtime policy, MCP registry and secrets. BAY EXCUSE X remains the Source of Truth for school identity/data.

## P0 data flow

```text
AWH canonical files
  ART_AI_WORKING_PROTOCOL.md
  AGENTS.md
  CURRENT_STATE.md
  ARCHITECTURE.md / DECISIONS.md / PROJECT.md / HANDOFF.md / TASKS.md
          |
          v
scripts/integrations/build-teamai-projection.mjs
          |
          v
ephemeral TeamAI-compatible projection
  teamai.yaml
  manifest/projects.yaml
  rules/awh/*
  docs/awh/*
  PROVENANCE.json
          |
          v
future standalone TeamAI repo / HTTP distribution canary
          |
          v
Codex / Claude / Cursor / other supported agents
```

The reverse path is deliberately not automatic. A TeamAI learning may become an **AWH learning candidate** only after provenance, duplicate and authority checks. It must never silently replace Project Memory or create a second memory authority.

## Authority matrix

| Concern | Authority | TeamAI P0 role |
| --- | --- | --- |
| Canonical source / exact revision | AWH | consume only |
| Project Memory | AWH | read-only projection |
| Task / queue / execution | AWH | none |
| Approval | AWH | none |
| Owner auth / principal | AWH | none |
| School identity/data | BAY EXCUSE X | none |
| Secrets | AWH secret management | never export |
| MCP registry | AWH | no reconciliation |
| Rules / skill distribution | AWH-authored content | projected copy |
| Recall / learnings | TeamAI candidate layer | never auto-promote |

## Safety invariants

1. No Production deployment, DB/schema change, service restart, pointer move or credential mutation belongs to P0.
2. The projection must contain no top-level `env/`, `mcp/`, `hooks/`, `agents/` or `learnings/` directory.
3. The projection carries the exact AWH source revision in `PROVENANCE.json`.
4. Project-specific resources use TeamAI project namespace `awh`; no global overwrite is allowed.
5. TeamAI runtime hook injection remains disabled until an isolated canary proves it cannot interfere with existing Codex/AWH controls.
6. Real secrets remain outside TeamAI `env.yaml` and outside Git.
7. TeamAI failure must degrade to “no harness enrichment”; it must not stop AWH tasks, queue, UI or production runtime.

## P0 implementation

- `config/teamai-harness-policy.json` is the machine-readable boundary.
- `scripts/integrations/build-teamai-projection.mjs` produces a disposable TeamAI-compatible team-repo projection from canonical AWH files.
- `scripts/qa/teamai-harness-preflight.mjs` verifies provenance, authority boundaries and forbidden output.
- `test/teamai-harness-integration.test.ts` keeps this contract inside normal AWH regression.

Run:

```bash
npm run qa:teamai
```

For a manual projection:

```bash
node scripts/integrations/build-teamai-projection.mjs \
  --out /tmp/awh-teamai-projection \
  --source-revision <exact-40-char-AWH-SHA>
```

## P1 canary gate

P1 may start only after P0 QA is green and the live AWH source/runtime is re-read. P1 should use a **standalone TeamAI repository or read-only HTTP distribution**, not TeamAI single-repo mode inside the business repository.

Canary acceptance:

- one isolated Codex workspace only;
- `teamai --dry-run pull`/equivalent produces expected AWH rules/docs;
- no AWH, Codex or MCP configuration outside the canary is changed;
- no secret appears in projection, logs or generated agent config;
- recall returns the correct AWH project-scoped knowledge;
- disabling/removing TeamAI returns the agent to its pre-canary state;
- AWH source/task/execution/approval/memory authorities remain unchanged.

Only after that proof should automatic session-start synchronization be considered.

## Rollback

P0 has no Production runtime state. Rollback is simply removal of this integration branch/files. Generated projections are disposable and must not be treated as an AWH source authority.
