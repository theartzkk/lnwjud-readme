# AWH Operations Baseline

AWH operations prefer automated, reversible, observable changes. Production writes are staged; destructive shortcuts are not normal operations.

## Daily operating signals

Owner System Health should surface: Hub/database health, current release, latest verified backup, worker availability, waiting capability count, storage pressure and AI budget state. Raw logs and implementation details stay under Advanced.

## Production change order

Backup → verify → migration dry-run/plan → release stage → health check → activate → observe → retain rollback evidence. A failed health check stops promotion and preserves the previous release/database authority.

## Capacity policy

Do not upgrade VPS from intuition alone. Upgrade only when measured CPU, memory, disk, queue latency or storage thresholds repeatedly demonstrate a bottleneck after software-level fixes.

## Device policy

Mac/Windows devices are replaceable optional workers. Enrollment, capability discovery, revoke and replacement must not change canonical project identity or require moving Hub data.
