# AWH Sustainability Contract

AWH is an evergreen product. Production should become useful early, then improve without breaking identity, data, or installed Desktop clients.

## Permanent invariants

- ReadyIDC is the 24/7 Cloud Control Plane; personal devices are optional workers.
- Canonical user/project/task/memory/artifact identity lives in the Hub authority, never in a local path.
- SQLite schema changes are versioned migrations. Production schema is never hand-edited as a normal workflow.
- Git/Vault remains source authority for project content; Hub stores portable identity, continuity, execution and audit state.
- Secrets never live in Git, web storage, URLs, logs, release manifests, or exported user data.
- AWH Cloud must remain usable while Desktop/Windows/Mac workers are offline.
- Everything may be replaced except durable identity and data continuity.
- Every Production product is a managed product before first release: it must have one Project Registry identity, one canonical Source Authority, one typed capability, one bounded service-mediated privileged executor, and one Update Center entry. Production release is fail-closed when any of these bindings is missing.
- Remote/AI workers never receive standing root credentials. Privileged deployment is performed only by allowlisted AWH services with immutable checkpoints, exact checksums, verified backups, staging-first verification, bounded writable paths, and automatic rollback. Owner approval never falls back to VPS console or ad-hoc sudo as a normal workflow.
- `NoNewPrivileges` on remote workers is a permanent safety boundary, not an operational blocker. Any recurring action that legitimately needs elevated filesystem or service access must be promoted into a typed AWH operator capability instead of weakening the worker sandbox.
- One canonical execution-envelope authority owns each conflicting mutation resource. Reads and isolated candidate/workspace lanes may be parallel. Product/AWH release tracks are independent when their resources do not conflict; only VPS Platform deployment is host-global because it can mutate shared runtime/infrastructure.
- A second chat/worker resumes, joins or waits for an existing conflicting authority. It never creates a parallel lock/queue to work around ownership, and a chat never becomes writer authority merely by declaring itself one.
- Release tracks are explicit and independent: VPS Platform, AWH, AWH Agent and each BAY product keep their own version, history, rollback and approval scope even when the Update Center presents them on one page.
- `AGENTS.md` is the single agent entry point. Dated state/handoff/history is evidence only; no `RULES.md` or other prose file may become a parallel constitution.
- Terminal release workspaces must be reclaimed on success and failure, and Production release must fail before dependency hydration when storage headroom is below the bounded safety threshold.
- Repeated blockers are engineering defects, not normal workflow. Closure requires root-cause evidence plus permanent prevention, regression coverage, recovery behavior and an observable signal; a temporary unblock never closes the defect by itself.
- Owner Assist Fast Lane is mandatory when the same failure path has been attempted twice or a short Owner action is materially faster than continued automated retry. The assistant surfaces the blocker and exact next action immediately instead of waiting silently.
- Unique unpromoted source never lives only in `/tmp`. Durable candidates use `/var/lib/awh-remote/worktrees`; temporary QA/cache trees must be reproducible from canonical source.
- Storage guard targets at least 6 GiB free space and performs project-aware bounded cleanup before a release/mission reaches the hard storage block. Cleanup fails closed when project authority cannot be resolved and never reclaims dirty, open, active-project or non-canonical workspaces.

## Release contract

Stable releases require CI, Hub regression tests, packaged runtime verification, a verified backup, an explicit migration plan, and a rollback plan. Preview may ship earlier only to Owner-controlled devices.

Desktop is install-once/evergreen. Windows keeps one stable Squirrel package identity. macOS keeps one stable bundle identifier. Update channels are `stable` and `preview`; changing channel never creates a second AWH identity.

`https://kruart.online` is the durable canonical AWH public origin. The former `sslip.io` endpoint is legacy redirect/recovery infrastructure only and must never reappear as a default client, registry, UI, or release authority. If the VPS/IP changes, DNS and the canonical hostname move while installed clients continue using `kruart.online` without reinstalling.

## Backup and recovery contract

A production migration begins only after a verified SQLite snapshot exists. Snapshots are created with SQLite snapshot semantics, hashed with SHA-256, paired with a manifest, and verified with integrity and foreign-key checks. Restore drills always materialize into an isolated scratch path; they never replace the production database automatically.

AWH may automate backup creation and verification, but production cutover after restore remains an explicit staged operation with health verification and rollback evidence.

## Documentation and compatibility-debt lifecycle

- AGENTS.md is the sole agent entry point in each governed repository. Machine policy verifies repository identity, default branch, forbidden parallel authority files, and context-document roles.
- CURRENT_STATE.md, PROJECT.md, HANDOFF.md, TASKS.md and similar continuity files never carry live Production truth. They are indices/context only; live mutable facts must be resolved from canonical runtime/source evidence.
- Historical checkpoints remain preserved for audit but move under history/ or explicit historical pointers instead of accumulating in root files.
- A temporary runtime hotfix is allowed only as a bounded compatibility measure with a named canonical replacement. The next verified release must absorb it and remove the override with rollback restoration.
- Repository default HEAD is contract data, not an accidental side effect of the last branch touched.
