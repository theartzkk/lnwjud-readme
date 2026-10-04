# AWH Hatchet execution runtime

Hatchet is an execution provider only. AWH remains the sole authority for project identity, Task/Execution/Envelope lifecycle, security, source promotion, exact-SHA approval, database migration and Production mutation.

## Permanent topology
- ReadyIDC runs the Hatchet worker continuously.
- Personal Mac/Windows devices are not server dependencies; they run AWH Agent only for device-required work.
- The worker reads its write-only provider credential from the existing AWH provider-secret boundary.
- No secret belongs in source, SQLite, task/checkpoint payloads, logs or artifacts.
- The first cutover capability is bounded non-Production execution. Production mutation authority remains false.

## Cutover
Existing legacy executions drain. New eligible non-conflicting executions may route Hatchet-first only after live worker health and canonical correlation are verified. Never run a second scheduler as permanent fallback.

## Recovery
systemd restarts the ReadyIDC worker after failure/reboot. Hatchet handles execution retry/concurrency; AWH retains canonical execution state and decides whether work may mutate a resource.
