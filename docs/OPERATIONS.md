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

## Device policy

Mac/Windows devices are replaceable optional workers. Enrollment, capability discovery, revoke and replacement must not change canonical project identity or require moving Hub data.
