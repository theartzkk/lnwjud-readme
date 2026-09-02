# AWH Current State Authority

Updated: 2026-09-02 15:18 ICT.

This file is the **current-state authority** for AWH operational status. Resolve the exact current `origin/awh/api-independence` SHA and re-read live runtime evidence before every mutation. Dated "current", "live", or "Production remains" statements in `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `DECISIONS.md`, and older checkpoint documents are historical evidence unless this file or a fresh inspection confirms them.

## Source and repository

- Canonical branch authority: `awh/api-independence`; exact SHA must be resolved from `origin` at read time. Last verified canonical source baseline: `95503e795c8229da2caafe6b24e26c71f271efc7` (resolve from origin again before every mutation).
- Five local worktrees are intentionally protected: dirty `awh/v0.1-migration`, dirty `awh/sustainability-foundation`, detached Production evidence `954cfa0`, dirty Project Source Authority evidence, and clean release snapshot `awh/production-surface-rc1`.
- Do not reset, remove, merge, or kill work associated with a dirty/protected worktree unless its ownership and recoverability are freshly proven.
- Canonical Project Memory precedence is `CURRENT_STATE.md` first, then `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `ARCHITECTURE.md`, and `DECISIONS.md`; legacy five-file worker metadata may be accepted during rollout but cannot claim current-state readiness or erase an existing current-state row.
- Legacy PR #7 is superseded by the canonical Task/Execution/Approval authorities and is closed without deleting history. PR #35 remains a future external-owner integration lane; do not merge its device-credential Safe Bridge as owner identity until principal-scoped external authorization converges with the current Hub trust model.

## Production

- Control/Web pointers: `m20-95503e795c82`.
- SQLite: schema 20, integrity `ok`, no foreign-key violation output in the latest verification.
- Migration ledger contains exactly the M20 authority row `m20-project-source-authority|20`; all six canonical-source columns are present on `projects`.
- Production Nginx generic `/api/v1/` read gateway is versioned through `/opt/awh-hub/control-plane-current/hub/public/web-gateway.php`; the legacy shared gateway is no longer the active generic read authority.
- Managed runtime: Nginx, PHP 8.3 FPM, `awh-native-executor.timer`, `awh-hosting-operator.timer`, and `awh-backup.timer` active in the latest verification. The hosting timer is `active (waiting)`, includes `OnActiveSec=5s` plus `OnUnitActiveSec=30s`, and has a finite next trigger after the M20 source refresh.
- Pre-M19 rollback database remains preserved at `/var/backups/awh-hub/awh.sqlite.pre-m19-b66ef39cc986` (52,834,304 bytes at the latest verification).
- Root filesystem is approximately 43% used after M20 activation and prior approved hard-link compaction.
- Release artifact compaction is complete: 180/180 matched desktop artifact paths are store-linked and guaranteed reclaim is 0 bytes. Release history was preserved.

## M20 Project Source Authority

- Source authority is integrated as migration `019_project_source_authority.sql`, migration id `m20-project-source-authority`, target schema 20, preserving M19 Conversation Lifecycle.
- M20 Production activation completed through the canonical `--deploy --approve --owner-auth --project-source-authority` path. The latest schema20 source refresh is release `m20-95503e795c82`; it did not re-run migration 019 and passed the guarded live-canonical preflight before Production mutation.
- AWH Project Vault has an ACTIVE post-refresh source archive revision (`ff6e2d36-a224-4ca5-8753-1a4115ededc4`) containing 505 tracked files; the manifest includes `CURRENT_STATE.md` and `hub/src/HubAiPassProjectExportService.php`.
- Project canonical-source metadata fields are currently unbound for existing projects; capability activation is complete, but canonical Git provider/repository/ref/revision binding remains a separate typed owner action and must not be inferred from Vault archive sync.
- AiPASS review delivery is now deployed as bounded direct DOCX batches: the user-facing path does not expose ZIP uploads, final DOCX text is bounded to 350,000 extracted UTF-8 bytes per file, batches to 650,000 bytes and 16 DOCX files, with fail-closed manifest/tamper verification.
- Fresh rollback baseline for the `m20-95503e795c82` refresh is `/var/backups/awh-hub/awh.sqlite.pre-m20-95503e795c82`, SHA-256 `6139d17498fe680c7c2b2ad7e78a8f8bd89b74d6a1e37f31d9d9b9c112496229`, schema 20, integrity `ok`, with zero foreign-key violations. The prior verified scheduled backup `awh-20260902T081712Z.sqlite` remains preserved.
- Build/typecheck, focused/full regression, Hub M20 fixtures, hosted CI, exact-canonical dry-run/rollback, post-activation route checks, Project Vault source sync, schema20 backup verification, and hosting timer restart continuity have passed.

## Operating rule

Fresh observed runtime/source evidence outranks this snapshot. This snapshot outranks historical dated checkpoint prose. If they disagree, stop the affected mutation, reconcile the facts, update this file, and only then continue through the existing typed authority.
