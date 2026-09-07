# BAY Ecosystem — VPS Migration Readiness

## Decision

Use a **clean VPS build**, never clone the current disk. Production runtime and application databases move to the owned VPS; GitHub/Cloudflare/LINE/off-site recovery may remain supporting services. AWH is the control plane, not a runtime dependency for BAY applications.

## Safety invariants

- InfinityFree remains the production authority for any app/data still hosted there until a deliberate final cutover.
- Never infer production data from VPS staging/proof databases.
- No production DB writes, destructive schema changes, production DNS changes, or dual-write during preparation.
- Every final data migration follows: immutable backup → write freeze → final dump → shadow restore/verification → final import → smoke/critical-flow QA → DNS cutover.
- Once the new VPS accepts writes, rollback must preserve those new writes; DNS-only rollback is forbidden.

## Target contract

The target is sized for 2 vCPU / 3 GiB RAM / 30 GiB SSD and uses Nginx + PHP-FPM + MariaDB + systemd directly. Keep builds, Electron packaging, video rendering, and heavy browser farms off the production VPS.

Filesystem authority:

```
/srv/apps/<project>       source/deploy metadata only
/srv/releases/<project>   immutable releases
/srv/data/<project>       persistent uploads/application data
/srv/backups/<project>    bounded fast recovery copies
/var/log/bay/<project>    rotated logs
```

Each PHP app gets a dedicated Linux user, FPM pool, MariaDB database user, and local-only DB access. Retain only current + previous + known-good application releases, plus bounded verified recovery points.

## Live evidence captured before changes

- AWH production points to `m20-21f8d0871634`, matching source head `21f8d087163446552ccd500e1898486ae09d6018` on `awh/api-independence` at audit time.
- AWH SQLite quick check passed and schema user_version is 20.
- MariaDB, Nginx, and PHP 8.3 FPM are active.
- Current VPS is approximately 29 GiB total, 19 GiB used, 9.1 GiB free (68% used) during this audit.
- The server already contains bounded storage guard, temp cleanup, retention, backup, and restore-drill timers. Their live scripts were imported verbatim into this migration branch because they were not represented in the Git source being audited.
- Sanitized DB fleet QA found AWH SQLite plus six MariaDB databases. MariaDB names are staging/proof/candidate-style; none are promoted to production authority by this inventory.
- The school production URL `https://banauedyai.ac.th/mainpage/` returned HTTP 200. The great-site school website is only a prototype/reference and is not canonical production source.

## Source authority gaps that block blind migration

1. AWH live release is newer than the source revision recorded in AWH's own project registry. Fix through canonical source synchronization, not direct SQL editing.
2. BAY EXCUSE X source main is known, but the **production InfinityFree DB/files manifest** still must be captured read-only before data migration.
3. The school website is present in AWH but has no canonical source repository/revision registered. Production database/file export authority must be established before a shadow copy can be trusted.
4. LearnLab still has active candidate branches/field gates; freeze the exact promotion SHA only after those converge.

## Database Studio v2 migration foundation

This branch adds a sanitized multi-engine fleet inventory to Database Studio while keeping row-level AWH inspection read-only. The inventory exposes only engine, safe database name/label, size, table count, health and conservative authority classification. It never sends credentials, DSNs, passwords or server paths to the browser.

MariaDB write/edit/import/restore operations are deliberately **not** opened yet. The next stage must use guarded operations with backup verification, step-up authorization, transaction/dry-run where supported, immutable audit evidence, and a restore-to-shadow default. Read-only remains the normal mode.

## Cutover order

1. Clean VPS foundation and AWH control-plane candidate.
2. BAY Hub as deployment/rollback pilot.
3. School website after canonical source + DB/files authority are pinned.
4. LearnLab after exact candidate and field gate converge.
5. BAY EXCUSE X last, after production DB/files shadow migration and critical-flow QA.

See `docs/migration/bay-ecosystem-manifest.json` for machine-readable readiness state.
