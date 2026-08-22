# AWH Cross-Device Continuity

M7 establishes the durable workspace-continuity authority. M8 reuses that
authority; it does not introduce a second project registry, checkpoint store,
or device credential model.

```text
canonical Project ID / Work / Memory / Task / Result / WIP checkpoint
                              │
                         AWH Hub
                    ┌─────────┴─────────┐
              Mac workspace         Windows workspace
              (device binding)      (device binding)
                    │                     │
                    └──── iPhone: Work, status, approvals ────┘
```

## Authorities

- `.awh/project.json` carries the portable project identity. A filesystem path
  is a device-local binding, never the project identity.
- The Hub stores project membership, Work/task/result metadata, WIP checkpoint
  metadata, the single writer lease, and bounded device-binding metadata.
- Git is the source/WIP transport only when its remote is private and the
  worker verifies the pushed `refs/awh/wip/...` revision.
- Large artifacts use their approved artifact authority. Build caches and
  dependencies are rebuilt locally.
- Credentials, private keys, cookies, local paths and source contents are not
  transferred through Hub Work, project bindings, or logical export.

## Safe handoff

1. The source worker verifies source state and creates a bounded WIP checkpoint.
2. It publishes only checkpoint metadata after verifying its private backing
   ref, then releases the workspace lease.
3. A compatible target with the same portable project identity claims the
   lease before reconstructing the checkpoint.
4. The target verifies its base revision and empty working tree before restore.
   Divergence, an unsynced checkpoint, unavailable source device, or a live
   writer lease fails closed with a truthful Hub state.

M8 records that a trusted device can restore a project using a human-readable
workspace label, source fingerprint and bounded capabilities. It never uploads
the local path. A new Desktop registration first validates the existing
portable manifest, then publishes the same canonical Project ID to the Hub;
an incompatible ID/name/type conflict is rejected rather than duplicated.

## Current validation boundary

Deterministic M7 fixtures cover clean and WIP handoff, reverse handoff, lease
exclusion, conflict rejection, unsynced/offline truthfulness, and secret/cache
exclusion. The M8 fixture covers project/device binding and the shared Work
authority. A physical Windows handoff remains a field test; it must not be
reported as passed until a trusted Windows device performs it.

## ChatGPT boundary

The legacy local read-only MCP tunnel is not AWH Hub synchronization and is
not a substitute for delegated authorization. A future remote MCP client must
use the same Hub project, Work, task, result, approval and scope authorities;
it must not read local workspace paths or receive device credentials.
