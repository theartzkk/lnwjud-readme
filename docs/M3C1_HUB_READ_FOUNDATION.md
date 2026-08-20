# M3C1 AWH Hub Read Foundation

M3C1 adds a minimal PHP-FPM/SQLite read foundation that follows the M3A
TypeScript contract. M3D adds a reviewed same-origin web gateway for the same
read model; these repository changes have not been deployed by this task.

## API boundary

The PHP front controller is `hub/public/index.php`. Its HTTP surface is:

```text
GET /api/v1/health
GET /api/v1/status
GET /api/v1/projects
GET /api/v1/projects/{projectId}
GET /api/v1/projects/{projectId}/memory
GET /api/v1/devices
GET /api/v1/builds
GET /api/v1/releases
```

Every route except health requires a Bearer token whose SHA-256 hash is supplied
through `AWH_HUB_READ_TOKEN_HASH`. The token is never stored in the repository,
returned, or logged. An unset/invalid hash fails closed with `503`.

All non-GET methods return `405`. Route IDs are strict UUIDs; there is no
arbitrary path, file, SQL, shell, MCP, source-editor, or execution endpoint.
Responses use bounded, safe error messages and `Cache-Control: no-store`.

## Data boundary

`hub/schema.sql` stores only Hub metadata and memory-file metadata:

- portable project identity
- source revision reference and observation/provenance metadata
- canonical memory file status, size, and hash
- device/build/release metadata

It does not contain `workspace_path` or memory `content`. The canonical source
remains `.awh/project.json` and the five Project Memory files. The local
`hub/bin/index-project.php` command indexes metadata only; it does not copy
memory content or source files. `observedAt` and `provenance` make stale/cache
state visible and the index is rebuildable.

The HTTP connection opens SQLite with `PRAGMA query_only = ON`. The indexer is
the separate local maintenance path and is not reachable through HTTP.

## Web read gateway

`hub/public/web-gateway.php` reuses the same router and model for browser reads;
it does not create a second API or copy Project Memory. Nginx supplies the
server-controlled `AWH_WEB_GATEWAY_TRUSTED_PERIMETER=nginx` FastCGI parameter,
which the gateway accepts instead of a browser Bearer token. A client HTTP
header cannot establish that trust. The reviewed Nginx template applies Basic
Auth at server scope to static assets and `/api/v1/*`, and sends PHP-FPM over a
Unix socket. This is a temporary preview perimeter, not the completed M3B
device/account authorization model.

## Local validation

```sh
/opt/local/bin/php -l hub/src/HubReadModel.php
/opt/local/bin/php -l hub/src/HubReadRouter.php
/opt/local/bin/php -l hub/public/index.php
/opt/local/bin/php -l hub/public/web-gateway.php
/opt/local/bin/php -l hub/src/HubWebGateway.php
/opt/local/bin/php -l hub/bin/index-project.php
/opt/local/bin/php hub/tests/read-foundation.php
```

The PHP behavior test requires `pdo_sqlite`; when it is available it exercises
the real SQLite read model and gateway trust boundary.

## Browser relationship

The browser adapter has two explicit modes:

- `STATIC_PREVIEW` (the default M3C0 build, using `data.json`)
- `HUB_READ` (same-origin sanitized GET mode, configured by an external
  `web-config.json`; it reuses only the same-origin web session and never
  receives or creates a bearer token)

The generated static output remains static unless a reviewed `web-config.json`
selects `HUB_READ`. If the live read fails, the adapter falls back to a
truthful offline/degraded static preview and never labels the Hub connected.
