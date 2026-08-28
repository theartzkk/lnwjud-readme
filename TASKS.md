# Authoritative task supersession — 2026-08-29

## NOW

- Close Promotion Evidence Gate V1 on top of Supervisor + Candidate QA: new native promotion approvals must bind and re-verify the exact candidate QA artifact before Vault promotion, while legacy approval scopes remain compatible.
- Keep M16 activation separate and approval-gated. Production remains M15/v15 until an exact reviewed SHA passes release gates and receives required approval.
- Required closure evidence: focused evidence/tamper fixture, Hub integration suite, full product regression, `git diff --check`, clean exact commit/push, then CI where available.
- Production, billing, credentials, permissions, Google Cloud legacy and BAY production remain untouched in this source milestone.

## NEXT

- Continue VPS-first self-sufficient execution using the same canonical task/execution/approval/memory authorities; prioritize expanding safe server-native project capability without shell/process authority or a shadow orchestration system.
- Field activation/verification of M16 remains a distinct reviewed Production milestone.

# Tasks

## NOW

- Close the M12 field defect in one coherent source pass: Responses history schema, sanitized provider diagnostics, low-cost real Responses connection probe, no false-success, bounded same-task retry, truthful provider/budget states, usage/cost guards, human-readable UI errors, outbound-capable sandboxed native executor, and a v12→v12 source-refresh deploy path that never replays migration 011.
- Run focused PHP/M10/M11/M12 regression plus `qa:fast` and `qa:local`; distinguish a real regression from a stale fixture before changing product behavior.
- Reconcile durable project docs to the actual M12 production truth after source QA; current runtime evidence outranks older project-memory text.
- When QA is clean, verify local branch/HEAD, fetch and compare remote, commit/push one exact candidate, then use Art’s current explicit authorization to deploy only that resulting SHA to ReadyIDC with backup/rollback and field verification. Future production changes still require explicit approval.
- After approved deployment, field-test from iPhone with `จำได้ไหมว่าเราสร้าง AWH ขึ้นมาทำไม?`; success requires a real AI answer grounded in Founding/Project Memory and no deterministic provider-failure fallback.
- Keep Google Cloud legacy VPS and BAY production untouched. Do not replace the OpenAI key, buy additional API budget, or use Codex for this defect.

## NEXT

- M12 is deployed at DB v12; do not replay older migrations or rotate credentials merely for field testing.
- After the exact provider-fix candidate is approved and deployed, validate both a successful real AI turn and a controlled provider-failure path from the canonical Work stream.
- Field-test the final Mac package in a logged-in GUI session.
- Field-test physical Windows pairing, Credential Manager persistence and runtime.
- Fix only verified field defects; then release stable `1.0.0`.

## NON-BLOCKING LATER WORK

- Provider/VPS capacity upgrade based on observed load; preserve provider-independent control-plane contracts and migrate without changing project identity/task/memory semantics.
- Large asset layer when real workload requires it.
- Source revision synchronization/conflict UX when cross-device editing requires it.
- Signing/notarization for broader distribution if needed.
- Additional AI provider adapters behind the same owner protocol and AWH task boundary.

## DONE

- Added and deployed owner username/password auth over canonical M4 sessions:
  secure password hashing, rate limits, CSRF, remembered sessions,
  logout/revocation, password change, hashed one-time recovery codes, step-up
  and sanitized audit fixtures.

- M3D live read path field-verified.
- M3E.1 through M12 are live on ReadyIDC schema v12; Mac enrollment and owner bootstrap/auth state remain preserved.
- AWH generic zero-project product contract established.
- BAY EXCUSE X and Teacher Evaluation Video removed as AWH deployment dependencies; their portable identities remain reusable user-project metadata.
- M4 canonical tasks/workers/results/artifacts/approvals/session/PWA foundation implemented locally.
- Mac `1.0.0-rc.1` artifact and Windows native installer artifact produced/verified in their respective evidence scopes.
- M4/M5 remain part of the deployed lineage; production has advanced through M12 at schema v12 with the single work-first control authority preserved.
- Real ReadyIDC Nginx root cause was confirmed and the shared
  include-composition helper was hardened; later activation and the current
  owner-auth compatibility refresh are recorded in the production handoff.
- Durable owner working protocol authored, agent entry contract added, Project Context injection implemented, and Desktop worker → Codex instruction precedence guarded on PR #8.
