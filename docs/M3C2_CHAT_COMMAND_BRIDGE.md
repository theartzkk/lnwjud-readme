# M3C2 — Chat Command Bridge

## Goal

Make the normal user flow:

`Art types a goal in ChatGPT -> ChatGPT changes or selects an exact Git revision -> AWH executes approved work -> AWH reports verified results -> ChatGPT summarizes the result.`

The user must not need GitHub Actions, SSH, Terminal, FTP, manual patch upload, or a second AI provider for routine build/test/deploy work.

## Product constraint

AWH must work with the user's current ChatGPT plan. Full custom MCP write/modify actions are not assumed to be available. The execution engine therefore cannot depend on a direct ChatGPT -> private MCP write path.

This is a transport constraint only. It must not change the AWH execution/safety model.

## Architecture decision

Use one AWH Command Bus with replaceable transport adapters.

### Adapter A — GitHub Command Bridge (current compatibility path)

GitHub is already a project Source of Truth and ChatGPT can use the connected GitHub app. GitHub Actions are not used.

1. ChatGPT inspects the authoritative repository/branch/HEAD.
2. If source changes are required, ChatGPT commits those changes through the GitHub connector.
3. ChatGPT creates a structured AWH job record referencing an exact repository and commit SHA.
4. GitHub delivers the job to AWH through a repository webhook. Polling is only an emergency fallback.
5. AWH validates the job contract, repository identity, exact SHA, project registration, risk class, and approval state.
6. AWH synchronizes the registered workspace to the exact approved revision without accepting arbitrary shell text from the job.
7. Existing AWH Autopilot/ManagedTaskRegistry executes only allowlisted capabilities and project-profile gates.
8. AWH records bounded status/artifact metadata and reports the result back to the same job thread.
9. ChatGPT reads the result and reports it to the user.

The GitHub bridge is command transport, not an execution engine and not a second project database.

### Adapter B — Remote MCP / Apps adapter (future direct path)

When full custom MCP write actions are available to the user's ChatGPT plan, a remote MCP transport may submit the same Command Bus contract directly.

The execution engine, risk model, project registry, task state, artifacts, and deployment logic must not change when transport changes.

## Non-goals

- Do not run GitHub-hosted Actions as part of the critical path.
- Do not interpret issue text, chat text, commit messages, or goal text as shell commands.
- Do not put credentials, tokens, SSH keys, database passwords, environment files, or private deployment material in GitHub jobs.
- Do not expose arbitrary shell, arbitrary argv, arbitrary cwd, arbitrary environment variables, filesystem paths, or SQL through the Hub/Web API.
- Do not make browser AWH Web an execution surface.
- Do not create a second editable copy of Project Memory.

## Command contract

The transport payload is bounded structured data. Initial schema:

```json
{
  "schemaVersion": 1,
  "jobId": "uuid-v4",
  "projectId": "uuid-v4",
  "repository": "owner/name",
  "revision": "40-char-git-sha",
  "action": "sync_verify",
  "riskClass": "routine",
  "approval": "not-required",
  "requestedAt": "ISO-8601",
  "requestedBy": "chatgpt-github-bridge"
}
```

Initial action allowlist:

- `inspect`
- `sync_verify`
- `qa`
- `build`
- `package`
- `deploy_staging`
- `deploy_production`
- `rollback`

The job does not contain a command line. Each action maps to reviewed AWH code and fixed project-profile capabilities.

## Approval model

### Routine

`inspect`, `qa`, `build`, and non-mutating package verification may run automatically when the exact revision is clean and approved by the project policy.

### Source mutation

Source editing remains a ChatGPT/Git operation. AWH execution only receives the resulting exact SHA. It does not generate arbitrary source mutations from remote goal text.

### Production

`deploy_production` is always two-phase:

1. AWH accepts the requested revision and enters `WAITING_APPROVAL`.
2. After explicit user approval in chat, ChatGPT records the approval transition on the same trusted job.
3. AWH revalidates repository, revision, current deployment state, backup/rollback readiness and health gates before mutation.

Approval is revision-bound. If HEAD or the requested revision changes, approval is invalidated.

### Destructive / credentials

Remote destructive or credential actions remain blocked in M3C2. They require a separately reviewed future contract.

## Security boundary

