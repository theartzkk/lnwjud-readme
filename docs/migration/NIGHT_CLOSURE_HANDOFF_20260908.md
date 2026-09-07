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
## 02:24 closure refresh

- Exact PR head `8ee227e31293571eff0e82ff46464928859129ce` is now confirmed by GitHub with both `CI` SUCCESS and `AWH Canonical Source Authority` SUCCESS.
- Fresh read-only live audit still reports root disk 29 GiB / 20 GiB used / 9.0 GiB available (69%), about 1.2 GiB RAM available, and `nginx`, `mariadb`, `php8.3-fpm`, `fail2ban` active.
- Canonical SQLite remains schema 20, integrity `ok`, and zero foreign-key violation rows.
- Guarded backup + isolated restore rehearsal were repeated successfully without replacing canonical SQLite. Latest proof: `awh-20260907T192458Z.sqlite`, 6434816 bytes, SHA-256 `68a9bdf39ef7a709a67ca78efb48a755f892fa22d896d4319e9c606e6ae2f35b`, integrity `ok`, FK violations `0`, schema `20`; both systemd services returned `Result=success` / `ExecMainStatus=0`.
- Exact-head local closure QA: migration/database/backup/retention focused tests 11/11 PASS, TypeScript typecheck PASS, `git diff --check` PASS.
- Storage classification is unchanged: recovery backups remain protected authority; `/opt/bay-gh-runner-temp-20260905` remains reversible `TEMP_BUILD_RUNTIME / DO_NOT_MIGRATE`, not promoted to purge while headroom is healthy.

## 03:20 closure refresh

- AWH migration head `cd18dba6623719bdae783c233993de535680b10c` is verified at the actual remote ref and PR #139 head. `CI` and `AWH Canonical Source Authority` both completed SUCCESS on that exact SHA. PR remains unmerged; no forced merge is justified while GitHub reports the aggregate merge state as `UNSTABLE`.
- BAY LearnLab candidate advanced to `0.8.0-rc.25` at `bcf21fe6a5e62a15f800a74072abb1101c30ff5a`, artifact SHA-256 `d9c08cacf22227711a64e564d403e36898f209b6240fc7b005c2d084f904d0fb`. Deterministic artifact build is proven, core security/runtime/package contracts pass, and exact-candidate teacher/projector Playwright QA is 9/9 PASS.
- LearnLab RC25 was installed only into BAY staging through PackageManager after an exact writer/source gate and a dedicated `ll_*` backup. Staging product state now records RC25 and previous-known-good RC24. Pre-install backup: `/var/backups/bay-staging/learnlab-pre-rc25-20260908-031444.sql.gz`, SHA-256 `bd935613109bf1303f9dd8568ee4b4ca8a7bc427d0568b805837532c116592ad`. Post-install evidence: 22 `ll_*` tables, 177 activities, 10 content packs, 11 devices. Stable/pilot channel manifests were deliberately not promoted; there was no production cutover.
- BAY EXCUSE X migration-proof branch advanced to `a852e9dc33732155472ad7db1045468ebe0f76d5`. Canonical release-source validation and the self-hosted release-safety job PASS. The separate GitHub-hosted MariaDB replay did not start because GitHub reported account billing/spending-limit infrastructure blocking; this is not recorded as a code/test failure and no spending change is authorized. Main remains the production-source authority until independently re-resolved.
- A failed read-only experiment through BAY bootstrap demonstrated that bootstrap is not a safe audit path because runtime migration handling may execute. Future read-only DB inventory must use direct DB metadata/read-only adapters or pre-proven audit scripts, never generic application bootstrap. No production database was involved.

## 03:26 storage-safety closure

