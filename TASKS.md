# Tasks

## NOW

- Release the owner-access browser-runtime compatibility candidate only after
  the exact SHA is reviewed: it must fix Safari same-origin safe GET handling,
  build a generic CONTROL PWA from the locked source, and use the v5
  no-migration compatibility-refresh path. The post-release gate is a real
  browser-shaped login → session → projects flow, not a backend status check.
- After successful sign-in, set a memorable owner username/password in Control
  Panel and retain a revocable remembered-device session; Keychain is not a
  normal-user dependency after the initial activation credential.

- Close the current owner-auth deployment candidate using the shared incident rule: prove the effective HTTPS route, application response, web `www-data` access, login/session and rollback as separate gates. Do not retry the rolled-back `055484d7ac9a4b9e5676ab5312518f8c722fd705`; require a new exact SHA and one bounded approval.

- Review the owner-auth v4→v5 deployment/rollback package and request one bounded production approval only after parity checks pass.
- Keep Basic Auth as temporary technical perimeter scaffolding; do not retry its rotation primitive in this auth pass.

- Keep AWH `1.0.0-rc.1` feature-frozen. No new product features before field validation.
- Complete PR #8 (`awh/clean-foundation`) cross-platform QA for the durable Art ↔ AI Working Constitution and worker/Codex context enforcement.
- Reconcile PR #8 into the release line only after QA passes and the exact final SHA is known.
- Before any M4 production retry, perform one whole-path production-readiness review against the real ReadyIDC topology: backup → migration → project-zero state → control/web pointers → Nginx composition → PHP-FPM/socket/env → reload → M3D/M3E/M4 routes → PWA/session behavior → rollback.

## NEXT

- The next Owner Auth retry requires the final exact SHA with production-parity proof for dynamic AWH PHP-FPM authority, FastCGI origin propagation, effective Nginx inspection, PHP-FPM reload after control-pointer movement (and after rollback restore), and bounded post-reload route convergence. Do not retry from a single immediate request after reload.
- After successful activation, field-test iPhone Safari/PWA first: trust device, empty-project state, Add Project/onboard, submit Goal, truthful queue/worker/result/approval state.
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

- Added owner username/password auth over canonical M4 sessions: secure password hashing, rate limits, CSRF, remember sessions, logout/revocation, password change, hashed one-time recovery codes, step-up and sanitized audit fixtures.

- M3D live read path field-verified.
- M3E.1/M3E.2 live on ReadyIDC schema v3; Mac enrolled; owner bootstrap closed.
- AWH generic zero-project product contract established.
- BAY EXCUSE X and Teacher Evaluation Video removed as AWH deployment dependencies; their portable identities remain reusable user-project metadata.
- M4 canonical tasks/workers/results/artifacts/approvals/session/PWA foundation implemented locally.
- Mac `1.0.0-rc.1` artifact and Windows native installer artifact produced/verified in their respective evidence scopes.
- First M4 production activation attempt failed safely and rollback restored the verified M3D/M3E baseline.
- Real ReadyIDC Nginx root cause was confirmed and the shared include-composition helper was hardened in release `88834b5ad34ed35e7aa1f54c473307482e37feee`; subsequent M4 activation is recorded in the current production handoff, while owner-auth v5 remains source-only.
- Durable owner working protocol authored, agent entry contract added, Project Context injection implemented, and Desktop worker → Codex instruction precedence guarded on PR #8.
