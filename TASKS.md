# Authoritative task supersession — 2026-08-29 P1-C Files surface checkpoint

## NOW

- P1-C is closed in source at candidate commit `33d1946`. Home artifact cards, pulse and file CTA open the canonical Files library; no duplicate artifact authority was introduced.
- Files are searchable by bounded name/type query and show real project/task provenance, metadata and validated downloads. Empty and no-match states are explicit; Tools remain the existing deterministic local surface.

## VERIFIED

- Focused Home + Tasks + Files regression `6/6 PASS`.
- Full product suite `318 tests = 317 PASS / 0 FAIL / 1 platform SKIP`; typecheck/build and `git diff --check` PASS.
- Browser/iPhone UAT, Desktop enrollment, Auto-Chain field proof, push/CI/review and Production deployment remain open gates. Primary checkout remains untouched.

## NEXT

- Preserve `DEVICE_NOT_ENROLLED` and push safety blockers. Continue bounded Owner Control Tower/mobile work only in the isolated candidate; do not deploy or bypass release approval.

# Authoritative task supersession — 2026-08-29 P1-B Tasks and Executions checkpoint

## NOW

- P1-B is closed in source at candidate commit `e9055e8` on `codex/finish-first-p0`. Home recent work, active work, attention and Owner Tasks actions converge on the new canonical Tasks/Executions surface.
- The surface is a presentation projection over existing control data only. It shows task filters, truthful phase/journey, result summary, continuation metadata, approval handoff and validated artifact download links without adding an authority or exposing raw secrets/paths.
- The Home task-list runtime reference error from undefined `STATUS_LABELS`/`executionPlace` is permanently removed; status/actor now come from `executionStatus()`.

## VERIFIED

- Focused P1 Home + Tasks regression `4/4 PASS`.
- Full product suite `316 tests = 315 PASS / 0 FAIL / 1 platform SKIP`; typecheck, build, CONTROL web preview and `qa:fast` PASS; diff check PASS.
- Browser/iPhone UAT, Desktop credential enrollment, Auto-Chain field proof, push/CI/review and Production deployment remain open gates. Primary checkout remains untouched.

## NEXT

- Keep P0 `DEVICE_NOT_ENROLLED` and push safety authorization explicit. Continue the next bounded P1 surface only on the candidate; do not bypass safety or promote this local commit to Production.

# Authoritative task supersession — 2026-08-29 P1-A Home command-center checkpoint

## NOW

- P1-A Home implementation is `e39bd0ed9e95f161bf5b7aab46e38899b821f9e7` on `codex/finish-first-p0`; subsequent docs-only checkpoints keep the candidate unpushed and extend the canonical dashboard without a new authority.
- Home’s real-data pulse shows project, active work, artifact and attention counts. Owner-only device readiness uses the existing worker projection; ordinary roles do not receive runtime/provider controls.

## VERIFIED

- Focused Home regression `2/2 PASS`; full product `313 PASS / 0 FAIL / 1 platform SKIP`; TypeScript build and controlled web preview build PASS.
- Mobile/keyboard source invariants are covered, but browser/iPhone visual UAT remains required. No Production mutation occurred.

## NEXT

- Keep P0 field proof and push/PR gates explicit. Do not invent a Desktop credential or bypass the push safety rejection.
- After those gates are authorized and field-ready, resume Auto-Chain proof and then continue P1-B Work using the same canonical control data.

# Authoritative task supersession — 2026-08-29 Desktop enrollment P0 + Auto-Chain field-proof checkpoint

## NOW

- Candidate source is isolated on `codex/finish-first-p0` at `f1844b6447c039c5e4c4f4f0d2d94e32bfe0f0df`, based on freshly verified canonical `awh/api-independence` `2caf9242d589d6f1463b8d063045eb86e5084c40`.
- Review the shared enrollment persistence fix: a successful server response is not reported as enrolled until the exact device credential is read back from the desktop store. Keep the worker dependent on the same persisted credential after a fresh store instance/restart.
- Review the canonical execution projection and bounded operation proof: `control_task_executions.checkpoint_json` is the only lineage authority; field evidence must show VPS `project.read`, completed root, automatic continuation, and identical `rootTaskId`.

## VERIFIED

- Focused tests `21/21 PASS`; full product `311 PASS / 0 FAIL / 1 platform SKIP`; Hub suite, PHP contract, typecheck, build and `qa:fast` PASS.
- `qa:local`/`qa:full` source checks PASS, but overall command status remains FAIL because the unpushed branch cannot satisfy exact-upstream QA; full desktop smoke is blocked by Codex GUI sandbox (`GUI_SANDBOX_BLOCKED`).
- Real field operation is truthfully blocked at `DEVICE_NOT_ENROLLED` because the current desktop session store is empty. No token/password/secret was printed or created.
- Production was audited read-only only: active enrollment `m3e2-457696d`, Control/Web `m16-6e8217ab6cd5`, DB v16/integrity ok/FK 0, Nginx topology PASS, internal health PASS, protected public read routes 401. Candidate is not deployed.

