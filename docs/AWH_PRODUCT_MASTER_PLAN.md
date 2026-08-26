# AWH Product Master Plan

Status: LOCKED PRODUCT DIRECTION

This document is the durable product guardrail for Art’s Workspace Hub (AWH). It prevents implementation milestones from shrinking AWH into a chat page, an admin panel, or a single-purpose school tool.

## Product promise

AWH is one extensible workspace where a normal user can say what they want in ordinary language and the system selects the right AI, tool, project context, runtime and worker, executes safely, verifies the result, stores the artifact/state, and lets the user continue from any device.

The product must be useful before every advanced capability is finished. Every release therefore ships a coherent usable slice while preserving extension points for future capabilities.

## Experience model

### Teacher / Staff

The default post-login experience is a friendly school-work dashboard inspired by the simplicity of Canva Home, not a technical console.

Primary surfaces:
- Home dashboard
- AI help / command bar
- Documents
- PDF tools
- Image tools
- QR tools
- My files
- My tasks
- Continue working / recent work

Teacher-facing UI must not require knowledge of prompts, models, providers, APIs, VPS, Git, CLI, runtime, worker protocols or databases.

AI should be embedded in the workflow. A teacher can describe an outcome such as “รวม PDF พวกนี้”, “ทำบันทึกข้อความ”, or “รูปใหญ่เกินส่ง LINE ไม่ได้”; AWH chooses the appropriate tool or AI path.

### Owner

Owner receives the same simple workspace plus a complete control center:
- Projects
- Multi Chat / conversations
- Tasks
- Executions
- Memory / continuity
- Files / artifacts
- Approvals
- Automations
- Devices / workers
- Runtime / lnwjud
- AI providers / routing / quotas / costs
- Users / roles / permissions
- Security
- Database Studio / system health

Technical detail stays behind Owner / Advanced surfaces and must never leak into normal teacher workflows.

## Post-login home contract

Login → Dashboard, not Login → blank chat.

Dashboard priorities:
1. One prominent natural-language AI command bar.
2. Large, obvious quick-tool cards for common school work.
3. Continue working / recent work.
4. My tasks and finished AI work.
5. Recent files / artifacts.
6. Role-aware navigation.

Chat remains a first-class workspace but is not the whole product.

## Core architecture

### ReadyIDC Control Plane

ReadyIDC remains the always-on canonical authority for durable users, sessions, projects, tasks, executions, memory projections, artifacts, approvals, device presence and usage state.

### Device workers

Mac and Windows are optional workers, not separate AWH products. Work requiring a device is routed to an eligible worker; cloud-capable work remains usable while personal devices are offline.

### lnwjud execution core

lnwjud capability concepts remain part of the AWH execution layer. The product UX speaks in outcomes while the execution layer can inspect, plan, execute and verify through bounded capabilities.

AWH must not create a second parallel task/project/memory authority merely to integrate lnwjud.

### Multi Chat / Multi-Agent

AWH supports multiple durable conversations per project and future orchestration across multiple AI/agent specialists.

Agent-to-agent delegation may include Codex, Claude Code or other compatible specialists when available, but delegation remains behind AWH task/execution/approval boundaries. The user should not need to manually coordinate CLIs.

### Project + Memory + Continuity

A conversation is always contextual, not an isolated browser chat. Project identity, durable memory, decisions, open tasks, execution history and artifacts must allow continuation across iPhone, browser, Mac and Windows.

AWH must never intentionally answer “เริ่มใหม่จากศูนย์” when durable project state exists and the user has access to it.

## Tool Center

Tools are modular capabilities. The first useful set is:
- PDF merge / split / compress / rotate
- Images → PDF / PDF → images where supported
- Image resize / compress / convert
- QR generation

Prefer deterministic client-side/local implementations for operations that do not need AI. This reduces latency, cost and provider dependence.

Future school-tool modules may include documents, certificates, forms, announcements, office exports, OCR, voice, video and school-specific workflows.

## AI gateway

AI is an adapter, not the product.

Routing principles:
- availability first
- free / included / local before metered when quality is sufficient
- bounded context instead of resending entire projects
- stronger models only when task complexity/risk requires them
- per-user / per-role / per-project budgets and quotas
- truthful failure states; no false success

Users choose outcomes. AWH chooses providers and execution paths.

## Extensibility contract

AWH is designed for continuous development without periodic rewrites.

New capabilities must be added through stable boundaries:
- capability registry
- provider / worker adapters
- tool modules
- project adapters/connectors
- role/permission policy
- durable task/execution contracts
- versioned additive migrations
- presentation modules

Every new module must declare:
- human-facing capability
- required permissions
- execution location (browser/cloud/device/specialist)
- cost class
- risk class
- artifact/result contract
- availability/fallback behavior

No module may silently create a competing Project registry, task queue, memory store, approval system, user identity store or worker-auth system.

## School integration

AWH, BAY EXCUSE X and the public school website remain distinct products.

AWH may connect to BAY through explicit connectors. Start read-only where possible, link existing personnel identity, and reuse existing communication/outbox authority rather than duplicating school data.

## Product completion order

### P0 — Usable Product Home
- Dashboard becomes the post-login default.
- Teacher-friendly quick tools and AI command bar.
- Continue working / recent work.
- Chat moved into the workspace rather than being the entire home.
- Owner sees additional control-center entry points.

### P1 — Tool Center V1
- PDF, image and QR deterministic tools.
- File input/output UX suitable for non-technical users.
- Results saved/discoverable where server storage is appropriate.

### P2 — Continuity UX
- Project selector and durable recent work.
- Memory/current-context summaries.
- Conversation history / Multi Chat surfaced clearly.
- Task/result/artifact continuity across devices.

### P3 — Execution UX
- Human-readable Planning → Running → Approval → Verifying → Done states.
- Route to ReadyIDC / Mac / Windows / specialist automatically.
- lnwjud capabilities stay implementation detail unless Owner opens Advanced.

### P4 — Owner Control Center
- Projects, executions, memory, devices, providers, quotas, users, security and system surfaces unified.

### P5 — Expansion
- Automations
- school connectors
- richer documents/forms
- agent-to-agent delegation
- additional AI providers
- voice/TTS
- video/creative workflows
- future tools without a fixed endpoint

## Release discipline

“Usable” means a real person can complete the intended workflow, not merely that backend tests pass.

For each release:
1. preserve canonical identity/data
2. add versioned migration only when needed
3. backup before production mutation
4. automated tests
5. real output / field smoke
6. mobile-first verification
7. rollback path

Production health and product experience are separate gates; both must pass before calling a product slice complete.

## Non-negotiable product principles

- Mobile-first and iPhone-friendly.
- A normal teacher can use core tools without training.
- AI adapts to the user; the user does not learn infrastructure.
- One canonical AWH control plane.
- No duplicate core authorities.
- No destructive migration without backup/rollback.
- No fake progress or false success.
- Keep working when optional personal workers are offline.
- Spend AI tokens only when AI adds value.
- Preserve Multi Chat, Projects, Memory, lnwjud, Workers and Owner Control Center as first-class product scope.
- Build useful slices now while leaving stable extension points for capabilities that do not exist yet.
