# Art Agent v0.4 — Context Economy

Art Agent v0.4 reduces repeated MCP payloads and preserves useful project/task continuity without adding parallel filesystem, Git, checkpoint, or process-control systems.

Release versioning now treats `package.json` as the runtime Source of Truth. `ART_AGENT_VERSION` derives from package metadata, so the MCP server, desktop app, tests, and installer do not keep a second hard-coded runtime version.

## Read contract

`read_file` remains the single guarded workspace read tool. It uses bounded line paging and a whole-file SHA-256 digest:

- `startLine` — 1-based page start
- `maxLines` — at most 500 lines; default 200
- `knownDigest` — optional digest from a prior response

If `knownDigest` still matches the current file, Art Agent returns metadata with `unchanged: true` and omits `content`. If the file changed, the requested page is returned with its original CRLF/LF line endings preserved.

`knownDigest` is a freshness/re-check mechanism. **Do not send the previous digest when intentionally requesting the next page**, because a matching whole-file digest correctly suppresses content. Omit `knownDigest` when moving to `nextStartLine`.

The existing whole-file byte guard remains in force before paging; v0.4 does not use pagination to bypass configured read-size limits.

## Git diff contract

`git_diff` remains the single working-tree diff tool and continues to use the existing secret-path filtering. It adds:

- optional changed `path` selection
- `startLine` / `maxLines` paging
- `knownDigest` suppression
- safe changed-path metadata and hidden-secret-path count

The safe changed-path set is discovered once per request and reused for the diff, avoiding duplicate Git discovery work.

## Discovery bounds

To prevent discovery responses from growing unexpectedly:

- `workspace_tree` defaults to 100 entries and remains bounded to 300
- `search_text` defaults to 25 matches and remains bounded by the configured maximum
- each `search_text` match is capped at 500 characters around the match; long lines set `truncated: true`

## Project profile

`workspace_info` now includes a small read-only project profile using the same guarded workspace boundary. It can identify Node.js, PHP, Python, Rust, and Go manifests. For Node projects it exposes only the package-manager name and which approved scripts (`test`, `lint`, `typecheck`, `build`) exist.

It does **not** return dependency lists or arbitrary script commands. Manifest symlinks that escape the registered workspace are ignored by the existing canonical read guard.

## Persistent task metadata

The existing task registry remains the only process-control authority. v0.4 persists a bounded metadata record under the Art Agent data directory so task IDs and completion state survive an Art Agent restart.

Persisted fields are limited to task identity/label, state, exit code/signal, timestamps, and the log-truncation flag. Art Agent deliberately does **not** persist stdout, stderr, executable paths, arguments, cwd, environment variables, stdin, Codex prompts, or instructions.

After restart:

- finished task metadata can be read through `task_status` / `task_list`
- a task that was previously `running` becomes `unknown_after_restart`
- `task_logs` and `task_stop` continue to work only for processes owned by the current runtime

This preserves continuity without granting a new runtime control over old/unknown processes.

## Checkpoints

No second checkpoint database was created. Art Agent already persists checkpoint metadata and snapshots under its existing checkpoint store with SHA-256 integrity verification, so v0.4 reuses that Source of Truth unchanged.

## CI economy

CI now uses branch/ref concurrency with `cancel-in-progress: true`. A newer commit automatically supersedes older CI work for the same ref instead of leaving obsolete Electron/installer jobs queued behind the current source.

## Security invariants

Context economy does not loosen write, execution, Codex, checkpoint, path-containment, secret-path, renderer sandbox, or installer boundaries. Pagination, digest suppression, project detection, and persisted task metadata sit behind the existing security boundaries rather than creating alternative access paths.
