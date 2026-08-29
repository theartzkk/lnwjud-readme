# Authoritative supersession — 2026-08-30 Auto-Chain Project Vault tool-result boundary

- Production was refreshed successfully through the typed M16 authority to exact SHA `06a7277063f891d0d29ad5bdbed7db7541dbb807`; post-cutover preflight, Control/Web pointers, schema 16 integrity/FK, backup readiness, Nginx/PHP-FPM and worker timer were healthy. No direct Production DB mutation occurred and no credential value was exposed, copied or injected.
- The real bounded Auto-Chain field proof was rerun after this refresh and remains blocked truthfully at `AUTOCHAIN_FIELD_TIMEOUT`. Read-only Production metadata shows the latest task reached `WAITING_FOR_WORKER` with `PROVIDER_FAILED`; the route was canonical `project.read` through OpenAI `agent.conversation`, so the earlier governance alias mismatch and the later `max_tool_calls` request defect are not the current failure.
- The revised diagnosis is a shared data boundary: `HubProjectVault::readText()` permits up to 256 KiB while `HubNativeAgentService` rejects a JSON tool result above 64 KiB. Inspection, continuation planning and assisted editing could therefore pass an oversized file result into the provider loop and fail before the next provider request.
- The bounded source repair is committed in `72d06691d96b1139a001021c5cf88e6afdda7378`: `HubProjectVault` adds a provider-facing 24 KiB valid-UTF-8 read contract while preserving the internal 256 KiB read contract; `HubDurableExecutionService` uses it for all provider-facing Vault/workspace reads; `project-vault-search.php` covers large, escaped, UTF-8 content and the JSON result boundary. The candidate is being merged with current canonical `e0fa5cc…`; Production remains at `06a7277…`.
- Verification after the repair: Project Vault, M16, Continuous Auto-Chain and M12 focused fixtures passed; typecheck passed; serial `npm test` passed `319/0/1`; build, `qa:fast` and serial `qa:full` passed after the `74556a1` canonical M11 fixture guard. A prior parallel QA invocation exposed a generated `dist-web` race; the serial rerun passed the full Node suite. Final exact-head QA remains required after this merge.

## Next action

Finish the canonical sync merge, rerun exact-head QA, push the resulting candidate and verify CI plus read-only M16 readiness/dry-run, then request one fresh exact-SHA Production approval. Do not deploy the new source before that approval; after approval rerun the bounded field proof and continue UAT/Production completion. Preserve `06a7277…` and the existing rollback assets until the new release passes public verification.
# Canonical `awh/api-independence` advanced to `e0fa5cc…` with the environment-aware M11 fixture guard; the candidate branch is being synchronized to that current canonical line before release readiness is evaluated. This source reconciliation does not authorize a Production refresh.

# Authoritative supersession — 2026-08-29 Auto-Chain Responses request contract

- Production was refreshed through the typed M16 authority to exact SHA `903d128f9b6160e011936b681a69656789b45a09`; the active Control/Web pointers, schema 16 database, Nginx/PHP-FPM route and worker timer were verified healthy after cutover.
- The governance/routing fix is proven in the live field attempt: the canonical `project.read` execution selected the OpenAI `agent.conversation` interface through the bounded alias, so the earlier `AUTOCHAIN_FIELD_TIMEOUT` route mismatch is closed.
- The next field attempt failed truthfully at the provider boundary with `PROVIDER_REQUEST_INVALID`. Source audit found the shared Responses payload emitted unsupported `max_tool_calls` in both the initial tool request and the follow-up tool-loop request; the service already enforces the six-call bound locally.
- Source commit `02bb176` removes that unsupported request field from both payload paths and adds an M16 fixture regression that executes a two-turn tool loop and asserts neither payload contains `max_tool_calls`. Canonical capability identity, tool allowlists and local call bounds remain unchanged.
- Verification: full product `320 tests = 319 PASS / 0 FAIL / 1 platform SKIP`; M16 self-sufficient-AI fixture PASS; Continuous Auto-Chain fixture PASS; typecheck PASS; `qa:fast` PASS; diff check PASS. `hub:test` remains non-green only at the pre-existing M11 fixture assertion (`owner system health exposes bounded operational summaries`), reproduced on the prior baseline; no M11 source changed.
- The `02bb176` source candidate is not deployed. No credential was exposed, copied or injected, and no direct Production DB mutation occurred. Production remains preserved at `903d128…` while this candidate is prepared for exact-SHA review.

## Next action

