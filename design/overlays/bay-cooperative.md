# BAY Cooperative Experience Overlay

Authority: `design/DESIGN.md` and `design/UX-ACCEPTANCE.md`.

## Product intent
Fast, low-error, phone-first cooperative POS. Immediate feedback and transaction confidence outrank decoration.

## Required contracts
- READY → STUDENT_SELECTED → ADDING_AMOUNT → COMMITTING → SUCCESS must be visually unambiguous.
- Barcode/member and amount actions must acknowledge input immediately.
- Offline queue, retry and duplicate-prevention state must be visible without exposing implementation jargon.
- Primary controls must meet touch-target rules and remain reachable with the software keyboard open.
- Daily close/totals must distinguish counted cash, recorded sales and change clearly.
- Lost/revoked card states must not look equivalent to an active card.
- Long Thai student names must not break transaction controls.
