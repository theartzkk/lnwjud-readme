# AWH Guarded Operator Bridge

The operator bridge gives the dedicated `awh-remote` VPS connector a typed, auditable path to existing AWH authorities without granting sudo, root shell, database file access, or a second deployment queue.

## Authority

- Socket caller: `awh-remote` only (`0600` Unix socket).
- Request handler: `awh-hub`, no Linux capabilities, `NoNewPrivileges=true`.
- Project mutation gate: existing `control_task_executions`, `control_execution_envelopes`, `control_workspace_leases`, Project Vault and canonical source metadata.
- BAY stage: VPS-local spool -> exact SHA/manifest/baseline verification -> canonical `updates/incoming`; no FTPS loop and no direct Production overwrite.
- BAY install: existing `HubBayRemoteUpdateService` -> `remote-update.php` -> BAY Production Shadow Update Inbox -> `PackageManager`.
- Audit: append-only sanitized JSONL under `/var/lib/awh-hub`; no request body, credential, signature or package content is logged.

## Allowlisted commands

`awh-operator status`

`awh-operator projects`

`awh-operator gate "BAY EXCUSE X"`

`awh-operator mission-status "Art’s Workspace Hub"`

`awh-operator mission-acquire "Art’s Workspace Hub" "<goal>" --confirm`

`awh-operator mission-renew <execution-id>`

`awh-operator mission-release <execution-id> <success|failure> --confirm`

A project mission reuses the existing task/execution/envelope authority as a two-hour renewable `CANONICAL:PROJECT` lease. A second chat receives the active mission instead of opening another writer. Expired missions fail safe and release their envelope; read-only work remains independent. Source promotion performed by the mission must pass `--mission <execution-id>` so the exact lease is reused rather than creating a nested writer.

Core Release follows the same non-nesting rule at the deploy boundary: `system.core.release` owns `CANONICAL:DEPLOY` for the full release lifecycle, and its guarded deploy stage borrows/re-verifies that exact execution instead of opening `project.mutate.deploy` as a second writer. Generic device lease recovery is limited to tasks that actually carry `assigned_device_id`; VPS-native operators and release runners are never treated as abandoned device work.

`awh-operator verification-store --confirm` (reads one bounded evidence JSON document from stdin)

`awh-operator verification-regressions` (reads `{ "changedPaths": [...] }` from stdin)

`awh-operator source-promote <repository> <bundle> <expected-main-sha> <target-sha> <bundle-sha256> [--mission <execution-id>] --confirm`

`awh-operator bay-status`

`awh-operator bay-stage <package.zip> <version> <source-sha> <package-sha256> --confirm`

`awh-operator bay-install <version> <source-sha> <package-sha256> --confirm`

`bay-stage` copies only from the private `/var/lib/awh-remote/operator-staging` spool, verifies ZIP SHA/manifest against live BAY version + deployed SHA, holds the existing BAY single-writer authority, and succeeds only when Update Inbox reports that exact package as installable. The installer binds the canonical Production Shadow inbox with an explicit `awh-hub` ACL, keeps the spool setgid to `awh-hub`, and retires transitional host drop-ins with rollback backups. The socket handler remains unprivileged and gets supplementary `www-data` group for the Production Shadow Update Inbox and `bayadmin` only for canonical Git operations inside its hardened service namespace.

`bay-install` is refused unless the project gate is READY, BAY preflight is ready, maintenance is inactive, and the exact version/source/package SHA is already installable in the canonical Update Inbox.

## Non-goals

The bridge never accepts arbitrary shell input, never uses FTPS when source/package and BAY Production already share the VPS, never grants awh-remote sudo, never reads browser sessions, and never creates a second lock/queue/auth system. Source mutation is limited to the allowlisted source-promote action: checksum-verified bundle, expected-base match, fast-forward-only main, existing single-writer gate, and no production ref mutation. New mutation actions must reuse an existing canonical authority and receive their own regression contract before they are allowlisted.

## Bootstrap

The first activation is intentionally root-installed because a non-privileged connector must not be able to install its own privilege bridge. `deploy/operator-bridge/install.sh` installs the root-owned systemd socket/client, verifies a real `awh-remote` status call, and rolls back units/client on failure. Once activated, normal operator calls require no sudo. The one-time Flow Simplification upgrade extends that same root-installed bridge so future ChatGPT/VPS source promotion no longer depends on a personal endpoint or self-SSH hop.

Verification evidence is stored under the existing AWH Hub data root (`/var/lib/awh-hub/verification-evidence`). Incident documents are immutable and keyed by deterministic fingerprint; matching changed paths are returned as regression IDs to later bounded deploy missions. This is evidence/learning state only and does not create a second task queue, source authority, or deployment authority.
