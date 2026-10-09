# Platform Reset Migration Backlog — 2026-10-05

This file preserves product and platform intent before stale durable goals are reconciled out of the active queue. Reconciliation here changes control-plane goal state only. It does not delete source, databases, production releases, audit evidence, or protected user/school data.

## Platform execution work absorbed into canonical reset

### vps-delivery-speed-quality-wave
- Goal: 31d688bb-c5b6-4879-b5fa-f04cb6662ffc
- Phase: mobile-experience-convergence-final-candidate-awaiting-source-activation
- Objective: Resume the existing VPS delivery-speed-quality wave and evaluate Hatchet in shadow mode as a replacement for custom execution/queue/retry/concurrency machinery, with zero Production mutation authority. Preserve only AWH safety/identity/owner-approval boundaries. Measure actual latency and control-plane call reduction before any cutover.
- Next: Ingest exact ZIP 41483020 into Project Vault, promote current-base candidate, verify Source/Vault parity and Update Center candidate identity, then stop at exact-revision Production approval.
- Prior blocker: fresh Owner exact-action approval required.
- Tracked task 8f5e710a-c7c7-4401-b22a-9afb0f8fc3b4 is terminal timed_out.
- Migration: execution-foundation / concurrency / control-room steps of canonical Platform Reset.

## Product work preserved for later migration waves

### BAY Excuse / Smart Card release
- Goal: 34471b71-25ee-47ed-b521-f204c111754c
- Key: bay-card-rc6652-release-cc5a6ac2
- Objective: resume governed BAY Excuse rc.66.52 release workflow from verified checkpoint through source authority and release path.
- Next: finalize verified source candidate through governed source-authority path.
- Migration: BAY Core/Card product migration wave after platform execution foundation is stable.

### BAY Assessment answer-key rescore
- Goal: f5b58c13-dabd-49b0-92ae-0aa17eaaaaa3
- Key: bay-assessment-answer-key-rescore-hotfix
- Objective: allow owner/academic to correct answer key after scanning starts but before finalization and deterministically rescore stored objective responses while preserving scan evidence, essay scores, geometry, ownership and auditability.
- Next: verify scanned session, current answer key and existing lock.
- Migration: Assessment functional backlog; must preserve exact scan/audit semantics.

### BAY Assessment teacher mobile UX
- Goal: 8ae3e96a-034d-401e-a686-d8b39082c8ab
- Key: bay-assessment-teacher-mobile-ux-cleanup
- Objective: explicit reliable logout, one current usable paper session per subject/class/campaign, legacy sessions only as collapsed history/compatibility, preserve old printed QR/scan compatibility.
- Next: inspect current session grouping, legacy/current paper state and mobile logout UX.
- Migration: Experience Platform + Assessment migration wave.

### BAY product consolidation
- Goal: bee3f408-eef1-40ac-9d64-ce9d132c48a5
- Key: bay-product-consolidation-20261004
- Objective: prepare/verify BAY Excuse Core consolidation candidate from canonical VPS Git with verified UX/UI/AX closure fixes and existing source/deploy authority.
- Next: create isolated BAY candidate from canonical VPS main.
- Migration: absorb into shared Experience Platform + BAY Core migration, not a separate orchestration track.

### AWH ChatGPT tool branding
- Goal: f4679745-8ed9-4210-ba93-c7a7b5a817fb
- Key: awh-chatgpt-tool-branding
- Objective: first-class AWH tool/plugin identity metadata and icon where source-controlled, without faking host UI branding.
- Next: edit existing Secure MCP App primary icon only when owner registration editor is exposed.
- Blocker: HOST_APP_REGISTRATION_EDITOR_UNAVAILABLE.
- Migration: external-host backlog; not allowed to block execution reset.

### BAY Assessment reserve answer sheets
- Goal: 93bcda8b-bb41-43e7-a238-f6c695b2a830
- Key: bay-assessment-print-center-reserve-answer-sheets
- Objective: include deterministic reserve answer-sheet output in Print Center while preserving scanner geometry, no-answer-key behavior and release authority.
- Next: verify reserve-count wiring and PDF generation.
- Migration: Assessment functional backlog.

### BAY Assessment stale rc.52.18 release track
- Goal: f524f77b-4f25-4f45-9035-3e6a98ca6a81
- Key: bay-assessment-rc52.18-release
- Objective at creation: deploy rc.52.18 while preserving legacy v6/v7 compatibility.
- Latest checkpoint had already moved target to rc.52.20 while Production was newer; this durable goal is stale by identity.
- Migration: retain historical evidence only; current Assessment migration must rediscover live canonical/Production state before any mutation.

## Goals intentionally kept active
- awh-bay-platform-reset-reliability-experience-20261005 — canonical reset.
- awh-agent-intel-release-closure — live AWH Agent packaging/release work still running.
- bay-computer-lab-management-resume — field/device scope with live QA service and physical-device prerequisites.
- bay-line-experience-wave3 — separate clean LINE workspace; preserve as independent project scope until migration wave explicitly joins it.

## Protected-data rule
Reconciliation of a durable goal is metadata cleanup only. It must never be used as authority to delete school data, scores, attendance, cooperative transactions, LINE bindings, Smart Card registry/history, accounts, secrets, audit history, source history, release history, or production databases.
