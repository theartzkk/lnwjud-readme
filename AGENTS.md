# AWH Agent Entry Contract

Before planning, editing, delegating, testing, deploying, or reporting work for Art:

1. Read `ART_AI_WORKING_PROTOCOL.md` and treat it as the durable owner-level working contract.
2. Read `KRUART_ECOSYSTEM_MASTER_CONTROL.md` before any cross-project planning or mutation. Treat its lane ownership/status registry as the orchestration authority; if another lane owns the mutation, do not edit/deploy that lane.
3. Read `CURRENT_STATE.md` and treat it as the current AWH operational-state authority; resolve exact Source of Truth/live state again before mutation.
4. Read the active project's portable identity and Project Memory (`CURRENT_STATE.md`, `PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `ARCHITECTURE.md`, `DECISIONS.md`) when available. Dated checkpoint claims are historical unless `CURRENT_STATE.md` or fresh evidence confirms them.
5. Inspect the current Source of Truth/runtime state relevant to the task before choosing implementation.
6. Treat the user's prompt as the desired outcome/symptom, **not as a restriction on analysis scope**.
7. Follow system-first/root-cause-first analysis and avoid micro-fix loops or parallel systems.
8. Preserve unrelated user work and already-validated core behavior.
9. Distinguish source-ready, QA-passed, artifact-ready, deployed, field-tested, and usable states truthfully.

Precedence:

1. platform/security constraints
2. `ART_AI_WORKING_PROTOCOL.md`
3. project-specific durable memory/constraints
4. current Goal/task acceptance criteria
5. current source/device/runtime evidence

Project-specific rules may be stricter but must not silently weaken the owner protocol.

## Design governance rule

- For any UI, UX, CSS, component, layout, navigation, typography, logo, illustration, banner, responsive, accessibility or visual-regression work, read `design/DESIGN.md`, `design/UX-ACCEPTANCE.md`, `design/AGENT-DESIGN-RULES.md` and the matching `design/overlays/` file before editing.
- `config/kruart-visual-assets.json` remains the semantic asset-slot authority; `design/assets.manifest.json` is a governance pointer and must not become a competing registry.
- Do not reinterpret the Golden KRUART family, regenerate approved logos, change the canonical school spelling, or introduce a second design system/framework merely to achieve visual consistency.
- Exact-revision rendered evidence and the existing deployment/rollback gates remain required; source inspection alone cannot classify a visual change as PASS.

## Canonical source rule

- Project source authority is singular and must be read from the current AWH Source Authority state. When authority is `AWH_VAULT`, the deliberately bound active Vault revision/content identity is the canonical execution source; GitHub repository/ref data remains mirror/upstream provenance and a later GitHub observation must not steal authority.
- For GitHub-authority projects, GitHub synchronization, or a release explicitly sourced from GitHub, `main` on the reviewed `theartzkk/lnwjud-readme` repository is the reviewed AWH upstream line. `awh/api-independence` is a compatibility ref only and must resolve to the same commit while retained.
- Do not require a GitHub network call merely to inspect, QA or execute work against an already-bound canonical Vault revision. GitHub outage/quota must stop only work that genuinely requires GitHub authority or synchronization.
- Before a GitHub-bound source or Production mutation, resolve the live reviewed upstream and use `scripts/ops/canonical-source-preflight.mjs --require-mutation-ready` where that contract applies. A cached remote-tracking ref, historical worktree, folder name or dated Project Memory statement is diagnostic evidence only.
- If a GitHub-authority mutation cannot resolve its live upstream, stop that mutation. Never fall back to a stale ref, another worktree, Remote Desktop transit hop, or manual replay.
- Multiple worktrees are allowed only as explicit operator/candidate/evidence/protected work. Never reset or repurpose a dirty/protected worktree to satisfy a source gate.

## Block-Free execution rule

- Route work in this order when capabilities permit: AWH server-native/VPS typed execution → direct connected API/connector → central Codex/specialist against a Vault revision → native device-only capability → Remote Desktop only for inherently interactive/device-local work.
- An online device must never become a hidden dependency for Cloud-capable work. Remote Desktop is prohibited as a transit hop to VPS/GitHub/API/CLI when a direct approved route exists.
- GitHub and hosted Actions are optional collaboration/verification paths unless the active source authority or requested operation genuinely requires them; local/VPS QA remains valid evidence when the canonical contract supports it.
- Prefer typed/approved operations over free-form shell. For repository QA use `project_task_start` with `qa-fast`, `qa-local`, or `qa-full`, then poll task status/logs.
- When only a terminal boundary is available, prefer the canonical short package scripts (`npm run qa:fast`, `npm run qa:local`, `npm run qa:full`, `npm run typecheck`, `npm run build`) instead of composing raw `node`, shell pipelines, or compound deploy commands.
- A platform safety/security gate is terminal for that attempted action: never bypass, disguise, or blind-retry it. Decompose the work into supported typed actions, connected tools, or the reviewed deployment authority.
- Long-running work must use start + poll/checkpoint semantics rather than one synchronous tool request.
- Production mutation keeps its existing explicit approval, backup, exact-revision, live-canonical-source, and rollback requirements.


## Clean workstation / minimum local footprint

Art's new MacBook Pro is a **clean creative/control workstation**, not a source/runtime warehouse. **VPS/AWH/Vault-first** and **Minimum Local Footprint** are hard safety invariants.

- Default persistent project-clone/worktree count on the Mac is **zero**.
- Prefer the active AWH/VPS/Project Vault authority and direct connected service/API. Use Mac-local execution only when the capability genuinely requires macOS/local hardware/software.
- GitHub is optional upstream provenance/mirror/review/transport. It is **not** a default runtime dependency, storage authority, execution queue, or required gate. GitHub quota/outage must not block work that can proceed against an already-bound AWH/VPS/Vault revision.
- Do not clone source onto the Mac merely to inspect/review, make remote-safe docs/config changes, build on VPS, or reach another service.
- If a Mac-only task truly needs local source/assets, fetch only the bounded working set required; keep it temporary, return durable results to the canonical VPS/Vault/Drive authority, then remove proven-regenerable intermediates.
- Ephemeral agent work belongs under `/tmp/kruart-agent/<task>`, not Desktop/Documents/Downloads.
- No silent install and no silent persistence: avoid unnecessary apps/packages/runtimes/agents/services/login items/watchers. Any genuinely necessary persistent addition must have purpose, owner, location, startup mechanism, and exact removal/rollback path.
- Do not make the Mac the primary repo store, database host, runtime log warehouse, artifact archive, or backup server.
- Keep cloud-synced user folders free of dependencies, caches, builds, logs, worktrees, temp data, and large generated artifacts.
- Before large local downloads/renders/builds, verify disk headroom; below 15% free capacity or 100 GB free, whichever is stricter, stop local growth and audit safely.
- Cleanup only proven-regenerable data. Never guess-delete source, secrets, databases, user documents, unique assets, or backups.
- Task closure must verify there is no unnecessary local clone/worktree/source copy/temp/build/cache/log/installer/archive/background item or duplicate authority left behind.

**Maximum Automation + Minimum User Touch + Minimum Local Footprint. VPS/AWH/Vault-first. GitHub-optional.**

