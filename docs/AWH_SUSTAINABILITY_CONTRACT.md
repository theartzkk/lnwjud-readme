# AWH Sustainability Contract

AWH is an evergreen product. Production should become useful early, then improve without breaking identity, data, or installed Desktop clients.

## Permanent invariants

- ReadyIDC is the 24/7 Cloud Control Plane; personal devices are optional workers.
- Canonical user/project/task/memory/artifact identity lives in the Hub authority, never in a local path.
- SQLite schema changes are versioned migrations. Production schema is never hand-edited as a normal workflow.
- Git/Vault remains source authority for project content; Hub stores portable identity, continuity, execution and audit state.
- Secrets never live in Git, web storage, URLs, logs, release manifests, or exported user data.
- AWH Cloud must remain usable while Desktop/Windows/Mac workers are offline.
- Everything may be replaced except durable identity and data continuity.

## Release contract

Stable releases require CI, Hub regression tests, packaged runtime verification, a verified backup, an explicit migration plan, and a rollback plan. Preview may ship earlier only to Owner-controlled devices.

Desktop is install-once/evergreen by contract. Windows keeps one stable Squirrel package identity. macOS keeps one stable bundle identifier. Update channels are `stable` and `preview`; changing channel never creates a second AWH identity. The updater is not considered activated until signed/update-feed behavior is implemented and verified.

The current `sslip.io` Hub endpoint is a launch endpoint, not permanent naming. Before the VPS/IP is ever replaced, AWH must gain a durable hostname or endpoint-discovery cutover so already-installed clients can migrate without reinstalling.

## Backup and recovery

Production backup uses a consistent SQLite snapshot, SHA-256 manifest, integrity check, foreign-key check, and a non-destructive restore drill. A restore drill always materializes into scratch storage; it never replaces the live production database. Production cutover remains an explicit staged operation with a verified rollback point.
