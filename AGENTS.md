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

### Remote Mission Efficiency — mandatory

- **Default work block: ~30 minutes of real productive execution, with no quota-based cap.** Any continuation instruction from Art for an active Remote/device task means one continuous Remote Mission of approximately 30 minutes, not a sequence of 2–5 minute micro-sessions. Do not end after a 1–2 minute sub-step if safe work remains. Complete earlier only when the bounded task is actually done, a real blocker/approval boundary appears, or the platform forcibly interrupts the turn.
- During that block, **do not return a final/progress response merely to narrate intermediate state**. Keep working in the same turn until completion, a real hard blocker, a required owner approval, or forced platform interruption.
- **This no-interruption rule applies globally to every Remote Desktop/Desktop Commander mission, regardless of project or task type.** Once Remote is invoked, never stop merely to report progress or require Art to send ต่อ/continue; maximize continuous productive work per invocation. Remote quota is not a reason to shorten, avoid, or downgrade a valid Remote mission.
- **Use Remote Desktop fully when the job is device-bound.** Remote is first-class for GUI/native-app/device-local work; Remote may be used fully whenever capability-fit. Prefer fewer, longer, better-prepared missions because that is operationally smoother, not because Remote usage is restricted. Keep VPS-native/headless work on the VPS so Remote is spent only where it adds real capability.
- Poll long-running processes at meaningful checkpoints, normally every **2–5 minutes**. Reuse the existing PID/session/checkpoint after reconnect; never restart or duplicate a render/build/export just because a response stream was interrupted.
- Batch related mutations and QA, keep evidence compact, and avoid repeated full screenshots, full process listings, or large logs unless they materially change the diagnosis.

- Remote Desktop / Desktop Commander remains available whenever Art explicitly requests it or when real device/UI evidence materially advances the task. Never require all headless routes to fail first.
- Treat every invocation as one bounded Remote Mission, not one micro-command: prepare from current Source of Truth and known state, define objective + adjacent checks + safety bounds + success criteria, batch related safe actions, reuse the active session, verify real output, record the observed delta, and cleanly exit.
- Remote quota/call count is telemetry only, not an execution constraint. Use Remote fully when capability-fit. Batching and reduced redundant polling are execution-discipline rules, not quota-saving reasons, and must never shorten or downgrade a productive mission.
- Never blind-retry Remote Desktop. Distinguish quota, auth, permission, timeout, offline-device and platform-safety blockers before the next call.
- Remote-preferred triggers override the generic route ordering only for endpoint/device-local work: when a task references a named managed Mac/Windows/student/teacher device, requires GUI/application state, Adobe/Office/native desktop work, installation or permission inspection on that endpoint, real browser/client state, physical-device behavior, or field QA, select Remote Desktop / Desktop Commander proactively when that device is online and the capability is available.
- A concrete Mac/Windows/student/teacher endpoint reference plus a request to inspect, fix, configure, verify or use that endpoint is sufficient Remote intent; Art does not need to repeat the words "use Remote Desktop". A server/VPS/infrastructure-host reference is not Remote intent by itself. For `bay-core-01`, ReadyIDC, or another infrastructure host, prefer AWH server-native/VPS typed execution, direct API/connector, or the guarded server operator path; use Remote Desktop there only for explicit break-glass inspection or genuinely GUI-bound evidence.
- School-site creative exception: VTR, graphics, Photoshop, After Effects, Premiere, motion/video and other creative-media production prefer the MacBook Pro M5 even when AY-TEACHER could technically perform the task. AY-TEACHER remains the school-site default for ordinary endpoint/classroom/field work.
- For mixed server + device incidents, inspect authoritative server-side evidence directly when useful, then open one prepared Remote Mission for the device-local half. Backend health must never substitute for real device proof.
- School-site endpoint preference: when current context explicitly establishes that Art is at school and the task needs endpoint/GUI/classroom/field evidence, prefer `AY-TEACHER` as the first managed endpoint when it is online and capable. Do not infer physical location merely from school-related task wording. Fall back to another endpoint only when AY-TEACHER is unavailable or lacks the required capability; server/VPS work remains server-native, and M5-only creative capability remains on M5.
- Device workers remain capability-bounded and must never become unrestricted remote shells.

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
