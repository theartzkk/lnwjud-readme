# Update Center release-track bootstrap

Checkpoint 2fd39efd62a378f07a14965312c8fc453054004a fixes Update Center adapter resolution from the canonical registry and makes shared-only Update Center maintenance resolve to the AWH release track.

The currently deployed pre-fix classifier returns no release track when every changed path is shared. This note is intentionally AWH-owned so the existing source-promotion authority can classify the exact checkpoint plus this compatibility note as awh without bypassing or replacing that authority.

No deployment engine, queue, registry, approval authority, or product implementation is introduced here.
