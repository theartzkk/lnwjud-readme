# Art’s Workspace Hub — AWH

## Purpose

Art’s Workspace Hub is a personal multi-project workspace hub. It gives an AI
and its local tools one carefully selected project context while preserving
local control, explicit permissions, and recoverable changes.

## Product truth

- Tagline: **Your Projects. One Workspace. Anywhere.**
- AWH is one product; Art Agent is a legacy compatibility codename.
- AWH is local-first. GitHub is an optional mirror/CI path, not critical infrastructure.
- AI is a component/adapter of AWH, not the AWH product itself.
- Portable project identity is stored in `.awh/project.json`.
- Portable Project Memory is stored in `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `ARCHITECTURE.md`, and `DECISIONS.md`.
- Absolute workspace paths are device-local. `.git` is never synchronized by AWH.

## Current implementation status

- M1.1 Local QA Engine: closed.
- M1.2 Product Identity Migration: closed.
- M1.3A Safe Data Migration Engine: closed.
- M1.3B Active Data Directory Policy: closed.
- M2A Project Registry + Project Memory Foundation: closed.
- M2B initialized this repository as the first real AWH Project.
- Local Project Registry and bounded Project Context builder are implemented.
- Local MCP, security boundaries, checkpoints, task/runtime engine, Git context, and desktop foundation are implemented.
- M3C0 browser-safe static Remote Read-Only Preview is implemented; the operator has reported the static preview behind Nginx Basic Auth, but this repository has not verified the VPS.
- M3C1 PHP/SQLite Hub read foundation and M3D same-origin web gateway are operational on the VPS; field verification confirms live HTTPS access on desktop and iPhone.
- M3D field state: Connected read-only, one indexed project, and PHP-FPM + SQLite + Nginx gateway operational.
- M3C2 hosting foundation and VPS bootstrap are documented design/templates only.
- M3E Secure Device Enrollment Foundation is implemented locally: independent device enrollment, bounded pairing, token rotation/revocation, and explicit project membership are server/domain foundations only; no enrollment transport is exposed yet.
- M3E.1 additive SQLite migration safety is implemented locally with preflight, ledger, idempotent rerun, rollback testing, and a reviewed VPS runbook; it has not been run on the VPS.

## Current limitations

- Hub account enrollment, secure OS credential storage, project membership, account sync, and source revision sync are not complete.
- Google VPS deployment has not started.
- Mac ↔ Hub ↔ Windows continuity is a goal, not a verified service.
- Large assets require a future separate asset layer.
- macOS packaging is not complete.
- OpenAI Secure MCP Tunnel control-plane end-to-end connectivity is not claimed.
- AI provider adapters are local integration points; no AWH-owned model is bundled.
- VPS live behavior is recorded from field verification; credentials, passwords, public IPs, and SSH details remain intentionally outside Project Memory.
- M3D Hub Read remains read-only. M3E does not enable source writes, remote execution, synchronization, browser bearer tokens, or MCP proxying.
