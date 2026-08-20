# M3E.2 Secure Enrollment API + Local Device Client

M3E.2 is implemented locally only. It reuses `HubEnrollmentService` and the
M3B device UUID/credential contracts. The existing M3D browser read gateway is
unchanged and remains read-only.

## HTTP boundary

The separate `hub/public/enrollment.php` front controller accepts only bounded
JSON `POST` requests:

```text
POST /api/v1/enrollment/bootstrap
POST /api/v1/enrollment/pairing-codes
POST /api/v1/enrollment/devices
POST /api/v1/enrollment/token/rotate
POST /api/v1/enrollment/token/revoke
POST /api/v1/enrollment/devices/{deviceId}/revoke
```

The route is not part of `web-gateway.php` or the browser `HUB_READ` adapter.
It rejects non-empty browser `Origin`, credentials in URLs, non-JSON bodies,
unknown fields, oversized requests, and non-POST methods. Bootstrap requires a
one-time deployment-provided nonce hash and remains closed after first owner
initialization. Owner routes require an active device Bearer credential.

Pairing consumption is limited to five attempts per device in a ten-minute
window, then blocked for thirty minutes. The counter is stored in the
additive `enrollment_rate_limits` table from
`hub/migrations/002_m3e2_enrollment_api.sql`.

## Local Desktop client

`src/enrollment-client.ts` reuses the existing local device identity and
`awh/device-token` credential key. It sends credentials only in the fixed
`Authorization` request header to the separate enrollment API, stores the new
credential through the injected credential store, and returns only sanitized
state. It never puts tokens in URLs, logs, Project Memory, renderer IPC, or
browser Hub Read data.

The production credential adapter is now selected by platform: macOS uses the
native Keychain `security` command and Windows uses native Credential Manager
through a fixed, in-memory PowerShell P/Invoke helper. Linux remains
fail-closed. No plaintext file fallback exists; in-memory storage remains
test-only.

## Deployment delta from M3D/M3E.1

Not executed. The complete local deployment package and runbook are in
`docs/M3E_FINAL_PRODUCTION_VALIDATION.md`. Before a human-reviewed deployment:

1. Apply migration 002 to the already-migrated Hub SQLite database and verify
   integrity/foreign keys.
2. Deploy the PHP enrollment router/service files outside the static web root.
3. Configure PHP-FPM environment for the database and a secret bootstrap nonce
   hash outside source control.
4. Add a separately reviewed Nginx location for the enrollment front
   controller. Do not route it through `web-gateway.php` or expose it as
   browser `data.json`/HUB_READ.
5. Run the enrollment API regression and verify existing health/status/projects/
   memory reads remain unchanged.
6. Only then pair a device with an operator-held short-lived code.

No deployment, SSH mutation, source synchronization, write endpoint, shell,
MCP proxy, or remote execution is part of this milestone.
