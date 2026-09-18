# AWH Block-Free Operations

Current invariant: a browser/ChatGPT/worker transport is never the lifetime authority of an AWH job.

- ReadyIDC is the single production control-plane authority.
- On schema M12+, conversation submit persists the user turn, canonical task and `agent.conversation` execution before returning. Provider I/O runs only in the native executor after the request has returned.
- Task/execution idempotency, leases and bounded retry reuse the existing control-plane tables; no parallel queue exists.
- Provider/network failure preserves the same task and never fabricates success.
- Long local commands use start + poll rather than one long transport wait.
- Remote Desktop Commander version is resolved from live endpoint state; historical pins are not assumed current. During critical work, do not auto-upgrade or downgrade a healthy endpoint merely to match stale documentation.
- Use the standard installed Remote Desktop runtime and its supported persistence/reconnect behavior. Do not add custom watchers, screenshot loops or parallel remote daemons as a transport workaround.
- Safety/security gates are never bypassed; operations are decomposed into narrower supported actions instead.

Operational success is therefore **gateway failure ≠ job failure**. External ISP/provider/realtime outages can still occur, but accepted AWH work must remain durable and recoverable.

## Current ChatGPT + device operating mode

ChatGPT is currently Art's preferred interactive control surface. Route from ChatGPT directly to the authoritative VPS or the capability-fit endpoint; do not require the AWH UI merely to satisfy architecture. AWH remains the durable backend/control plane.

Device routing is capability-based: M5 is the clean creative/heavy workstation; AY-TEACHER and ART-MAC-INTEL are peer general workers for non-video projects; VPS owns server-native durable work. Only one chat/mission may actively mutate a given device GUI at once. Reuse one standard Remote Desktop session per endpoint and do not create duplicate remote processes, screenshot loops, custom watchers or similar persistent helpers as a transport workaround.

A ChatGPT response-stream failure and a Remote Desktop transport failure are separate failure domains. Neither should be "fixed" by making the endpoint heavier. On reconnect, re-inspect device/application state, resume from proven durable state, and avoid blind retry or repeated micro-polling.

## Gate minimization

A gate exists only to prevent a concrete damage mode. Keep hard blocks for platform safety/security, Production source/revision identity, single writer, data integrity, backup/rollback, secret boundaries, exact Production approval and destructive/irreversible actions. Reversible candidate work should continue through warnings/attention when the missing condition is not required for safe mutation. Pending release and Production lag are states, not candidate blockers. One exact-revision Production approval covers the bounded deploy mission unless revision, scope or risk changes.

Operational tiers: G0 read/inspect/QA runs automatically; G1 reversible candidate work and fast-forward `main` promotion run automatically after deterministic QA/checkpoint; G2 reversible Production gets one exact-revision approval and then closes automatically; G3 destructive/security/identity/DNS/credential operations require explicit action approval. Network route/SSH alias/device availability must be rerouted, not promoted into a safety gate.

VPS-hosted code promotion must stay on the VPS. ChatGPT should stage an exact bundle/revision and invoke the bounded local source operator; do not require AY-TEACHER, ART-MAC-INTEL or M5 to SSH back into the same VPS.

## Remote Desktop / Desktop Commander — high-value mission policy

**ChatGPT 30-minute Remote Mission rule:** a continuation request for active Remote work starts one coherent work block targeting approximately 30 minutes of productive execution. ChatGPT must not stop after a few minutes merely to report progress. It should continue in the same turn until the mission is complete, a genuine hard blocker/approval boundary appears, or the platform forcibly interrupts the turn.

**Global no-interruption requirement:** after any Remote Desktop/Desktop Commander invocation, ChatGPT must keep the mission moving continuously and must not pause for a ต่อ prompt or wait for acknowledgement. **Interim progress reporting is required and must be non-blocking:** send a detailed heartbeat approximately every 3–5 minutes or when a meaningful milestone completes, covering elapsed / delta since last / current / stage / proof / PID or app / latest save or artifact / next / blocker, then continue execution immediately. This rule applies across all KRUART/AWH/BAY/LearnLab/website/document/creative/device tasks. Use fewer, larger, better-prepared Remote calls because it keeps execution coherent and reduces fragmentation; Remote quota is not a limiting policy and must not reduce required work or QA.

