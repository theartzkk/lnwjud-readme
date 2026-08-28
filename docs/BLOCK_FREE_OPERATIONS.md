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
