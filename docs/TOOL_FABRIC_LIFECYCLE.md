# AWH Tool Fabric Lifecycle

AWH treats third-party tools as replaceable capability providers, never as a second control plane.

## Update lifecycle

1. Discover — AWH checks upstream metadata only. It does not mutate a worker.
2. Review — resolve an exact revision/release, verify license and breaking changes.
3. Preview — stage into an isolated tool root and run MCP/CLI smoke plus capability-contract tests.
4. Promote — Update Center changes the stable pin only after required gates pass.
5. Roll out lazily — workers download the stable provider only when the capability is needed, verify integrity, then atomically switch.
6. Rollback — keep one previously verified provider and revert automatically when startup/smoke fails.

Floating latest versions and in-place global upgrades are forbidden for managed stable runtimes.

## New tools

New repositories enter the Tool Discovery Inbox as DISCOVERED. They do not become executable capabilities until license, overlap, privacy/data boundary, maintenance health and rollback behavior are reviewed. AWH prefers an existing provider when a new tool duplicates a capability.

Large catalogs are discovery sources only. Individual tools are pinned and reviewed separately before approval.

## User model

The owner sees capabilities such as code.semantic, document.quick, or security.scan, not vendor-specific setup. Provider replacement is an implementation detail managed by Tool Fabric and Update Center.
