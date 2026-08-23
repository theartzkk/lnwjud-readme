# M12 Central Project Authority

M12 moves the first safe execution boundary under AWH authority without
creating a second Project, conversation, task, or worker registry.

- The existing `projects.project_id` remains the only Project identity.
- A Project Vault revision is immutable, private, content-hashed, and never a
  local path. A device path remains a binding only.
- Initial archive ingestion is promoted only after validation. Later imports
  are candidates and need an expected-active-revision precondition before
  promotion.
- ZIP ingestion rejects absolute/traversal paths, links, sensitive paths,
  oversized/over-compressed content, and duplicate paths. Vault content is
  never made public by a download URL.
- `control_task_executions` is a one-to-one durable execution projection of an
  existing `control_tasks` row. It is not another task queue.
- The unprivileged VPS executor currently supports only native conversation and
  bounded read-only inspection tools. It has no shell, deployment, write, or
  network-tool capability. Engineering mutations remain durable while waiting
  for an explicitly capable, isolated specialist path.

## Production-parity gate

Copy the verified M11 database to a safe non-production location, then run:

```sh
AWH_M12_PRODUCTION_PARITY_DB=/safe/copy/awh-m11.sqlite \
AWH_M12_PRODUCTION_PARITY_CONFIRMED=1 \
php hub/tests/m12-production-parity.php
```

The fixture refuses `/var/lib/awh-hub/` and verifies v11 → v12, idempotence,
integrity, foreign keys, and exactly one migration-ledger row. It must pass on
a fresh production-shaped copy before an owner-approved activation. It does
not access production itself.

## Deliberate non-claims

M12 does not make arbitrary project mutation, document rendering, media
rendering, Codex execution, Desktop package signing, or off-host backup pass
by implication. Those require their own bounded capability, isolated task
workspace, and runtime evidence.
