# Handoff

## Current state

### Current live state — M12 production + provider field-debug

ReadyIDC is the active production authority at SQLite **schema v12**. The deployed runtime SHA is `9b5970f3a29213d79550b068805bd0b23c84674a` and the production pointer is `m12-9b5970f3a292`. M12 migration/idempotence/integrity/FK checks, Nginx/PHP-FPM, native executor timer, Project Vault, artifact storage, task workspace/transfer permissions, owner/auth preservation and the rollback contract are verified production evidence.

The active source branch is `awh/v0.1-migration`. Current source may be ahead of production; production is never inferred from repository HEAD. For any continuation, inspect current source/local+remote state first, then production read-only evidence, then DB/release pointers, and only then these documents.

The current field defect is the OpenAI Responses conversation path. Production key storage and the old connection test prove credential reachability, but the deployed request path can fail and still surface a deterministic fallback as `COMPLETED`. Source work now targets the exact defect boundary: valid Responses history schema, sanitized diagnostics, a real low-cost Responses probe, no false-success, bounded retry on the same task, truthful user-visible states, and cost accounting that does not treat failed calls as successful model results.

Normal owner use remains username/password plus a revocable remembered session. Provider secrets are server-side/write-only. No production mutation, key replacement, budget purchase, Google Cloud legacy change or BAY production change is part of this field-debug.

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