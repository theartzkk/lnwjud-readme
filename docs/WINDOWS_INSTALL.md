# Art Agent — Windows Installation

Art Agent uses a **per-user Squirrel.Windows installer**. The normal install path does not require administrator privileges from Art Agent.

## Install through the Windows UI

1. Open this repository on GitHub and choose **Actions**.
2. Open the latest successful **CI** run for the release commit you want to install.
3. In **Artifacts**, download `Art-Agent-Windows-Installer-<version>`.
4. Extract the downloaded ZIP.
5. Confirm the folder contains:
   - `ArtAgentSetup.exe`
   - `ArtAgent-<version>-full.nupkg`
   - `RELEASES`
   - `ArtAgent-SHA256.txt`
6. Double-click `ArtAgentSetup.exe`.
7. Start **Art Agent** from the Windows shortcut.
8. Choose the project workspace in Control Center, then enable only the permissions needed for that project.

## Integrity and trust boundary

CI verifies the installer set before upload and writes SHA-256 values for the installer and Squirrel package into `ArtAgent-SHA256.txt`.

Current internal/test builds are **unsigned** unless the relevant release notes explicitly say otherwise. Windows SmartScreen or reputation warnings are therefore expected on some machines. Use only an artifact from a successful CI run in this repository and keep the SHA-256 file with the installer. Public distribution should wait for a code-signing certificate and signing workflow.

GitHub Actions artifacts have limited retention. A permanent GitHub Release channel is intentionally deferred until code-signing and release policy are finalized.

## What the installer changes

- Installs Art Agent for the current Windows user.
- Uses Squirrel install/update/uninstall lifecycle handling.
- Creates/removes the normal application shortcut through Squirrel startup handling.
- Does not enable workspace writes, execution, or Codex permissions automatically.
- Does not add or widen MCP permissions; capabilities are determined by the source version being installed.

## Branding

Both `ArtAgent.exe` and `ArtAgentSetup.exe` use the repository's canonical `logo-256x256.png`. Packaging generates the required Windows `.ico` container deterministically and preserves the original PNG artwork byte-for-byte inside that container.

## Build the installer from source

For development or CI reproduction on Windows x64:

```powershell
npm ci --ignore-scripts
node node_modules/electron/install.js
Push-Location node_modules/electron-winstaller
node script/select-7z-arch.js
Pop-Location
npm run typecheck
npm test
npm run desktop:make
```

The explicit Electron and Squirrel 7-Zip preparation is intentional. CI keeps general npm lifecycle scripts disabled and runs only these reviewed package setup steps before creating the installer.
