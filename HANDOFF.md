# Authoritative supersession — 2026-08-29 Continuous Auto-Chain V1

- Canonical source was re-based from `awh/api-independence` @ `eb78779d...` and the already-CI-green multi-provider qualification/execution commits were cleanly converged before this milestone. Working branch: `awh/continuous-autochain-v1`.
- ReadyIDC read-only service audit before mutation: host `awh-hub-01`; `awh-native-executor.timer`, `awh-backup.timer`, and `nginx` active; root disk 58% used. Production pointers/schema were not guessed when direct evidence was unavailable, and Production was not mutated.
- Continuous Auto-Chain V1 is source-only: explicit autonomous intent adds bounded continuation metadata to the existing execution checkpoint. After a completed VPS inspection/conversation, the planner reads bounded Vault Source of Truth and may materialize one next canonical task through `HubControlPlaneService`. It stops for approval/high-impact/repeat/max-step/provider failure.
- No deployment, DB migration, credential/provider activation, billing, permission or Production change has been performed. Production activation remains approval-gated on an exact reviewed SHA.
- Source QA closure: focused `AWH Continuous Auto-Chain` PASS; Hub integration PASS (only the known Mac PHP-extension skips); full product regression 306 tests = 305 PASS / 0 FAIL / 1 platform SKIP; `git diff --check` PASS. The automation regression fixture was updated from a stale implementation-specific constructor regex to the actual invariant: same native tick, canonical continuation materializer, bounded `runBatch(4)`, no daemon/scheduler duplication.

# Authoritative supersession — 2026-08-29

- Read-only Production audit: ReadyIDC is live at SQLite **schema v15** with migration ledger through `m15-automation-registry`; DB integrity is `ok`, foreign-key violations `0`, Nginx topology `PASS`, backup state `BACKUP_READY`. Active web pointer remains the M15 release. Production was not mutated during the M16/Supervisor source work.
- Canonical source checkpoint before Supervisor work: `779a5d2348f354bbb8f5705fc97e081866d9309e` on `awh/self-sufficient-foundation`. M16 guarded release path is source-complete but not Production-activated; activation remains an approval-gated schema/service cutover.
- Source line advanced through `awh/continuous-work-supervisor` and `awh/candidate-qa-truthfulness`; current isolated milestone is `awh/promotion-evidence-gate`. Supervisor V1 **reuses** `control_tasks`, `control_task_executions`, existing leases, Automation materialization and the native executor timer. It must never introduce a shadow queue/task/memory/approval authority.
- Continuous-work rule: one service-manager tick may drain only a fixed small batch of canonical work. Transient provider/lease failures use deterministic same-task backoff; they must not hot-loop every timer interval. Expired leases must reconcile both execution state and canonical task state, including terminal failure after the retry limit.
- Candidate QA Truthfulness V1 is closed in source: deterministic PHP/JSON validation, explicit `REVIEW_REQUIRED` for unsupported syntax, and no false PASS from workspace capture alone.
- Promotion Evidence Gate V1 binds each new native promotion approval to evidence schema v2 and re-verifies object integrity plus task/project/base/candidate/QA identity at decision time. Missing, tampered or mismatched evidence fails closed before Vault promotion; legacy approval scopes remain readable for backward compatibility.
- Candidate Secret Gate V1 is closed in source on `awh/candidate-secret-gate`: high-confidence provider-generated credential/private-key/token content is rejected before candidate Vault capture and again during candidate QA. The failure is terminal/non-retryable, no candidate revision is created, and ordinary placeholders/environment references remain allowed. Local Hub integration and full product regression are green; the M12 integration fixture remains locally skipped only where the required PHP extension is unavailable and must be confirmed by Linux CI.
- VPS Native Code Context V1 extends the existing read-only `project_search` tool instead of creating an index/search authority: filename matches remain first, then bounded case-insensitive content search over immutable Vault text with line/snippet evidence. One search scans at most 512 files / 16 MiB and still obeys existing sensitive-path, binary and per-file read guards.
- VPS Root-Cause Inspection V1 now closes the next read-only flow: newly reconciled inspections advertise/request `project.search` while retaining `project.read` compatibility; the native inspection policy requires source-content search followed by exact bounded reads before a root-cause conclusion, and the regression fixture proves search → read → evidence summary without changing the active Vault revision.
- Durable Multi-file Inspection Evidence V1 is the current source milestone: each completed `PROJECT_INSPECTION` stores one object-backed `project-inspection` artifact through the existing `control_artifacts` authority, bound to task/execution/project/exact Vault revision/content hash. Evidence is bounded to searches, path/line/snippet metadata and read hashes/size/line counts; full source payloads are not duplicated, credential-looking snippets are redacted, and inspection remains read-only with no promotion/approval path.
- Linux CI exposed a false-negative fixture in PR #44: a one-line source file made an intentionally bounded search snippet equal the whole short line, while the test incorrectly treated that as copied read payload. The permanent guard now verifies that read evidence has no `content`, includes a SHA-256 metadata binding, and search snippets remain bounded to 240 characters. Runtime evidence semantics were not weakened.
- Work Inspection Evidence Surface V1 now consumes the same `project-inspection` artifact download route in place: Owner can expand “ดูหลักฐานที่ AWH ใช้วิเคราะห์” to see exact source revision plus bounded search path/line and read hash/line-count provenance. It uses same-origin session cookies only and creates no new evidence API/authority. The same pass also repairs the previously inert cancelled-message dedupe so Work renders `visibleMessages` rather than raw duplicate messages.
- Next continuation must re-check branch/HEAD/remote and Production read-only evidence before mutation. Source truth supersedes the historical M12 sections below.

# Handoff

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
## 2026-08-29 — Multi-Provider Qualification V1
- Base/source: `04545661c222576d90e07fce2d57445e65415d33` (`awh/self-sufficient-continuous-release`, CI #633 SUCCESS).
- Production re-audit: control/web pointers still `m15-402ff72ba41d`; no Production mutation. Remote DB introspection was blocked by the safety gate and was not bypassed.
- Added qualification lifecycle service and capability-bound cross-provider routing over existing M16 authorities. Focused M16 + deployment QA PASS; `npm run hub:test` PASS with only known extension-dependent skips.
- Next: full product regression + CI on the checkpoint SHA; provider adapters/credentials remain separate and no provider should be activated in Production without explicit approval.
- Full product regression completed on this candidate: 306 tests / 305 PASS / 0 FAIL / 1 platform SKIP. `git diff --check` PASS.
- An unrelated incomplete untracked `HubGeminiProviderAdapter.php` appeared during the run and was intentionally excluded from this checkpoint because its provenance was not established and it did not parse; do not treat it as canonical work.

## 2026-08-29 — Provider Execution Fabric V1
- Base: `e5557621f2df02275b416aa0de073b126acd6de1` (PR #47; CI #636 SUCCESS).
- Extended the existing `HubNativeAgentService` runtime boundary so a provider selected by M16 governance is dispatched through its matching injected adapter + provider credential store, priced under that provider, and recorded under that provider in canonical usage evidence.
- Root cause fixed: when the only eligible runtime provider was non-primary, the old single-provider fast path incorrectly forced selection back to primary. The fast path now applies only when the sole provider is actually primary.
- Focused M16 provider-dispatch fixture and full Hub regression PASS. Production remained untouched; no real secondary provider adapter or credential was activated.
- QA closure: focused M16 dispatch fixture PASS; `npm run hub:test` PASS with known extension-only skips; full product regression 306 tests / 305 PASS / 0 FAIL / 1 platform SKIP; `git diff --check` PASS.
