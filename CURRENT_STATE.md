# AWH Committed State Index

Updated: 2026-09-24 ICT.

This file is **not live authority**. Current-state authority comes from fresh canonical runtime/source evidence. **Fresh observed runtime/source evidence outranks this snapshot.** This file records the operating model expected by the current source tree and tells agents where to verify mutable state. Never use a SHA, service state, disk value, schema number, device status or Production claim from prose when the live authority is available.

## Verify before mutation

Resolve these from their canonical sources:

- AWH canonical source: `/srv/awh-git/awh.git` refs, through bounded read access.
- Production source: canonical `production` ref plus the active Control/Web release pointers.
- Public identity: `https://kruart.online/release.json`.
- Hub integrity/state: canonical Hub database, migrations, task/execution/approval/envelope authorities.
- Mutation ownership: active execution envelopes and project mission authority.
- Storage: live filesystem telemetry and storage guard/retention evidence.
- Devices: current enrolled runtime/capability heartbeat, not remembered versions.
- Project source: each Project Registry/Vault authority, not an old branch or handoff.

## Current operating model

ReadyIDC/VPS is the durable AWH control plane. Personal devices are optional capability workers.

Canonical project work uses existing Hub tasks/executions; no second queue is permitted. Mutation conflicts are resource-scoped: reads and isolated candidate/workspace lanes may run concurrently, while conflicting resources serialize.
The VPS Production deploy resource is global across projects. A project's canonical source promotion is interlocked with that project's active deploy. A second conflicting writer waits or joins; it does not create a competing authority.

Local remote-mission files coordinate a device/transport session only. They are not project, source, task, approval or release truth.

Core Release uses VPS-native local typed authority, exact revision binding, bounded storage preflight, terminal workspace cleanup, one Owner approval and post-deploy public verification.

## Document roles

- `AGENTS.md`: single entry point and precedence.
- `docs/AWH-AUTHORITY-MAP.md`: normative architecture/authority contract.
- `config/execution-policy.json`: machine-readable execution integrity contract.
- `docs/AWH_SUSTAINABILITY_CONTRACT.md`: long-lived product invariants.
- `ART_AI_WORKING_PROTOCOL.md`: advisory working context.
- `HANDOFF.md`: short continuity pointer only.
- `history/`: dated evidence/audit only.

Older state and handoff text is preserved under `history/governance-20260924/`. It must not override live inspection or the current contracts above.
