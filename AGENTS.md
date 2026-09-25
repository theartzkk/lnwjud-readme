# AWH Agent Entry Point

This is the single human-readable entry point for agents working on AWH/KRUART/BAY infrastructure.

## Authority model

There is no parallel `RULES.md` authority. Use these layers for their specific purpose:

1. **Current request** defines the intended outcome. Historical plans never override it.
2. **Live evidence** defines mutable facts: canonical Git refs, Production refs, public release identity, DB state, services, device state and current leases.
3. **Normative integrity contracts** define boundaries that must not be bypassed: `docs/AWH-AUTHORITY-MAP.md`, security/release contracts and the machine-enforced execution authority.
4. **Machine-readable execution contract** is `config/execution-policy.json`; runtime code/tests must enforce the same invariants.
5. **Working context** in `ART_AI_WORKING_PROTOCOL.md` is non-binding working context: advisory and non-prescriptive.
6. **`CURRENT_STATE.md`** is the first committed state index; read it before `PROJECT.md`, while remembering it is never live authority.
7. **`PROJECT.md`**, `HANDOFF.md`, history and dated closure documents are continuity/audit context only.

When facts disagree, inspect the live authority. When prose disagrees with enforced integrity contracts, fix the prose or implementation rather than inventing another rule layer.

Use professional judgment and the capabilities actually available now; stale tool, device, workflow or routing preferences are context, not authority.

## Mutation ownership

Read-only work may run concurrently. Mutations must use the canonical Task/Execution/Envelope authorities and **one active writer per mutation scope**, where the scope is the conflicting mutation resource.
A second chat or worker must **JOIN/WAIT** on an active conflicting authority; it must not create a competing writer.

Project-local candidate/workspace work may remain parallel when isolated. The shared VPS Production deploy lane is global across projects. Canonical source promotion and Production deploy for the same project are interlocked.

Local remote-mission files are device/transport leases only. They never outrank Hub project/source/release authority.

## Release and privilege

Canonical source changes use the typed source-promotion authority. Do not direct-write the bare canonical repository.

Production uses one exact-revision approval for the bounded release scope. QA PASS alone is not Production success. Closure requires exact revision identity through source, artifact, Production/public state and post-deploy verification.

On VPS-native work, use the local typed operator. Do not self-SSH back into the same VPS when the local authority exists. Restricted workers keep `NoNewPrivileges`; recurring privileged actions belong in bounded typed operators.

## Completion

Resume proven durable state after a chat/tool interruption instead of blind retrying or spawning a duplicate mission. Clean transient workspaces and release leases on terminal paths.

Verify the deliverable that matters: runtime/public state for deployments, data integrity for migrations, real rendered/field output for UI/creative work.

Supporting documents may add domain detail, but they cannot create another identity, task queue, mutation lock, source authority, approval authority or Production truth.

For visual/UI work, use `design/DESIGN.md` and the canonical asset registry `config/kruart-visual-assets.json` as domain-specific design governance. They constrain design consistency only and never override live runtime, source, mission, approval or Production authority.
