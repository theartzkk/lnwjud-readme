# KRUART Experience Gate

This is the durable UX contract for the KRUART/BAY ecosystem. It does not merge repositories, identities, databases, or release ownership.

- One product has one navigation vocabulary. Responsive layouts may change presentation, not destination meaning.
- Mobile primary navigation is capped by `config/kruart-experience-contract.json`.
- Back = previous context, Home = current product home, Exit = parent product or originating context.
- Public surfaces must not expose internal control-plane terminology.
- Utility/compatibility surfaces must not become duplicate user-facing portals.
- Every interactive action must expose pressed/loading/success/error behavior appropriate to latency.
- Async status must be screen-reader observable; sticky/mobile UI must respect safe areas and minimum touch targets.
- Release tracks remain independently owned even when Update Center renders them together.
- Candidate/source activation and Production deployment remain separate gates with exact-revision evidence.
- Visual changes require rendered verification; source inspection alone is insufficient.

KRUART is the umbrella. AWH is owner workspace/control plane. BAY EXCUSE X is school operations. Computer Lab is the student entry. LearnLab is the learning room. Assessment is an academic workflow under BAY. School Website is the institutional public surface. LINE OA is a channel/integration, not another product core.

A new top-level surface, navigation vocabulary, release track, or parent/exit relationship requires an explicit update to the machine-readable contract and design-governance QA in the same revision.
