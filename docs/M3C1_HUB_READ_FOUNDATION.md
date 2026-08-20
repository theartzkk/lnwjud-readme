# M3C1 AWH Hub Read Foundation

M3C1 adds a minimal PHP-FPM/SQLite read foundation that follows the M3A
TypeScript contract. It is a local implementation and has not been deployed.

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

## Local validation

```sh
/opt/local/bin/php -l hub/src/HubReadModel.php
/opt/local/bin/php -l hub/src/HubReadRouter.php
/opt/local/bin/php -l hub/public/index.php
/opt/local/bin/php -l hub/bin/index-project.php
/opt/local/bin/php hub/tests/read-foundation.php
```

The current Mac PHP runtime has no `pdo_sqlite` driver. Therefore the PHP
behavior test reports an explicit environment skip; syntax is checked and the
SQLite schema is smoke-tested with the local `sqlite3` tool. A full PHP
read-model test requires a PHP runtime with `pdo_sqlite`.

## Browser relationship

The browser adapter has two explicit modes:

- `STATIC_PREVIEW` (the default M3C0 build, using `data.json`)
- `HUB_READ` (future same-origin sanitized GET mode, configured by an external
  `web-config.json`; it never receives or creates a bearer token)

The Hub-connected mode is not enabled in the generated static output and must
not be described as a live connection until the authenticated server perimeter
and API deployment are separately verified.
