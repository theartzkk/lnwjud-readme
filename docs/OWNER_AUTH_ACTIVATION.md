# AWH Owner Auth Activation Package

This package prepares the final v4→v5 owner-auth cutover without changing
ReadyIDC during source QA.

The reviewed production command is:

```sh
cd /Users/mac/Documents/ChatGPT/lnwjud-readme
AWH_SOURCE_ROOT=/Users/mac/Documents/ChatGPT/lnwjud-readme \
AWH_DEPLOY_TARGET=awh-ready \
AWH_HUB_HOSTNAME=157-85-108-142.sslip.io \
AWH_RELEASE_COMMIT=<exact-reviewed-release-sha> \
npm run ops:owner-auth:activate
```

For a production that is already at schema v5 with its existing owner binding,
use the bounded code/runtime compatibility refresh instead. It rebuilds the
CONTROL PWA from the exact release, validates the M4/M5 capability ledgers and
existing owner credential, then refreshes only release/web/Nginx pointers. It
does not replay a migration, provision a password, or register a project:

```sh
cd /Users/mac/Documents/ChatGPT/lnwjud-readme
AWH_SOURCE_ROOT=/Users/mac/Documents/ChatGPT/lnwjud-readme \
AWH_DEPLOY_TARGET=awh-ready \
AWH_HUB_HOSTNAME=157-85-108-142.sslip.io \
AWH_RELEASE_COMMIT=<exact-reviewed-release-sha> \
npm run ops:owner-auth:activate -- --compat-refresh
```

The compatibility refresh proves the browser-shaped sequence
login (exact Origin) → session/projects (same-origin Fetch Metadata with no
Origin) before it reports success. It retains no session cookie or password in
deployment output.

`art` is the first-install default only. Once the owner changes their username
through Control Panel, an explicitly supplied `AWH_OWNER_AUTH_USERNAME` is used
for a later live golden-login verification; the capability gate itself always
checks the one canonical owner binding rather than a hard-coded name.

The local wrapper generates the initial password in process memory, stores it
in the existing macOS Keychain boundary, and sends it only through stdin to
the fixed remote helper. It never prints the password or recovery codes. The
safe local operator retrieval command is emitted only after a successful
activation:

```sh
security find-generic-password -a 'awh-device-token-v1:awh/owner-password' -s 'Art’s Workspace Hub' -w
```

Recovery codes are deliberately not transported through the deployment
boundary. After first login, the authenticated Control Panel can regenerate
them through the existing owner-auth route.

The remote deployment first builds a candidate from the authoritative
ReadyIDC HTTPS site. It removes only the old server-level Basic Auth pair,
adds explicit Basic Auth to `/api/v1/` and `/preview/`, and preserves the
existing enrollment/control includes, TLS and database settings. The
control/auth FastCGI socket is resolved from the active enrollment include:
the control plane therefore uses the same reviewed `awh-hub` pool rather
than inferring a generic PHP-FPM pool or a PHP version. The candidate is
installed only after the database backup and v4→v5 checks.

After Nginx reload, the activation requires both an effective-config check
and a bounded runtime convergence check. The latter waits for the exact
public auth route to return its expected application `405` without a Basic
Auth challenge; it does not mistake a just-retiring worker's old perimeter
response for the new generation. The deployment output may report only
allowlisted HTTP status and attempt-count diagnostics, never credentials,
cookies, request bodies or raw server errors.

The control release pointer has a stable pathname. PHP-FPM may therefore
retain an earlier opcode/realpath view while the database has advanced from
v4 to v5. Immediately after the pointer changes, activation reloads the
specific active `awh-hub` PHP-FPM service derived from the live enrollment
socket and confirms it is active before the Nginx cutover. Rollback restores
the prior pointer, then reloads that same PHP-FPM service before validating
the v4 baseline. Reloading only Nginx is not a valid release transition.

If a post-mutation gate fails, the engine restores the verified SQLite backup,
release pointers and Nginx file, runs `nginx -t`, reloads only after restore,
and verifies the M3D baseline. A rollback failure is reported as a failed
rollback and must not be retried automatically.
