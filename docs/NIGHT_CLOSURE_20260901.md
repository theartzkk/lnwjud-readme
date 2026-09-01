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
