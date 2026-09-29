# AWH Operations Baseline

AWH operations prefer automated, reversible, observable changes. Production writes are staged; destructive shortcuts are not normal operations.

Operational mutation ownership is enforced by canonical execution envelopes and the live AWH Gate decision. Reads and isolated candidate/workspace lanes may be parallel. Project Mission is coordination only and never blocks by itself. Production deploy ownership is release-track scoped; unrelated tracks may proceed concurrently, while `VPS Platform` alone is host-global because it can mutate shared runtime/infrastructure. Device-local mission files coordinate transport only and never replace Hub mutation authority.

## Daily operating signals

Owner System Health should surface: Hub/database health, current release, latest verified backup, worker availability, waiting capability count, storage pressure and AI budget state. Raw logs and implementation details stay under Advanced.

## Production change order

Backup → verify → migration dry-run/plan → release stage → health check → activate → observe → retain rollback evidence. A failed health check stops promotion and preserves the previous release/database authority.

## Capacity policy

Do not upgrade VPS from intuition alone. Upgrade only when measured CPU, memory, disk, queue latency or storage thresholds repeatedly demonstrate a bottleneck after software-level fixes.

Core Release performs storage preflight before dependency hydration and reclaims terminal release workspaces. A failed release must not leave an unbounded build workspace behind, and retries are blocked while storage is above the configured release threshold.

Storage maintenance is proactive: the guard targets 6 GiB free space, checks every 10 minutes, and invokes project-aware cleanup before the hard block. The temp janitor runs every 30 minutes and treats `operator.project_mission` as coordination only, so a coordination lease never pins every temporary workspace for that project. Under storage pressure it keeps only the newest clean canonical-backed temp workspace per repository and reduces temp/operator-staging age thresholds to 60 minutes. Deletion remains fail-closed: the exact HEAD must be reachable from a canonical branch/tag, the tree must be clean, and no open file or process working directory may reference it. Old `node_modules`, npm/Electron caches and exported `vault-*.zip` files are reclaimable only as reproducible data and only when no active mutation/process uses them. Durable candidates live outside `/tmp`; `/tmp` contains only reproducible transients. Unknown authority is preserved, never guessed.

When an operation is blocked, retry the identical failure path no more than twice. If an Owner action is materially faster, report the blocker and exact action immediately under Owner Assist Fast Lane, then resume from the durable checkpoint. A workaround is not closure until prevention, regression, recovery and observability are in place.

## Device policy

Mac/Windows devices are replaceable optional workers. Enrollment, capability discovery, revoke and replacement must not change canonical project identity or require moving Hub data.
