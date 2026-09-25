> Historical/architectural reference only. Current execution behavior is defined by live capabilities, current evidence, and context-only working intent; prescriptive workflow text below is non-authoritative.

# KRUART Ecosystem Master Control

Updated: 2026-09-14 ICT.

This file is the **cross-project orchestration registry** for KRUART / AWH / BAY. It prevents conversational memory, stale handoffs, and parallel chats from becoming accidental orchestration authority.

It is **not** a replacement for each project's exact live Source of Truth. Before mutation, resolve the exact live source/Vault/runtime state required by that project. CURRENT_STATE.md remains the AWH operational-state authority.

## Global orchestration rule

- One Main Orchestration Chat is the coordination authority for the ecosystem.
- Each active project lane has at most one mutation owner at a time.
- Other chats/lane agents may inspect or prepare handoff evidence, but must not mutate the same source/runtime concurrently.
- A lane must update this registry or provide a FINAL HANDOFF to the Main Orchestration Chat before it is considered closed.
- Never infer current readiness from chat memory, a dated checkpoint, a folder name, or a stale worktree.
- Do not create duplicate Core/Auth/DB/Queue/Notification/Memory/Source Authority systems to work around a blocked lane.
- External GitHub projects are capability/reference inputs only unless the Main Orchestration Chat explicitly promotes a bounded integration.
- KRUART Owner Operating Model 2.0 applies to every lane and every mutation owner. Lane-specific rules may add constraints but cannot replace its Source-of-Truth, permanent-fix, tool-fit routing, resource-efficiency, real-evidence, real-QA, clean-environment or minimum-user-touch contracts.

## Status vocabulary

- ACTIVE — one mutation owner is currently changing this lane.
- WAITING — work is intentionally paused on an external dependency or handoff.
- VERIFY — current live/source status must be re-resolved before mutation.
- READY_TO_MERGE — source/QA candidate exists but is not canonical yet.
- READY_TO_DEPLOY — canonical candidate is verified but Production activation is pending.
- CLOSED — the lane has a verified safe checkpoint and no required mutation remains.
- BACKLOG — recorded future work; must not be silently started by another lane.

## Current lane registry

| Lane / product | Status | Mutation owner | Last authoritative evidence | Production/runtime | Next exact action |
|---|---|---|---|---|---|
| AWH / kruart.online | VERIFY | Main Orchestration Chat after reconciling any AWH closure lane | latest product-code baseline before governance-only Master Control commits is 128a9413800843bc83a8681303bdb28fb378f1a3, merge of PR #159; resolve live main again before mutation because governance commits may be newer | Last independently verified Production before PR #159 merge: m21-77573a7738ef, schema 21, SQLite integrity ok, FK clean, Nginx/PHP/native-executor/hosting-operator active. Do not assume the PR #159 product baseline is deployed without fresh evidence. | Read PR #159/final lane handoff, resolve live main, and inspect the live Production pointer before any AWH mutation or deploy |
| BAY EXCUSE X → VPS migration | ACTIVE | Existing BAY migration lane | Another chat is the mutation owner; exact source/runtime must come from its FINAL HANDOFF/live evidence | Migration/cutover status must not be guessed here | Finish that lane to a safe checkpoint, then hand off to Main Orchestration Chat |
| BAY LearnLab | VERIFY | None until Main assigns | Repository exists; prior field/deploy claims are historical until live recheck | Resolve live runtime before mutation | Receive lane handoff or perform read-only live reconciliation |
| BAY Hub | VERIFY | None until Main assigns | Repository exists; intended to converge with AWH ecosystem health rather than become a second control plane | Resolve live runtime before mutation | Reconcile status and consolidation boundary |
| School Website / school.kruart.online | VERIFY | None until Main assigns | Repository exists; public site must remain aligned with KRUART Golden UI | Resolve live runtime before mutation | Reconcile source/deploy status |
| TeacherAssessmentDocumentary | VERIFY | None until Main assigns | Repository exists; media/content project only, not platform authority | n/a unless a rendering/runtime lane is active | Reconcile project handoff before further production work |
| BAY Computer Lab | WAITING | Main assigns when device work is required | Device/native capability lane; must consume BAY identity rather than create its own authority | Physical device state is field evidence, not platform source authority | Reopen only for real device/native-app tasks |
| Parent Connect / LINE OA / LIFF | WAITING | BAY EXCUSE X migration lane while migration is active | Identity/data authority remains BAY EXCUSE X; no parallel LINE stack | Verify after migration/cutover | Validate links, LIFF, parent binding and notifications after cutover |
| KRUART Asset Vault / Golden UI | WAITING | Main assigns | Shared visual authority; must not become a competing project database | Asset/runtime state is project-specific | Reuse existing approved asset/design authority in every UI lane |

## Repository inventory owned by this ecosystem

- theartzkk/lnwjud-readme — AWH / kruart.online orchestration, Project Vault, durable Task/Execution, capability routing, VPS/runtime control.
- theartzkk/bay-excuse-x — school/student/personnel/identity, attendance, timetable, leave, substitute, reports, Parent Connect authority.
- theartzkk/bay-learnlab — classroom learning runtime that consumes BAY identity.
- theartzkk/bay-hub — BAY ecosystem surface/status; must not become a competing control plane.
- theartzkk/bay-school-website — public school website for **โรงเรียนบ้านเอือดใหญ่**.
- theartzkk/TeacherAssessmentDocumentary — teacher assessment / PA / salary-evaluation media project.

