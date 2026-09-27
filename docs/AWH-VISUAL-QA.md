# AWH Visual QA Loop

Visual review is a reviewer-evidence layer, not a Production authority.

## Pipeline

source → build → fixture scenarios → screenshots → sanitized review pack → review findings → engineering fix → re-render → deterministic QA → release candidate

Review findings may report PASS, REVIEW, or BLOCK. They never deploy, mutate Production data, or create a second source of truth.

## Reviewer perspectives

Use the evidence pack to check:
1. conversational simplicity and continuity;
2. task/execution progress and recovery;
3. Thai mobile usability, safe areas, wrapping, touch targets and keyboard behavior;
4. accessibility, contrast, focus, Stop/Retry/offline/error behavior;
5. adversarial product review for anything a nontechnical user could misunderstand.

Findings are evidence, not truth. Deterministic tests and Owner acceptance remain final gates.

## Release interpretation

- P0: broken primary flow, unsafe/misleading result, inaccessible core action, mobile overflow/navigation obstruction, or no recovery from a common failure.
- P1: material friction, inconsistent artifact/progress/history behavior, excessive decisions, or an important accessibility defect.
- P2: polish, optional affordances, visual refinement, or secondary productivity improvements.

A visual review may block a candidate only when at least one P0 finding contains reproducible scenario evidence.

## Review artifacts

Each pack contains exact revision identity, UX Constitution, scenario manifest, findings JSON schema, screenshots, screen metadata, source snapshot, and safety manifest. Before/after evidence must use the same viewport and scenario ID.

## Review findings

Save structured reviewer output as findings.json, then run npm run review:validate -- findings.json <candidate-sha>. Invalid severity, revision, score, or P0/verdict combinations fail closed. Valid findings may become normal AWH engineering work, but the findings file is never a source of truth.

## Provider boundary

AWH does not require an external review provider. Any optional external reviewer remains manual and evidence-only; AWH must not automate third-party login, scrape authenticated sessions, or treat external output as deployment authority.

## Long-term evidence history

npm run review:visual stores rendered evidence under .awh-local/review/history/<commit-prefix>/ before building the sanitized pack. A new candidate does not overwrite the previous baseline.

Use npm run review:compare -- <before-dir> <after-dir> for paired Before/After evidence. npm run review:retention is audit-only and never deletes evidence.

## Findings lifecycle

1. Generate a clean exact-SHA visual pack.
2. Review the evidence using an approved reviewer surface.
3. Validate with npm run review:validate -- findings.json <candidate-sha>.
4. Generate triage with npm run review:triage -- findings.json <candidate-sha>.
5. Fix through the canonical engineering workflow and render the new exact revision.
6. Run deterministic QA, CI and Owner acceptance.
