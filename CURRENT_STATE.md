# AWH Current State Authority

Updated: 2026-09-04 12:06 ICT.

This file is the **current-state authority** for AWH operational status. Resolve the exact current `origin/awh/api-independence` SHA and re-read live runtime evidence before every mutation. Dated "current", "live", or "Production remains" statements in `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `DECISIONS.md`, and older checkpoint documents are historical evidence unless this file or a fresh inspection confirms them.

## Source and repository

- Canonical branch authority: `awh/api-independence`; exact SHA must be resolved from `origin` at read time. Last fully verified executable baseline before this documentation commit: `0e3acfe16b02e75ec83d21222d9ea3b326b92d0b` (post-PR #114 merge), with push CI run `33823600218` fully green across all five jobs. Resolve from origin again before every mutation.
- Five local worktrees are intentionally protected: dirty `awh/v0.1-migration`, dirty `awh/sustainability-foundation`, detached Production evidence `954cfa0`, dirty Project Source Authority evidence, and clean release snapshot `awh/production-surface-rc1`.
- Do not reset, remove, merge, or kill work associated with a dirty/protected worktree unless its ownership and recoverability are freshly proven.
- Canonical Project Memory precedence is `CURRENT_STATE.md` first, then `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `ARCHITECTURE.md`, and `DECISIONS.md`; legacy five-file worker metadata may be accepted during rollout but cannot claim current-state readiness or erase an existing current-state row.
- Legacy PR #7 is superseded by the canonical Task/Execution/Approval authorities and is closed without deleting history. PR #35 remains a future external-owner integration lane; do not merge its device-credential Safe Bridge as owner identity until principal-scoped external authorization converges with the current Hub trust model.

## 2026-09-04 Mac Desktop field rollout

- The authorized Mac bridge is online again. This supersedes only the prior field statement that the bridge was offline; it does **not** by itself refresh or prove Production state.
- Exact canonical source `0e3acfe16b02e75ec83d21222d9ea3b326b92d0b` passed push CI run `33823600218`. Its macOS x64 artifact is GitHub Actions artifact `9919156406`, outer digest `sha256:6ba2b1fdb0576fadeef563ae8c3b320ff7020c1ff6f36bc3ff4365d22fa1806b`.
- The artifact's machine-readable release evidence binds `AWH-macOS-x64.zip` to the same exact source SHA with package SHA-256 `470089c9ac6d3d860f760e64b17586821111c3f730545ebbb839b7d6d8ad9db8`, 129,886,385 bytes and `packageVerification=VERIFIED`.
- Before rollout, installed AWH Desktop had `app.asar` SHA-256 `351fff880dc7de523ada3842317260217b0a8245f1fa9e1a5626d1ea7482cab7`; the exact-canonical artifact carried `7b24819ee3fb780208207a5cb768db9427c12ebe13ab984c4995dd1f29e62cce`, so a real binary drift was proven rather than inferred from the unchanged `1.0.0-rc.1` version string.
- A rollback copy of the previous application was preserved under the local AWH Application Support rollback area before replacement. The installed application now matches the exact-canonical `app.asar` SHA, reports bundle id `com.artworkspacehub.awh`, and is running with one visible `AWH Desktop — Art’s Workspace Hub` window.
- The installed runtime contains the canonical six-file Project Memory list including `CURRENT_STATE.md` and the shared 256 KiB `PROJECT_MEMORY_METADATA_MAX_BYTES` contract. This closes the **installed Mac binary** gap.
- The macOS package is x86_64 and currently unsigned; code signing/publication/auto-updater activation remain separate unfinished release concerns. Do not reinterpret this local field rollout as signed distribution readiness.
- Authoritative Production Hub confirmation that this Mac has republished Project Memory as six rows / `memoryReady=true` remains **FIELD VERIFY PENDING**. No Production DB write or deployment was performed in this rollout, and no 6/6 claim is made without the Hub authority evidence.
- Physical authenticated iPhone Safari remains a separate manual field gate. Installing the latest Mac Desktop artifact does not substitute for iPhone attachment/navigation/scroll verification.

