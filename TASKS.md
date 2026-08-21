# Tasks

## NOW

- Keep AWH `1.0.0-rc.1` feature-frozen. No new product features before field validation.
- Complete PR #8 (`awh/clean-foundation`) cross-platform QA for the durable Art ↔ AI Working Constitution and worker/Codex context enforcement.
- Reconcile PR #8 into the release line only after QA passes and the exact final SHA is known.
- Before any M4 production retry, perform one whole-path production-readiness review against the real ReadyIDC topology: backup → migration → project-zero state → control/web pointers → Nginx composition → PHP-FPM/socket/env → reload → M3D/M3E/M4 routes → PWA/session behavior → rollback.

## NEXT

- If the final exact SHA passes the whole-path review, request one bounded ReadyIDC M4 retry approval.
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

- M3D live read path field-verified.
- M3E.1/M3E.2 live on ReadyIDC schema v3; Mac enrolled; owner bootstrap closed.
- AWH generic zero-project product contract established.
- BAY EXCUSE X and Teacher Evaluation Video removed as AWH deployment dependencies; their portable identities remain reusable user-project metadata.
- M4 canonical tasks/workers/results/artifacts/approvals/session/PWA foundation implemented locally.
- Mac `1.0.0-rc.1` artifact and Windows native installer artifact produced/verified in their respective evidence scopes.
- First M4 production activation attempt failed safely and rollback restored the verified M3D/M3E baseline.
- Real ReadyIDC Nginx root cause confirmed and shared include-composition helper hardened in release `88834b5ad34ed35e7aa1f54c473307482e37feee`; production retry not yet performed.
- Durable owner working protocol authored, agent entry contract added, Project Context injection implemented, and Desktop worker → Codex instruction precedence guarded on PR #8.
