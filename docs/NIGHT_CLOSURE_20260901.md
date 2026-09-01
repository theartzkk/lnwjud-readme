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
