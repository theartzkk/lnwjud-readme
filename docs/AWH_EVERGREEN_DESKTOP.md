# AWH Evergreen Desktop

AWH Desktop is install-once. Stable and Preview are update channels of the same installed application, never separate products.

## Permanent identity

- Product: `awh`
- Windows package: `AWH`
- macOS bundle: `com.artworkspacehub.awh`
- Executable: `AWH`
- Default channel: `stable`

Changing these identifiers after the first stable installation is a migration event, not normal release work.

## Update contract

Desktop accepts only a v1 update manifest whose product ID, Windows package ID, macOS bundle ID and selected channel match the installed AWH identity. The manifest binds the release version to an exact SHA-256 and byte size and must point to a bounded `/desktop-updates/v1/...` path.

Normal updates are upgrade-only. Silent downgrade is forbidden. Rollback is an explicit recovery operation with a separately verified previous Stable release.

Stable is the default for every normal installation. Preview is an Owner opt-in stored on the same installation. Switching channel must not create another app identity or another AWH data directory.

## Activation sequence

1. Ship Production Core and first Stable installer.
2. Publish a trusted HTTPS update feed from the AWH Cloud authority.
3. Add signed release metadata and platform signing/notarization gates.
4. Enable background update checks and verified download.
5. Install only after verification; preserve the previous Stable release for rollback.

Until the trusted feed/signing gates exist, AWH must not pretend automatic installation is active. Cloud remains usable even when Desktop is absent or updating.
