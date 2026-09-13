# AWH product closure candidate

Base: `77573a7738efacfbb57b2dcc9944dd5fd8c3c1f7` on `astra/awh-final-closure-20260913`.
Scope: local Web product implementation. No Production deployment, DB mutation, DNS change, hosted Actions, source-authority/runner/artifact-routing architecture change or school identity change.

## Shared causes and changes

- The two-second conversation poll rebuilt the entire live message DOM. Rendering now reconciles stable keyed rows, preserving unchanged nodes, selection/focus and expanded details. Scroll restoration ignores hidden/stale conversations. Global CSS no longer turns immediate restoration into smooth scrolling.
- Conversation reads were concurrent and unbound to their originating selection. Refresh is single-flight for a selection; poll responses are generation/room checked and cannot overwrite an in-flight submission. A failed read retains confirmed history. Polling starts for both restored sessions and fresh login.
- Opening Chat reset the textarea and polling reset an edited room title. Navigation preserves the composer; drafts and original File objects are kept separately per room for the current page session. Drafts are not persisted across browser reload and this patch does not introduce a local identity/data store.
- Submission is guarded against concurrent sends, retains text typed while a request is pending, restores failed text without silently dropping a newer draft, and reuses the idempotency key/uploaded attachment IDs when the same failed request is explicitly resent. No automatic send retry loop is added.
- Dashboard routing no longer waits for owner infrastructure data before selecting the requested surface. Home, Tasks and Files can resolve immediately after authenticated shell bootstrap. Background dashboard rendering reapplies the active surface so Owner/Night Shift sections do not reappear in Tasks/Files.
- Root history removes stale workspace/dialog metadata; modal Forward restoration and focus filtering respect hidden panels. Late artifact preview results cannot replace a newly selected preview.
- The canonical global header owns the profile entry. The mobile chat heading no longer has a duplicate account portrait/second action row. Existing KRUART action blue, Thai line height and readable task-filter colors replace conflicting legacy styles; filters wrap at narrow widths. Remaining legacy pale foregrounds in Tasks/Files use existing text/status tokens, and the mobile Owner disclosure heading wraps as a full-width row.
- Standard image thumbnails reserve 44px geometry and use bounded original-byte data URLs permitted by the existing CSP; upload bytes are unchanged. HEIC and general files retain the existing original-file path and filename affordance.

## Architecture and product audit boundary

The Web shell is imperative DOM (`app.js`, `dashboard.js`, `navigation.js`), with CONTROL adapters and polling over existing Conversation/Task/Execution/Approval/Artifact authorities. It is not a token-streaming framework. Stop remains limited to states already cancellable by the backend; RUNNING cancellation is not fabricated. Edit/resend preserves prior messages. Existing provider/model/error/usage routing, durable queues and background work remain authoritative. BAY EXCUSE X remains school/student/personnel/identity SoT; canonical school spelling remains โรงเรียนบ้านเอือดใหญ่.

The existing UX Constitution, visual-review loop and design/asset contracts were used as references. Hallmark-style rendered QA and specialist-routing concepts are ADAPT/REFERENCE only; no external framework, new queue or asset registry was imported. Approved assets were reused without regeneration. The extra floating hero thumbnail was removed and optional Owner cards use one disclosure on all viewports. PDF preview offers an explicit same-origin download action without leaving the workspace because the existing CSP does not permit blob frames.

## Verification and release interpretation

- Added `test/chat-render-continuity.test.ts` to the standard test command: late responses, overlapping polling, optimistic send protection, offline recovery and fresh-login lifecycle.
- Added `scripts/qa/chat-continuity-browser.mjs`, reusing an installed Playwright/Chrome and the existing `control-web-fixture.mjs`. It downloads no browser dependency and accepts only a loopback fixture URL. The existing fixture now implements the empty conversation-trash read contract already supported by the real router; this removes a fixture-only 404 when opening room management.
- Build browser fixtures in a separate output directory: existing full-suite tests also rebuild `dist-web`, so serving that shared directory during concurrent tests can invalidate browser evidence.
- Frozen full `npm test` on clean `4a934bd4093fc3731b1bf82d2ad3263ce481c2c4`: 430 tests, 429 passed, 0 failed, 1 Windows-only test skipped. The final successor changes only dashboard CSS foreground/wrapping and this report; targeted regression and rendered evidence are repeated for that successor.
- Initial targeted checks: 29/29 passed. Adjacent checks found one source-contract assertion naming the old refresh function; it was updated to the actual guarded fetch owner without weakening the auth condition.
- Initial sandbox `qa:local`: TypeScript/build/final-UAT shell passed, but overall `ENVIRONMENT_NOT_READY`; tool probes timed out, main tests timed out, security/MCP/PHP checks failed, and dirty/unbound upstream state failed the release gate. This is not a full-QA PASS. A direct suite run outside the sandbox was started to distinguish environment failures from source failures.
- Browser exploration proved stable message nodes/focus after login, draft preservation on Back, room-title editing, failed-read history retention, and narrow viewport rendering. Exact clean-revision browser evidence and final test totals must be read from the final handoff/manifest, not inferred from these exploratory findings.

Not deployed or field-tested. Physical authenticated iPhone Safari/HEIC decoding, real provider streaming/reconnect, live task execution, Production quota/provenance and real-device keyboard behavior remain separate field gates. No candidate here is automatically deploy-safe. Any future release needs the existing exact-revision approval, canonical-source, artifact and rollback gates.
