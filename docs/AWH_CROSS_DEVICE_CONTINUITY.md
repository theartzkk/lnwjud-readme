# AWH Cross-Device Continuity — Interim Plan

The current Git-over-SSH VPS mirror remains an interim source bridge. It is
not AWH Hub synchronization, and `.git` must never be copied through Drive or
generic file sync.

```text
Mac AWH Desktop  -->  AWH Hub read/auth foundation  <--  School PC AWH Desktop
       independent device identity and credential on each device
```

Portable truth remains `.awh/project.json` plus the five Project Memory files.
`~/.awh/projects.json`, device identity, credentials, local workspace paths,
and Git SSH keys remain device-local. A Mac private SSH key must never be
copied to the school PC.

## Next human-reviewed pairing steps

1. Install a normal supported Node/npm runtime and AWH Desktop on the school
   PC; do not copy the Mac data directory or credentials.
2. Initialize a new school-PC device identity through the explicit Desktop flow
   once M3B secure OS credential storage is available.
3. Register the school-PC project folder only after verifying the portable
   `projectId`; opening a folder must not implicitly initialize it.
4. Use the reviewed Hub enrollment/pairing flow to authorize that device for
   the project. Never paste a long-lived token into Project Memory, Git, or a
   browser URL.
5. Re-run local QA and compare the portable manifest/memory status. Resolve
   future source/memory conflicts explicitly; do not use last-write-wins.

This plan does not claim that pairing, token storage, Hub synchronization, or
remote tunnel end-to-end connectivity is implemented or verified.
