# AWH Visual QA Loop

AIPass is a **reviewer**, not a Production authority. The review loop converts rendered AWH behavior into structured findings while preserving existing task, artifact, release, and approval authorities.

## Pipeline

`source → build → fixture scenarios → screenshots → sanitized review pack → AIPass review → findings.json → engineering fix → re-render → deterministic QA → release candidate`

AIPass may output `PASS`, `REVIEW`, or `BLOCK`, but it must never deploy, mutate production data, or become a second issue database.

## Reviewer perspectives

Use one prompt with five perspectives:

1. ChatGPT simplicity — friction, conversational continuity, density, composer behavior.
2. Genspark agentic UX — plan, execution, live progress, background work, artifact delivery.
3. Thai mobile usability — Thai copy, wrapping, touch targets, keyboard and safe areas.
4. Accessibility and recovery — focus, contrast, stop/retry/offline/error behavior.
5. Adversarial product review — identify anything a nontechnical user could misunderstand.

Findings are evidence, not truth. Deterministic tests and Owner acceptance remain final gates.

## Daily 10,000-credit strategy

A practical budget for TH-AI Passport Innovator:

- 2,500 credits — main visual audit on Claude Opus 5.
- 2,000 credits — visual second opinion on Gemini 3.1 Pro.
- 2,000 credits — focused verification after fixes, preferably Claude Sonnet 5 or Gemini Flash.
- 3,500 credits — final candidate/adversarial review using the strongest model only when needed.

Do not spend credits asking every model to read the whole repository. Start with screenshots + UX Constitution + scenario metadata. Supply source snippets only for findings that need implementation-level diagnosis.

## Release interpretation

- **P0:** wrong answer/intent, broken primary flow, unsafe or misleading result, inaccessible composer, mobile overflow/navigation obstruction, no recovery from a common failure.
- **P1:** material friction, inconsistent artifact/progress/history behavior, excessive decisions, important accessibility defect.
- **P2:** polish, optional affordances, visual refinement, secondary productivity improvements.

A visual review may block a candidate only when at least one P0 finding contains reproducible screenshot/scenario evidence. P1/P2 findings do not independently authorize source changes or deployment.

## Review artifacts

Each pack contains the committed revision identity, UX Constitution, scenario manifest, findings JSON schema, screenshots, screen metadata, source snapshot, and safety manifest. Before/after screenshots should use the same viewport and scenario ID so regressions can be compared directly.

## Importing AIPass findings

Save the model response as `findings.json`, then run `npm run review:validate -- findings.json <candidate-sha>`. Invalid severity, revision, score, or P0/verdict combinations fail closed. Valid findings may be converted into normal AWH engineering work, but the JSON file itself is never a new source of truth.

## AiPASS handoff boundary

AiPASS itself is used only through its official user interface. AWH must not automate login, emulate user actions, scrape authenticated sessions, or connect to undocumented AiPASS API/API-key/token endpoints.

The automated boundary stops at the sanitized ZIP. The Owner uploads that pack in the official AiPASS UI, selects the reviewer model, and saves/copies the returned JSON. AWH automation resumes only after that JSON is back on the AWH side and has passed `review:validate`.

This keeps the free AiPASS entitlement useful for product review without making AiPASS a runtime dependency or violating its access conditions.

## Long-term evidence history

`npm run review:visual` stores rendered evidence under `.awh-local/review/history/<commit-prefix>/` before building the sanitized ZIP. A new candidate therefore does not overwrite the previous visual baseline.

Use `npm run review:compare -- <before-dir> <after-dir>` to build a paired Before/After evidence set. Comparisons require clean exact-revision manifests and pair screenshots by scenario plus viewport. This is the preferred verification path after a UX fix because it asks the reviewer to identify regressions and unresolved defects instead of re-auditing unchanged screens.

`npm run review:retention` is intentionally audit-only. It reports history/compare entries beyond the configured retention windows but never deletes them. Purging evidence is a separate Owner-approved operation.

## Reviewer policy lifecycle

`scripts/review/reviewer-policy.json` defines reviewer roles, daily credit allocation and fallback choices. Model names are recommendations, not runtime dependencies. Review the catalog at least every 30 days and change the role mapping rather than embedding a specific model into source or Product UX.

The daily budget is capped at 10,000 review credits by policy. Deep Research is reserved for genuinely research-heavy audits and requires an Owner choice because its availability and monthly quota may differ from normal chat models.

## Findings lifecycle

1. Generate a clean exact-SHA visual pack.
2. Upload it through the official AiPASS UI and request JSON only.
3. Validate with `npm run review:validate -- findings.json <candidate-sha>`.
4. Generate a human triage report with `npm run review:triage -- findings.json <candidate-sha>`.
5. Fix through the canonical engineering workflow, render a new SHA, then run Before/After compare.
6. Deterministic QA, CI and Owner acceptance remain the release authority.
