> Historical/architectural reference only. Current execution behavior is defined by live capabilities, current evidence, and context-only working intent; prescriptive workflow text below is non-authoritative.

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

## Execution First / Remote Mission policy

The same Execution First model applies to every KRUART/AWH/BAY/LearnLab/website/document/creative task. One mission owns one mutation scope; device/resource leases prevent parallel writers. Route work by capability, keep long-running work alive across chat/transport interruptions, report assistant-visible evidence-backed heartbeats every 3–5 minutes, and continue without waiting for acknowledgement. Device-bound work normally targets a coherent ~30-minute productive mission (or longer when useful), not 1–2 minute micro-turns.

`remote-mission-state` is only a local device/transport lease and checkpoint aid. Canonical project/task/source/release mutation ownership remains in Hub task/execution/envelope authorities; a local mission file must never be used to override or duplicate that authority.

Subprocess completion never ends the mission by itself. Restart is recovery only, never a way to control state. Creative applications remain in one healthy session and must not be force-terminated for probing/QC. Long processes are polled sparsely (normally every 2–5 minutes) and resumed by PID/session/checkpoint.

QA is risk-based and single-flight; release/deep QA uses an immutable exact SHA in an isolated worktree. Closure requires completion proof and cleanup of transient clones/logs/probes/locks/bundles while preserving canonical source, bounded verified recovery, verified evidence and Production releases.

ChatGPT UI labels such as `กำลังคิด`, diagnostic text, tool labels or spinners are not progress reports. The owner-facing heartbeat must include elapsed time, stage, concrete delta, current operation, proof, PID/app when relevant, last save/artifact, next steps and blocker.

`config/execution-policy.json` is the machine-readable authority for this model.

## Permanent Fix / Root-Cause Closure

Do not optimize for passing the current gate. Resolve the evidence-backed root cause, then close shared/adjacent failure paths and regression risk. A temporary workaround must remain visibly temporary and carry a removal condition. Verify the real artifact/runtime/field result before closure.

## Visual Truth — school media

When an artifact represents โรงเรียนบ้านเอือดใหญ่ as factual reality, use verified first-party school photos, captures and source assets. Do not substitute generated, stock, other-school or unrelated imagery. Search Project Sources, KRUART Asset Vault, Drive/files and approved captures first. Illustration/concept media is acceptable only when explicitly requested or clearly non-documentary.
