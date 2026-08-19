# M2A Project Registry and Memory Foundation

M2A adds a local foundation for using more than one project without creating a
second data system. The local registry is stored under the currently resolved
AWH `config.dataDir`; it does not choose a data directory independently and
does not touch the real user home during tests.

Portable identity and display metadata live in `<workspace>/.awh/project.json`.
It contains only `schemaVersion`, one UUID-style `projectId`, portable `name`,
portable normalized `type`, and `createdAt`. The ID is generated once by
explicit initialization, is never derived from a path, and survives copying
the project to another device or path. The initial name may be proposed from
the workspace basename, but the stored manifest value is the portable truth.
Type is a bounded normalized string rather than a closed enum, so future
categories do not require a schema migration. Absolute paths are device-local
only: `projects.json` maps the portable ID to the canonical local
`workspacePath`, availability, pin state, and local timestamps; it does not
duplicate name or type.

Canonical Project Memory is portable workspace files, initialized only by an
explicit action and never overwritten:

`PROJECT.md`, `HANDOFF.md`, `TASKS.md`, `ARCHITECTURE.md`, and `DECISIONS.md`.

The bounded context builder reads `.awh/project.json`, those files in the
canonical order, then safe project profile and Git status. Missing memory files
remain missing; partial initialization creates only missing files. Existing
registry data is not a competing note/decision/instruction memory database.

Manifest parsing rejects malformed schemas, unknown fields, absolute paths,
URLs/control characters in display metadata, and symlinks. Context reads reuse
the existing canonical workspace, read, write, secret-path, and project/Git
guards. Project context takes name/type from the manifest, never from the local
workspace basename.

This foundation does not add a cloud registry, synchronization, automatic
project discovery, or an AI model. The Desktop Projects workflow is documented
separately in `M2C_DESKTOP_PROJECTS.md`; it consumes this local registry and
portable memory foundation. Future AWH Hub sync may share portable identity,
memory, and revisions, but must never synchronize device-local absolute paths as
project identity.
