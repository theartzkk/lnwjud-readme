# Authoritative task supersession — 2026-08-30 Auto-Chain continuation fallback

## NOW

- Live ReadyIDC was re-reconciled after external pointer changes: Control/Web currently resolve to `m16-f47a7eb3691b`, source marker `f47a7eb3691b67de513c1e12fbc880397608f503`; current canonical source is `07b7871e489753c0b9c10094c98258b1e4f56dce`. Nginx, PHP-FPM, executor/backup timers, schema 16, integrity and foreign-key checks are healthy. This run did not perform those activations.
- The real field proof against that live source still timed out after the root task completed. Source audit found the root cause in `planContinuation()`: the provider-failure fallback returned an array from a `?string` planner, so the continuation materializer was skipped by the throwable boundary.
- The candidate branch fixes the shared fallback to return one bounded scalar `NEXT:` goal and covers `PROVIDER_FAILED`, `PROVIDER_UNAVAILABLE` and `PROVIDER_RATE_LIMITED` without weakening high-impact/provider-auth blocking.

## VERIFIED

- Before reconciling with the newly advanced canonical source, the candidate's `qa:fast`/serial `qa:full` and exact-head CI were green 5/5. The merge with current canonical now requires a fresh QA/CI run before release approval.
- No credential value was read, printed, copied or injected; no Production DB was directly mutated; no BAY cutover or unrelated Production change was performed.

## NEXT UNFINISHED CHECKPOINT

- Finish this durable checkpoint, re-run exact-head CI, then request one exact-SHA approval before deploying the candidate through typed M16. After approval, rerun the real Desktop/worker/Auto-Chain lineage proof and continue the remaining UAT/15-of-15 gates.

# Authoritative task supersession — 2026-08-30 Overnight VPS autonomy foundation

## Finish-first run status

- [x] Add truthful bounded Storage/Garbage inventory fields and disk measurement.
- [x] Add Governor, self-healing and housekeeping projections without a second queue.
- [x] Add durable idempotent Morning Brief persistence through existing audited revisions.
- [x] Expose derived generic Managed Site topology in the Owner Control Panel without inventing domain/runtime/database authority.
- [ ] Close real School Document AI and Project Factory vertical slices.
- [ ] Obtain rendered Web/Desktop/iPhone evidence and exact-head CI/restore proof.
- [ ] Enable quarantine/purge only after explicit policy and reference-proof implementation.

## NOW — post-deploy Auto-Chain boundary

- Typed M16 deployed exact SHA `13acbb573c406d17ef56e538db4327e6caf43134` successfully; DB16 integrity/FK, backup/restore readiness, Nginx/PHP-FPM, executor recovery and route health remain PASS.
- The real Auto-Chain proof stopped at bounded `AUTOCHAIN_FIELD_TIMEOUT` after two provider attempts. The canonical task/execution history remains intact; no credential was injected and no task was deleted.
- Read-only VPS audit found 8 malformed-UTF-8 Vault file contents. The canonical line now contains the provider-facing in-memory UTF-8 repair plus the latest Staff/Storage/Morning Brief/release-lock hardening. The previously approved `acabea5` candidate is stale because PR #58 is conflicting and must not be deployed.

## NEXT UNFINISHED CHECKPOINT

- Finish canonical sync, verify the resulting exact candidate/CI/M16 readiness, then obtain fresh exact-SHA approval. After activation, rerun Auto-Chain, prove rootTaskId continuation, and continue UAT/Production completion without claiming field PASS from source evidence.

## NOW

- Candidate `codex/finish-first-p0` contains source merge `190e1426e09a5e85910eadcc10a2b7e20b035dbf` and is pushed; the checkpoint docs follow in the current release-gate commit. It contains the bounded Staff loop, ten role projections, storage classification audit, backup/recovery/DB-locking reporting and executor full-telemetry correction. Existing Project/Task/Execution/Artifact/Approval/Release authorities remain the only authorities.
- Production remains exact SHA `06a7277063f891d0d29ad5bdbed7db7541dbb807` / release `m16-06a7277063f8`; no deploy is performed until exact-head CI/review and a fresh exact-SHA approval.

## VERIFIED

- `qa:local` PASS and `qa:full` PASS on the exact pushed candidate; targeted PHP/Node/staff/sustainability/infrastructure checks PASS.
- Read-only live baseline: DB schema 16, integrity/FK PASS, Nginx/PHP-FPM and executor/backup timers active, latest backup verified with bounded restore drill PASS, no active leases, two capability-waiting executions, and no AWH-managed temporary debris eligible for purge. Broad `/tmp` remains outside managed purge scope.

## NEXT UNFINISHED CHECKPOINT

