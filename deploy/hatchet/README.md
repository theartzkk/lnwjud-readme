# AWH Hatchet execution runtime

Hatchet is the durable execution provider only. AWH remains the sole authority for project identity, Task/Execution/Envelope lifecycle, security, source promotion, exact-SHA approval, database migration and Production mutation.

## Permanent topology
- ReadyIDC runs one Hatchet Embedded engine and the AWH Hatchet worker continuously.
- The embedded engine is pinned to v0.110.5 with SHA-256 18ddacae0005042bd982328bcb8d370cca6907352a1ab2a3c8406001d31e7dee.
- Hatchet Embedded uses its bundled Postgres under /var/lib/awh-hub/hatchet-embedded/postgres, so normal execution does not depend on Hatchet Cloud task-run quota.
- Personal Mac/Windows devices are not server dependencies; they run AWH Agent only for device-required work.
- No Hatchet credential is required for embedded mode. A legacy cloud credential may remain stored by the existing secret boundary for rollback, but it is not runtime authority.
- Production mutation authority remains false inside Hatchet tasks.

## Concurrency
The workflow concurrency key is input.resource with maxRuns 1. Different resources may run concurrently. The same resource serializes. AWH computes and authorizes the resource; Hatchet only schedules execution.

## Recovery
systemd owns the process lifecycle. KillMode=control-group removes the embedded sidecar and bundled Postgres children together on stop/restart. Persistent Hatchet state remains under /var/lib/awh-hub/hatchet-embedded/postgres. AWH execution/checkpoint state remains canonical and is used to resume abandoned work after worker loss.

## Cutover rule
Existing queued AWH executions are reused. Do not create replacement Tasks/Missions merely because Hatchet restarts. Do not run a second permanent scheduler fallback.