**Remote-full-use policy:** Remote Desktop/Desktop Commander is intentionally available at full strength for endpoint work. Prefer it whenever real GUI/device/native-app state materially improves execution or verification. Keep the session productive for roughly 30 minutes or longer when useful, batching actions, reusing the same session/PID, and avoiding redundant reconnects/polls. Do not stop after 1–2 minutes while safe productive work remains, and do not refuse or shorten Remote work for quota reasons. VPS-only work must remain VPS-native so Remote is never wasted as a bridge back to the server.

A child process ending does not close the Remote Mission. Chain the next safe step automatically. Every progress heartbeat must cite fresh execution evidence, and a mission marked ACTIVE may not finalize while a safe next step remains. For scriptable work expected to exceed two minutes, prefer one durable one-shot process/checkpoint over repeated foreground micro-calls; this does not authorize persistent endpoint daemons or watchers.

**Detailed heartbeat format:** the owner must be able to understand real progress from the update alone. Include elapsed mission time, current stage (for example 3/7), exact delta since the previous heartbeat, current operation, fresh proof-of-work, active PID/app when applicable, latest canonical save/hash or output artifact, next 1–3 actions, and blocker. For Adobe/VTR, canonical AEP save evidence and latest render/QC artifact are mandatory when available. For release work, exact SHA and current/passed gate are mandatory. Do not fabricate percentages; prefer stage counts and verified deltas. Heartbeats never wait for acknowledgement.

Preferred owner-facing order: `Progress Heartbeat — Stage X/Y`, `Elapsed`, `เสร็จตั้งแต่ครั้งก่อน`, `กำลังทำ`, `Proof`, `ถัดไป`, `Blocker`. A spinner/status line by itself is never a heartbeat.

For long-running render/build/export processes, start once and keep the same process alive. Poll at meaningful checkpoints, normally every **2–5 minutes**; on reconnect, resume from the existing PID/session/checkpoint before considering any restart. Use bounded logs/previews and avoid repeated high-volume evidence reads.

Execution constants live in `config/execution-policy.json`. Long device-bound missions use the VPS-only `ops:mission-state` projection for active device lease, checkpoint, PID/app hint, heartbeat and next step. It stores no command, credential or task queue and creates no endpoint daemon. History is bounded by the machine-readable retention policy and pruned opportunistically by the CLI, so no watcher or permanent background cleanup service is required.

Remote access remains available by default when explicitly requested or materially useful for real device/UI work. Block-Free operation means eliminating wasteful micro-sessions and hidden device dependencies, not avoiding Remote Desktop. Remote quota/call count is observational telemetry only and must never become a hard gate or a reason to stop a productive mission.

For each invocation:
1. Reuse known Source of Truth, logs and last verified device delta before connecting.
2. Define one bounded problem cluster and include safe adjacent checks before the call.
3. Batch related actions and keep the active session instead of reconnecting for each micro-action.
4. Verify real UI/output and relevant regression before leaving.
5. Record what changed and what is now known so later work starts delta-first.
6. Clean task-created temporary state and intentionally leave required apps/services running or stopped.

Remote quota/call count is telemetry only and never changes routing, mission duration, or completion quality. Batching and reduced redundant polling exist to keep execution coherent. Never blind-retry a blocked call, and never use a device merely as a bridge to VPS/API/GitHub/CLI when an approved direct route exists.

## Permanent Fix / Root-Cause Closure

Do not optimize for passing the current gate. Resolve the evidence-backed root cause, then close shared/adjacent failure paths and regression risk. A temporary workaround must remain visibly temporary and carry a removal condition. Verify the real artifact/runtime/field result before closure.

## Visual Truth — school media

When an artifact represents โรงเรียนบ้านเอือดใหญ่ as factual reality, use verified first-party school photos, captures and source assets. Do not substitute generated, stock, other-school or unrelated imagery. Search Project Sources, KRUART Asset Vault, Drive/files and approved captures first. Illustration/concept media is acceptable only when explicitly requested or clearly non-documentary.
