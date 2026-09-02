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
## 2026-09-02 03:3x ICT — automation closure checkpoint 3

- Canonical was re-read before mutation at `awh/api-independence` `5f6771123095b75804d07838001420b42702d73b`; PR #78 head `414c0fc2b291a7991fd1f8d0be7a705bb9344b5a` then completed cross-platform CI successfully in run `33555414818`.
- PR #78 was promoted from draft and merged. Canonical is now exact merge SHA `7246e21f0f55e094ebcf6912d6efa06cc8418988`, with Project Source Authority integrated as `019_project_source_authority.sql`, migration id `m20-project-source-authority`, schema target 20. Production was not migrated or redeployed.
- Production was freshly reverified after source convergence: Control/Web pointers both remain `m19-b66ef39cc986`; SQLite remains `user_version=19`, `integrity_check=ok`, zero foreign-key violations. nginx, PHP 8.3 FPM, native executor timer and backup timer are active.
- Exact pre-M19 rollback database remains present at `/var/backups/awh-hub/awh.sqlite.pre-m19-b66ef39cc986`, size `52,834,304` bytes, timestamp `2026-09-02 00:02:50 +0700`.
- Fresh read-only release-retention audit after the M20 merge: 37 Control + 33 Web releases, 174 matched desktop/checksum paths, 134 already linked. Guaranteed physical reclaim remains `9,701,990,589` bytes Control-only and `10,640,730,340` bytes Control+Web. Root filesystem is ~78% used; predicted usage after verified both-side compaction remains ~42.5%. No Production filesystem mutation occurred.
- Repository hygiene removed only three clean, fully merged, reproducible temporary worktrees: `awh/m20-canonical-convergence`, `awh/night-closure-20260901`, and `awh/night-closure-storage-both`; dirty M19/M20 evidence and rollback worktrees remain protected. Registered worktrees are now 35.
- Current canonical focused QA PASS: TypeScript typecheck plus 15/15 tests covering HEIC provider-safe input, Conversation Lifecycle/delete semantics, three-destination mobile shell, Tasks/Files surfaces, policy-paused readiness, release dedup contract, and visual-review authority.

Next safe action: keep Production at schema 19 until explicit M20 activation approval. The highest-value independent safe work is repository/worktree classification plus continued rendered/field QA on canonical. Release hard-link compaction is ready by evidence but remains a separate Production mutation gate.

- Post-merge rendered QA also PASS on clean checkpoint commit `29f0d157326b66a219df6c7bc438902ee5370ec7`: 16 screenshots across 390×844 and 1440×900, with the renderer reporting `dirty=false`.

## 2026-09-02 05:0x ICT — automation closure checkpoint 5

