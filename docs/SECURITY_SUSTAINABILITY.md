# AWH Security Sustainability

Security boundaries must survive upgrades and device replacement.

- Secrets remain write-only where possible and are never committed, exported, logged or embedded in release/update manifests.
- Browser authentication uses same-origin session cookies; Database Studio remains Owner-only and read-only by default.
- Desktop/device credentials are individually revocable. A lost worker does not invalidate Hub identity or data.
- Stable releases preserve security regression tests and package identity.
- SSH host-key verification is never bypassed during deployment or recovery.
- Production restore, schema destruction and release cutover remain explicit staged boundaries.
