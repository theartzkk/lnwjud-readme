# External Capability Integrations

Status: bounded integrations under the existing AWH control plane.

These repositories are inputs to AWH capabilities/references. They do **not** become a second Project registry, Task/Execution queue, Memory authority, identity store, approval system, notification system or control plane. All mutations still materialize through the existing AWH Project → Conversation → Task → Execution → Approval → Artifact path.

| Source | Pinned revision | License | AWH role | Boundary |
|---|---|---|---|---|
| `Tencent/teamai-cli` | `c23fd70380a3ae528dce227f9afbeaff8ad7bdc6` | MIT | Optional local adapter `team.harness`; worker metadata `tool.teamai` only when installed | Reuse skills/rules/shared-knowledge patterns; no TeamAI project/task/memory authority |
| `Nutlope/hallmark` | `13ac0ec7e148655948100b6396439e481361d690` | MIT | Reference skill `design.hallmark` | Design audit/redesign/study reference; KRUART Golden UI remains authoritative |
| `mksglu/context-mode` | `ba5f5dfd1a0cd3e8a8f812c219d50390ed0a61c8` | Elastic-2.0 | Optional local adapter `context.optimize`; worker metadata `tool.context-mode` only when installed | Local/ephemeral optimization only; never hosted, never AWH Memory/Queue/Source Authority |
| `rohitg00/awesome-claude-design` | `7f60ee56b9340f8c2671a08c2d8aab4037546a64` | MIT | Reference corpus `design.reference` | DESIGN.md/recipe inspiration only; never replaces KRUART design authority |
| `miqdadbadjuber/anti-slop` | `a56a8a78229516238375111a799001a5f24953cf` | MIT | Approved lazy skill pack: `design.antislop`, `copy.antislop`, `code.antislop` | Vendored once under `skills/approved/anti-slop`; exact-file integrity verified; offline/disposable materialization only; KRUART remains design authority |
| `vercel-labs/skills` | `7407f3893ad4dceab546ac002c3ef806e4000c73` | MIT | Discovery reference `skill.discovery` | skills.sh/CLI ecosystem may help discover candidates, but discovery never auto-installs or grants execution |

## Runtime policy

- The canonical registry is `config/external-capabilities.json`; exact upstream revisions and license classifications are pinned there.
- AWH discovers `teamai` and `context-mode` as **tool inventory metadata**, not execution permission.
- Existing task capability, approval, worker-auth, cost, audit and rollback gates still decide execution.
- Hallmark and Awesome Claude Design are reference-only. AWH does not vendor or run their web applications.
- `context-mode` is not offered as a hosted or managed service. Its optional local cache is disposable and cannot become canonical memory.
- External integrations are disabled by default as independent authorities. Approved skill profiles may be auto-selected by the existing advisory router only because their exact payload is already reviewed, pinned and vendored; selection still grants no new execution/network authority.
- Removing or disabling any external integration leaves AWH canonical state intact.
- Refreshing an upstream revision requires review of the exact commit, license and boundary before the registry pin changes.

## Skill intake and trust pipeline

AWH uses **discover → inspect → pin → vendor → verify → lazy-load → clean**. It never uses **discover → install → execute**.

1. Discovery may come from skills.sh, GitHub or another public directory.
2. Review the actual upstream repository: license, `SKILL.md`, scripts/hooks, requested tools, network calls, data handling, setup/self-update instructions and authority conflicts.
3. Pin an exact upstream commit and record whether the capability can touch task/user data.
4. Vendor only the approved bounded payload under `skills/approved/`; do not spread copies into BAY/LearnLab/project repositories.
5. Verify the reviewed file identities before materialization. Anti Slop uses exact upstream Git blob SHAs in `skills/approved/anti-slop/SOURCE.json`.
6. Materialize selected skills only into the disposable central Codex workspace. Codex stays network-disabled and receives `DISABLE_TELEMETRY=1` and `DO_NOT_TRACK=1`.
7. Remove the materialized skill folders before the candidate workspace is archived. No target project receives hidden skill state.
8. Refreshes are explicit reviewed source changes; there is no runtime auto-update.

Skill directories are discovery surfaces, not security authorities. Never place credentials, private student data or unpublished school data in a public skill pack or directory listing.


## Source-of-truth rule

AWH remains the control plane. BAY EXCUSE X remains school/student/personnel/identity authority. KRUART Golden UI remains design authority. External projects can improve execution or references but cannot own lifecycle state.

## Rollback

The integration is additive. Rollback is to revert the registry/metadata commit or disable an optional adapter. No AWH schema, Project registry, Task queue, Memory store, auth database or notification subsystem is created by these integrations.
