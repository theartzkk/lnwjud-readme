# BAY Ecosystem VPS Migration — Durable Closure Handoff

Checkpoint captured 2026-09-08 01:21 Asia/Bangkok. This handoff is additive operational evidence; it does not authorize production cutover.

## Exact source authority

- Repository: `theartzkk/lnwjud-readme`
- Migration branch: `awh/vps-migration-readiness-20260907`
- Verified predecessor candidate before this handoff: `8381cc86ba1ea1433e826a04a3ecb3bf187700c3`
- PR: #139, base `awh/api-independence` at `504ac7b986dd5681994c3f66b7d8e78fb2c06070`
- Exact-head GitHub evidence for predecessor: `CI` SUCCESS and `AWH Canonical Source Authority` SUCCESS.
- Local worktree was clean and exact with remote immediately before this handoff mutation.

Always re-resolve branch/head/CI/current writer before any further source mutation.

## Live VPS evidence

Host `awh-hub-01` was audited read-only immediately before recovery rehearsal.

- Root filesystem: 29 GiB, 20 GiB used, 9.0 GiB available, 69% used.
- Memory: 1.9 GiB total, approximately 1.2 GiB available; 2.0 GiB swap with about 232 MiB used.
- `nginx`, `mariadb`, `php8.3-fpm`, and `fail2ban`: active.
- Canonical AWH SQLite: `/var/lib/awh-hub/awh.sqlite`, schema user_version 20, integrity `ok`, no FK violation output.
- Current SQLite table count observed: 73.

### Fresh backup/restore proof

A normal guarded backup service and isolated restore-drill service were run; neither overwrote canonical SQLite.

- Backup file: `awh-20260907T182115Z.sqlite`
- Bytes: `6434816`
- SHA-256: `5649e6faf34eb109d5ff9a8241145dbf04b3e01f167f58bf9a270ccf72fee371`
- Backup manifest: schema 20, integrity PASS, foreign keys PASS.
- Restore drill: PASS, restoring into the existing isolated `/var/tmp` rehearsal path and cleaning temporary restore artifacts through the guarded service.

A much larger earlier recovery point (`awh-20260907T161151Z.sqlite`, 172216320 bytes) is intentionally retained. Read-only comparison showed both old/new backups have schema 20 and 73 tables. The size delta is concentrated in `control_product_setting_revisions`: 39,031 rows in the larger recovery point versus 9 in the later/current authority, while Project Vault revisions, conversation message count, and task count remained unchanged at the comparison checkpoint. Do not purge the larger recovery point until the revision-retention event is independently reconciled with its audit trail.

## Storage closure state

- `/var/backups/awh-hub`: approximately 4.6 GiB and treated as recovery authority, not generic cache.
- `/opt/bay-gh-runner-temp-20260905`: approximately 711 MiB; previously classified `TEMP_BUILD_RUNTIME / DO_NOT_MIGRATE` after no running process/systemd/symlink/open-file reference was found. It remains intact because deletion has lower value than preserving reversibility while disk headroom is healthy.
- Desktop artifact planner previously found 42 objects: 18 referenced and 24 orphaned; 3 old orphan candidates totaled about 1.77 GiB. No artifact is promoted to `SAFE_TO_PURGE` solely from age. Preserve current/previous/known-good and release-manifest/hardlink authority.
- Strict retention `--plan`: zero normal release/backup candidates eligible under current conservative windows.

No destructive cleanup occurred in this closure checkpoint.

## Migration capability and QA

The migration candidate contains:

- five per-project migration manifests plus ecosystem aggregate manifest;
- clean-target preflight contract for 2 vCPU / 3 GiB RAM / 30 GiB SSD;
- InfinityFree shadow migration contract with old production remaining sole write authority until approved cutover;
- Database Studio multi-database inventory and MariaDB/MySQL read-only adapter design;
- guarded MariaDB restore rehearsal limited to staging/proof database names;
- retention planning and desktop artifact classification tools.

Exact local verification on predecessor candidate `8381cc86...`:

- migration-focused tests: 13/13 PASS;
- TypeScript typecheck: PASS;
- control web build + release manifest: PASS;
- `git diff --check`: PASS.

## Remaining hard gates only

These are not routine engineering tasks that should be guessed around:

1. Target VPS Game has not been provisioned/purchased; clean-target preflight cannot be executed against that host yet.
2. BAY EXCUSE X InfinityFree production still requires read-only deploy-state plus authoritative DB/files/uploads manifest/final dump credentials before a production-faithful shadow restore can be performed.
3. School website canonical source revision and InfinityFree production DB/files authority are still not established; the existing production site remains Source of Truth.
4. LearnLab physical Windows/classroom acceptance remains a field gate; source candidate must be re-resolved before promotion.
5. Any production write freeze, DNS change, production cutover, destructive migration, secret rotation, or authority switch requires explicit approval.

## Resume rule

Start from this exact branch/PR, fetch remote, confirm remote head and CI, re-read live VPS state, then continue only work made possible by new authority/evidence. Do not recreate manifests, adapters, shadow runbooks, retention planners, or restore rehearsals already present here.
