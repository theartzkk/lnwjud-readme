# M3E Secure Device Enrollment Foundation

M3E adds the local/server domain foundation for independent AWH device
enrollment. It reuses the M3B UUID and authentication contracts. No browser
mutation route, source write, sync, shell, MCP proxy, or remote execution is
enabled.

## Boundary

- `src/device-identity.ts` remains the device-local stable UUID source.
- `hub/src/HubEnrollmentService.php` stores only hashes for pairing codes and
  device tokens.
- SQLite stores users, permanently closed owner bootstrap state, pairing-code
  lifecycle, device enrollment, device/project membership, and token lifecycle
  metadata.
- Plain pairing codes and bearer tokens are returned only to the explicit
  local enrollment/rotation caller. They are not returned by Hub read routes,
  browser JavaScript, Project Memory, or logs.
- `/api/v1/devices` exposes bounded device metadata plus enrollment status and
  permitted-project count, never credentials, hashes, or paths.

## Enrollment lifecycle

1. The first owner is initialized once; a second bootstrap attempt fails closed.
2. An owner issues a bounded pairing code for already-authorized projects.
3. The code is stored as SHA-256 only, expires within the bounded TTL, and is
   consumed atomically on successful enrollment.
4. Each device keeps its own stable UUID and receives its own token.
5. Rotation revokes the old token and creates a replacement; expiry and
   revocation fail closed before project authorization.
6. Project access requires active token, matching device identity, active
   enrollment, and explicit device/project membership.

Production enrollment transport and schema migration remain human-reviewed
future work. The M3D browser gateway remains read-only.
