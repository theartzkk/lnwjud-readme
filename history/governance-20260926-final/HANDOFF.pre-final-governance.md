# AWH Handoff Contract

> **Current-state authority:** Read `CURRENT_STATE.md` first; fresh observed runtime/source evidence outranks this handoff.

Handoff is continuity context, not runtime authority.

Before continuing work:

1. Read `AGENTS.md`.
2. Inspect the current user request.
3. Inspect live project mission/mutation ownership.
4. Inspect canonical source, Production/public identity and relevant runtime evidence.
5. JOIN/WAIT if a conflicting writer already exists; do not create another mutation authority.
6. Resume the existing execution/checkpoint when one exists instead of blind retrying.

A handoff may record the last observed SHA, execution id, blocker and evidence, but every mutable fact must be revalidated before use.

Do not use a handoff to authorize Production, bypass an approval/security boundary, direct-write canonical source, replace Hub task/execution authority, or treat a device-local mission file as project authority.

Keep the root handoff short. Detailed dated closure records belong under `history/` or a clearly historical document.

The pre-standardization handoff history from 2026-09-24 is preserved at `history/governance-20260924/HANDOFF.pre-standardization.md`.
