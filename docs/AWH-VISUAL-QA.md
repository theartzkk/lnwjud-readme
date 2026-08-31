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