Update this checkpoint in the final candidate, push and verify PR/CI truth, then run the read-only revision/lease, schema-16 integrity/FK, backup/recovery, current-release and typed M16 dry-run gates. Request one fresh approval for the resulting exact SHA before any new Production refresh; after approval rerun the bounded Desktop/worker/Auto-Chain proof and continue the remaining UAT/completion gates. Do not claim Auto-Chain or Production completion from source evidence alone.

# Authoritative supersession — 2026-08-29 Auto-Chain governance-routing contract

- Root cause closed in source commit `832e909`: M16 governance required an exact provider capability row for `project.read`, while the live OpenAI provider advertises the bounded tool-mediated path as `agent.conversation`. The planner therefore received `PROVIDER_UNAVAILABLE`, its defensive catch hid the route failure, and no continuation task materialized before the field-proof timeout.
- The fix is at the shared governance eligibility layer. `project.read`, `project.search` and `project.mutate.assisted` may use the provider's `agent.conversation` interface only when tool calling is enabled; route decisions and executor rows retain the canonical task capability. Unregistered capabilities such as `project.mutate.text` and `artifact.object` remain fail-closed.
- Regression evidence: M16 self-sufficient-AI fixture PASS, Continuous Auto-Chain fixture PASS, full product `320 tests = 319 PASS / 0 FAIL / 1 platform SKIP`, typecheck PASS, build PASS, diff check PASS. `qa:full` still reports the pre-existing M11 fixture assertion plus dirty-tree status before this checkpoint commit; no M11 source was changed.
- Last verified ReadyIDC state remains Production Control/Web `m16-ea3ac9f28986`, exact active SHA `ea3ac9f289867f6026c22a1b28ae0115e59df9ba`, DB schema 16 with integrity/FK PASS, Nginx/PHP-FPM/worker healthy, and no credential value exposed. The new source fix is not deployed.

## Next action

Push the exact candidate from the current branch, verify CI/review truth in the current remote repository, then request one fresh approval for that exact SHA before any typed M16 Production refresh. After approval, rerun Desktop restart/enrollment, worker reuse, Auto-Chain lineage and remaining UAT; do not deploy a different SHA or bypass the safety gate.

# Authoritative supersession — 2026-08-29 finish-first continuation / backup authority

