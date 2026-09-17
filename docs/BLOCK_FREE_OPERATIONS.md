# AWH Block-Free Operations

Current invariant: a browser/ChatGPT/worker transport is never the lifetime authority of an AWH job.

- ReadyIDC is the single production control-plane authority.
- On schema M12+, conversation submit persists the user turn, canonical task and `agent.conversation` execution before returning. Provider I/O runs only in the native executor after the request has returned.
- Task/execution idempotency, leases and bounded retry reuse the existing control-plane tables; no parallel queue exists.
- Provider/network failure preserves the same task and never fabricates success.
- Long local commands use start + poll rather than one long transport wait.
- macOS Remote Worker uses pinned Desktop Commander `0.2.47`, `--persist-session`, LaunchAgent supervision, a five-second recovery loop and no runtime `npx` fallback.
- The version-locked runtime patch contains only bounded logging, faster channel health checks, local-child recovery and process-spawn error containment.
- Safety/security gates are never bypassed; operations are decomposed into narrower supported actions instead.

Operational success is therefore **gateway failure ≠ job failure**. External ISP/provider/realtime outages can still occur, but accepted AWH work must remain durable and recoverable.

## Current ChatGPT + device operating mode

ChatGPT is currently Art's preferred interactive control surface. Route from ChatGPT directly to the authoritative VPS or the capability-fit endpoint; do not require the AWH UI merely to satisfy architecture. AWH remains the durable backend/control plane.

Device routing is capability-based: M5 is the clean creative/heavy workstation; AY-TEACHER and ART-MAC-INTEL are peer general workers for non-video projects; VPS owns server-native durable work. Only one chat/mission may actively mutate a given device GUI at once. Reuse one standard Remote Desktop session per endpoint and do not create duplicate remote processes, screenshot loops, custom watchers or similar persistent helpers as a transport workaround.

A ChatGPT response-stream failure and a Remote Desktop transport failure are separate failure domains. Neither should be "fixed" by making the endpoint heavier. On reconnect, re-inspect device/application state, resume from proven durable state, and avoid blind retry or repeated micro-polling.

## Gate minimization

A gate exists only to prevent a concrete damage mode. Keep hard blocks for platform safety/security, Production source/revision identity, single writer, data integrity, backup/rollback, secret boundaries, exact Production approval and destructive/irreversible actions. Reversible candidate work should continue through warnings/attention when the missing condition is not required for safe mutation. Pending release and Production lag are states, not candidate blockers. One exact-revision Production approval covers the bounded deploy mission unless revision, scope or risk changes.

## Remote Desktop / Desktop Commander — high-value mission policy

Remote access remains available by default when explicitly requested or materially useful for real device/UI work. Block-Free operation means eliminating wasteful micro-sessions and hidden device dependencies, not avoiding Remote Desktop.

For each invocation:
1. Reuse known Source of Truth, logs and last verified device delta before connecting.
2. Define one bounded problem cluster and include safe adjacent checks before the call.
3. Batch related actions and keep the active session instead of reconnecting for each micro-action.
4. Verify real UI/output and relevant regression before leaving.
5. Record what changed and what is now known so later work starts delta-first.
6. Clean task-created temporary state and intentionally leave required apps/services running or stopped.

Quota adaptation is driven only by observed quota/availability. Normal capacity keeps normal access. Constrained capacity increases batching and eliminates redundant exploration without silently skipping required QA. Never blind-retry a blocked call, and never use a device merely as a bridge to VPS/API/GitHub/CLI when an approved direct route exists.

## Permanent Fix / Root-Cause Closure

Do not optimize for passing the current gate. Resolve the evidence-backed root cause, then close shared/adjacent failure paths and regression risk. A temporary workaround must remain visibly temporary and carry a removal condition. Verify the real artifact/runtime/field result before closure.

## Visual Truth — school media

When an artifact represents โรงเรียนบ้านเอือดใหญ่ as factual reality, use verified first-party school photos, captures and source assets. Do not substitute generated, stock, other-school or unrelated imagery. Search Project Sources, KRUART Asset Vault, Drive/files and approved captures first. Illustration/concept media is acceptable only when explicitly requested or clearly non-documentary.
