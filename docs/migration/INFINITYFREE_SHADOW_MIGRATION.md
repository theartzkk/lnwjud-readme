# InfinityFree → VPS shadow migration contract

This procedure applies independently to the school website and BAY EXCUSE X. It deliberately separates **copy/verification** from **cutover**.

## Phase 1 — read-only authority capture

Record the current production URL, exact application source revision (when available), PHP/runtime version, DB engine/version, database name (never password), charset/collation, table list, row counts, indexes, foreign keys, triggers/views/events, auto-increment values, and persistent upload roots/file counts/checksums. Save the SQL dump and file archive as immutable migration inputs with SHA-256 manifests.

If any of those cannot be proven, mark the field `UNKNOWN`; never infer it from staging/proof databases.

## Phase 2 — shadow restore

Create an isolated target DB/user and release path on the VPS. Restore the dump and persistent files there. The public production site continues to write only to InfinityFree. Run schema/row-count/checksum reconciliation and application critical-flow QA against the shadow URL. No reverse sync is allowed.

## Phase 3 — final cutover (requires explicit approval)

1. Confirm a recent verified recovery point and successful restore rehearsal.
2. Put old production into a short write freeze/maintenance state.
3. Create the final dump and final file delta; hash both.
4. Restore to the prepared VPS DB and reconcile against the final manifest.
5. Run smoke + critical-flow QA while old production is still frozen.
6. Only after all checks pass, switch production DNS/route and enable writes on the VPS.
7. Keep old production frozen/read-only as evidence during the observation window.

## Rollback boundary

Before the new VPS accepts writes, rollback is simply reopening the old authority. After the new VPS accepts writes, DNS-only rollback is forbidden: preserve/reconcile all post-cutover writes first.