- Canonical GitHub Source of Truth was re-read first and remains `awh/api-independence` at exact SHA `253160a7ec7009b7db973160e722589326e4435b` (PR #79 merge); no newer canonical commit was present.
- Local worktree inspection found five pre-existing registered worktrees before this checkpoint. The only dirty feature worktree is `/Users/mac/Desktop/AWH-project-source-authority` on `fix/project-source-authority-20260901` at `4a6b91da1a6ac20afd9a43abb8cd33cf6e44f364`, with seven tracked files modified plus untracked `node_modules`; it was treated as active evidence and not edited, reset, merged, or removed.
- A new isolated clean QA worktree was created from exact canonical SHA at `/Users/mac/Desktop/AWH-night-closure-253160a`; this avoids collision with the dirty Project Source Authority/M19 evidence worktree.
- Fresh Production read-only verification: Control pointer `/opt/awh-hub/control-plane-current` and Web pointer `/var/www/awh-web/current` both resolve to `m19-b66ef39cc986`; SQLite remains schema 19 with `integrity_check=ok` and zero FK violations. nginx, PHP 8.3 FPM, native executor timer, and backup timer are active.
- Exact pre-M19 rollback database remains `/var/backups/awh-hub/awh.sqlite.pre-m19-b66ef39cc986`, size `52,834,304` bytes, timestamp `2026-09-02 00:02:50 +0700`.
- Fresh canonical release-retention preview: 37 Control + 33 Web releases, 174 matched artifact paths, 134 already store-linked. Guaranteed physical reclaim is `9,701,990,589` bytes Control-only and `10,640,730,340` bytes Control+Web. Root filesystem currently uses `23,501,127,680 / 30,083,776,512` bytes (~79%); predicted used after verified both-side compaction is `12,860,397,340` bytes (~42.7%). No Production filesystem mutation was performed.
- Current canonical focused QA PASS: TypeScript typecheck plus 13/13 tests covering HEIC provider-safe input, conversation lifecycle/delete semantics, Home/Tasks/Files surfaces, release-retention audit, and visual-review evidence rules.

Next safe action: keep Production at M19/schema 19 until explicit approval for M20 activation. The verified ~10.64 GB hard-link compaction remains the highest-value Production disk-recovery mutation but still requires its separate approval gate. Keep the dirty Project Source Authority worktree untouched until its owner/agent state is explicitly reconciled against canonical.
## 2026-09-02 06:0x ICT — automation closure checkpoint 6

- Canonical GitHub authority was re-read before work and remained `awh/api-independence` at exact SHA `45deeaf7a8fddc91e59bdf8e2db5bfa946819f49` (PR #80 merge); no newer canonical commit was observed before this checkpoint branch was created.
- Fresh Production read-only verification: Control and Web pointers both resolve to `m19-b66ef39cc986`; SQLite remains schema 19 with `integrity_check=ok` and zero FK violations. nginx, PHP 8.3 FPM, native-executor timer, and backup timer are active. Exact pre-M19 rollback DB remains `/var/backups/awh-hub/awh.sqlite.pre-m19-b66ef39cc986`, 52,834,304 bytes, timestamp `2026-09-02 00:02:50 +0700`.
- Fresh retention/compaction preview on exact canonical: 37 Control + 33 Web releases, pointers match, 174 matched paths, 134 already store-linked, `10,640,730,340` bytes guaranteed Control+Web reclaim, zero uncertain shared bytes; root usage observed around 79%, predicted around 42.8% after verified both-side compaction. No Production filesystem mutation was performed.
- Repository hygiene removed only two clean, canonical-merged, reproducible temporary worktrees: `/private/tmp/awh-night-closure-run3` and `/Users/mac/Desktop/AWH-night-closure-253160a`. Dirty M19/M20 evidence, unmerged branches, and detached Production rollback/release snapshots remain untouched.
- The legacy Git remote `awh-vps` in the Documents checkout currently resolves to `ssh://awh-vps/srv/awh/git/awh.git`, but that repository path is unavailable; consequently `git fetch --all` fails even though `git fetch origin` succeeds. Existing handoff/history identifies `awh-vps` as legacy Google Cloud authority while current Production is ReadyIDC (`awh-ready`), so this stale remote is recorded as a hygiene/root-cause issue rather than rewritten without an explicit authority decision.
- Exact-canonical QA PASS: TypeScript typecheck plus 17/17 focused tests covering HEIC provider-safe input, Conversation Lifecycle/delete authority, mobile overflow/navigation boundaries, Home/Tasks/Files surfaces, release-retention/compaction safeguards, and visual-review fail-closed evidence rules. Worktree was clean after QA.

Next safe action: preserve Production at M19/schema 19 until explicit M20 activation approval, and preserve the ~10.64 GB compaction as a separate approval-gated Production mutation. Independently, reconcile or remove the stale `awh-vps` Git remote only after confirming whether any legacy recovery workflow still requires that mirror; do not let `git fetch --all` failure obscure canonical `origin` convergence.

## 2026-09-02 07:0x ICT — automation closure checkpoint 7

- GitHub canonical was re-read before work and remains `awh/api-independence` at exact SHA `d218d5c4d61817381d9c07cb3bfafd5fa7da2c7b` (PR #81 merge).
- Fresh Production read-only verification: Control `/opt/awh-hub/control-plane-current` and Web `/var/www/awh-web/current` both resolve to `m19-b66ef39cc986`; SQLite `/var/lib/awh-hub/awh.sqlite` remains `user_version=19`, `integrity_check=ok`, zero FK violations. nginx, PHP 8.3 FPM, native-executor timer and backup timer are active.
- Exact pre-M19 rollback DB remains `/var/backups/awh-hub/awh.sqlite.pre-m19-b66ef39cc986`, 52,834,304 bytes, schema 18, integrity OK, zero FK violations, timestamp `2026-09-02 00:02:50 +0700`.
- Fresh exact-canonical retention preview: 37 Control + 33 Web releases; pointers match; 174 matched artifact paths; 134 already store-linked; guaranteed Control+Web reclaim remains `10,640,730,340` bytes with zero uncertain shared bytes. Root filesystem observed at `23,502,942,208 / 30,083,776,512` bytes used; predicted post-compaction usage is `12,862,211,868` bytes (`42.8%`). No Production filesystem mutation was performed.
- Exact-canonical TypeScript typecheck PASS and focused regression PASS 15/15 covering HEIC provider-safe input, Conversation Lifecycle/delete semantics, three-item mobile navigation, Home/Tasks/Files surfaces, release retention/compaction safeguards and visual-review fail-closed evidence.
- The old Codex reconciliation process for `/private/tmp/awh-project-source-authority-m20` is still alive at PID 29261, 0.0% CPU, from obsolete base `3ccd18a725a9821ae3ea71d5847f5b48ea3122fe`; its M20 and M20-closure worktrees remain dirty. They are protected from reset/merge/removal because process ownership is still active even though M20 Project Source Authority is already canonical.
- Repository hygiene found no additional clean, canonical-merged branch worktree eligible for safe deletion under the current evidence-preserving policy. The isolated run-7 QA worktree is reproducible and may be removed after this checkpoint merges.
- The stale local `awh-vps` remote cannot simply be removed as a hygiene fix yet: current source still contains legacy enrollment/web-preview/bootstrap paths whose default deploy target is `awh-vps`, while current Production authority is ReadyIDC `awh-ready`. This is now classified as a source-level legacy-target convergence issue, not merely a broken Git remote.

Next safe action: keep Production on M19/schema 19 pending explicit M20 activation approval, and keep the verified ~10.64 GB hard-link compaction as a separate approval-gated mutation. Independently, reconcile legacy `awh-vps` default-target code paths onto an explicit current/legacy authority model before removing the stale Git remote; do not touch the still-running obsolete M20 agent worktrees.

## 2026-09-02 10:07 ICT — legacy deployment target convergence

- Re-read GitHub canonical before mutation: `awh/api-independence` = `c501a5cc15b4c981bbb5cd28652e4fc1db2688de`.
- Re-read Production: Control/Web both `m19-b66ef39cc986`; SQLite schema 19, integrity `ok`, FK violations 0; root disk 79% used. Daily backup authority is `awh-backup.timer` (next run 2026-09-03 03:38 ICT) with a fresh 2026-09-02 03:38 SQLite backup; the previously queried `awh-hub-backup.timer` unit name is obsolete/not present.
- Protected the still-running obsolete M20 Codex PID 29261 and dirty Project Source Authority worktrees; no reset/kill/removal was performed.
- Root-cause source convergence: current ReadyIDC Production SSH authority is `awh-ready`, while six live deploy/bootstrap defaults still selected legacy Google Cloud `awh-vps`. Defaults now select `awh-ready`; `AWH_DEPLOY_TARGET` remains the explicit override for legacy/recovery targets. No Production deployment or pointer/schema mutation was performed.
- QA on the isolated exact-canonical worktree: TypeScript typecheck/build PASS; focused deployment/bootstrap regression 34/34 PASS after a clean `npm ci --ignore-scripts`. Initial dependency-reuse attempt was discarded because that checkout lacked complete runtime dependencies; it did not mutate Production.
- Dependency install surfaced 24 audit findings (3 low, 20 high, 1 critical); no blind `npm audit fix` or breaking upgrade was applied during closure.

Next safe action: review/merge this source-only authority convergence, then re-read canonical and Production. Keep M20 Production activation and verified release hard-link compaction as separate Production mutation gates.
## 2026-09-02 10:1x ICT — post-PR83 M20 production-readiness checkpoint

- GitHub canonical was re-read after PR #83 and is exact `awh/api-independence` SHA `1e8437031d3c03798b9aa5db9e4516b08671ba71`; the legacy-target convergence is therefore canonical.
- A separate active Sustainability Foundation worktree now exists at `/Users/mac/Desktop/AWH-api-independence` on branch `awh/sustainability-foundation` with tracked and untracked changes. It is protected from closure edits, resets, merges, or cleanup. The obsolete M20 Codex process PID 29261 remains alive from base `3ccd18a...` and its evidence stays untouched.
- Fresh Production read-only verification: Control/Web pointers remain `m19-b66ef39cc986`; SQLite remains schema 19 with `integrity_check=ok`; nginx, PHP 8.3 FPM, native-executor timer and `awh-backup.timer` are active. Root filesystem remains ~79% used. No Production mutation occurred.
- Exact-canonical release-retention preview still reports 37 Control + 33 Web releases, 174 matched artifact paths, 134 already store-linked, and `10,640,730,340` bytes guaranteed Control+Web reclaim with zero uncertain shared bytes; predicted post-compaction root usage remains ~42.8%.
- M20 authority remains coherent as `019_project_source_authority.sql`, migration id `m20-project-source-authority`, schema target 20. Clean isolated QA passed build/typecheck and focused regression 14/14. Full Hub regression reached M20 Project Source Authority PASS; local extension-dependent fixtures truthfully skipped where ZipArchive/required PHP extensions are unavailable.
- Exact M20 activation dry-run PASS against default target `awh-ready` with release `1e8437031d3c03798b9aa5db9e4516b08671ba71`. The plan gates v19→v20 migration to migration 019 only, supports truthful v20 source refresh, quiesces/resumes managed operators, verifies project-source columns/routes, and retains exact DB/pointer/service rollback. Production activation still requires explicit approval.
- The first isolated QA attempt produced one dependency-resolution false failure because a shared `node_modules` symlink did not contain the required `pdf-lib` runtime asset. A clean `npm ci --ignore-scripts` eliminated the environment defect and the identical focused suite then passed 14/14; no source patch was made for this false failure.

Next safe action: merge this evidence-only checkpoint, then keep M20 Production activation and the verified ~10.64 GB hard-link compaction as separate explicit mutation gates. Continue source/repository hygiene without touching the active Sustainability Foundation or obsolete M20 evidence worktrees.

## 2026-09-02 10:xx ICT — approved release compaction checkpoint

- Canonical was re-read before mutation at `awh/api-independence` `7289c2d9adc314f437b9580796ddab3e3c6a0630`; active dirty Sustainability Foundation and Project Source Authority worktrees were preserved untouched.
- Production preflight remained Control/Web `m19-b66ef39cc986`, SQLite schema 19 with `integrity_check=ok`, zero FK output, and nginx/PHP 8.3 FPM/native-executor/backup timers active. Exact pre-M19 rollback DB remains `/var/backups/awh-hub/awh.sqlite.pre-m19-b66ef39cc986` at 52,834,304 bytes.
- Approved hard-link-only Control+Web compaction ran in two bounded passes from exact canonical. Pass 1: 12 linkable paths, `5,983,596,990` reclaimable bytes, PASS. Pass 2: 12 linkable paths, `5,021,969,692` reclaimable bytes, PASS. Release directories were not deleted and Control/Web pointers were not moved.
- Root filesystem improved from `23,520,772,096 / 30,083,776,512` bytes used (~79%) before compaction to `14,376,230,912 / 30,083,776,512` bytes used (48%) after the two completed passes, a measured reduction of `9,144,541,184` bytes.
- Fresh post-pass retention preview shows 158 artifact paths already store-linked and `1,512,643,160` guaranteed physical reclaim bytes remaining, with predicted final usage ~42.8%. A third bounded apply attempt was blocked by the execution safety gate and was not bypassed.
- Post-compaction Production verification remained Control/Web `m19-b66ef39cc986`, schema 19, integrity OK, services/timers active. M20 Production activation remains pending because the owner-auth execution path is safety-gated despite a clean exact-canonical dry-run.

Next safe action: preserve the current healthy 48% Production state, complete the remaining ~1.51 GB bounded hard-link compaction only when the execution gate permits, and activate M20/schema 20 only through the approved owner-auth deployment path without bypassing the safety gate.

## 2026-09-02 10:4x ICT — stale PR hygiene classification

- Canonical after the approved compaction checkpoint is `awh/api-independence` `ac2edf1aaa07fb5edaba123ad89eea198a1a2dc2`.
- Open legacy PR heads were compared against canonical using both ancestry and patch-equivalence rather than age/title heuristics.
- PR #6 head `35b5e87446647faf2d542f0cd49d4dc508f7d34c` is already an exact ancestor of canonical and was closed as superseded.
- PR #47 head `e5557621f2df02275b416aa0de073b126acd6de1` has 1/1 patch-equivalent commit in canonical; PR #48 head `a9fde482207cb2841d09a14f7af3eae3f087e0dd` has 2/2 patch-equivalent commits. Both were closed as superseded without deleting their branches/history.
- PRs #58, #53, #35, #33, #10, #9 and #7 still contain one or more unique patches relative to canonical and remain open/protected for later reconciliation.
- The five retained local worktrees remain protected: dirty `awh/v0.1-migration`, dirty `awh/sustainability-foundation`, detached Production evidence `954cfa0`, dirty Project Source Authority evidence, and clean release snapshot `awh/production-surface-rc1`.

Next safe action: do not merge unique legacy PRs wholesale. Reconcile only their still-unique patches against current canonical when they become relevant, while preserving active Sustainability Foundation work. Production remains healthy on M19/schema 19 at 48% disk usage; M20 owner-auth activation and the final ~1.51 GB compaction remainder remain execution-gated.

## 2026-09-02 10:5x ICT — post-compaction convergence checkpoint

- Canonical is `awh/api-independence` `e7af1fd929ca98531549f67997a15bcde1acfe14` after stale-PR hygiene checkpoint PR #86.
- A separately created exact-canonical compaction worktree `/private/tmp/awh-compaction-final-20260902` was discovered with an active bounded compaction process; it was treated as protected concurrent work and not modified or removed. That process completed PASS: 12 linkable paths (8 Control + 4 Web), reported `3,390,122,662` reclaimable bytes.
- Fresh post-process retention preview: 180 matched artifact paths, 173 already store-linked; Control guaranteed reclaim is now 0. Remaining Control+Web guaranteed physical reclaim is `1,225,431,703` bytes, entirely outside the already-closed Control side.
- Root filesystem is now `13,802,680,320 / 30,083,776,512` bytes used (46%), down by `9,718,091,776` bytes from the pre-compaction `23,520,772,096` bytes. Predicted final usage after the remaining bounded Web compaction is ~41.9%.
- Production remains Control/Web `m19-b66ef39cc986`, SQLite schema 19 with integrity OK and no FK output; nginx, PHP 8.3 FPM, native-executor timer and backup timer remain active.
- A final bounded Web-side apply from exact current canonical was attempted normally and blocked by the execution safety gate. The gate was not bypassed.
- M20 Project Source Authority remains source-ready with prior clean build/typecheck, focused regression, Hub M20 PASS, and `awh-ready` deploy dry-run/rollback evidence; Production schema-20 activation remains blocked specifically at the owner-auth execution safety gate.

Next safe action: keep Production at the healthy M19/schema-19 state. Complete the remaining ~1.23 GB Web hard-link pass only when the normal execution gate permits, and activate M20 only through the canonical owner-auth deployment path without bypassing safety controls.

## 2026-09-02 10:5x ICT — UX/M19 closure verification

- Exact-canonical focused UX regression at `49a313cb2391e543990538e578828d04c41ccda1` passed 15/15 across HEIC provider-safe input, Conversation Lifecycle/delete authority, canonical Work/mobile Chat markup, three-item mobile navigation, Home/Tasks/Files surfaces and fail-closed visual-review contracts.
- Exact-canonical rendered visual review passed with `dirty=false`, 16 screenshots at 390x844 and 1440x900. Manual spot-checks of Home, Work/Chat progress and document artifact states found the composer/nav/artifact actions bounded on mobile and desktop without the prior header/navigation obstruction.
- M19 source convergence is complete: published M19 activation head `fb36b16227b6edc1dbd5738ad71606170499f65b` is an ancestor of canonical, while canonical still owns `018_conversation_lifecycle.sql`, migration id `m19-conversation-lifecycle`, target schema 19 and its deployment/regression contracts. No M19 re-merge is required.
- Local committed snapshot branches `awh/v0.1-migration`, `awh/production-surface-rc1`, `fix/project-source-authority-20260901` and detached Production evidence `954cfa0` are all commit ancestors of canonical; dirty/uncommitted evidence remains protected rather than reset or removed.
- Production remains healthy at Control/Web `m19-b66ef39cc986`, schema 19/integrity OK with managed services active. Approved hard-link compaction has reduced root usage from ~79% to ~46%; remaining guaranteed Web-side reclaim is `1,225,431,703` bytes and remains execution-gated.
- M20 remains source-ready and exact-canonical dry-run ready, but Production activation is still blocked at the normal owner-auth execution safety gate; the gate was not bypassed.

Next safe action: preserve the healthy M19 Production state while the execution gates remain closed. When a normal gate opens, complete the remaining bounded Web compaction and then activate M20 only through the canonical owner-auth deployment path, followed immediately by schema/pointer/service/rollback verification.

## 2026-09-02 11:3x ICT — retry-identity and compaction closure

- Canonical source before this checkpoint is `awh/api-independence` `f0dfeb5f2811f9f0684b6854febcf02135e15a41`, merge of PR #89. The harvested retry-identity fix binds optional `AWH_RELEASE_ATTEMPT=r1..r999` before CONTROL web build, backup and rollback naming; remote validation covers typed releases through M20.
- PR #89 exact head passed hosted CI run `33589916206`, local full Node regression 354 tests / 353 PASS / 1 platform SKIP / 0 FAIL, full Hub/PHP regression through M20, and exact-merge focused QA 13/13 plus typecheck. M20 dry-run with retry identity `r1` PASS and generated `awh-shell-m20-f0dfeb5f2811-r1`.
- Legacy PRs #9, #10, #33, #53 and #58 were closed as superseded after ancestry/semantic evidence; branches/history were preserved. Only intentional architecture drafts #35 and #7 remain open.
- Approved release-artifact compaction completed its final bounded Web pass from exact canonical: 7 Web paths linked, reported `2,164,171,454` logical reclaimable bytes. Post-audit is now 180 matched / 180 store-linked with Control and Control+Web guaranteed reclaim both `0` bytes.
- Production root disk is now ~42% used (`12,579,168,256 / 30,083,776,512` bytes observed immediately after compaction), down from ~79% before compaction. No historical release directory was deleted.
- Post-compaction Production verification remains Control/Web `m19-b66ef39cc986`, SQLite schema 19 with integrity `ok` and no FK output; nginx, PHP 8.3 FPM, native-executor timer and backup timer are active.
- Exact rollback DB `/var/backups/awh-hub/awh.sqlite.pre-m19-b66ef39cc986` remains protected; daily backup authority is active.
- M20 Production activation is source/QA/dry-run ready with verified current desktop artifacts, but the normal `--deploy --approve --owner-auth --project-source-authority` invocation is blocked by the execution safety gate. The gate was not bypassed and Production remains healthy on M19.

Next safe action: keep M19 Production stable until the normal owner-auth execution gate permits M20 activation. When it opens, use only the canonical exact-SHA path, then immediately verify schema 20, migration ledger, Control/Web pointers, services, project-source/AiPASS routes, backup and rollback evidence.
