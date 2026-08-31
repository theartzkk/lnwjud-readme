# AWH AiPASS Model Roles

Source catalog: TH-AI Passport project page, checked 2026-08-31. The platform may change models later, so AWH stores roles rather than hard-coding model names into product authority.

## Recommended roles

| Role | Preferred AiPASS model | Use |
| --- | --- | --- |
| Primary UX/Product critic | Claude Opus 5 | Review screenshots, IA, copy, friction, mental model |
| Visual second opinion | Gemini 3.1 Pro | Compare mobile/desktop visual hierarchy and multimodal evidence |
| Architecture/root-cause judge | GPT-5.6 Sol | Check proposed fixes against AWH One Authority Rule and release constraints |
| Fast verification | Claude Sonnet 5 or GPT-5.6 Terra | Re-check resolved findings and small regressions |
| Web-grounded product research | Sonar Reasoning Pro | Competitive/product research requiring current web evidence |
| Rare deep audit | o3 Deep Research or Sonar Deep Research | Large research questions only; use sparingly |

AIPass is a reviewer, never the Production authority. Deterministic QA, canonical release evidence, and Owner UAT remain authoritative.

## Daily credit routing

- Main visual audit: Claude Opus 5, about 2,500 credits.
- Independent visual pass: Gemini 3.1 Pro, about 2,000 credits.
- Focused after-fix verification: Claude Sonnet 5 or GPT-5.6 Terra, about 2,000 credits.
- Final candidate/adversarial review: reserve about 3,500 credits for the strongest model needed that day.

Prefer visual-first prompts. Do not send the entire repository unless a finding truly needs source-level diagnosis.
