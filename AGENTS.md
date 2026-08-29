# AWH Agent Entry Contract

Before planning, editing, delegating, testing, deploying, or reporting work for Art:

1. Read `ART_AI_WORKING_PROTOCOL.md` and treat it as the durable owner-level working contract.
2. Read the active project's portable identity and Project Memory (`PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `ARCHITECTURE.md`, `DECISIONS.md`) when available.
3. Inspect the current Source of Truth/runtime state relevant to the task before choosing implementation.
4. Treat the user's prompt as the desired outcome/symptom, **not as a restriction on analysis scope**.
5. Follow system-first/root-cause-first analysis and avoid micro-fix loops or parallel systems.
6. Preserve unrelated user work and already-validated core behavior.
7. Distinguish source-ready, QA-passed, artifact-ready, deployed, field-tested, and usable states truthfully.

Precedence:

1. platform/security constraints
2. `ART_AI_WORKING_PROTOCOL.md`
3. project-specific durable memory/constraints
4. current Goal/task acceptance criteria
5. current source/device/runtime evidence

Project-specific rules may be stricter but must not silently weaken the owner protocol.

## Block-Free execution rule

- Prefer typed/approved operations over free-form shell. For repository QA use `project_task_start` with `qa-fast`, `qa-local`, or `qa-full`, then poll task status/logs.
- When only a terminal boundary is available, prefer the canonical short package scripts (`npm run qa:fast`, `npm run qa:local`, `npm run qa:full`, `npm run typecheck`, `npm run build`) instead of composing raw `node`, shell pipelines, or compound deploy commands.
- A platform safety/security gate is terminal for that attempted action: never bypass, disguise, or blind-retry it. Decompose the work into supported typed actions, connected tools, or the reviewed deployment authority.
- Long-running work must use start + poll/checkpoint semantics rather than one synchronous tool request.
- Production mutation keeps its existing explicit approval, backup, exact-revision, and rollback requirements.