## Production

- Last independently recorded read-only Production checkpoint from the one-night closure: Control/Web pointer `m20-95503e795c82`, SQLite schema 20, integrity `ok`, no foreign-key violation output, and active Nginx/PHP-FPM plus native-executor/hosting-operator/backup timers.
- The latest recorded Production source binding still resolves historical canonical snapshot `881dc3bacf8dc453e6bd8e1211278eff81a5d57d`; therefore Production is intentionally behind current canonical source until a separately approved exact-SHA deployment/refresh.
- A fresh live Production reinspection was not fabricated for this update: the authorized Desktop Commander Mac bridge was offline at the 2026-09-03 08:50 ICT checkpoint. Treat the Production facts above as the latest verified snapshot, not as proof of current live health after that checkpoint.
- Production Nginx generic `/api/v1/` read gateway is versioned through `/opt/awh-hub/control-plane-current/hub/public/web-gateway.php`; the legacy shared gateway is no longer the active generic read authority in the latest verified Production snapshot.
- Pre-M19 rollback database remains preserved at `/var/backups/awh-hub/awh.sqlite.pre-m19-b66ef39cc986` (52,834,304 bytes at the latest verification).
- Release artifact compaction is complete in the latest verified Production snapshot: 180/180 matched desktop artifact paths are store-linked and guaranteed reclaim is 0 bytes. Release history was preserved.

## M20 Project Source Authority

- Source authority is integrated as migration `019_project_source_authority.sql`, migration id `m20-project-source-authority`, target schema 20, preserving M19 Conversation Lifecycle.
- M20 Production activation completed through the canonical `--deploy --approve --owner-auth --project-source-authority` path. The latest verified schema20 source refresh is release `m20-95503e795c82`; it did not re-run migration 019 and passed the guarded live-canonical preflight before Production mutation.
- Owner Source Authority is durably bound for `Art’s Workspace Hub` to GitHub repository `theartzkk/lnwjud-readme`, ref `awh/api-independence`. The exact canonical revision is resolved dynamically from that ref and must not be treated as a fixed configuration value.
- Last verified bound-source snapshot resolved to Git SHA `881dc3bacf8dc453e6bd8e1211278eff81a5d57d`. Its immutable canonical remote-cache Vault revision is `5e9b1e13-da63-49df-b86f-5c96ae0a171d` with 505 files and 7,508,208 bytes. This revision is intentionally a mapped `CANDIDATE`, not an automatic promotion of the working Project Vault.
- The working Project Vault revision `ff6e2d36-a224-4ca5-8753-1a4115ededc4` remains `ACTIVE` in the latest verified Production snapshot; after canonical remote-cache creation the working Vault is marked `STALE` by design. Canonical remote cache must not silently overwrite or promote over working/worker state.
- AiPASS direct DOCX delivery was verified on Production against the bound canonical snapshot. Task `47b7a741-3861-44c5-81e6-197e33b16cf9` completed successfully and produced artifact `e86dfdd1-1270-4414-9be9-ec7548797e0f`. Its safety manifest contains 11 batches, 32 DOCX files, 21 source evidence parts, and 480 included source files; each DOCX is below 350,000 extracted UTF-8 bytes and each batch is below 650,000 bytes with only 2–3 files per batch.
- AiPASS user-facing delivery does not expose ZIP uploads. The stored ZIP is an internal atomic bundle only; user-facing delivery is bounded direct DOCX with exact canonical SHA/Vault metadata, secret/PII redaction, per-file and per-batch byte ceilings, and fail-closed manifest/tamper verification.
- Fresh rollback baseline for the `m20-95503e795c82` refresh is `/var/backups/awh-hub/awh.sqlite.pre-m20-95503e795c82`, SHA-256 `6139d17498fe680c7c2b2ad7e78a8f8bd89b74d6a1e37f31d9d9b9c112496229`, schema 20, integrity `ok`, with zero foreign-key violations. The prior verified scheduled backup `awh-20260902T081712Z.sqlite` remains preserved.

