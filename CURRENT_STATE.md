# AWH Current State Authority

Updated: 2026-09-02 14:10 ICT.

This file is the **current-state authority** for AWH operational status. Resolve the exact current `origin/awh/api-independence` SHA and re-read live runtime evidence before every mutation. Dated "current", "live", or "Production remains" statements in `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `DECISIONS.md`, and older checkpoint documents are historical evidence unless this file or a fresh inspection confirms them.

## Source and repository

- Canonical branch authority: `awh/api-independence`; exact SHA must be resolved from `origin` at read time. Last verified canonical source baseline: `b95cec93ee94d40ccc00cb9a4957d023da936e9c` (resolve from origin again before every mutation).
- Five local worktrees are intentionally protected: dirty `awh/v0.1-migration`, dirty `awh/sustainability-foundation`, detached Production evidence `954cfa0`, dirty Project Source Authority evidence, and clean release snapshot `awh/production-surface-rc1`.
- Do not reset, remove, merge, or kill work associated with a dirty/protected worktree unless its ownership and recoverability are freshly proven.
- Canonical Project Memory precedence is `CURRENT_STATE.md` first, then `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `ARCHITECTURE.md`, and `DECISIONS.md`; legacy five-file worker metadata may be accepted during rollout but cannot claim current-state readiness or erase an existing current-state row.
- Legacy PR #7 is superseded by the canonical Task/Execution/Approval authorities and is closed without deleting history. PR #35 remains a future external-owner integration lane; do not merge its device-credential Safe Bridge as owner identity until principal-scoped external authorization converges with the current Hub trust model.

## Production

- Control/Web pointers: `m20-b95cec93ee94`.
- SQLite: schema 20, integrity `ok`, no foreign-key violation output in the latest verification.
- Migration ledger contains exactly the M20 authority row `m20-project-source-authority|20`; all six canonical-source columns are present on `projects`.
- Production Nginx generic `/api/v1/` read gateway is versioned through `/opt/awh-hub/control-plane-current/hub/public/web-gateway.php`; the legacy shared gateway is no longer the active generic read authority.
- Managed runtime: Nginx, PHP 8.3 FPM, `awh-native-executor.timer`, and `awh-backup.timer` active in the latest verification.
- Pre-M19 rollback database remains preserved at `/var/backups/awh-hub/awh.sqlite.pre-m19-b66ef39cc986` (52,834,304 bytes at the latest verification).
- Root filesystem is approximately 43% used after M20 activation and prior approved hard-link compaction.
- Release artifact compaction is complete: 180/180 matched desktop artifact paths are store-linked and guaranteed reclaim is 0 bytes. Release history was preserved.

## M20 Project Source Authority

- Source authority is integrated as migration `019_project_source_authority.sql`, migration id `m20-project-source-authority`, target schema 20, preserving M19 Conversation Lifecycle.
- M20 Production activation completed through the canonical `--deploy --approve --owner-auth --project-source-authority` path on release `m20-b95cec93ee94`.
- AWH Project Vault has an ACTIVE post-activation source archive revision (`d8613044-8752-4213-9abf-e2c40b52c10e`) containing 498 tracked files, including `CURRENT_STATE.md`.
- Project canonical-source metadata fields are currently unbound for existing projects; capability activation is complete, but canonical Git provider/repository/ref/revision binding remains a separate typed owner action and must not be inferred from Vault archive sync.
- Fresh post-M20 backup `awh-20260902T070957Z.sqlite` is verified at 64,155,648 bytes, SHA-256 `2921cb9c0f426c8355301e16802600b21cef70cf45d45e95f4df52d4a6b5cf56`, schema 20, integrity `ok`, with no foreign-key violation output.
- Build/typecheck, focused/full regression, Hub M20 fixtures, hosted CI, exact-canonical dry-run/rollback, post-activation route checks, Project Vault source sync, and schema20 backup verification have passed.

## Operating rule

Fresh observed runtime/source evidence outranks this snapshot. This snapshot outranks historical dated checkpoint prose. If they disagree, stop the affected mutation, reconcile the facts, update this file, and only then continue through the existing typed authority.
