# Anti Slop Intake Security Review

Status: APPROVED as a bounded advisory skill pack at revision `a56a8a78229516238375111a799001a5f24953cf`.

- Upstream setup instructions are non-authoritative under the AWH compatibility wrapper.
- Runtime download and self-update are forbidden.
- Central Codex remains network-disabled; external data transfer is forbidden.
- AWH disables telemetry for the Codex child process.
- Materialized skills are removed before candidate packaging.
- Bundled scripts never auto-execute and gain no execution permission from skill loading.
- Exact upstream commit and file identities are pinned in `SOURCE.json`.
- Anti Slop is a filter; KRUART design governance remains higher authority.
- Rollback removes/disables only this capability pack; no canonical AWH authority depends on it.
