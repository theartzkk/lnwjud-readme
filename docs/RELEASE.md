# AWH Release Contract

AWH ships as an evergreen product. Web/PWA receives the latest compatible Stable release automatically; Desktop keeps a stable application identity so future updates can occur in place.

## Channels

- `stable`: default for real work. Requires CI, Hub regression, packaged runtime verification, verified backup, migration plan and rollback plan.
- `preview`: Owner-controlled early access only. It never creates a second AWH identity or separate data authority.

## Stable release evidence

Every Stable release records product version, Git SHA, web release identity, database schema/migration state, package checksums, backup verification, migration plan, rollback plan and post-deploy health result.

## Desktop evergreen rule

Windows keeps the Squirrel identity `AWH` and setup name `AWHSetup.exe`. macOS keeps bundle identifier `com.artworkspacehub.awh`. Users should install Desktop once. The updater transport is intentionally not marked active until a signed/verified release feed and rollback-safe activation path exist.

A Desktop update failure must never make AWH Cloud unavailable. Desktop is an optional execution worker, not the authority for user/project/memory data.
