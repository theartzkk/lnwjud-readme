# AWH P5 Expansion Blueprint

Status: DESIGN GUARDRAIL — no production activation

## Principle

P5 extends the existing AWH authority; it does not create parallel products. Automations, school connectors, voice, video and agent delegation must materialize work through the existing Project → Conversation → Task → Execution → Approval → Artifact path.

## Automations

An automation stores intent and timing only. When due, it creates or reuses one canonical `control_tasks` task through the existing control-plane work submission contract.

Required invariants:
- no second task queue or execution table
- deterministic idempotency per automation occurrence
- project membership and capability checks happen again at run time
- disabled/revoked automations cannot create work
- device-only work may wait for a worker; the schedule service never impersonates a worker
- risky work uses existing `control_approvals`
- every run maps back to the canonical task id for audit and continuation
- timezone and recurrence are explicit and bounded

A future additive automation registry may store definitions and run references, but execution state remains `control_tasks` / `control_task_executions`.

## Voice and TTS

M13 already declares `voice.tts` and `voice.clone` as planned capabilities. Providers such as local Thai TTS must be adapters behind those capability names rather than a new voice subsystem.

`voice.clone` is high risk and requires explicit profile ownership/consent plus existing approval boundaries. Raw voice samples must not become project memory by default.

## Video

M13 already declares `video.render`. Remotion, FFmpeg, cloud render or burst workers are provider choices behind that capability. Render tasks produce canonical artifacts and never become an independent project/task authority.

## Multi-agent delegation

Codex, Claude Code, MCP or future specialists are execution providers. Delegation remains inside a canonical AWH task/execution envelope. The user coordinates outcomes in AWH, not CLI handoffs.

If parent/child work becomes necessary, add a bounded task-relation projection; do not create a second conversation or approval system.

## BAY and school connectors

AWH, BAY EXCUSE X and the public school website remain distinct products. Start connectors read-only, link existing personnel identity and reuse BAY communication/outbox authority. Never copy school personnel, attendance or messaging records into a competing AWH source of truth.

## Activation order

1. Finish Owner Control Center and deploy current V1.2.1 safely.
2. Activate/verify Capability Fabric only through its existing migration discipline.
3. Add automation definition contract and read-only Owner surface.
4. Add a bounded automation materializer that submits canonical work.
5. Add TTS/video/provider adapters one capability at a time with field QA.
6. Add school connectors read-only first.
7. Add agent delegation only after task/execution/approval observability is strong enough.

No P5 capability is called production-ready until automated tests, real output QA, mobile UX and rollback evidence pass.