- Candidate `codex/finish-first-p0` is pushed at `c427d9dd575dd53556ee6a7e184916e7a971cbc3` in PR [#57](https://github.com/theartzkk/lnwjud-readme/pull/57) against `awh/api-independence`; CI run `33248726861` is terminal `5/5 PASS`. PR remains open/unmerged and no Production mutation occurred.
- Foundation-now fix: Database Studio no longer selects arbitrary newest files for backup display. It delegates to `HubBackupService::latestMetadata()`, so the Owner surface uses the same verified SQLite integrity, FK, manifest hash and schema evidence as the canonical Control Plane.
- Verification: full product `319 tests`, `318 PASS / 0 FAIL / 1 platform SKIP`; focused backup-authority `1/1 PASS`; typecheck/build/CONTROL preview/`qa:fast`/diff check PASS.
- Field gates remain open: `npm run ops:autochain:field-test` returns `BLOCKED DEVICE_NOT_ENROLLED`; no credential was invented, copied or logged. Browser/iPhone visual UAT remains manual; local `file://` preview navigation was blocked by browser policy and was not bypassed.

## Next action

Complete normal Desktop enrollment on the target device, then rerun the bounded Auto-Chain proof and real browser/iPhone journey. After fresh exact-SHA review/approval, use the typed release authority for Production activation; do not merge or deploy from this checkpoint alone.

# Authoritative supersession — 2026-08-29 P1-C Files surface checkpoint

- P1-C is implemented in local candidate commit `33d1946` on `codex/finish-first-p0`. Home artifact cards, the result pulse and “เปิดคลังไฟล์” now converge on one responsive Files surface over the existing canonical `control.artifacts` projection.
- The real artifact library supports bounded search by name/type, project/task provenance, size/time metadata and downloads only when the server-provided path matches the canonical artifact route. No file storage, upload authority, API route or mock data was added; existing Tools remain local/deterministic on Home.
- P1-C focused Home + Tasks + Files regression `6/6 PASS`; full product suite `317 PASS / 0 FAIL / 1 platform SKIP` across 318 tests; build and `git diff --check` PASS. This remains source/build evidence, not visual browser or iPhone UAT.
- Candidate remains local-only and undeployed. P0 field proof remains blocked at `DEVICE_NOT_ENROLLED`; push/CI/review authorization is still absent and no credential or Production mutation was performed.

## Next action

Keep the exact-SHA/push/field gates explicit. Continue the next bounded visible priority (Owner Control Tower/mobile verification) only on this candidate while preserving the canonical Work, Tasks, Files and Tools authorities; do not claim Production v1 complete from local evidence.

# Authoritative supersession — 2026-08-29 P1-B Tasks and Executions checkpoint

- P1-B is implemented in local candidate commit `e9055e8` on `codex/finish-first-p0`. The canonical Home now opens one Tasks/Executions surface over the existing `control.tasks`, `control.artifacts`, `control.approvals`, `control.workers` and `executionStatus()` projections; no new route, table, queue, execution or activity authority was added.
- The surface gives the owner human-readable filters (`ทั้งหมด`, `กำลังทำ`, `ต้องดู`, `เสร็จแล้ว`), a selected-task detail, truthful execution journey, worker/result/continuation context, pending-approval handoff back to Work, and only validated same-origin artifact download links. Home recent/active/attention actions now converge on this surface.
- A real Home runtime defect was fixed at its source: `renderRecentWork()` referenced undefined `STATUS_LABELS` and `executionPlace`, which could abort Home refresh when tasks existed. It now uses the canonical presentation projection `executionStatus(task, workers)`.
- P1-B regression `4/4 PASS`; full product suite `315 PASS / 0 FAIL / 1 platform SKIP` across 316 tests; `npm run typecheck`, `npm run build`, CONTROL web preview and `npm run qa:fast` PASS; `git diff --check` PASS. This is source/build evidence, not visual browser or iPhone UAT.
- Candidate remains local-only, clean after the checkpoint commit, ahead of `origin/awh/api-independence`, not pushed, not in CI, and not deployed. P0 field proof remains blocked at `DEVICE_NOT_ENROLLED`; no credential was invented or printed.

## Next action

Preserve the P0 and release gates: obtain explicit destination authorization before any push, enroll the target Desktop through normal auth before the Auto-Chain field proof, then require CI/review and fresh exact-SHA Production approval. In parallel, continue the next safe visible slice (Files/Tools) only on this isolated candidate; do not claim browser UAT, field PASS, or Production v1 complete from source/build evidence.

# Authoritative supersession — 2026-08-29 P1-A Home command-center checkpoint

- The first Visible Product Pass card is implemented on top of the existing canonical Web/PWA Home and Work surfaces. Home now exposes a compact “ภาพรวมตอนนี้” pulse for real project, active-task, artifact and approval counts, with actions that return to the existing Projects, Work and results surfaces.
- Worker readiness is shown only to Owner and uses the existing `control.workers` projection. No endpoint, table, task queue, event database, mock data or second authority was added.
- The pulse cards are keyboard-focusable buttons, use readable overflow behavior, and collapse from four columns to two/one at mobile breakpoints. A focused source regression and web preview build cover the new surface.
- P1-A evidence: focused Home regression `2/2 PASS`; full product suite `313 PASS / 0 FAIL / 1 platform SKIP`; `npm run build` and `node --import tsx scripts/build-web-preview.ts --control` PASS. This is source/build evidence, not visual browser UAT.
- P1-A implementation is `e39bd0ed9e95f161bf5b7aab46e38899b821f9e7`; the candidate branch includes subsequent docs-only checkpoints and has not been pushed or deployed. P0 field proof remains blocked at `DEVICE_NOT_ENROLLED`, and the push/PR safety gate remains unresolved.

## Next action

Preserve the original P0 order: obtain explicit destination authorization before retrying push, then CI/review and fresh exact-SHA Production approval; separately enroll the target Desktop through the normal auth flow before running the Auto-Chain field proof. Continue the next visible P1 card only on this candidate/source boundary; do not claim browser UAT, field PASS or Production deployment from static/build evidence.

# Authoritative supersession — 2026-08-29 Desktop enrollment P0 + Auto-Chain field-proof checkpoint

- Canonical source was re-verified from `awh/api-independence` at `2caf9242d589d6f1463b8d063045eb86e5084c40`. The isolated candidate is `codex/finish-first-p0` at `f1844b6447c039c5e4c4f4f0d2d94e32bfe0f0df`; the primary checkout remained untouched.
- Desktop enrollment now writes the returned device credential and reads it back before returning success. Login/pair/rotate fail closed with `CREDENTIAL_PERSISTENCE_FAILED` if the exact value cannot be read back; revoke also verifies deletion. A fresh-store regression proves restart-equivalent persistence without storing passwords.
- Hub task responses now project validated Auto-Chain lineage from the existing `control_task_executions.checkpoint_json` authority (`rootTaskId`, bounded `step`, `maxSteps`). The new bounded operation `npm run ops:autochain:field-test` proves credential reuse, VPS `project.read`, root completion, continuation materialization and same-root lineage without human Continue.
- The shared server inspection predicate now ignores mutation words inside explicit prohibition clauses while still rejecting unnegated mutation. This fixes the field request routing root cause rather than adding a phrase-only exception.
- Source evidence: focused credential/enrollment/worker/operation tests `21/21 PASS`; full product suite `311 PASS / 0 FAIL / 1 platform SKIP`; `npm run hub:test`, `npm run qa:fast`, typecheck, build and PHP Auto-Chain contract PASS. `qa:local`/`qa:full` ran all source gates but remain non-green only because the candidate is not pushed (`upstreamExact=false`); full desktop smoke is `GUI_SANDBOX_BLOCKED` in Codex and requires a logged-in macOS GUI session outside Codex.
- Actual field operation stopped fail-closed at `DEVICE_NOT_ENROLLED`; no credential was invented and no DB/production mutation occurred. The current local `~/.awh/session-credentials` directory is private but empty.
- Read-only ReadyIDC evidence on 2026-08-29: enrollment pointer `m3e2-457696d`; Control/Web pointer `m16-6e8217ab6cd5`; SQLite schema `16`, integrity `ok`, foreign-key violations `0`, migration ledger through `m16-self-sufficient-ai`, Nginx topology/config PASS, PHP-FPM active, internal sanitized health PASS, public protected read routes `401`. The exact deployed Git SHA is not exposed by the observed release marker and must not be inferred from the release ID.
- Candidate is not deployed. Push/PR was blocked by the external safety gate because repository ownership/authorization for `theartzkk/lnwjud-readme` was not verified. Do not use this candidate for production until it is pushed/CI-reviewed and the exact SHA receives fresh approval.

## Next action

Explicitly authorize the reviewed push destination (if intended), then push/CI-review `f1844b6...`; after exact-SHA approval, deploy through the guarded release path and rerun Desktop login plus the bounded Auto-Chain field proof. Do not copy credentials, mutate production DB, or bypass the safety gate.

# Authoritative supersession — 2026-08-29 Finish-First Owner Control Tower Production V1

- Current Product milestone reuses the canonical Infrastructure page/API and existing M16 AI/task/release authorities. It adds no parallel control plane.
- Visible Owner surface now includes Production Complete %, AI provider/model health and fallback counts, autonomous work, activity/incidents, and release/candidate/rollback state. PASS/FAIL is evidence-based; Mobile and Smoke stay FAIL until field-proven.
- Source branch `awh/finish-first-control-tower` is based on canonical `6781e35af616af993657bce88ad25d79e93987a7`. Focused Infrastructure QA and Hub integration are green; exact final full regression must be green before commit/push.
- Production is still a healthy partial M16 state: SQLite schema 16, Control/Web pointers M15, native executor active. The staged exact M16 candidate exists, but Remote Desktop Commander blocks the bounded activation invocation. No safety bypass and no DB downgrade are allowed.

# Authoritative supersession — 2026-08-29 Continuous Auto-Chain canonical closure

- Canonical source is now `awh/api-independence` @ `070f61386da1f4203b7a20b255ba5f9aeecfe393`, merged from PR #51 after CI #646 succeeded across Ubuntu, Windows, Linux runtime, macOS package and Windows installer jobs.
- The canonical line retains `677cf8a` QA-operation hardening plus qualified multi-provider routing/execution and Continuous Auto-Chain V1. Local rebase regression: 307 tests = 306 PASS / 0 FAIL / 1 platform SKIP; Hub integration and PHP syntax PASS.
- ReadyIDC Production remains unchanged at M15 / SQLite v15 with active pointer `m15-402ff72ba41d`; integrity `ok`, foreign-key violations `0`, Nginx valid, native executor/backup timers active, latest verified backup SHA-256 `7603bc7384dec8d84b2610245eab135e0f78dcdaa0975050637d9bb293f1c128`.
- Production activation was explicitly approved for superseded source SHA `1a2261bf...`, but canonical advanced before mutation. That approval MUST NOT be reused for the new exact SHA. Remote execution safety also blocked the approved deployment/preflight command, and no bypass was attempted.
- Next Production attempt must re-audit canonical/Production and obtain explicit approval for the final exact deployment SHA before M15→M16 mutation.

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
