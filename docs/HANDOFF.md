# AWH Durable Handoff Reference

This document is continuity context only. It is not a policy, ruleset, runtime authority or release authorization.

Start from the repository-root `AGENTS.md`, then verify live source/runtime/mission state. Normative architecture is `docs/AWH-AUTHORITY-MAP.md`; execution integrity is mirrored in `config/execution-policy.json`.

Handoffs may record evidence and unfinished intent, but mutable facts must be re-observed before action. A second chat/worker joins or waits for an existing conflicting mutation authority rather than opening another writer.

Production completion requires exact source/release/public identity plus post-deploy verification; old handoff prose never substitutes for that evidence.

Detailed dated handoffs belong under `history/`.
