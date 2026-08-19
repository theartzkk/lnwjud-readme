# M2C Desktop Projects UX

The Desktop Projects page is the local entry point for registered AWH projects.
It uses the existing project registry and portable project-memory engines; it
does not create another project database or memory store.

## Project workflow

- `Register Existing Project` requires `.awh/project.json` and never initializes
  an arbitrary folder implicitly.
- `Initialize as AWH Project` is an explicit action that creates the portable
  manifest once, then registers the project locally.
- `Select / Open Project` validates the manifest/project ID and stores the local
  workspace selection for restart.
- `Locate Project` validates the copied manifest `projectId` before rebinding a
  missing registry record. A mismatch fails closed.
- Duplicate available paths for one portable project ID are surfaced as a
  conflict rather than silently selected.

The manifest remains portable truth for `name`, `type`, and `projectId`.
`projects.json` remains device-local mapping and state only. Local availability,
selection, timestamps, and lightweight Git status are derived at runtime.

## Project Memory

The Memory view reads the existing portable files in the established order:

`PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `ARCHITECTURE.md`, `DECISIONS.md`.

`HANDOFF.md` is shown first through a bounded preview. Missing files are shown
as `Missing`; `Initialize Missing Project Memory` creates only missing template
files and never overwrites an existing file.

## Security boundary

The renderer receives only fixed high-level IPC methods. It never receives raw
filesystem, shell, process, environment, or arbitrary command access. Folder
selection is performed by the Electron main process, and project operations
accept a validated portable project ID rather than a renderer-supplied path.
The existing `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`,
and `connect-src 'none'` boundaries remain in force.
