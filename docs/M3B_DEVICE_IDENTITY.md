# M3B Device Identity

M3B establishes local device identity without creating a Hub server or making a
network call.

## Current implementation

`src/device-identity.ts` stores one local file under the resolved AWH data
directory:

`<config.dataDir>/device.json`

The allowlisted fields are:

```json
{
  "schemaVersion": 1,
  "deviceId": "<UUID v4>",
  "displayName": "Art’s Mac",
  "platform": "darwin",
  "arch": "arm64",
  "createdAt": "<ISO timestamp>"
}
```

The identity is generated once and reused. It is not derived from a MAC
address, hostname, serial number, hardware fingerprint, workspace path, or
project folder. It is outside the project workspace and contains no token.
The file and containing directory use user-only permissions where supported.
Malformed, oversized, non-regular, or symlinked metadata fails closed.
Display name changes preserve the same device ID.

The Desktop Doctor reads existing metadata and exposes only readiness, display
name, platform/arch, and an eight-character ID preview. It does not show a
credential. M3B does not automatically initialize the real user's data
directory during QA; the current real device identity is therefore not
initialized by this milestone.

## Credential boundary

`src/credential-store.ts` defines one `CredentialStore` interface. The test
adapter is in-memory only. The production factory intentionally returns an
unavailable fail-closed adapter until a safe macOS Keychain or Windows
Credential Manager implementation is added. There is no silent plaintext
fallback.

Device tokens must never be placed in `device.json`, settings, project files,
Project Memory, Git, logs, or audit metadata.

## Future behavior

An explicit Desktop setup flow may call the identity initializer and allow the
user to edit the display name. Device identity is device-local and must not be
copied with a project or synchronized as project data. A future secure OS
credential adapter may store the device-scoped token without changing the
device metadata schema.
