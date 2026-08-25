# Handoff

## Current development handoff — Batch 1, 2026-08-25

- Continue only from `awh/lnwjud4-port`; inspect worktree, HEAD, status and remotes first. Batch 1 parent was `b940755be087378eb0c698d9d390829bce659019`.
- Product implementation covers conventional human login, six product roles, backend feature/project authorization, managed users, temporary-password first-login, role-aware Hub shell, Global Command foundation, Work Inbox, one shared 214-tool registry projection and Owner-only Database Center diagnostics.
- Exact Windows-verified candidate: `4eb3e57ddaffc6df7fba7ecbd5dc2bd86abc0472`, tree `3e3fb51c2507e8170327b4ad9469b59604de214c`. Windows evidence: packaging 6/6 PASS, release gate 6/6 PASS, tool catalog 214/214, monorepo typecheck PASS, bundled private Node/stdio launcher PASS, plus prior tunnel/DPAPI/persistence/concurrency/IPC suites PASS.
- `AWH-Setup-4.9.1.exe` was produced successfully on Windows using the proven safe fallback: native build → unbranded `win-unpacked` → AWH icon/VersionInfo via `rcedit-x64.exe` → NSIS from `--prepackaged`. Verified app metadata was `Art's Workspace Hub`, version `4.9.1.0`; branded app SHA-256 was `8c86a1048f780f45bea5454e8b023080ddf97d1c3ae20a82c5917caf1a1fedf6`.
- Source follow-up automates that fallback in `scripts/package-windows.ps1` without enabling Developer Mode or lowering Windows security. It pins winCodeSign 2.6.0 archive SHA-256 `cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4` and `rcedit-x64.exe` SHA-256 `ab53500d556fd824636621bca7dbecd8583ba181891c3e9efdcf16b72a28b0cd`, extracting only the Windows editor and avoiding unrelated macOS symlinks.
- Mac contract evidence for the automated fallback: packaging contract PASS, release gate PASS, ESLint PASS and `git diff --check` PASS. One final Windows execution of root `package:windows` is still required to prove the newly automated path and capture installer SHA-256/install-launch smoke evidence.
- GitHub HTTP push previously failed with transport HTTP 400 and SSH had no key; do not claim the candidate is on GitHub until remote evidence exists.
- Do not deploy. ReadyIDC/BAY/legacy Google Cloud were not mutated by this Batch.

## Convergence foundation — 2026-08-24

- Active convergence branch: `awh/lnwjud4-port`.
- Execution-core base: upstream `lnwjud v4.9.1` peeled commit `166f004bf73e16d634ab37048346b4d4cd9df349`.
- Strategy: preserve lnwjud 4.9.1 internal namespaces/protocols/tool contracts and layer AWH product identity, canonical AWH data path, Project Memory, ReadyIDC Hub v12, web/control-plane and deployment assets around it. Do not recreate lnwjud features in a parallel AWH core.
- Runtime tool catalog remains the upstream 214-tool catalog; Context Economy, persistent indexing, dynamic tool filtering, session handoff, incremental verification, durable/background tasks and the upstream permission boundary remain the local execution foundation.
- AWH display/distribution boundary now targets `Art’s Workspace Hub`, app id `th.theartzkk.awh`, GitHub release source `theartzkk/lnwjud-readme`, and `AWH-Setup-*` artifacts while intentionally retaining `@lnwjud/*`, `window.lnwjud`, launcher filenames and tunnel-profile identifiers internally for compatibility.
- AWH data defaults to the existing `Art’s Workspace Hub` user-data directory. `AWH_DATA_PATH` is the AWH override; `LNWJUD_DATA_PATH` remains an explicit compatibility override only. There is no silent merge/import of an unrelated upstream lnwjud data directory.
- The existing AWH Hub/ReadyIDC v12 source overlay was carried forward from `origin/awh/v0.1-migration` without production mutation. ReadyIDC, Google Cloud legacy and BAY production were not changed by this convergence work.
- QA evidence on macOS: full monorepo typecheck PASS; shared data-path tests 19 PASS / 2 Windows-DPAPI skips; packaging PASS; integration 2 PASS; release-gate 6 PASS; synchronized 214-tool catalog PASS; AWH branding-target tests 10 PASS; Hub regression PASS for every locally runnable fixture with zero failures and three explicit fixture/platform skips. The remaining upstream desktop failures are Windows-only DPAPI/PowerShell/tunnel acceptance paths and must be proven on Windows rather than patched to fake a macOS pass.


## Current state

### Current live state — M12 production + provider field-debug

ReadyIDC is the active production authority at SQLite **schema v12**. The deployed runtime SHA is `9b5970f3a29213d79550b068805bd0b23c84674a` and the production pointer is `m12-9b5970f3a292`. M12 migration/idempotence/integrity/FK checks, Nginx/PHP-FPM, native executor timer, Project Vault, artifact storage, task workspace/transfer permissions, owner/auth preservation and the rollback contract are verified production evidence.

