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

## KRUART Owner Operating Model — mandatory inheritance

ART_AI_WORKING_PROTOCOL.md is the single owner-level operating authority. Every task must apply its policy families together: Outcome & Continuity; Authority & Source of Truth; System Analysis & Permanent Repair; Tool-Fit Routing; Resource Efficiency; Device & Remote Mission; Evidence & Visual Truth; QA & Truthful Closure; Safety/Integrity/Rollback; Clean Environment/Lifecycle; Maximum Automation & Minimum User Touch.

Do not optimize one family by breaking another:
- VPS-first is not a ban on real-device work.
- Remote efficiency is not Remote avoidance.
- quota efficiency is not lower QA.
- one coherent pass is not permission for unrelated scope expansion.
- permanent fix is not permission for gratuitous refactoring.
- automation is not permission to bypass approval, data integrity, rollback or platform safety.

### Current operating posture — mandatory

- ChatGPT + Remote Desktop / Desktop Commander is Art's current primary interactive surface; AWH is the backend/control plane until its UI is demonstrably more useful. Do not require an AWH-App detour.
- VPS owns server-native Source-of-Truth/runtime/deploy/DB/backup/log/automation work.
- `ART-MAC-M5` owns creative/heavy native media work and must remain clean: no convenience watchers/duplicate remote daemons/server state.
- `AY-TEACHER` and `ART-MAC-INTEL` are peer GENERAL_WORKER endpoints for non-video project work; prefer AY-TEACHER when Art is at school. M5 may later absorb the personal general-worker role only after capability parity is proven.
- One device has one GUI writer at a time. Reuse one healthy standard remote session per endpoint; other chats may prepare/analyze elsewhere but must not race the same GUI.
- Gate policy is damage-based: hard-block real safety/integrity/authority/rollback/Production-approval risks; downgrade reversible candidate-work readiness gaps to warning/attention/verification. Never add a ritual gate that prevents no distinct damage.
- Gate tiers are fixed: **G0 observe = automatic; G1 reversible candidate/main fast-forward = automatic after QA/checkpoint; G2 reversible Production = one exact-revision approval then automatic closure; G3 destructive/trust-boundary = explicit action approval.** Offline personal devices, SSH alias availability, GitHub quota, optional evidence or stale tracking are routing/attention states, not hard blockers.
- For VPS-hosted code repositories, do not use a personal Mac/Windows endpoint as a transit hop to mutate VPS canonical source. Use the bounded local VPS source-promotion authority.


## Design governance rule

- For any UI, UX, CSS, component, layout, navigation, typography, logo, illustration, banner, responsive, accessibility or visual-regression work, read `design/DESIGN.md`, `design/UX-ACCEPTANCE.md`, `design/AGENT-DESIGN-RULES.md` and the matching `design/overlays/` file before editing.
- `config/kruart-visual-assets.json` remains the semantic asset-slot authority; `design/assets.manifest.json` is a governance pointer and must not become a competing registry.
- Do not reinterpret the Golden KRUART family, regenerate approved logos, change the canonical school spelling, or introduce a second design system/framework merely to achieve visual consistency.
- Exact-revision rendered evidence and the existing deployment/rollback gates remain required; source inspection alone cannot classify a visual change as PASS.

### Execution First — mandatory for every project and task

- One coherent user objective = one Mission. A completed command/subprocess is not mission completion. Continue through the next safe productive step until the objective is complete, a real blocker/approval boundary appears, or the platform interrupts.
- One mutation scope has one Mission Owner/Writer at a time. Other chats may inspect/analyze, but they must not mutate the same project/resource concurrently. Use the existing VPS mission projection/resource lease; do not invent another queue or lock system.
- Route by capability: VPS/control plane for source, DB, build, QA, deploy, automation and headless work; M5 for creative/native media; AY-TEACHER or ART-MAC-INTEL for general endpoint/classroom/Office/browser work. Never use a personal endpoint as gratuitous transit back to VPS.
- Remote/device work targets a long productive mission (~30 minutes or longer when useful), not micro-turns. First productive action should normally begin within ~60 seconds when state is already known.
- Send assistant-visible, evidence-backed Detailed Progress Heartbeats every ~3–5 minutes or at milestones: elapsed, stage, delta since last heartbeat, current operation, proof, PID/app, save/artifact, next 1–3 steps, blocker. ChatGPT spinners/internal status never count. Send the heartbeat and continue immediately without waiting for `ต่อ`.
- Poll long-running work sparsely (normally 2–5 minutes). Transport timeout or stream interruption means inspect/resume the same PID/session/checkpoint first; never restart merely because the chat/tool transport reconnected.
- Restart is recovery, never state control. Creative apps must stay in one healthy session; routine kill/pkill/force-quit is forbidden. Force termination requires confirmed hang evidence and save/checkpoint protection.
- Source of Truth precedes every mutation. Code uses canonical VPS Git/main authority; non-Git media/docs use their declared canonical project/Vault source. Single-writer project files (AEP/docs/etc.) must not be mutated from parallel chats.
- QA is risk-based and single-flight. Release/deep QA runs against an immutable exact SHA in an isolated worktree; shared mutable branches are not release evidence.
- Mission closure requires objective completion proof plus cleanup. Remove temp clones, logs, probes, locks, bundles and generated transient artifacts; preserve only canonical source, bounded verified recovery, verified evidence and Production releases.
- Gates are damage-based only: G0 observe automatic; G1 reversible candidate/main automatic after proof; G2 Production one exact-revision approval; G3 destructive/trust-boundary explicit action approval. Do not add ritual gates for offline devices, quota, stale metadata or optional evidence.
- `config/execution-policy.json` is the machine-readable authority. Human docs explain it and must not silently contradict it.