## NEXT

- Obtain explicit destination authorization if the owner wants the candidate pushed to `theartzkk/lnwjud-readme`; safety rejection must not be bypassed. Then obtain CI/review and fresh exact-SHA production approval before guarded deployment.
- After deployment, sign in on the target Desktop, verify `enrolled=true` and `credentialStored=true` after a fresh app/store instance, then run `npm run ops:autochain:field-test` and record root/continuation IDs and VPS executor evidence without human Continue.

# Authoritative task supersession — 2026-08-29 Finish-First Owner Control Tower Production V1

## NOW

- Finish-First Product lane extends the existing Owner Infrastructure surface and `/api/v1/control/infrastructure`; no new task, execution, approval, memory, route, table, scheduler or telemetry authority is created.
- Owner Control Tower now projects Production Complete PASS/FAIL evidence, provider/model health and fallback evidence, current autonomous executions, recent task activity/incidents, and sanitized production/candidate/rollback release state from existing authorities.
- Mobile and end-to-end Smoke Test remain truthful FAIL until visible Production field verification. Deploy remains FAIL until Control/Web pointers match an M16 release.
- ReadyIDC Production remains DB schema 16 with Control/Web still on M15 while the external remote execution safety boundary blocks the bounded typed activation invocation. Do not bypass that boundary or downgrade healthy DB16.

## NEXT

- Close exact source QA/CI and merge this visible Control Tower milestone. Re-refresh canonical before any Production mutation, freeze the resulting exact release SHA, then complete M16 forward when the bounded remote activation path is available.

# Authoritative task supersession — 2026-08-29 canonical Auto-Chain closure

## NOW

- Source milestone is closed on canonical `awh/api-independence` @ `070f61386da1f4203b7a20b255ba5f9aeecfe393`; do not repeat qualification/provider-fabric/Auto-Chain implementation.
- Keep ReadyIDC Production at M15/v15 until a fresh exact-SHA approval is granted. The earlier approval is stale because canonical advanced before mutation.
- Treat remote safety-layer deployment blocking as a hard gate; never bypass it. Continue reversible source/QA work if that gate remains blocked.

## NEXT

- Re-audit canonical HEAD + Production immediately before any deployment attempt, generate exact M16 dry-run evidence from the final SHA, then request one explicit approval for that exact SHA. After approval, run the guarded M15→M16 activation with verified backup/rollback and field verification.

# Authoritative task supersession — 2026-08-29 Continuous Auto-Chain V1

## NOW

- Close Continuous Auto-Chain V1 source QA on the converged canonical line: explicit autonomy intent, bounded next-milestone planning, canonical follow-up materialization, approval/high-impact/repeat/max-step stop gates, and no parallel scheduler/task authority.
- Focused fixture, Hub integration suite, full product regression (306 = 305 PASS / 0 FAIL / 1 platform SKIP) and diff check are closed. Finish exact commit/push and CI. Keep Production unchanged until an exact reviewed SHA receives required approval.

## NEXT

- After source/CI closure, prepare a guarded ReadyIDC activation plan that first re-audits exact Production schema/pointers/backup/rollback and requires explicit Production approval.

# Authoritative task supersession — 2026-08-29

## NOW

- Close Work Inspection Evidence Surface V1 on top of the existing durable `project-inspection` artifact authority: let Owner expand the evidence inside Work and see exact source revision plus bounded search/read provenance without a new API, evidence store or permission surface.
- Repair adjacent Work rendering regressions discovered during the pass rather than carrying them forward; cancelled-message dedupe must operate on canonical messages and render the filtered `visibleMessages` list.
- Keep M16 activation separate and approval-gated. Production remains M15/v15 until an exact reviewed SHA passes release gates and receives required approval.
- Required closure evidence: same-origin artifact retrieval guard, read-only evidence validation, visible-message regression guard, focused Web tests, `git diff --check`, clean exact commit/push, then stacked CI on top of the Linux-fixture fix.
- Production, billing, credentials, permissions, Google Cloud legacy and BAY production remain untouched in this source milestone.

## NEXT

- Continue VPS-first self-sufficient execution using the same canonical task/execution/approval/memory authorities. After read-only root-cause inspection is closed, the next safe expansion should improve evidence packaging or bounded multi-file diagnosis without granting new execution authority.
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
