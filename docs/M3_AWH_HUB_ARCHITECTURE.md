# M3A AWH Hub Architecture

M3A defines the Hub coordination contract only. It does not deploy a server,
implement source synchronization, or make the Hub necessary for local work.
AWH Desktop remains the offline-first authority for the working project folder,
Git, Project Memory files, builds, QA, and checkpoints.

## Boundary

```text
Mac Home ─┐
          ├─ HTTPS JSON API ─ AWH Hub control plane ─ metadata / revisions / small text blobs
School ───┘                                      └─ Asset Layer references only
```

The Hub is not a remote development workstation. It has no arbitrary shell,
filesystem, process, MCP proxy, or remote execution surface.

## Minimal v1 domain

| Entity | Durable identity / purpose | Hub-owned data |
| --- | --- | --- |
| User | `userId` | owner account, display name, lifecycle |
| Device | generated UUID `deviceId` | user, platform, arch, app version, last seen, revocation |
| Project | portable `projectId` | name, type, created time; never local path |
| Membership | project + user | owner/member role and revocation |
| Memory revision | project + memory file + revision DAG | hash, size, optional small content, originating device |
| Source revision | project + parent revision | manifest hash, file manifest, originating device |
| File manifest | relative path + hash + size + kind/mode | metadata only; excluded paths never enter it |
| Content blob | SHA-256 address | small source content only, strictly bounded |
| Build/release | project + source revision | status, version, artifact references, timestamps |
| Audit event | request/device/user/project | safe action/outcome metadata, never credentials |

Images, video, audio, PDFs, and other creative/media files belong to a
separate Asset Layer such as Google Drive. The Hub may store a reference and
hash, but not the media payload.

## Identity and locality

`.awh/project.json` remains the portable project truth for `projectId`, `name`,
and `type`. `workspacePath`, folder names, and repository URLs are device-local
registry data and are never accepted as Hub project identity.

Each Desktop installation eventually generates a random UUID device ID and
stores it under the local AWH data directory. It does not use a MAC address,
hardware serial, or invasive fingerprint. A copied project keeps its project ID;
two devices have different device IDs.

## Revisions and conflicts

Memory and source revisions use parent references. A root revision has a null
parent. Every source revision carries a deterministic SHA-256 hash of its
validated manifest. The Hub accepts a revision only when the submitted parent
matches the server current revision. Otherwise it returns `REVISION_CONFLICT`
with bounded current/submitted metadata; it never applies last-write-wins.

M4 Desktop will resolve or merge conflicts explicitly. M3A does not execute a
merge or synchronize files.

## Offline contract

When the Hub is unavailable, Desktop continues to open and edit projects, read
and write canonical Project Memory, use Git, build, run local QA, and use
checkpoints. A later local sync queue may record pending intent, but queue
execution is outside M3A and must never block local operations.

## Proposed low-cost runtime

For a first deployment, use a small Google Compute Engine VM with Nginx or
Caddy terminating HTTPS, PHP-FPM, SQLite, and a systemd-managed API process.
Keep the database and private small-blob directory outside the web root with
restrictive permissions and regular backups. No Cloud SQL, Kubernetes, Redis,
message broker, container orchestrator, or mandatory worker is required.
Request/response operations cover core sync; maintenance can be an optional
systemd timer. Actual Google pricing, free-tier eligibility, region, quota, and
TLS provisioning remain deployment decisions and are not verified by M3A.
