# AWH VPS Direct Connector Bootstrap

Purpose: pair the ReadyIDC Ubuntu VPS directly to the already-connected Remote Desktop Commander MCP transport so ChatGPT can inspect the VPS without routing through MacBook or AY-TEACHER.

This is a transport bootstrap only. It does **not** create a second AWH queue, database, login system, or source authority. AWH's existing control plane, durable executor, project vault, approvals, leases, and audit trail remain authoritative.

## Safety invariants

- Run the remote device agent as dedicated unprivileged user `awh-remote`.
- Do not grant `awh-remote` sudo during bootstrap.
- Do not expose a new inbound TCP port; the agent initiates the outbound TLS connection.
- Do not copy AWH secrets into source, arguments, logs, or this repository.
- Keep production mutation through AWH's existing guarded deployment / approval paths.
- Pair only after the verification code displayed by the VPS matches the code on the authorization page.

## Bootstrap

From the ReadyIDC web console, as root:

```sh
sh deploy/remote-worker/linux/bootstrap-vps-direct-connector.sh
```

The script:

1. Verifies Node.js 18+ / npx, installing Ubuntu packages only if needed.
2. Creates `awh-remote` with home `/var/lib/awh-remote`.
3. Uses pinned Desktop Commander package version `0.2.50`.
4. Starts the remote agent in the foreground as `awh-remote`.

After the terminal prints the verification URL/code, approve the matching code from the phone. Do not approve a mismatched code.

## Phase 2 after pairing

Once the VPS appears online in ChatGPT, finish from the chat itself:

- verify OS / disks / services / active AWH release / DB schema / source SHA;
- constrain Remote Desktop Commander allowed directories and blocked commands;
- add a bounded systemd unit for automatic reconnect after reboot;
- grant only the minimum audited sudo operations actually needed;
- verify disconnect/reconnect and revoke behavior;
- keep Mac/Windows as optional workers only.

Do not make the device agent root and do not replace AWH's native executor with the connector.
