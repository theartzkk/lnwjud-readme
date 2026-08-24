# AWH × lnwjud 4.9.1 Convergence

## Goal

Make Art’s Workspace Hub use lnwjud v4.9.1 as its local Windows execution core instead of continuing the older AWH-local MCP/runtime implementation. Preserve the existing AWH Hub/Project Memory/control-plane authority and layer it around the upstream core.

## Invariants

1. Upstream execution semantics win for local MCP/capabilities unless an AWH requirement is additive and independently justified.
2. Keep internal `@lnwjud/*`, `window.lnwjud`, launcher/tunnel filenames and protocol keys when renaming them would create compatibility risk without user value.
3. User-visible product identity is AWH. AWH owns its data directory, GitHub update source and installer artifact names.
4. ReadyIDC Hub v12 remains the canonical remote project/task/memory/revision authority; no second Hub/database/task engine may be created.
5. Project Memory remains `.awh/project.json` plus `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `ARCHITECTURE.md`, `DECISIONS.md`.
6. No silent legacy data import, credential copy, production mutation, or Windows-only behavior emulation on macOS.
7. Codex is an optional specialist/delegation path, not the default executor.

## Current candidate

- Branch: `awh/lnwjud4-port`
- Base: `v4.9.1^{}` = `166f004bf73e16d634ab37048346b4d4cd9df349`
- Core tool catalog: 214 tools, synchronized
- AWH overlay: product identity/data path + durable Project Memory + ReadyIDC Hub v12 source + web/control-plane/deployment assets
- Production: unchanged

## QA split

**Passed on macOS:** typecheck, shared resolver tests, packaging tests, integration tests, release-gate tests, 214-tool catalog check, AWH branding tests, and all locally runnable Hub fixtures.

**Windows field gate:** DPAPI, PowerShell tunnel lock/controller, Windows process ownership, production MCP stdio launcher, full desktop persistence, native packaging/installer and physical Windows behavior. These are intentionally not altered merely to pass on macOS.

## Closure order

1. Push this convergence candidate.
2. Run native Windows CI/field parity against the exact candidate SHA.
3. Fix only Windows-proven defects while preserving upstream semantics.
4. Attach AWH Hub worker/control-plane adapter to the v12 authority.
5. Verify Mac/Windows/Hub continuity and quota-saver behavior end-to-end.
6. Only then prepare an exact production deployment candidate and request production approval.
