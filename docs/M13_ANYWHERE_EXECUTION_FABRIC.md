# M13 — Anywhere Execution & Capability Fabric

Status: release candidate, not production-activated yet.

## Product invariant

AWH must remain usable from any modern device, from anywhere, without requiring the owner's Mac or school Windows PC to be online.

ReadyIDC is the always-on control plane and canonical runtime authority. Personal devices, lnwjud, Codex and future burst workers are optional execution providers only.

## Authority preservation

M13 does **not** create another Project registry, task queue, memory store, approval system, worker-auth system or Source of Truth. It projects capability/provider metadata over the existing M12 durable execution authority.

Authority order remains: current Source of Truth → active execution/checkpoint → current Project state → durable memory/history.

## Capability model

Capabilities are human-facing functions such as Cloud conversation, project inspection, browser work, Office/PDF/OCR, code specialist, voice and video. Technical tool names remain implementation details.
Routing preference is availability-first and cost-aware: always-on Cloud for normal work, then on-demand/burst providers, with optional personal-device providers used only when their unique capability is required or they materially reduce cost.

`lnwjud` v4.10.0 is recorded as an MIT upstream capability source. AWH harvests compatible capability concepts; it does not merge lnwjud into a parallel product or make Windows a prerequisite.

## Multi-session safety

Conversation/session identity and workspace mutation authority remain separate. M13 adds one execution envelope per existing durable execution. It reuses M12 candidate revisions and existing single-writer/lease behavior instead of introducing a second lock system.

## User experience

The default UI speaks in outcomes: “พร้อมใช้จาก AWH Cloud”, “ใช้ได้เมื่อมีอุปกรณ์เสริม”, and “กำลังพัฒนา”. Provider IDs, model names, worker internals, execution envelopes and technical logs belong in Advanced/Audit surfaces.

## Deployment contract

Activation accepts only canonical schema v12 or a verified v13 refresh. The native executor is quiesced before migration, database integrity and foreign keys are verified, and deployment records the exact baseline schema for rollback.

Production mutation remains approval-gated. Failed activation restores the exact database baseline, control/web pointers, managed executor units and Nginx configuration before service-health regression checks.
