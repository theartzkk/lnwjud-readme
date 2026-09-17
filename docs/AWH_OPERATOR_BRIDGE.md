# AWH Guarded Operator Bridge

The operator bridge gives the dedicated `awh-remote` VPS connector a typed, auditable path to existing AWH authorities without granting sudo, root shell, database file access, or a second deployment queue.

## Authority

- Socket caller: `awh-remote` only (`0600` Unix socket).
- Request handler: `awh-hub`, no Linux capabilities, `NoNewPrivileges=true`.
- Project mutation gate: existing `control_task_executions`, `control_execution_envelopes`, `control_workspace_leases`, Project Vault and canonical source metadata.
- BAY stage: VPS-local spool -> exact SHA/manifest/baseline verification -> canonical `updates/incoming`; no FTPS loop and no direct Production overwrite.
- BAY install: existing `HubBayRemoteUpdateService` -> `remote-update.php` -> BAY Update Inbox -> `PackageManager`.
- Audit: append-only sanitized JSONL under `/var/lib/awh-hub`; no request body, credential, signature or package content is logged.

## Allowlisted commands

`awh-operator status`

`awh-operator projects`

`awh-operator gate "BAY EXCUSE X"`

`awh-operator bay-status`

`awh-operator bay-stage <package.zip> <version> <source-sha> <package-sha256> --confirm`

`awh-operator bay-install <version> <source-sha> <package-sha256> --confirm`

`bay-stage` copies only from the private `/var/lib/awh-operator-staging` spool, verifies ZIP SHA/manifest against live BAY version + deployed SHA, holds the existing BAY single-writer authority, and succeeds only when Update Inbox reports that exact package as installable. The socket handler remains unprivileged and gets supplementary `www-data`/`bay-staging` groups only inside its hardened service namespace.

`bay-install` is refused unless the project gate is READY, BAY preflight is ready, maintenance is inactive, and the exact version/source/package SHA is already installable in the canonical Update Inbox.

## Non-goals

The bridge never accepts arbitrary shell input, never uses FTPS when source/package and BAY Production already share the VPS, never grants `awh-remote` sudo, never reads browser sessions, never creates a second lock/queue/auth system, and never writes project source directly. New mutation actions must reuse an existing canonical authority and receive their own regression contract before they are allowlisted.

## Bootstrap

The first activation is intentionally root-installed because a non-privileged connector must not be able to install its own privilege bridge. `deploy/operator-bridge/install.sh` installs the root-owned systemd socket/client, verifies a real `awh-remote` status call, and rolls back units/client on failure. Once activated, normal operator calls require no sudo.
