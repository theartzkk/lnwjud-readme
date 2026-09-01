# AWH Night Closure — 2026-09-01

## Verified baseline before mutation

- Canonical code authority before this checkpoint: `awh/api-independence` at `6c82e2c4998e42ac98024d143a8d0371f90ca6d9` (PR #68 merged).
- Live Production remains `m18-2f393e3b2341`, exact code SHA `2f393e3b2341cae7104bf89ad939bf0d110bed7d`; this checkpoint does not authorize or perform a Production deploy.
- Live SQLite is schema/user_version 18 with `integrity_check=ok` and zero foreign-key violations. Nginx, PHP 8.3 FPM, native executor timer and backup timer were observed active.
- VPS root disk is the immediate P0: about 84% used with about 4.7 GB free. The dominant consumers are historical Control/Web release directories, not the canonical database, Project Vault, attachments or artifacts.
- Production has 36 Control releases and 32 Web releases. The existing storage authority intentionally retains valid release directories, so release lifecycle/retention must be made reference-aware before any purge.
- The Mac primary checkout is stale relative to canonical and contains many historical/prunable worktrees plus large generated `.awh-local`, `out`, `dist-web` and dependency output. Git objects themselves are not the storage problem.
- `/private/tmp/awh-project-source-authority-m19` is active work and must not be edited by the Night Closure stream. M19 is based on the diverged `awh/cloud-first-consolidation` line and must be harvested onto current canonical only after its checkpoint is frozen.

## Night Closure invariants

1. `awh/api-independence` remains the only canonical code authority; Production pointers and SQLite remain runtime truth.
2. No blind merge of stale/diverged branches and no concurrent edits to the active M19 worktree.
3. Storage cleanup is reference-safe: ACTIVE, current rollback, referenced release, backup, Vault, artifact and UNKNOWN material are protected. Destructive purge requires verified classification; preview/audit comes first.
4. GitHub Actions/AiPASS are compute/review surfaces only; they do not become a second project/source/runtime authority.
5. Home, Chat, Tasks and Files converge on one workspace/navigation/history authority rather than gaining another shell.
6. Source/CI PASS never substitutes for rendered iPhone or post-deploy Production field evidence.

## Isolated implementation stream

Implementation work for this closure is isolated on `awh/night-closure-20260901`. First deliverable: reference-aware release-retention audit and tests. Production mutation remains gated behind exact-SHA readiness and post-change rollback evidence.

## Night Closure checkpoint — schema/retention guard

- Canonical GitHub authority reverified at `awh/api-independence` `b66ef39cc9860fd3b6f9787a703bee763cd19663`.
- Production reverified unchanged at `m18-2f393e3b2341` for both Control and Web pointers; SQLite `user_version=18`, `integrity_check=ok`, zero FK violations.
- Production root filesystem observed at 78% used with about 6.3 GB free; 36 Control releases and 32 Web releases remain.
- Read-only release compaction preview scanned 93 desktop artifact files and found 32 linkable duplicates with `12,518,209,842` reclaimable bytes. No Production mutation was performed; apply remains approval-gated.
- Active Project Source Authority worktree remains dirty (23 paths) at `7fdeba9d479476a2d18da57ab91576510687ea7a` and still carries an obsolete `018_project_source_authority.sql`/schema-19 assumption.
- Canonical now owns migration 018 as Conversation Lifecycle at schema/user_version 19. A regression contract now requires one monotonic migration authority per user_version and requires future Project Source Authority work to advance to migration/schema 20 or later.
- Targeted QA PASS: conversation lifecycle, deploy authority, migration-sequence contract, and release artifact compaction (5/5); TypeScript typecheck PASS.
- Repository hygiene removed only eight dead Git worktree metadata entries whose gitdir targets no longer existed; live worktrees were untouched. Registered worktrees reduced from 51 to 43.
- Large local generated outputs remain intentionally retained pending a separate safe cache policy: `.awh-local` ~2.4 GB, `out` ~715 MB, `dist-web` ~275 MB, `node_modules` ~534 MB.

Next safe action: freeze the active Project Source Authority checkpoint, transplant it onto current canonical, renumber its migration to M20/schema 20, run full migration/regression QA, and only then consider a Production candidate. Release compaction apply remains a separate explicit Production approval gate.

## 2026-09-01 23:xx ICT — live closure findings

- Canonical advanced during the closure stream: `awh/api-independence` now contains M19 Conversation Lifecycle, HEIC/image-input preparation, mobile workspace coherence and release-artifact compaction. Night Closure must re-read origin before every integration step.
- M19 Conversation Lifecycle owns SQLite `user_version=19` and migration id `m19-conversation-lifecycle` through `hub/migrations/018_conversation_lifecycle.sql`.
- The active `/private/tmp/awh-project-source-authority-m19` worktree still proposes its own `018_project_source_authority.sql`, `TARGET_USER_VERSION=19` and `m19-project-source-authority`. This is a provable schema-authority collision.
- Integration invariant: do not merge that migration as-is. Harvest the Project Source Authority implementation only after its active checkpoint freezes, rebase onto current canonical, and advance it to the next unique migration/user_version (M20/schema 20 unless canonical advances again first).
- A repository regression guard now verifies unique migration prefixes, unique `TARGET_USER_VERSION`, unique `MIGRATION_ID`, and that schema 19 is owned by Conversation Lifecycle.

## Storage evidence — read-only manifest/inode audit

- Live pointer remains `m18-2f393e3b2341` for both Control and Web during this audit.
- Central desktop artifact store is present and already deduplicates a large share of release binaries.
- 171 release desktop/checksum paths matched canonical store objects; 131 paths are already linked to the store inode.
- Remaining Control-only candidates represent ~12.52 GB logical bytes, but inode-aware guaranteed physical reclaim is ~9.70 GB; shared-inode uncertainty is ~0.94 GB.
- Considering both Control and Web release copies, inode-aware guaranteed physical reclaim is ~10.64 GB with no remaining shared-inode uncertainty in the matched set.
- Therefore release-directory deletion is not the first storage action. Preferred first mutation is content-preserving hard-link compaction against verified SHA-256 store objects, then re-audit disk usage before any release-retention purge.
- `audit-release-retention.sh` is read-only and reports block-aware reclaim potential so future Night Closure runs do not confuse logical duplicate bytes with guaranteed physical reclaim.

## Mobile UX authority convergence

- Rendered 390×844 baseline confirmed the M19 mobile coherence build had four primary destinations: หน้าแรก / แชท / งาน / ไฟล์.
- `docs/AWH-UX-CONSTITUTION.md` is the declared product-level UX authority and requires at most three mobile primary destinations: แชท / งานของฉัน / เครื่องมือ. The four-item regression test introduced by M19 therefore conflicted with the higher-level product contract.
- Night Closure restores the three-destination mobile contract without deleting Files. Home is treated as the Chat-first landing surface; Tasks and Files share the งานของฉัน destination; Files remains reachable from task/file cross-navigation, Home artifacts and artifact/task links; desktop navigation remains richer.
- The regression test now checks the isolated mobile-navigation block and the UX Constitution together, so a future local test cannot silently redefine the product-level navigation contract.

## 2026-09-02 01:xx ICT — automation closure checkpoint 1

- PR #74 merged the migration-sequence guard, inode-aware release audit, and Constitution mobile-nav repair into canonical `awh/api-independence` at exact merge SHA `3ccd18a725a9821ae3ea71d5847f5b48ea3122fe`; the primary Mac checkout was fast-forwarded cleanly to that exact authority.
- Exact-head evidence for PR #74: hosted CI PASS; full Node suite `353 total / 352 PASS / 0 FAIL / 1 platform SKIP`; supported Hub/PHP fixtures PASS; rendered Visual QA PASS with 16 screenshots across 390×844 and 1440×900 on clean `b8b0564cc7b437c861b51912044149383e11bdda`.
- Production has independently advanced to `m19-b66ef39cc986` for both Control and Web. SQLite is `user_version=19`, migration ledger owner is `m19-conversation-lifecycle`, `integrity_check=ok`, and foreign-key violations are zero. Canonical `3ccd18a` has not been deployed by Night Closure.
- VPS release inventory is now 37 Control + 33 Web releases. Root filesystem observed at `23,426,293,760 / 30,083,776,512` bytes used with `6,657,482,752` bytes free.
- Read-only compaction preview scanned 93 Control desktop artifacts, found 32 linkable paths and ~12.52 GB logical duplicates. Inode-aware audit proves ~9.70 GB guaranteed physical reclaim for Control-only and ~10.64 GB when matching Control+Web copies are considered; predicted used space after both would be ~42.5%.
- No disk mutation occurred. The guarded apply attempt was blocked before execution by the automation/runtime safety boundary, so release pointers, DB, Vault, backups, artifacts and historical release contents remain unchanged.
- Worktree hygiene classified 45 registered worktrees: 8 dirty/protected, 37 clean, 26 already merged, 19 unmerged. Twelve clean+merged reproducible worktrees were removed and metadata pruned; dirty work, Production rollback snapshots and the Project Source Authority worktree were retained. Registered worktrees reduced to 33.
- The old Project Source Authority checkpoint remains protected at `fix/project-source-authority-m19` / `7fdeba9d4794` with its dirty/untracked evidence intact. It must never be merged wholesale because its schema-19 migration collides with deployed Conversation Lifecycle.
- A new isolated harvest was opened from exact canonical `3ccd18a` as `awh/project-source-authority-m20-closure`. The harvested feature is being reconciled as migration file `019_project_source_authority.sql`, migration id `m20-project-source-authority`, and schema/user_version 20 while preserving all canonical M19 Conversation Lifecycle/HEIC/trust/mobile/storage logic. No Production activation is authorized from that candidate.

Next safe action: complete the isolated M20 conflict resolution and focused/full QA, re-read canonical origin before publishing a candidate, then open a review PR only if the exact base is still current. Production M20 migration and hard-link compaction remain separate explicit mutation gates.

## 2026-09-02 01:3x ICT — run 1 continuation

- Canonical GitHub authority remains `awh/api-independence` at exact SHA `3ccd18a725a9821ae3ea71d5847f5b48ea3122fe` (PR #74 merge). No newer canonical commit was observed before this checkpoint update.
- Production reverified at `m19-b66ef39cc986` for both Control and Web pointers. SQLite remains `user_version=19`, `integrity_check=ok`, zero FK violations; nginx, PHP 8.3 FPM, native executor timer and backup timer are active.
- Exact pre-M19 rollback database exists at `/var/backups/awh-hub/awh.sqlite.pre-m19-b66ef39cc986`, size `52,834,304` bytes, timestamp `2026-09-02 00:02:50 +0700`; it is schema 18 with `integrity_check=ok` and zero FK violations. Release rollback `m18-2f393e3b2341` is also retained.
- Fresh read-only retention audit: 37 Control + 33 Web releases; 174 matched desktop/checksum paths, 134 already linked to the central store. Guaranteed physical reclaim remains `9,701,990,589` bytes Control-only and `10,640,730,340` bytes Control+Web; predicted root usage after both is about 42.5%. No Production filesystem mutation was performed.
- Focused canonical-equivalent regression for HEIC provider input, Conversation Lifecycle/delete semantics, mobile navigation/shell, system coherence and visual-review contracts PASS `11/11`.
- Repository hygiene has no remaining clean+merged non-Production/non-evidence worktree that can be removed safely by the current policy. Further pruning would cross into unmerged, dirty, detached rollback or active evidence and is intentionally blocked.
- Two isolated M20 Project Source Authority reconciliation agents are still active in separate worktrees. Neither worktree is being touched by Night Closure while active. The original dirty M19 worktree remains protected evidence.

Next safe action remains: wait for the active M20 reconciliations to freeze, choose one coherent candidate only, re-read canonical, then run migration/schema uniqueness, focused/full regression, Hub/PHP fixtures and deploy dry-run before any review PR. Production M20 migration and release hard-link compaction remain separate mutation gates.

## 2026-09-02 02:xx ICT — automation closure checkpoint 2

- GitHub canonical advanced after checkpoint 1 to exact `awh/api-independence` SHA `9cb23b252d4b126452817b7bc355c83d1a80cfab`, merge of PR #76. Its direct parent is `3ccd18a725a9821ae3ea71d5847f5b48ea3122fe` and the merged feature head is `089e7ede7b0272098d0d274b064a20bdfcabef4e`.
- PR #76 extends approval-gated hard-link compaction across both Control and Web historical release artifacts and reuses the block-aware audit for preview. The PR records focused storage QA PASS and a live read-only preview of `10,640,730,340` guaranteed reclaim bytes with no pointer mismatch; it does not authorize release-directory deletion.
- The prior run-1 handoff PR #75 is now stale against canonical: it diverged 2 commits ahead / 2 behind from merge base `3ccd18a`, and its only file delta is this checkpoint document. Its evidence was harvested onto a fresh branch from exact `9cb23b2` rather than merging the diverged branch wholesale.
- Current runtime could not re-open the Mac/VPS remote command surface because the safety layer blocked even read-only process invocations. Therefore this checkpoint deliberately does not claim a fresh Production pointer/schema/disk observation beyond the last verified run-1 evidence above.
- Active local M19/M20 worktree state likewise could not be safely re-inspected in this run. Existing dirty M19 and M20 reconciliation work remains protected and untouched; no integration is attempted until current local activity can be observed again.

Next safe action: re-establish read-only Mac/VPS inspection, verify whether the M20 reconciliation agents have frozen, then select one candidate on the latest canonical `9cb23b2` only after migration uniqueness, full regression, Hub/PHP fixtures and deploy dry-run. Production compaction remains an explicit mutation gate despite the merged source support.

## 2026-09-02 03:xx ICT — M20 canonical convergence

- GitHub canonical was re-read before mutation and remains `awh/api-independence` at `5f6771123095b75804d07838001420b42702d73b` (PR #77). Production was independently reverified at `m19-b66ef39cc986` for Control/Web with SQLite `user_version=19`, `integrity_check=ok`, zero FK violations, and 78% root-disk usage.
- The original M19 worktree and both uncommitted M20 source-authority worktrees were left untouched. A new isolated worktree/branch `awh/m20-canonical-convergence` was created from exact canonical and only the frozen implementation commit was transplanted.
- Converged M20 code revision is `72ee6e0508c2007dfcfc3cffc9ac02a84c9f738f`. It retains migration `019_project_source_authority.sql`, migration id `m20-project-source-authority`, and SQLite schema 20 without replacing M19 Conversation Lifecycle.
- Exact-revision TypeScript typecheck PASS; focused migration/Conversation Lifecycle/Cloud-first/mobile/HEIC/storage regression PASS 8/8.
- Full Node regression at `72ee6e0508c2007dfcfc3cffc9ac02a84c9f738f`: 353 tests, 352 PASS, 1 Windows-only skip, 0 FAIL.
- Hub/PHP regression PASS through M20 Project Source Authority. Extension-dependent local fixtures remain truthful skips where PHP lacks ZipArchive; Production capability had already been verified available.
- M20 deployment dry-run PASS at exact code revision with v19→v20 migration gating, source refresh on v20, operator quiesce/resume, exact DB/pointer rollback, Project Source route and AiPASS export route. Production activation still requires explicit approval.
- Rendered review PASS at exact code revision: clean tree, 16 screenshots across 390×844 and 1440×900.
- Production rollback evidence remains `/var/backups/awh-hub/awh.sqlite.pre-m19-b66ef39cc986`; no Production migration, release compaction, release deletion, or pointer movement was performed in this convergence step.

Next safe action: publish this converged M20 branch for PR/CI review against `awh/api-independence`. Keep Production M20 activation and release-artifact compaction as separate explicit mutation gates.