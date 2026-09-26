# AWH Approved Skill Fabric

Status: source candidate on `feat/approved-skill-fabric-20260927`

## Goal

Add reusable Agent Skills without turning skill directories, installers, or third-party prompts into a second AWH authority.

## Architecture

```
skills.sh / GitHub / public directories
              │
              ▼
       discovery/reference
              │
              ▼
 security + license + data review
              │
              ▼
 exact commit + file integrity pins
              │
              ▼
 config/external-capabilities.json
              │
              ▼
 existing AWH capability router
              │
              ▼
 lazy materialization into disposable Codex workspace
              │
              ▼
 current Project → Task → Execution → Approval → Artifact path
```

No new database, queue, login, memory store, project registry, approval system, source authority or design authority is introduced.

## Approved now

### Anti Slop

- Source: `miqdadbadjuber/anti-slop`
- Revision: `a56a8a78229516238375111a799001a5f24953cf`
- Version: 3.2.18
- License: MIT
- Profiles:
  - `design.antislop` → antislop + UI + human/accessibility + mobile/layout
  - `copy.antislop` → antislop + copywriting
  - `code.antislop` → antislop + code-comment hygiene
- Authority: filter only. KRUART Golden UI and project/product contracts remain authoritative.

The upstream install wizard, mandatory DURING/AFTER question, self-install/update commands and project entry-file edits are deliberately neutralized by the AWH compatibility wrapper.

### Agent Skills discovery

- Source: `vercel-labs/skills`
- Revision: `7407f3893ad4dceab546ac002c3ef806e4000c73`
- License: MIT
- Role: discovery/reference only
- It never gets permission to install, update or run a discovered skill automatically.

## Security contract

- runtime network access: off for central Codex
- skill telemetry: off
- child-process telemetry flags: `DISABLE_TELEMETRY=1`, `DO_NOT_TRACK=1`
- live `npx skills add` during tasks: forbidden
- runtime auto-update: forbidden
- persistent skill copies in project repos: forbidden
- data exfiltration: forbidden
- skill scripts: never auto-run
- exact upstream commit + reviewed file Git blob SHAs: required
- tampered vendored payload: fail closed
- AWH-created skill directories are removed before candidate archive creation

## Intake policy for future skills

A candidate skill is promoted only after review of:

1. repository owner and provenance
2. exact revision/version
3. license
4. `SKILL.md` instructions
5. scripts/hooks and executable behavior
6. network endpoints
7. requested credentials/secrets
8. files/data it can read or write
9. telemetry/analytics
10. external data transfer
11. authority conflicts with AWH/KRUART/BAY
12. removal and rollback path

The default state of an unreviewed skill is **DISCOVERY_ONLY**, not installed.

## Routing policy

The current router selects skills only when task intent matches a reviewed profile. This is lazy context loading, not blanket prompt expansion. UI work receives Anti Slop during execution; a separate AFTER-style audit is used only when the Owner explicitly asks for an audit/review.

## About example skills such as grill-me and firebase-basics

Examples discovered through skills.sh are candidates, not global defaults. `grill-me` should not override Art's Maximum Automation / Minimum User Touch contract by forcing unnecessary clarification. Firebase-specific skills should only be promoted for a project whose current source architecture actually uses Firebase.

## Rollback

Disable/remove the capability entries and the `skills/approved/anti-slop` vendor directory. Because the fabric reuses existing Task/Execution/Vault/Approval authorities, rollback does not migrate or rewrite canonical project data.