### Permanent Fix / Root-Cause Closure — mandatory

- Solve the durable cause, not merely the current gate. A command, CI check, deployment, dialog or one-off workflow passing is not sufficient closure when the underlying defect can recur.
- Audit the full affected path: root cause, shared boundary/config/data contract, adjacent blockers, regression surface, compatibility, rollback and real user-visible behavior.
- Prefer the smallest durable shared fix over repeated local patches. Do not perform unrelated large refactors where the existing architecture is healthy.
- A temporary workaround is allowed only when a durable repair cannot safely be completed in the current scope. Mark it as temporary, preserve the real root-cause evidence, state the removal/closure condition, and never silently promote it to the permanent solution.
- Closure requires real QA of the artifact/runtime/field behavior where feasible, not merely a successful command or test harness.

### Global Visual Truth — mandatory for every project

- Any content that represents โรงเรียนบ้านเอือดใหญ่, its grounds, classrooms, staff, students, activities, documents, devices, systems or real events must use authentic first-party school media/evidence from current Project Sources, KRUART Asset Vault, Drive/files, approved captures or other verified school-owned sources whenever that content is presented as real.
- Do not use AI-generated images, stock photos, or images of another school/place/person as a substitute for school reality. Never imply such media is a real photo/event/location from โรงเรียนบ้านเอือดใหญ่.
- If real media is missing, search/reuse verified school sources first. Missing evidence is not permission to fabricate a replacement.
- Generated illustration/cartoon/concept media is allowed only when Art explicitly requests that mode or the artifact is clearly illustrative; it must not be presented as factual documentary evidence.
- Preserve original framing/content unless the task explicitly requires editing. For documentary/VTR/evaluation work, keep full originals available before any crop or derivative.

## Canonical source rule

- Project source authority is singular and must be read from the current AWH Source Authority state. When authority is `AWH_VAULT`, the deliberately bound active Vault revision/content identity is the canonical execution source; GitHub repository/ref data remains mirror/upstream provenance and a later GitHub observation must not steal authority.
- For GitHub-authority projects, GitHub synchronization, or a release explicitly sourced from GitHub, `main` on the reviewed `theartzkk/lnwjud-readme` repository is the reviewed AWH upstream line. `awh/api-independence` is a compatibility ref only and must resolve to the same commit while retained.
- Do not require a GitHub network call merely to inspect, QA or execute work against an already-bound canonical Vault revision. GitHub outage/quota must stop only work that genuinely requires GitHub authority or synchronization.
- Before a GitHub-bound source or Production mutation, resolve the live reviewed upstream and use `scripts/ops/canonical-source-preflight.mjs --require-mutation-ready` where that contract applies. A cached remote-tracking ref, historical worktree, folder name or dated Project Memory statement is diagnostic evidence only.
- If a GitHub-authority mutation cannot resolve its live upstream, stop that mutation. Never fall back to a stale ref, another worktree, Remote Desktop transit hop, or manual replay.
- Multiple worktrees are allowed only as explicit operator/candidate/evidence/protected work. Never reset or repurpose a dirty/protected worktree to satisfy a source gate.

## Block-Free execution rule

- When Art has not selected a route and equivalent capabilities are available, prefer AWH server-native/VPS typed execution → direct connected API/connector → central Codex/specialist against a Vault revision → native device capability → Remote Desktop / Desktop Commander. This is a default routing preference, not a ban: explicit Remote Desktop intent is allowed immediately.
- An online device must never become a hidden dependency for Cloud-capable work. Remote Desktop is prohibited only as a gratuitous transit hop to VPS/GitHub/API/CLI when a direct approved route exists; this does not prohibit an explicitly requested or genuinely device-local Remote Mission.
- GitHub and hosted Actions are optional collaboration/verification paths unless the active source authority or requested operation genuinely requires them; local/VPS QA remains valid evidence when the canonical contract supports it.
- Prefer typed/approved operations over free-form shell. For repository QA use `project_task_start` with `qa-fast`, `qa-local`, or `qa-full`, then poll task status/logs.
- When only a terminal boundary is available, prefer the canonical short package scripts (`npm run qa:fast`, `npm run qa:local`, `npm run qa:full`, `npm run typecheck`, `npm run build`) instead of composing raw `node`, shell pipelines, or compound deploy commands.
- ReadyIDC AWH repository QA/build must use the bounded AWH toolchain at /opt/awh-toolchain/node/bin when present. Do not use the EOL /usr/bin/node runtime to satisfy a repository contract that requires Node >=20; keep the AWH toolchain isolated rather than replacing the system Node globally.
- A platform safety/security gate is terminal for that attempted action: never bypass, disguise, or blind-retry it. Decompose the work into supported typed actions, connected tools, or the reviewed deployment authority.
- Long-running work must use start + poll/checkpoint semantics rather than one synchronous tool request.
- Production mutation keeps its existing explicit approval, backup, exact-revision, live-canonical-source, and rollback requirements.
- One bounded Deploy Mission consumes exactly one Owner approval for its proven exact revision; QA, rehearsal, verified desktop-artifact reuse, backup, guarded activation, live verification and cleanup continue automatically inside that approved scope. Ask again only if the exact revision or approved risk scope changes.
- Verification depth is risk-based, not ritual-based: LOW→FAST, MEDIUM→STANDARD, HIGH/CRITICAL→DEEP. Keep the outer workflow one mission; deeper checks remain internal and are selected by the shared verification policy.
- DEEP verification must detect unstable/flaky evidence. A mixed PASS/FAIL repeat is `UNSTABLE`, never silently retried into PASS.
- Confirmed execution/deploy failures must emit a deterministic incident fingerprint and regression-case identity; future fixes should turn that identity into a durable regression guard instead of rediscovering the same failure.
