# KRUART Ecosystem Master Control

Updated: 2026-09-14 ICT.

This file is the **cross-project orchestration registry** for KRUART / AWH / BAY. It exists so that no chat, agent, worker, or operator has to rely on conversational memory to know which lane owns a mutation, what is already closed, or what integration work remains.

It is **not** a replacement for each project's exact live Source of Truth. Before mutation, resolve the exact live source/Vault/runtime state required by that project. CURRENT_STATE.md remains the AWH operational-state authority.

## Global orchestration rule

- One Main Orchestration Chat is the coordination authority for the ecosystem.
- Each active project lane has at most one mutation owner at a time.
- Other chats/lane agents may inspect or prepare handoff evidence, but must not mutate the same source/runtime concurrently.
- A lane must update this registry or provide a FINAL HANDOFF to the Main Orchestration Chat before it is considered closed.
- Never infer current readiness from chat memory, a dated checkpoint, a folder name, or a stale worktree.
- Do not create duplicate Core/Auth/DB/Queue/Notification/Memory/Source Authority systems to work around a blocked lane.
- External GitHub projects are capability/reference inputs only unless the Main Orchestration Chat explicitly promotes a bounded integration.

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
| AWH / kruart.online | CLOSED | Main Orchestration Chat only if reopened | canonical main 77573a7738efacfbb57b2dcc9944dd5fd8c3c1f7 | m21-77573a7738ef; schema 21; SQLite integrity ok; FK clean; Nginx/PHP/native-executor/hosting-operator active | Monitor; do not reopen without a new explicit goal |
| BAY EXCUSE X → VPS migration | ACTIVE | Existing BAY migration lane | Another chat is the mutation owner; exact source/runtime must be taken from its FINAL HANDOFF/live evidence | Migration/cutover status must not be guessed here | Finish that lane to a safe checkpoint, then hand off to Main Orchestration Chat |
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
| Tencent/teamai-cli | BACKLOG | ADAPT only; no second orchestration plane | specialist/team patterns, reusable skills, shared project knowledge |
| Nutlope/hallmark | BACKLOG | ADOPT/ADAPT as bounded QA tooling | Golden Visual QA, design audit, redesign/study workflow |
| mksglu/context-mode | BACKLOG | ADOPT as optimization only; never Memory/Queue/Source Authority | large-output/context compression for Codex, logs, diffs, tests and research |
| rohitg00/awesome-claude-design | BACKLOG | REFERENCE/ADAPT; no competing design authority | codebase → design-system extraction, DESIGN.md workflow, reusable design recipes |

### Integration invariants

- Integrate external projects through existing AWH Skills/Capability Registry/provider/QA boundaries.
- Do not fork an external project into a second AWH Core.
- Preserve existing Task/Execution/lease/Vault/approval/audit authorities.
- AWH/VPS remains the preferred execution plane for Cloud-capable work.
- GitHub remains source mirror/collaboration/review unless the active source contract genuinely requires GitHub.
- Remote Desktop remains device-only fallback and must not be used as transit to VPS/API/GitHub.
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
2. Reconcile all other open project lanes into this registry.
3. Keep AWH stable on the verified M21 baseline unless a new requirement genuinely needs a change.
4. After migration closure, perform ecosystem integration/reconciliation from the Main Orchestration Chat only.
5. Evaluate and integrate the four external GitHub capabilities one by one, with no duplicate authority.
