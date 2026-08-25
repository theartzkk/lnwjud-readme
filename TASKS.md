# Tasks

## BATCH 1 CLOSURE — 2026-08-25

- [x] Audit convergence worktree/source and preserve existing Chat/runtime authorities.
- [x] Add conventional Username/Email + Password auth, six product roles, backend feature/project authorization and temporary-password first-login.
- [x] Add managed Users, role-aware Hub shell, Global Command foundation, Inbox/Tasks, Tool/Files surfaces and Owner-only read/diagnostic Database Center.
- [x] Keep Tool Center on one runtime authority and generate synchronized AWH-branded 214-tool web catalog.
- [x] Mac Hub regression PASS 17 / SKIP 1; M13 PASS; CONTROL web build/release manifest PASS.
- [x] Record exact Windows-tested candidate `4eb3e57ddaffc6df7fba7ecbd5dc2bd86abc0472` / tree `3e3fb51c2507e8170327b4ad9469b59604de214c`.
- [x] Native Windows candidate QA: packaging 6/6, release 6/6, 214-tool catalog, monorepo typecheck, private Node/stdio launcher, tunnel/DPAPI/persistence/concurrency/IPC evidence PASS.
- [x] Produce `AWH-Setup-4.9.1.exe` on Windows through the safe rcedit + prepackaged NSIS path without enabling Developer Mode; verify AWH app metadata/version and app SHA-256.
- [x] Automate that safe fallback in `scripts/package-windows.ps1` with pinned archive/rcedit integrity checks; Mac packaging/release/lint/diff contracts PASS.
- [x] Fix installer shortcut/uninstall safety: branded Start Menu shortcut now resolves to the real AWH app executable; custom uninstall no longer deletes legacy `lnwjud` compatibility data. Mac packaging contract PASS.
- [x] Make fallback select canonical AWH main executable despite bundled `lnwjud-node.exe`; add guarded `verify:windows-package` artifact/VersionInfo/hash/launch smoke and optional install→launch→uninstall verification.
- [ ] Next Windows-online gate: run root `package:windows` once from the new exact source SHA, capture installer SHA-256, verify VersionInfo/icon, perform install-launch-uninstall smoke, then mark Batch 1 fully closed.
- [ ] Publish development branch only after remote transport is healthy. No merge/deploy is implied.
- [ ] Production deployment remains explicitly out of scope until exact-SHA closure and separate approval.

## CONVERGENCE NOW — 2026-08-24

- Commit and push `awh/lnwjud4-port` as the first convergence candidate based exactly on lnwjud `v4.9.1` commit `166f004`.
- Do not deploy this candidate to ReadyIDC yet. Production remains the current verified AWH Hub v12 authority until a later exact-SHA approval and field plan.
- Next field gate is native Windows: install/package AWH, verify DPAPI/PowerShell/tunnel ownership, MCP stdio/HTTP, 214-tool catalog, Context Economy/session handoff, project workspace behavior and AWH data-path isolation on the real Windows school device.
- After Windows runtime parity is proven, integrate the AWH Hub worker/control-plane adapter against the existing v12 authority without creating a second task/project/memory store.
- Keep Codex delegation opt-in/off by default for quota economy; prefer local lnwjud capabilities and bounded verification first.


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