## 2026-09-03 one-night release-candidate closure

- PR #108 (Owner Source/AiPASS UX) is merged as `0439b217335abcafff281706a943dbcb633b82d1`; its exact head `9dcd4d7fda0aac11483681f1075a773178f8ca70` passed CI run `33655806146`.
- PR #109 introduced the six-file metadata-only Project Memory reconciliation and is merged as `a837410bebd141642773a137ad221eaaac86d7cd`. PR #111 then separated the metadata size bound from the smaller AI context-read bound and is merged as `67604f6f4630b0ebfc1f58307ea8802c5610ea34`.
- PR #110 (Owner Night Shift projection) is merged as `4153a7c0300a84e8e7fbc8aaa4c923502ca47603`; its targeted mobile/chat/Home/Night Shift regression and full suite were green before hosted merge.
- PR #112 recorded the initial release-candidate closure as merge `3a6b390045fd00733554953f7ae3b43f172c9da3` without Production mutation.
- PR #113 closed the final discovered reconciliation contract mismatch by sharing `PROJECT_MEMORY_METADATA_MAX_BYTES = 256 KiB` between runtime and worker client. It is merged as `6d6cf0d15850a62115ff8f5998988df88725e054`; exact PR head `ec7c99a673a3de8f65f74cef96947f683248385a` passed CI run `33701394436` and the canonical merge SHA passed post-merge push CI run `33701662515`.
- On exact canonical executable SHA `6d6cf0d15850a62115ff8f5998988df88725e054`, CI run `33701662515` completed successfully across Ubuntu regression/Hub/runtime dependency security/ZipArchive/mobile-deploy contract gates, Windows regression/build, Linux Electron runtime smoke, macOS x64 packaging/runtime verification, and Windows installer/portable packaging/runtime/MCP verification.
- Exact-source artifacts from run `33701662515`: macOS x64 artifact `9873762208`, digest `sha256:fe2202ae3e0b8b1b1e2267e216a92da0552b071169158fe087b6c317bfad9d5a`; Windows installer artifact `9873791043`, digest `sha256:3a16b7ed48fb61df419e375a08175d0a8f729fffccd0070479bfb1774f5855b9`; Windows x64 artifact `9873792785`, digest `sha256:231ddfd672efdc22363acc862175908c8f35ed268185087d6845562f9be4defd`.
- Six-file reconciliation is source/CI proven, including the real-world >32 KiB metadata case and >256 KiB fail-before-network guard. This does **not** prove that Production Hub metadata has been republished: the last verified field snapshot still had legacy five-file metadata with `CURRENT_STATE.md` absent and `memoryReady=false`.
- Worker/runtime requirement remains a field/runtime distinction: canonical Linux Desktop runtime smoke is green in CI, but the last verified AWH control-plane worker rows were stale and the authorized Desktop Commander bridge is currently offline. Do not convert CI runtime smoke into a live worker PASS.
- Daily Workspace source contracts remain regression-proven for reversible conversation lifecycle, provider-safe HEIC handling, bounded multi-file/camera attachment flow, canonical mobile Work, and existing Night Shift authority reuse. Physical authenticated iPhone Safari remains a manual field gate and was not fabricated from viewport simulation.
- Production was not mutated by this closure. Any Production refresh must use a freshly resolved exact canonical SHA, preserve schema 20/owner/auth/Vault/rollback authority, and require explicit owner approval before mutation.

## Operating rule

Fresh observed runtime/source evidence outranks this snapshot. This snapshot outranks historical dated checkpoint prose. If they disagree, stop the affected mutation, reconcile the facts, update this file, and only then continue through the existing typed authority.
