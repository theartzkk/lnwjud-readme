> **Document role: CONTEXT_ONLY_STATE_INDEX**
> This file intentionally contains no mutable state values. This file is not live authority. Fresh observed runtime/source evidence outranks this snapshot.

# Current State Index

This index locates current-state authority; it does not replace live evidence.

Use this file only to locate the correct live authority.

| Question | Live authority |
|---|---|
| What source is canonical now? | Project Registry + canonical Git/Vault evidence |
| What is deployed now? | Production ref/pointer + public/runtime release.json |
| Is a project writable now? | awh-operator mission-status + awh-operator gate |
| Is the database healthy/current? | approved DB integrity/schema inspection |
| Are services healthy? | systemd/runtime health + public checks |
| Is a device/worker available? | current device/capability evidence |
| Is there an update? | Update Center backend + source-promotion/release authority |
| Is backup/recovery valid? | newest verified backup metadata + restore-drill evidence |

Do not add SHA values, schema numbers, disk values, device counts, current queue counts, or prose that hard-codes the currently deployed revision here. If a durable invariant is discovered, update the normative authority or machine policy instead. Historical snapshots belong under history/.
