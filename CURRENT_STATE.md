# AWH Current State Authority

Updated: 2026-09-03 02:55 ICT.

This file is the **current-state authority** for AWH operational status. Resolve the exact current `origin/awh/api-independence` SHA and re-read live runtime evidence before every mutation. Dated "current", "live", or "Production remains" statements in `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `DECISIONS.md`, and older checkpoint documents are historical evidence unless this file or a fresh inspection confirms them.

## Source and repository

- Canonical branch authority: `awh/api-independence`; exact SHA must be resolved from `origin` at read time. Last fully verified release-candidate source baseline before this documentation checkpoint: `de683f6251f287ec7b987acbb3f39d01d31b4b7a`; resolve from origin again before every mutation.
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
- Owner Source Authority is now durably bound for `Art’s Workspace Hub` to GitHub repository `theartzkk/lnwjud-readme`, ref `awh/api-independence`. The exact canonical revision is resolved dynamically from that ref and must not be treated as a fixed configuration value.
- Last verified bound-source snapshot resolved to Git SHA `881dc3bacf8dc453e6bd8e1211278eff81a5d57d`. Its immutable canonical remote-cache Vault revision is `5e9b1e13-da63-49df-b86f-5c96ae0a171d` with 505 files and 7,508,208 bytes. This revision is intentionally a mapped `CANDIDATE`, not an automatic promotion of the working Project Vault.
- The working Project Vault revision `ff6e2d36-a224-4ca5-8753-1a4115ededc4` remains `ACTIVE`; after canonical remote-cache creation the working Vault is marked `STALE` by design. Canonical remote cache must not silently overwrite or promote over working/worker state.
- AiPASS direct DOCX delivery is verified on Production against the bound canonical snapshot. Task `47b7a741-3861-44c5-81e6-197e33b16cf9` completed successfully and produced artifact `e86dfdd1-1270-4414-9be9-ec7548797e0f`. Its safety manifest contains 11 batches, 32 DOCX files, 21 source evidence parts, and 480 included source files; each DOCX is below 350,000 extracted UTF-8 bytes and each batch is below 650,000 bytes with only 2–3 files per batch.
- AiPASS user-facing delivery does not expose ZIP uploads. The stored ZIP is an internal atomic bundle only; user-facing delivery is bounded direct DOCX with exact canonical SHA/Vault metadata, secret/PII redaction, per-file and per-batch byte ceilings, and fail-closed manifest/tamper verification.
- Fresh rollback baseline for the `m20-95503e795c82` refresh is `/var/backups/awh-hub/awh.sqlite.pre-m20-95503e795c82`, SHA-256 `6139d17498fe680c7c2b2ad7e78a8f8bd89b74d6a1e37f31d9d9b9c112496229`, schema 20, integrity `ok`, with zero foreign-key violations. The prior verified scheduled backup `awh-20260902T081712Z.sqlite` remains preserved.
- Build/typecheck, focused/full regression, Hub M20 fixtures, hosted CI, exact-canonical dry-run/rollback, post-activation route checks, Project Vault source sync, schema20 backup verification, hosting timer restart continuity, Owner Source binding, canonical remote-cache binding, and Production AiPASS DOCX generation have passed.

## 2026-09-03 one-night release-candidate closure

- PR #108 (Owner Source/AiPASS UX), PR #109 (six-file Project Memory metadata reconciliation), PR #110 (Owner Night Shift projection), PR #111 (oversized Project Memory metadata reconciliation), and PR #98 (exact-SHA desktop release evidence) are merged. PR #35 remains intentionally outside this release lane.
- Release-candidate source baseline `de683f6251f287ec7b987acbb3f39d01d31b4b7a` passed exact-head/push hosted CI run `33675363802`: Ubuntu regression/Hub/runtime dependency security/ZipArchive gate, Windows regression, Linux desktop runtime, macOS package, and Windows installer all succeeded.
- Exact-source artifacts from that run are: macOS x64 artifact `9864165153` digest `sha256:b2814520e85e32e18bf0ac25f1a34241f144d24e44d4945e51978a0383008133`; Windows installer artifact `9864239524` digest `sha256:95151cd94eed9e88ef211412d899ed06d7ef64771c42a75b10ecc0c059b1ac3a`; Windows x64 artifact `9864243278` digest `sha256:a69822b6c9175ffc469ee005f1cbe67edf76f3992fad6b544a3b1117d44cb7ac`.
- The exact-source release-readiness evaluator returned `READY` after fresh schema-20 backup verification, isolated restore drill (`integrity=ok`, zero foreign-key violations), migration/rollback contract gates, and strict known-host verification. This is release-candidate evidence only; it is not Production activation authority.
- Production remained read-only during this closure. Live pointer remains `m20-95503e795c82`; schema is 20, integrity is `ok`, foreign-key check is empty, root filesystem is about 45% used, and Nginx/PHP-FPM plus native-executor/hosting-operator/backup timers are active. The latest scheduled database backup verified in the restore drill is `awh-20260902T081712Z.sqlite`.
- Production source binding still resolves the historical canonical snapshot `881dc3bacf8dc453e6bd8e1211278eff81a5d57d`; therefore canonical-vs-Production drift is intentional and unresolved until a separately approved deployment/refresh.
- Hub Project Memory for `Art’s Workspace Hub` is still legacy five-file metadata: `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `ARCHITECTURE.md`, and `DECISIONS.md`; `CURRENT_STATE.md` is absent and `memoryReady=false`. The installed Mac AWH bundle is `1.0.0-rc.1` and already contains the six-file reconciliation code, but its uniquely registered local AWH workspace is an older local revision (`72ce7e7c7737daf5767a46a578a39c40041fe136`) where `CURRENT_STATE.md` is absent. The worker therefore remains truthfully not ready; no Production metadata was republished and no protected workspace was altered.
- Hub worker rows last observed Art’s Mac at `2026-09-02T18:44:58+00:00` and Art’s Windows PC at `2026-09-02T08:24:53+00:00`. With the canonical 120-second stale threshold both are stale at this checkpoint even though their stored row state is `READY`; Windows was not touched blindly. Desktop Commander remote bridge remains a separate runtime from the AWH control-plane worker.
- Daily Workspace source regressions remain green for reversible conversation lifecycle, provider-safe HEIC handling, bounded multi-file/camera attachment flow, canonical mobile Work, and existing Night Shift authority reuse. Physical authenticated iPhone Safari remains a manual field gate and was not fabricated from viewport simulation.

## Operating rule

Fresh observed runtime/source evidence outranks this snapshot. This snapshot outranks historical dated checkpoint prose. If they disagree, stop the affected mutation, reconcile the facts, update this file, and only then continue through the existing typed authority.
