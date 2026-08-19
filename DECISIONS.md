# Decisions

- Art Agent is a legacy codename only.
- There is one AWH product; no parallel ArtAgent product is created.
- AWH is local-first.
- GitHub is optional and is not critical infrastructure.
- Portable project identity lives in `.awh/project.json`.
- `projectId` is stable across devices.
- Absolute workspace paths are device-local only.
- Project Memory files are portable truth.
- `.git` is never synchronized by AWH.
- Large assets use a separate future asset layer.
- AI providers are adapters/components, not the AWH product.
- Remote execution remains restricted.
- AWH Hub must not become a single point of failure.