- Webhook requests require GitHub signature verification with a server-side secret.
- The job repository, author/app identity, branch policy and exact SHA are allowlisted.
- Job replay is rejected by durable `jobId` idempotency state.
- A revision is fetched only from the configured repository remote.
- Dirty registered workspaces fail closed; AWH never overwrites local dirty work.
- Secrets stay in OS/native credential stores or VPS service configuration outside GitHub.
- All execution uses the existing no-shell/fixed-argv process boundary wherever possible.
- Output is bounded and redacted before becoming result metadata.
- AWH records an audit decision for receive, validate, approve, execute, verify, rollback and complete stages.

## Failure model

A failed transport must not corrupt project state.

- GitHub unavailable: queued work waits; local AWH remains usable.
- Duplicate webhook: idempotent no-op after the first accepted job.
- Revision missing/moved: fail closed.
- QA failure: no deploy.
- Production health failure after mutation: invoke the reviewed rollback path automatically when rollback is safe and available.
- Result-post failure: keep the durable local result and retry reporting; do not rerun the task.
- VPS restart: durable job/task metadata marks interrupted work for reconciliation; never assume success.

## Result contract

AWH reports bounded machine-readable metadata only:

```json
{
  "jobId": "uuid-v4",
  "state": "COMPLETED",
  "revision": "40-char-git-sha",
  "checks": [
    { "id": "test", "status": "PASS" },
    { "id": "build", "status": "PASS" },
    { "id": "health", "status": "PASS" }
  ],
  "artifactRefs": [],
  "deployment": {
    "environment": "staging",
    "revision": "40-char-git-sha"
  },
  "startedAt": "ISO-8601",
  "finishedAt": "ISO-8601"
}
```

No raw secret, full environment dump, arbitrary process argv, private absolute path, or unbounded log is returned.

## VPS role

The VPS is an AWH Hub + lightweight execution worker, not a replacement AI model.

Minimum target for the first field implementation:

- Ubuntu 24.04 LTS x64
- 2 vCPU
- 3 GB RAM
- 30 GB SSD
- IPv4
- Docker-capable Linux/root administration
- systemd
- swap configured for transient build peaks
- serialized heavy-job queue

The first implementation must remain functional on this target. Heavy creative/video work may later be dispatched to an enrolled desktop worker instead of forcing the Hub VPS to render everything.

## Why this removes the current bottleneck

GitHub remains Source of Truth but GitHub-hosted Actions are no longer required for build/test/deploy. The VPS performs approved execution itself. Codex becomes optional delegation rather than a required worker. ChatGPT can still inspect/edit GitHub source through the existing connector, while AWH owns deterministic execution and verification.

## Implementation phases

### M3C2-A — Contract and durable inbox

- Add strict command/result schema.
- Add durable idempotent job state.
- Map actions to existing Autopilot capabilities; no shell command field.
- Unit-test malformed/replayed/unsupported/high-risk jobs.

### M3C2-B — GitHub transport adapter

- Verify webhook signature.
- Verify trusted repository and requester/app identity.
- Convert accepted job metadata into the internal Command Bus contract.
- Post bounded state/results back without secrets.
- Keep webhook code separate from the execution engine.

### M3C2-C — Revision sync + worker

- Resolve registered project by `projectId`.
- Verify clean workspace.
- Fetch configured remote.
- Resolve exact requested SHA.
- Refuse implicit moving-branch deployment.
- Execute allowlisted Autopilot profile gates serially.
- Persist lifecycle/audit/result state.

### M3C2-D — Staging deployment

- Add project-specific staging deployment adapter.
- Require backup/rollback metadata before mutation.
- Health verify exact deployed revision.

### M3C2-E — Production two-phase approval

- `WAITING_APPROVAL` revision-bound gate.
- Explicit approval transition only.
- Re-preflight immediately before mutation.
- Auto rollback on failed post-deploy health where supported.

### M3C2-F — Direct MCP transport

- Implement only when the user's ChatGPT plan supports full write actions.
- Feed the same internal contract; do not fork execution logic.

## Buy/no-buy gate

A VPS is suitable for AWH if it can run the M3C2 worker and current Hub services without relying on GitHub Actions. Provider-hosted backup is optional because AWH must own off-site backup/restore independently. The selected provider must not force a proprietary execution layer into the critical path.
