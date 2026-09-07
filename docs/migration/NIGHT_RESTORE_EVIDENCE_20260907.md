# VPS Migration — Restore Evidence (2026-09-07 Night Shift)

## AWH SQLite

Live authority was inspected read-only before the drill: Production release `m20-504ac7b986dd`, SQLite schema 20, integrity `ok` and no foreign-key violation output. The newest canonical scheduled backup was restored into a random file under `/var/tmp` through the existing `HubBackupService::restoreDrill` path. Backup verification and restored SHA/schema comparison passed, and the temporary restore file count returned to zero.

**State: PASS.** No canonical SQLite file was overwritten.

## MariaDB migration rehearsal

The rehearsal was deliberately limited by code to database names containing `staging` or `proof`. It used `bay_staging`, never InfinityFree Production. The flow was `single-transaction dump -> random temporary database -> restore -> object reconciliation -> exact per-base-table row-count reconciliation -> cleanup`.

Observed result: 273 base tables before and after, zero row-count mismatch, zero missing tables, zero extra tables, and zero trigger/routine/event drift. The temporary database and SQL dump were both removed by the guarded cleanup path.

**State: PASS.** This proves the VPS MariaDB restore/reconcile mechanism against a BAY-shaped staging schema; it is not evidence that current InfinityFree Production has already been exported.

## Storage planning

The strict retention engine now has a `--plan` mode that performs no state/manifest writes and no deletion. On the live VPS it returned zero currently eligible release/backup candidates under the existing conservative retention windows.

Desktop artifacts are evaluated separately using release manifests plus hardlink references. The live store contained 42 objects: 18 referenced and 24 orphaned. Three orphan objects were at least 14 days old and qualified as reclaimable under the planner, totaling 1,900,367,219 bytes (~1.77 GiB). No artifact was deleted in this shift.

The extracted `/opt/bay-gh-runner-temp-20260905` tree (~711 MiB) had no running process, systemd reference, symlink reference, or open file and was not configured as a runner service. It is classified `TEMP_BUILD_RUNTIME / DO_NOT_MIGRATE`; no destructive cleanup was performed.