The active source branch is `awh/v0.1-migration`. Current source may be ahead of production; production is never inferred from repository HEAD. For any continuation, inspect current source/local+remote state first, then production read-only evidence, then DB/release pointers, and only then these documents.

The current field defect is the OpenAI Responses conversation path. Two production-proven causes exist: historical assistant turns were serialized as `input_text` instead of Responses `output_text`, and the M12 systemd executor was installed with `PrivateNetwork=true`, which prevents its durable timer path from reaching the provider at all. The source candidate fixes both while preserving the server-side credential boundary: sanitized diagnostics, a real low-cost Responses probe, no false-success, bounded retry on the same task, truthful UI states, billed-failure cost accounting, an outbound-capable but still sandboxed executor (`AF_UNIX/AF_INET/AF_INET6` only), and an idempotent M12→M12 source-refresh deployment path that does not replay migration 011.

Normal owner use remains username/password plus a revocable remembered session. Provider secrets are server-side/write-only. Art has authorized the current bounded ReadyIDC source refresh after final QA; the closure must not replace the key, buy API budget, touch Google Cloud legacy, or change BAY production.

### Deployed evolution — M6 through M12

M6/M7 are no longer pending: their durable conversation and workspace-continuity authorities were subsequently extended through M8–M12 and are part of the current v12 production model. M12 is the live foundation for immutable Project Vault revisions, durable server-side execution, isolated task workspaces, artifact objects, bounded native execution and worker/specialist transfer. Older v5→v7 deployment instructions below are historical evidence and must not be reused as a current release plan.

The first M4 activation attempt is historical evidence only: it failed before
Nginx activation and rollback restored the v3 baseline. Subsequent reviewed
releases closed that include-composition boundary; the active v5 state above is
authoritative.

## Durable owner working protocol

AWH now carries `ART_AI_WORKING_PROTOCOL.md` as the durable owner-level contract for ChatGPT/AWH/Codex work. `AGENTS.md` points agents to it, Project Context loads it before project memory, and the Desktop worker composes AI instructions in this order:

1. platform/security boundary;
2. Art ↔ AI Working Constitution;
3. canonical project identity + Project Memory;
4. current Goal;
5. current source/runtime evidence.

Core rule: **the Goal/symptom does not limit analysis scope — system-first, root-cause-first, one coherent pass, no parallel systems, preserve validated core, QA the real flow, report only what is proven.**

The owner-protocol integration is isolated on `awh/clean-foundation` / PR #8 for cross-platform QA before the release branch advances. It does not mutate ReadyIDC, Google Cloud, BAY production or user project source.

## Canonical project behavior

- Fresh AWH may contain zero user projects.
- User projects are added later through reusable Add Project/onboarding.
- Existing `.awh/project.json` identity is reused; duplicate available identities fail closed.
- BAY EXCUSE X and Teacher Evaluation Video are optional user projects/dogfood, never AWH-core or deployment dependencies.
- Project Memory remains `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `ARCHITECTURE.md`, `DECISIONS.md`.
- Heavy execution stays on trusted Mac/Windows workers; the VPS remains a lightweight, provider-portable control plane.

## Production safety state

- ReadyIDC M12: **active and verified** at deployed SHA `9b5970f3a29213d79550b068805bd0b23c84674a`.
- DB: schema v12; migration idempotence, integrity/FK, Vault/artifact/workspace/runtime service gates passed.
- Google Cloud `awh-vps`: untouched legacy/backup authority.
- BAY production: untouched.
- Future release changes require an exact reviewed SHA and whole-path
  production-parity evidence; do not reopen an incident by guessing at an
  isolated subcommand.

## Remaining field gates

1. Finish source QA for the Responses API/false-success candidate and record the exact final SHA with local/remote/worktree evidence.
2. Deploy **only after Art explicitly approves that exact SHA**; deployment must preserve DB v12, owner/auth, Project Vault and current rollback authority.
3. After deployment, run a real iPhone AWH turn: `จำได้ไหมว่าเราสร้าง AWH ขึ้นมาทำไม?` and verify a genuine OpenAI answer uses relevant Founding/Project Memory.
4. Verify provider-failure field behavior separately: failed AI calls must never produce `COMPLETED` or a fake assistant answer; temporary failures use bounded same-task retry and then a truthful waiting/failure state.
5. Physical Windows pairing/Credential Manager/runtime validation remains a later field gate and is not part of this provider defect closure.

## Next action

Complete the current source candidate and QA. If clean, commit/push it on `awh/v0.1-migration`, report the exact SHA, and stop before production deployment for explicit approval. Do not reopen M12 architecture, do not replay old v5→v7 migration steps, and do not touch Google Cloud legacy or BAY production.