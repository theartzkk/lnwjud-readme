# Art Agent v0.4 — Context Economy

The v0.4 context contract reduces repeated MCP payloads without adding a second filesystem or Git engine.

## Read contract

`read_file` remains the single guarded workspace read tool. It gains bounded line paging and a whole-file SHA-256 digest:

- `startLine` — 1-based page start
- `maxLines` — bounded to at most 500 lines; default 200
- `knownDigest` — optional digest from a prior response

If `knownDigest` still matches the current file, Art Agent returns metadata with `unchanged: true` and omits `content`. If the file changed, the requested page is returned with its original CRLF/LF line endings preserved.

## Git diff contract

`git_diff` remains the single working-tree diff tool and continues to use the existing secret-path filtering. It gains:

- optional changed `path` selection
- `startLine` / `maxLines` paging
- `knownDigest` suppression
- safe changed-path metadata and hidden-secret-path count

## Discovery defaults

To prevent large discovery responses by default:

- `workspace_tree` defaults to 100 entries and remains bounded to 300
- `search_text` defaults to 25 matches and remains bounded by the configured maximum

## Security invariants

Context economy does not change write, execution, Codex, checkpoint, path-containment, or secret-path permissions. Pagination and digest suppression sit after the existing guarded read/diff boundaries.
