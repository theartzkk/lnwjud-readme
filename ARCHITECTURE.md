> **Document role: CONTEXT_ONLY_ARCHITECTURE**
> This file describes stable shape, not live state. Never infer a current SHA, schema, service state, device state, queue state, or Production claim from this document.

# AWH Architecture

AWH is the control plane for KRUART/BAY work. It owns durable project identity, task/execution authority, approvals, source/release coordination, artifacts, audit, and bounded automation. Product systems remain separate products and consume shared authorities instead of creating shadow control planes.

## Stable topology

- ReadyIDC VPS hosts the always-on AWH control plane and managed Production runtimes.
- Canonical source authority is resolved per Project Registry contract. AWH-managed Git projections and Project Vault must agree where Vault is authoritative.
- Tasks and mutations use canonical Task → Execution → Envelope authorities. Conflict is resource-scoped; unrelated work may proceed concurrently.
- Production releases are exact-revision, fail-closed, backup/rollback protected, and verified after cutover.
- Personal devices are optional workers or interactive clients. They are not source, release, queue, or identity authority.
- External providers supply bounded capabilities; provider-local state never becomes AWH product authority.

## Live evidence

Resolve mutable facts from live authority before acting:

- /usr/local/bin/awh-operator status
- /usr/local/bin/awh-operator projects
- /usr/local/bin/awh-operator gate <project>
- canonical Git refs under /srv/awh-git
- public/runtime release.json
- database integrity/schema queries through approved operational paths
- current systemd/service/device evidence

## Normative contracts

Read AGENTS.md first. Normative boundaries are in docs/AWH-AUTHORITY-MAP.md, security/release contracts, and machine-readable policies under config/. Historical architecture snapshots are retained under history/.
