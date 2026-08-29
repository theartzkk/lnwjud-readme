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