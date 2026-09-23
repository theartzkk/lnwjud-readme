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
3. Uses pinned Desktop Commander package version `0.2.51`.
4. Starts the remote agent in the foreground as `awh-remote`.

After the terminal prints the verification URL/code, approve the matching code from the phone. Do not approve a mismatched code.

## Phase 2 after pairing

Phase 2 is source-managed by `install-vps-direct-connector.sh`. It pins the agent, installs a hardened systemd unit, constrains Desktop Commander file roots, grants read-only ACLs to the canonical Git projections, and refuses privileged group membership. It does not install a general sudo rule.

To adopt an already-approved session without exposing its contents, run as root on the VPS:

```sh
AWH_RDC_SESSION_SOURCE=/path/to/existing/device.json \
  sh deploy/remote-worker/linux/install-vps-direct-connector.sh --activate
sh deploy/remote-worker/linux/verify-vps-direct-connector.sh
```

The session is copied with mode `0600` into `/var/lib/awh-remote`; the source path is never printed. Production mutation remains behind AWH's guarded deployment and approval paths rather than a general-purpose remote sudo capability.

For browser-level UX QA, reuse an existing trusted Chrome tree without downloading another browser:

```sh
AWH_CHROME_PATH=/absolute/path/to/chrome \
  sh deploy/qa/install-browser-qa-runtime.sh --install
sh deploy/qa/verify-browser-qa-runtime.sh
sh scripts/qa/run-vps-chat-continuity.sh
```

The browser tree is adopted into `/opt/awh-tools/browser-qa` with hard links on the same filesystem, Playwright is pinned, browser download is disabled, and Thai-capable Noto fonts plus required shared libraries are installed.

Do not make the device agent root and do not replace AWH's native executor with the connector. Mac/Windows remain optional workers only.
