# AWH Local QA Engine

This repository is migrating the public product identity to AWH while preserving Art Agent as a legacy compatibility identity. The local QA engine remains the source of truth for local verification: it does not change installer executable names, `.art-agent` paths, legacy `ART_AGENT_*` variables, or MCP protocol identity.

## Commands

```sh
npm run qa:fast   # Node, lock metadata, typecheck, tests, build
npm run qa:local  # fast + Git/configuration, desktop readiness, security and MCP isolation
npm run qa:full   # local + supported desktop smoke and platform-specific installer gate
```

`AWH-QA.command` is a macOS double-click/Terminal launcher when Node is available. `AWH-QA.cmd` is the Windows launcher. Both invoke the same `scripts/qa/awh-local-qa.mjs` source of truth.

Results are written to `.awh-local/qa/latest.json` and `.awh-local/qa/latest.log`; `.awh-local/` is gitignored. The JSON contains `schemaVersion`, timing, platform, Node/npm/Git tool discovery, Git state, overall result, and checks with `PASS`, `FAIL`, `SKIP`, or `SKIP_PLATFORM` status. `ENVIRONMENT_NOT_READY` is used for the overall result when missing runtime/dependencies block source gates; those checks remain `FAIL` for schema compatibility and explicitly say `ENVIRONMENT BLOCKER`.

The engine uses fixed executable names and argument arrays with `shell: false`. It never prints environment variables or `.env` contents, never calls GitHub, and runs QA child processes with local write/exec/Codex permissions disabled. Normal QA assumes dependencies are already installed; dependency installation is deliberately outside the engine.

On macOS and Linux, Windows installer QA is explicitly `SKIP_PLATFORM`. A skipped platform gate is not represented as a pass. On Windows, installer work runs only when the existing Forge/Squirrel toolchain is available.

The `ffmpeg` gate is an actual disposable video E2E, not executable detection alone: it resolves both FFmpeg and FFprobe, validates both versions, encodes an ordered temporary frame sequence to H.264/yuv420p MP4 through bounded argv execution, and verifies count, duration, FPS, timebase and decoded ordering.

On macOS, a pre-marker AppKit/LaunchServices abort from the Codex GUI sandbox is reported in the human summary as `GUI_SANDBOX_BLOCKED` and stored with schema-compatible `SKIP` status; it is not an AWH application failure. A real logged-in macOS GUI launch outside Codex is still required for desktop runtime PASS.

`.github/workflows/ci.yml` remains unchanged in this milestone and is not required by the local runtime.
