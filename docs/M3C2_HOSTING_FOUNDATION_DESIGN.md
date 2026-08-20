# M3C2 AWH Hosting Foundation — Design Only

This is a future topology design, not an installation or deployment record.
AWH is a control plane for project/workspace metadata and safe operations; it
is not cPanel and does not replace Linux, Caddy, PHP-FPM, MariaDB/MySQL, or
backup tools.

```text
Internet
  |
 HTTPS / Caddy
  +-- awh.<domain>  -> AWH Web + authenticated Hub read API
  +-- www.<domain>  -> School Website
  +-- app.<domain>  -> BAY EXCUSE X -> PHP-FPM -> MariaDB/MySQL
```

## Hard boundaries

- AWH Hub SQLite and BAY EXCUSE X MariaDB/MySQL are separate concerns.
- Application databases live outside Git and outside web roots.
- TCP 3306 and PHP-FPM sockets are private; neither is public.
- phpMyAdmin is not an open public endpoint; prefer private admin access or an
  audited tunnel when it is needed.
- Production, staging, and rollback release directories are separate.
- Secrets are service-managed outside source control.
- Backups must be encrypted, tested, and capable of surviving VM loss.
- AWH panels remain read-only until each future mutation has an explicit
  authorization, audit, rollback, and recovery design.

## Future read-only control plane panels

Websites, Deployments, Server Health, Backups, Databases, Logs, Releases, and
Rollback Status can be surfaced as sanitized status views. AWH must not expose
an arbitrary terminal, raw SQL editor, file browser, or unrestricted service
restart control.

## Resource signals

Do not assume an e2-micro is sufficient for the final multi-service stack.
Measure memory pressure, swap, CPU steal, disk growth, PHP-FPM queueing,
MariaDB latency, backup duration, and TLS/request error rate. Upgrade before
adding BAY EXCUSE X production traffic if sustained memory pressure, swap use,
or queueing appears. This design does not select a machine size, region,
static IP, domain, or cloud product.
