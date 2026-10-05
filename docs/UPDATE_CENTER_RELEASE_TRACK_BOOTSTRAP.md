# Update Center release-track bootstrap

Checkpoint 2fd39efd62a378f07a14965312c8fc453054004a fixes Update Center adapter resolution from the canonical registry and makes shared-only Update Center maintenance resolve to the AWH release track.

The currently deployed pre-fix classifier returns no release track when every changed path is shared. This note is intentionally AWH-owned so the existing source-promotion authority can classify the exact checkpoint plus this compatibility note as awh without bypassing or replacing that authority.

No deployment engine, queue, registry, approval authority, or product implementation is introduced here.

## 2026-10-05 metadata-repair readiness bootstrap

Checkpoint `80898ac3a81b3cd6f9afc0c95c1a26661d015e4d` fixes a shared-repository release-readiness deadlock where a historical `SOURCE_PROMOTION_CHAIN_GAP` repair can be newer in audit time than the promotion it repairs and can predate deterministic `bundleSha256` evidence. The deployed control plane can therefore show a VPS Platform update as ready while the mutation path fails closed with `CORE_RELEASE_NOT_READY`.

This AWH-owned compatibility note advances only the normal AWH source-promotion/bootstrap lane so the shared control-plane parser can understand that durable historical repair evidence. It does not move `platform/production`, activate Platform maintenance units, bypass Owner approval, edit historical database rows, or create a second release authority. The VPS Platform payload remains subject to its normal `system.platform.release` runner after the control-plane bootstrap converges.

## 2026-10-05 Hatchet stage validator bootstrap follow-up

Checkpoint `ac51d21d21206a687d3ab38522bf2035d5aeec6d` adds the already-emitted `HATCHET_WORKER_PREPARED` stage to the strict remote deploy output allowlist. The full clean-source test suite passes after this compatibility repair, so this note advances the AWH bootstrap target beyond that checkpoint without moving `platform/production` or changing release authority.
