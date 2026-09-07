# BAY Ecosystem VPS Migration Readiness

## Outcome

Move the runtime of AWH, BAY Hub, the school website, BAY LearnLab, and finally BAY EXCUSE X onto one clean VPS while preserving the current production database until each application passes its independent cutover gate.

This is **VPS-first, not VPS-only**. GitHub may remain source/CI, Cloudflare may remain DNS/TLS/protection, LINE remains messaging, and an off-site backup may remain disaster recovery. None of those services may become a hidden requirement for an already-running school application to answer normal requests.

## Non-negotiable data invariants

1. The current live database remains Source of Truth until the exact cutover commit point.
2. Never dual-write old hosting and the VPS.
3. Never combine host migration, destructive schema redesign, and data cleanup into one irreversible step.
4. Every final database transfer requires a pre-cutover backup, an independently restored shadow copy, schema/count/integrity reconciliation, application QA, and a rollback decision point before new writes are accepted.
5. After the VPS accepts writes, rollback must preserve post-cutover data; a DNS-only reversal is not a valid database rollback.
6. Credentials are server-side only and are never exposed by Database Studio, migration manifests, logs, or browser responses.

## Target contract — VPS Game baseline

Target planning envelope: 2 vCPU / 3 GB RAM / 30 GB SSD.

The target is built cleanly. Do not clone the old VPS filesystem. Standard authorities:

- Nginx: ingress/reverse proxy
- PHP-FPM: per-application pools where PHP is used
- MariaDB: application databases, bound to localhost/socket only
- SQLite: AWH control-plane authority where already canonical
- systemd: durable services/timers
- AWH: control/visibility/deploy/recovery UI, never a runtime dependency for BAY EXCUSE X, LearnLab, or the website

Application/data/release roots must be standardized and documented before activation. Build products, CI caches, old desktop packages, transient runners, and video/media rendering do not belong in the production storage budget.

## Migration order

1. Clean VPS foundation and recovery controls
2. AWH control plane in observe/control mode
3. BAY Hub
4. School website (first InfinityFree exit pilot)
5. BAY LearnLab
6. BAY EXCUSE X (last business-system cutover because it owns school identity/master data)

Applications can become migration-ready independently; they do not need to reach 100% on the same date.

## Database Studio safety levels

Default mode is read-only. The Studio may inventory all databases and expose safe structure/data views without disclosing credentials. MariaDB/MySQL write operations are not implied by registration.

Future mutation flow must remain guarded:

`Owner session -> step-up -> verified backup -> preview/diff -> bounded transaction -> verify -> audit`

High-impact restore/promotion remains a separate approved operation. phpMyAdmin/Adminer, if retained at all, is break-glass tooling rather than the normal owner workflow.

## Storage lifecycle

Protected:

- canonical production databases
- current release
- previous/known-good rollback release
- Project Vault and canonical source bindings
- current secrets/config authority
- latest verified recovery point and evidence required for rollback

Retention-controlled:

- old web releases
- desktop artifacts
- pre-deploy database snapshots
- journals/logs
- CI runners/cache/temp
- staging/proof databases after dependency proof

Nothing moves from RETAIN/QUARANTINE to SAFE_TO_PURGE from age/name alone. Dependency/reference checks and current-pointer proof are required.

## Required per-project migration manifest

Each project must resolve these values from live Source of Truth at execution time:

- repository / canonical branch / exact SHA
- current production authority and domain
- runtime and extensions
- database engine/name/schema/collation plus reconciliation rules
- writable data/uploads
- secret **names** and provider boundaries (never values)
- background jobs/webhooks/timers
- health endpoint and expected response
- backup and isolated restore procedure
- deploy/current/previous/known-good pointers
- rollback procedure
- shadow QA matrix
- final write-freeze/cutover gate

## Definition of migration-ready

A project is migration-ready only when source, database, writable files, runtime config, backup, isolated restore, health checks, shadow QA, and rollback are all reproducible. Production cutover is a separate state and requires current evidence at the time it happens.
