# M16 Windows Field Readiness

Observed on AY-TEACHER on 2026-08-26.

- Desktop Commander: pinned `0.2.47`
- Pinned install: `C:\Users\AY8\AppData\Local\AWH\RemoteWorker\package`
- Watchdog: `C:\Users\AY8\AppData\Local\AWH\RemoteWorker\awh-remote-worker.ps1`
- Startup launcher: `Startup\AWH-Remote-Worker.vbs`
- Node.js: `v24.19.0`
- Git: `2.55.0.windows.3`
- Microsoft Office executable version: `16.0.15225.20204`

Executable paths verified:

- Word: `C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE`
- Excel: `C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE`
- PowerPoint: `C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE`

A stale Word COM process from an earlier combined smoke test was closed gracefully using Word's COM `Quit()` method. The subsequent isolated Word→PDF smoke script was prepared on the device, but remote execution was blocked by the OpenAI safety gate, so Office→PDF is **not yet an end-to-end PASS**.

Architecture invariant: AY-TEACHER is an optional Windows/Office execution provider. AWH Cloud remains authority and must remain usable when this PC is offline.