- Verify PR #58 exact-head CI/review, M16 dry-run, production preflight and final storage/backup evidence. Request one exact-SHA approval, then deploy only that exact candidate and rerun Desktop persistence, worker reuse, Auto-Chain lineage, UAT, smoke and 15/15 gates.

# Authoritative task supersession — 2026-08-30 Auto-Chain Project Vault tool-result boundary
# Authoritative supersession — 2026-08-30 Product completion candidate

## NOW

- Candidate `533185e` aligns Web and Desktop around `web/awh-design-system.css`, shared navigation language, Home command entry and canonical Tasks/Executions. The existing Control/Infrastructure/Database/Trust authorities remain the only backend sources.
- Owner Activity now carries task goal, project, phase/state, message/result and blocker metadata. Infrastructure also shows a clearly marked `SNAPSHOT_ONLY` Morning Brief; it is not presented as persisted or as an autonomous scheduler result.

## VERIFIED

- Full Node: `321 tests`, `320 PASS`, `0 FAIL`, `1 platform SKIP`.
- Hub supported fixtures, typecheck, build, CONTROL web build, focused parity/infrastructure/desktop tests, Desktop smoke and diff check: PASS.
- Production read-only: pointer `m16-06a7277063f8`, schema 16, integrity `ok`, FK `0`, Nginx/PHP-FPM/executor/backup active; no mutation.

## OPEN

- Web/Desktop rendered screenshot comparison, iPhone manual UAT, live AI/provider proof, exact-SHA deploy approval, school Document AI, generic managed-site hosting operations, persisted Morning Brief and storage cleanup/recovery proof remain open. Keep these as FAIL/REQUIRED rather than inventing PASS evidence.

# Authoritative supersession — 2026-08-30 Source/Production reconciliation

- Current Production truth is typed M16 release `m16-06a7277063f8`, exact SHA `06a7277063f891d0d29ad5bdbed7db7541dbb807`, with schema 16 and post-cutover health/readiness verified. The bounded field proof still reports `AUTOCHAIN_FIELD_TIMEOUT`; latest read-only task metadata is `WAITING_FOR_WORKER`/`PROVIDER_FAILED` after canonical `project.read` routing.
- The current root-cause repair is committed in `72d06691d96b1139a001021c5cf88e6afdda7378` and is included in the current candidate branch tip. It is bounded provider-facing data normalization, not another routing alias: keep internal Vault reads at 256 KiB, cap provider-facing reads at 24 KiB with valid UTF-8 truncation, and apply the same cap to inspection, continuation and assisted-edit tool callbacks.
- Regression is added for large escaped UTF-8 text and asserts the serialized tool result stays below 64 KiB. Focused fixtures, typecheck, serial full Node tests and build passed; the known aggregate exceptions are dirty-tree status before commit and the unrelated pre-existing M11 fixture assertion.
- The repair is committed and pushed in PR #58, with the source candidate's CI 5/5 PASS, M16 dry-run PASS and Production preflight PASS. This docs-only checkpoint requires exact-head CI before approval. No credential value was read/printed, no direct Production DB mutation occurred, and the deployed `06a7277…` release must remain the rollback baseline.

## Next unfinished checkpoint

Request one new exact-SHA Production approval for the exact PR #58 head after its docs-only checkpoint CI completes. PR #57 is already merged at the prior deployed SHA; PR #58 is the current review state. After approval, deploy only that SHA and rerun enrollment/restart, worker reuse, Auto-Chain lineage and the remaining UAT/15-of-15 gates.
# Canonical `awh/api-independence` is now `e0fa5cc…`, which includes the environment-aware M11 test guard. The candidate must include this current canonical line before CI/release readiness is treated as final; Production remains on `m16-06a7277063f8`.

# Authoritative supersession — 2026-08-29 Auto-Chain provider request contract

## NOW

- Exact Production SHA `903d128f9b6160e011936b681a69656789b45a09` is active after the typed M16 refresh. The governance alias fix is field-proven to select canonical `project.read` through the bounded OpenAI `agent.conversation` provider interface.
- The remaining field blocker is `PROVIDER_REQUEST_INVALID`: OpenAI Responses rejects the unsupported `max_tool_calls` request field. Source commit `02bb176` removes it from initial and follow-up tool-loop payloads while preserving the existing local six-call bound.
- M16 and Continuous Auto-Chain fixtures, full Node product tests, typecheck, `qa:fast` and diff check pass. `hub:test` retains only the pre-existing M11 fixture failure, reproduced on baseline and unrelated to this change.

## NEXT

- Finish the checkpoint docs, push the exact candidate, verify PR/CI and all release-readiness evidence, then request one fresh exact-SHA Production approval. Until then keep Production at `903d128…`; after approval rerun the real field proof and continue UAT/15-of-15 without bypassing the typed authority.

# Authoritative supersession — 2026-08-29 Auto-Chain governance-routing contract

