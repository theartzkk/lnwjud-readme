# Tasks

## NOW

- Review the exact M6/M7 Native Assistant + Workspace Continuity release, then use one bounded ReadyIDC approval to migrate schema v5→v7 and switch the release. It must not seed projects, alter owner credentials, replay M3E/M4/M5 or mutate Google Cloud/BAY production.
- After M6/M7 activation, field-test one iPhone → canonical Work message → Mac worker claim → natural result/artifact flow, then verify the same stream after a Desktop restart and a Mac↔Windows WIP handoff. Do not call iPhone/Mac/Windows field PASS until performed.

- After successful sign-in, set a memorable owner username/password in Control
  Panel and retain a revocable remembered-device session; Keychain is not a
  normal-user dependency after the initial activation credential.
- Field-test ordinary iPhone Safari/PWA after M6 activation: sign in → select
  the existing project → send a normal message/read-only request → see a
  truthful Work stream. Validate normal viewport and full-page capture share
  the graphite canvas; do not revive the legacy preview dashboard.
- Keep Basic Auth as technical perimeter scaffolding only; it is not a normal
  user login path and its rotation primitive is not current product work.

- Keep AWH `1.0.0-rc.1` feature-frozen. No new product features before field validation.
- Complete PR #8 (`awh/clean-foundation`) cross-platform QA for the durable Art ↔ AI Working Constitution and worker/Codex context enforcement.
- Reconcile PR #8 into the release line only after QA passes and the exact final SHA is known.

## NEXT

- Owner Auth/M5 compatibility refresh is deployed; do not replay migration or
  rotate credentials merely for field testing.
- Field-test iPhone Safari/PWA first: sign in, select project, submit Goal,
  then validate truthful queue/worker/result/approval state.
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
- M3E.1/M3E.2 are live and compatible through ReadyIDC schema v5; Mac enrolled; owner bootstrap closed.
- AWH generic zero-project product contract established.
- BAY EXCUSE X and Teacher Evaluation Video removed as AWH deployment dependencies; their portable identities remain reusable user-project metadata.
- M4 canonical tasks/workers/results/artifacts/approvals/session/PWA foundation implemented locally.
- Mac `1.0.0-rc.1` artifact and Windows native installer artifact produced/verified in their respective evidence scopes.
- M4/M5 are active on ReadyIDC schema v5; the 8c5ea compatibility refresh
  deployed the single work-first PWA and passed login/session/projects gates.
- Real ReadyIDC Nginx root cause was confirmed and the shared
  include-composition helper was hardened; later activation and the current
  owner-auth compatibility refresh are recorded in the production handoff.
- Durable owner working protocol authored, agent entry contract added, Project Context injection implemented, and Desktop worker → Codex instruction precedence guarded on PR #8.
