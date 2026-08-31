# AWH UX Constitution

This document is the product-level UX authority for Art’s Workspace Hub (AWH). It governs review, implementation, and release decisions without replacing backend source-of-truth contracts.

## Product promise

AWH should feel as simple as ChatGPT for conversation and as capable as Genspark for multi-step deliverables.

**Open AWH → type what you want → AWH answers or acts → show human progress → deliver an artifact → continue naturally.**

## Non-negotiable rules

1. Home is Chat-first. The primary control is a real composer, not a launcher that looks like an input.
2. Normal users never need to choose a model, agent, tool, worker, executor, provider, job, queue, or server.
3. A normal question receives a conversational answer. It must not accidentally become a task-status response.
4. A work request becomes a bounded plan and executes automatically unless approval or safety policy requires a pause.
5. Artifacts live in the conversation and can be previewed, continued, downloaded, converted, or shared when supported.
6. Follow-ups such as “ไฟล์เมื่อกี้”, “ทำเป็น PDF”, or “ใช้แบบเดิม” resolve from canonical conversation/task/artifact context before asking again.
7. Mobile has at most three primary destinations: **แชท · งานของฉัน · เครื่องมือ**. Settings/Owner controls belong behind profile/account surfaces.
8. Backend vocabulary is forbidden in L1/L2 UX: `Agent`, `Executor`, `Worker`, `Provider`, `Job`, `RUNNING`, `Server`, capability IDs, task IDs, model IDs.
9. Progress uses human phases and must expose Stop whenever the task can still be safely cancelled.
10. Failure states preserve work and offer a human recovery action such as Retry, Edit & resend, or Resume.

## Mobile and interaction contract

11. iPhone reference viewport is 390×844. Horizontal overflow is a release blocker.
12. Header, composer, sheets, and bottom navigation respect `safe-area-inset-top` and `safe-area-inset-bottom`.
13. Default composer is one line, grows with content, and stays attached to the keyboard. Minimum touch target is 44 px.
14. Desktop: Enter sends, Shift+Enter inserts a new line. Mobile must not accidentally submit during IME composition.
15. The send control changes into a Stop action while cancellable work is active.
16. Suggestions reduce typing but never compete with the composer. They are contextual and disappear when no longer useful.
17. Empty state contains at most three useful examples; it is not a product brochure.
18. Home only shows information that helps the user start now or resume previous work.

## Progressive disclosure

- **L1 — default:** intent, answer, artifact, one-line progress.
- **L2 — expand:** human-readable steps, progress, elapsed/updated time, recovery actions.
- **L3 — developer/owner:** model, tool, capability, task/execution IDs, provider usage, logs.

L3 is never allowed to leak into L1/L2 through error strings or backend event text.

## Outcome metrics

- Time to first prompt: < 5 seconds after opening AWH.
- Decisions before first outcome: 0 unless approval is required.
- Average taps per deliverable: ≤ 3 after the prompt is entered.
- >90% of normal work should finish without changing primary surface.
- A completed artifact must be visible where the user asked for it.
