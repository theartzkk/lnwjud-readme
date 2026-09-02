# AWH Current State Authority

Updated: 2026-09-02 11:37 ICT.

This file is the **current-state authority** for AWH operational status. Resolve the exact current `origin/awh/api-independence` SHA and re-read live runtime evidence before every mutation. Dated "current", "live", or "Production remains" statements in `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `DECISIONS.md`, and older checkpoint documents are historical evidence unless this file or a fresh inspection confirms them.

## Source and repository

- Canonical branch authority: `awh/api-independence`; exact SHA must be resolved from `origin` at read time. Last verified baseline before this file was created: `d57c504f95708ca6c8ee704d3354ed598adf1e04`.
- Five local worktrees are intentionally protected: dirty `awh/v0.1-migration`, dirty `awh/sustainability-foundation`, detached Production evidence `954cfa0`, dirty Project Source Authority evidence, and clean release snapshot `awh/production-surface-rc1`.
- Do not reset, remove, merge, or kill work associated with a dirty/protected worktree unless its ownership and recoverability are freshly proven.
- Canonical Project Memory precedence is `CURRENT_STATE.md` first, then `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `ARCHITECTURE.md`, and `DECISIONS.md`; legacy five-file worker metadata may be accepted during rollout but cannot claim current-state readiness or erase an existing current-state row.
- Legacy PR #7 is superseded by the canonical Task/Execution/Approval authorities and is closed without deleting history. PR #35 remains a future external-owner integration lane; do not merge its device-credential Safe Bridge as owner identity until principal-scoped external authorization converges with the current Hub trust model.

## Production

- Control/Web pointers: `m19-b66ef39cc986`.
- SQLite: schema 19, integrity `ok`, no foreign-key violation output in the latest verification.
- Managed runtime: Nginx, PHP 8.3 FPM, `awh-native-executor.timer`, and `awh-backup.timer` active in the latest verification.
- Pre-M19 rollback database remains preserved at `/var/backups/awh-hub/awh.sqlite.pre-m19-b66ef39cc986` (52,834,304 bytes at the latest verification).
- Root filesystem is approximately 42% used after approved hard-link compaction.
- Release artifact compaction is complete: 180/180 matched desktop artifact paths are store-linked and guaranteed reclaim is 0 bytes. Release history was preserved.

## M20 Project Source Authority

- Source authority is integrated as migration `019_project_source_authority.sql`, migration id `m20-project-source-authority`, target schema 20, preserving M19 Conversation Lifecycle.
- Build/typecheck, focused/full regression, Hub M20 fixtures, hosted CI, and `awh-ready` deployment dry-run/rollback evidence have passed on the current source line.
- Production is **not** schema 20. M20 activation must use the canonical `--deploy --approve --owner-auth --project-source-authority` path and remains blocked by the execution safety gate. Never bypass, disguise, encode around, or manually replay that gate/migration.

## Operating rule

Fresh observed runtime/source evidence outranks this snapshot. This snapshot outranks historical dated checkpoint prose. If they disagree, stop the affected mutation, reconcile the facts, update this file, and only then continue through the existing typed authority.