## NOW

- Source root cause is fixed in `832e909`: the shared M16 provider-eligibility query now maps only bounded tool-mediated project capabilities to the registered `agent.conversation` provider interface while preserving canonical `project.read`/`project.search`/`project.mutate.assisted` route identity and executor policy.
- Sibling regression is explicit: the three bounded tool paths route; `project.mutate.text` and `artifact.object` remain `AI_ROUTE_UNAVAILABLE`. M16 and Continuous Auto-Chain fixtures pass; Production remains at `ea3ac9f289867f6026c22a1b28ae0115e59df9ba` and has not been mutated.

## NEXT

- Push this exact candidate, verify current remote CI/review state, and obtain one fresh exact-SHA approval before typed M16 deployment. Then rerun the real Desktop/worker/Auto-Chain proof and continue remaining UAT and Production completion.

# Authoritative task supersession — 2026-08-29 finish-first continuation / backup authority

## NOW

- Candidate `codex/finish-first-p0` is pushed at `c427d9dd575dd53556ee6a7e184916e7a971cbc3`; PR [#57](https://github.com/theartzkk/lnwjud-readme/pull/57) is open against `awh/api-independence` and CI run `33248726861` is `5/5 PASS`.
- Foundation-now card is closed: Database Studio reuses `HubBackupService::latestMetadata()` as the one verified backup authority. No schema, route, storage or backup subsystem was added.

## VERIFIED

- Full product: `319 tests = 318 PASS / 0 FAIL / 1 platform SKIP`.
- Focused backup-authority regression: `1/1 PASS`; typecheck, build, CONTROL preview, `qa:fast` and `git diff --check` PASS.
- `npm run ops:autochain:field-test`: `BLOCKED DEVICE_NOT_ENROLLED`, fail-closed with no secret exposure. Browser UAT remains manual because local `file://` preview navigation was blocked by browser policy.

## NEXT

- Complete normal Desktop enrollment, rerun Auto-Chain lineage proof, and perform real browser/iPhone UAT. Keep PR open for review; Production deploy requires fresh exact-SHA approval and remains unperformed.

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
# Authoritative supersession — 2026-08-30 live reconciliation and provider-failure continuity

## CURRENT CHECKPOINT

- Live ReadyIDC was re-read, not inferred from historical notes. Control/Web currently point to typed M16 release `m16-12fb67a09d4b`, source marker `12fb67a09d4b87e942c8aa120e40e9c8d33d1f9f`; Nginx, PHP-FPM, executor timer and backup timer are active. DB is schema 16 with integrity/FK PASS and the latest verified backup is ready for a bounded restore drill.
- Desktop credential reuse is working through the existing OS credential store: the authenticated read-only `projects` probe returned HTTP 200 and four projects without printing the credential. The real Auto-Chain proof still timed out because the live `project.read` executor repeatedly reached `PROVIDER_FAILED` after bounded provider attempts; no task or credential was deleted/injected.
- Canonical `awh/api-independence` advanced to `bd6acaa664043d8fc26e26975f526482e9fc3159`, which adds the root-cause continuity fix: safe read-only inspection falls back to bounded deterministic Vault evidence for `PROVIDER_FAILED`, `PROVIDER_UNAVAILABLE` and rate-limit failures, while provider failure remains recorded truthfully. Morning Brief persistence now creates a new revision when material daily state changes.
- Candidate `codex/finish-first-p0` is a clean merge candidate at `66c86584f299433f791c0fceb8e24b4348b94aef` before this checkpoint-doc update; it contains the current canonical source and prior visible-product/VPS foundation work. Production has not been mutated in this continuation.

## VERIFIED

- Full Node regression: 321 tests, 320 PASS, 0 FAIL, 1 platform SKIP; typecheck PASS; Hub/M16/Continuous Work/Continuous Auto-Chain/Staff Operations/Project Vault fixtures PASS; `qa:fast` PASS after candidate push.
- Hosted CI for canonical `bd6acaa...`: 5/5 PASS. Hosted CI for candidate `66c8658...` was observed in progress before this docs checkpoint and must be rechecked after the final candidate hash is created.
- The typed M16 dry-run remains approval-gated and reports `M11_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL`. No direct Production DB mutation, credential exposure/injection, force-push or safety-gate bypass occurred.

## NEXT UNFINISHED CHECKPOINT

Complete this docs checkpoint, rerun exact-head CI and final read-only preflight/M16 dry-run. Then request one fresh exact-SHA Owner approval if Production activation is still required. After approval, use only typed M16, rerun enrollment/restart, worker reuse and Auto-Chain lineage, then continue real Web/Desktop/iPhone UAT, backup/restore evidence and the 15/15 acceptance gates. Keep all unsupported or unobserved gates FAIL/REQUIRED rather than inventing PASS.