## External GitHub integration backlog

These repositories are deliberately recorded here so they cannot disappear when chats are archived or context is truncated.

| External repository | Status | Integration policy | Target capability |
|---|---|---|---|
| Tencent/teamai-cli | CLOSED | Integrated as opt-in `team.harness` / `tool.teamai` adapter metadata at `c23fd70380a3ae528dce227f9afbeaff8ad7bdc6`; no second orchestration plane | skills/rules/shared-knowledge patterns through existing AWH Task/Execution authority |
| Nutlope/hallmark | CLOSED | Integrated as MIT reference skill `design.hallmark` at `13ac0ec7e148655948100b6396439e481361d690` | Golden Visual QA/design audit/redesign/study reference; KRUART remains design authority |
| mksglu/context-mode | CLOSED | Integrated as opt-in local `context.optimize` / `tool.context-mode` metadata at `ba5f5dfd1a0cd3e8a8f812c219d50390ed0a61c8`; ELv2 keeps it local/non-hosted | local context optimization only; never Memory/Queue/Source Authority |
| rohitg00/awesome-claude-design | CLOSED | Integrated as MIT reference corpus `design.reference` at `7f60ee56b9340f8c2671a08c2d8aab4037546a64`; no competing design authority | DESIGN.md workflow and reusable design recipes/reference |

### Integration invariants

- Global Visual Truth applies to every lane: factual โรงเรียนบ้านเอือดใหญ่ visuals must use verified first-party school media. AI-generated, stock, other-school or unrelated imagery may not be presented as documentary reality; illustrative media is allowed only when explicitly requested or clearly non-documentary.
- Permanent Fix / Root-Cause Closure applies to every lane: do not close work because one gate passed; resolve the durable cause, audit adjacent shared assumptions, run regression/real QA, and track any temporary workaround until removal.

- Integrate external projects through existing AWH Skills/Capability Registry/provider/QA boundaries.
- Do not fork an external project into a second AWH Core.
- Preserve existing Task/Execution/lease/Vault/approval/audit authorities.
- AWH/VPS remains the preferred execution plane for Cloud-capable work.
- GitHub remains source mirror/collaboration/review unless the active source contract genuinely requires GitHub.
- Remote Desktop / Desktop Commander remains an allowed interactive/device route and explicit owner-selected route. Do not require headless-route exhaustion before use. Every invocation follows the Remote Mission efficiency contract: prepare → batch related safe work → real-output QA → delta capture → clean exit. Device-as-transit to VPS/API/GitHub remains prohibited when a direct approved route exists.
- Every promoted integration must record source repository, exact revision/version, license, enabled capability, rollback/disable path, and whether it touches user data.

## Target ecosystem surface

The user should be able to enter through kruart.online and reach the ecosystem without needing to understand which repository or worker implements each capability.

- AWH Home / Work / Chat
- Projects / Tasks / Executions
- Files / Documents / Approvals / Forms / Automations
- Memory / Devices / Runtime / System Health
- BAY EXCUSE X
- BAY LearnLab
- BAY Computer Lab
- BAY Hub / Ecosystem Health
- School Website
- Parent Connect / LINE OA / LIFF
- Student / Personnel / Attendance / Timetable / Substitute / Leave
- Scores / Behavior / Activities
- Reports / ปพ. / official print/document center
- PR Journal / media / Teacher Assessment Documentary
- KRUART Asset Vault / Golden UI assets

## Lane handoff contract

Before an active lane is closed or ownership moves to Main Orchestration, its FINAL HANDOFF must include:

1. Project/lane name.
2. Completed work.
3. Work still in progress.
4. Work not started.
5. Exact repository/ref/SHA or Vault revision/content identity.
6. Latest verified Production/runtime pointer.
7. DB/schema/data-integrity evidence when applicable.
8. CI/test/QA evidence.
9. Deploy/cutover state.
10. Latest backup/rollback point.
11. Real blockers.
12. Work Main must not repeat.
13. One next exact action.
14. Temporary branches/worktrees/files still retained.
15. Final lane status from the vocabulary above.

A missing handoff means the lane is **not** safe to assume closed.

## Main Orchestration startup checklist

1. Read this file.
2. Read ART_AI_WORKING_PROTOCOL.md.
3. Read CURRENT_STATE.md.
4. Identify the requested lane and its current mutation owner.
5. Resolve fresh source/runtime evidence needed for that mutation.
6. If another lane owns the mutation, do not edit/deploy; collect its handoff instead.
7. Update this registry whenever ownership, status, or a durable integration decision materially changes.

## Current priority order

1. Let the existing BAY EXCUSE X → VPS migration lane reach a safe checkpoint and hand off.
2. Reconcile PR #159 / any open AWH closure lane against live Production before another AWH mutation.
3. Reconcile all other open project lanes into this registry.
4. After migration/closure reconciliation, run ecosystem integration from the Main Orchestration Chat only.
5. Keep the four external GitHub integrations pinned and opt-in; refresh revisions only through reviewed AWH capability updates.