- Fresh live audit: root filesystem 29 GiB with 9.0 GiB available (about 68-69% used), approximately 1.2 GiB RAM available; `nginx`, `mariadb`, `php8.3-fpm`, and `fail2ban` remain active. Canonical AWH SQLite remains schema 20, integrity `ok`, FK violations 0. Database inventory service completed with `Result=success` and `ExecMainStatus=0`.
- Retention dry-run exposed an unsafe adjacent condition: the automatic `--apply` timer considered the anomalous 172,216,320-byte revision-history recovery point and its paired same-window backup as ordinary scheduled candidates. No deletion was performed.
- Root cause was closed by adding explicit `.retain` support for scheduled backups to the canonical retention manager and publishing the pin list in retention evidence. Both `awh-20260907T161151Z.sqlite` and `awh-20260907T161249Z.sqlite` are pinned on the live VPS with an operational reason; the prior live retention script was preserved under backup config for rollback. After the guarded live update, `--plan` reports zero release/backup/manual candidates and zero candidate bytes. The normal retention timer remains enabled rather than being disabled globally.
- LearnLab staging pre-RC25 SQL backup passed `gzip -t` and SHA-256 recheck. The PackageManager pre-update rollback ZIP passed `unzip -t` with no compressed-data errors; rollback ZIP SHA-256 is `e72143180ee52f51d8ef2e49bdd2a2cab0b1ab68ad5f9963e2243a7c16c40385`. An attempted isolated restore command was not executed because the control layer blocked the destructive proof-DB lifecycle; no database mutation occurred from that attempt. Existing AWH isolated restore rehearsal remains the proven database restore path for this migration closure.
- Exact candidate source QA after the retention fix: control web build + release manifest PASS, TypeScript typecheck PASS, migration/database/backup/retention focused tests 12/12 PASS, `git diff --check` PASS. Static Database Studio artifact is emitted (`dist-web/database.html` plus `database.js`); local HTTP retrieval is 200. Headless Chrome rendering could not be used as additional visual evidence because the local Chrome process aborted in headless mode, so no visual PASS is claimed from that run.

## 04:20 post-merge closure refresh

- PR #139 is now merged into canonical non-production source branch `awh/api-independence` at signed merge commit `6900cf447e966fd093b22ad981d56cdde317d35b`. Production remains `m20-504ac7b986dd`; this source merge does not authorize or imply Production activation.
- Fresh live read-only audit: `awh-hub-01`; root 29 GiB / 20 GiB used / 9.0 GiB available (69%); approximately 1.2 GiB RAM available; `nginx`, `mariadb`, `php8.3-fpm`, and `fail2ban` active. Canonical SQLite remains schema 20, integrity `ok`, with zero FK violation rows.
- Retention `--plan` advanced with time and correctly surfaced one newly eligible scheduled backup pair: `awh-20260907T161636Z.sqlite` + manifest, 6,361,391 logical bytes. A DRY_RUN manifest proved the exact candidate while protecting current web/control `m20-504ac7b986dd`, protected release IDs, the three newest scheduled backups, and both explicit recovery pins `awh-20260907T161151Z.sqlite` and `awh-20260907T161249Z.sqlite`.
- Candidate backup verification PASS: SHA-256 `502175887dd9de76b543adbad67c0c6ca343c12ee7e160a2a9b270d241f275a6`, schema 20. Three newer scheduled backups (`182115Z`, `192458Z`, `203552Z`) independently verify as schema 20, so `161636Z` was classified `SAFE_TO_PURGE_SUPERSEDED_SCHEDULED_BACKUP` rather than recovery authority.
- Guarded retention `--apply` deleted only that verified candidate pair: 2 items / 6,361,391 bytes. Immediate post-apply `--plan` reports zero release, scheduled-backup, pre-release, and manual-backup candidates with `candidateBytes=0`; disk free increased to 9,584,476,160 bytes. No release, canonical DB, Project Vault, secret, current/previous/known-good pointer, or pinned recovery evidence was removed.
- The aggregate migration manifest was reconciled to the merged source authority and the post-cleanup live storage state. Older handoff paragraphs describing PR #139 as unmerged are historical evidence only; this section supersedes their source/merge status.

### Resume authority after this refresh

Resume from `awh/api-independence` merge commit `6900cf447e966fd093b22ad981d56cdde317d35b` plus this post-merge closure branch. Do not recreate PR #139 work. Remaining blockers are external/authority gates only unless fresh evidence changes that: target VPS not provisioned; InfinityFree production DB/files authority for BAY EXCUSE X and the school website is unavailable; LearnLab physical classroom acceptance remains external; Production cutover/DNS/write-freeze/authority switch requires explicit approval.
