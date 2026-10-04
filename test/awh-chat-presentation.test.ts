import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test, { after } from "node:test";

const runFile = promisify(execFile);
const ROOT = process.cwd();
const OUTPUT = await mkdtemp(join(tmpdir(), "awh-chat-presentation-"));
after(async () => { await rm(OUTPUT, { recursive: true, force: true }); });
const read = (name: string) => readFile(join(ROOT, name), "utf8");

test("AWH Chat presentation reuses the existing AWH authority", async () => {
  const [app, bridge, runtime, thread] = await Promise.all([
    read("web/app.js"), read("web/chat-island/bridge.ts"),
    read("web/chat-island/runtime.tsx"), read("web/chat-island/thread.tsx"),
  ]);
  assert.match(app, /globalThis\.AWH_CHAT_BRIDGE/);
  assert.match(app, /submitWorkMessage/);
  assert.match(app, /loadConversations/);
  assert.match(app, /decideApproval/);
  assert.match(app, /openArtifactWorkspace/);
  assert.match(bridge, /type AwhChatBridge/);
  assert.match(runtime, /useExternalStoreRuntime/);
  assert.match(runtime, /WebSpeechDictationAdapter/);
  assert.doesNotMatch(bridge + runtime + thread, /fetch\s*\(/);
  assert.doesNotMatch(bridge + runtime + thread, /indexedDB|new WebSocket|EventSource/);
});

test("iPhone dictation is one-shot and self-recovers instead of remaining stuck", async () => {
  const [runtime, thread, css] = await Promise.all([
    read("web/chat-island/runtime.tsx"), read("web/chat-island/thread.tsx"), read("web/chat-island/chat.css"),
  ]);
  assert.match(runtime, /continuous:\s*false/);
  assert.doesNotMatch(runtime, /continuous:\s*true/);
  assert.match(thread, /function DictationSafety/);
  assert.match(thread, /phase === "starting" \? 4_000 : 30_000/);
  assert.match(thread, /aui\.composer\.stopDictation\(\)/);
  assert.match(thread, /visibilitychange/);
  assert.match(thread, /กำลังเปิดไมค์…/);
  assert.match(thread, /กำลังฟัง… แตะ ■ เพื่อหยุด/);
  assert.match(css, /\.awh-dictation-state/);
});

test("Provider setup is discoverable, truthful, and high-risk confirmation happens in context", async () => {
  const [app, html, adapter] = await Promise.all([
    read("web/app.js"), read("web/index.html"), read("web/control-plane-adapter.js"),
  ]);
  assert.match(html, /data-profile-section="ai"/);
  assert.match(html, /<strong>AI Providers<\/strong>/);
  assert.match(app, /\+ เพิ่ม Provider/);
  assert.match(app, /id="provider-add-list"/);
  assert.match(app, /function providerHubSummary/);
  assert.match(app, /status\.available === true && status\.credential\?\.lastTestStatus === 'PASS'/);
  assert.match(app, /พร้อมใช้งาน \$\{ready\.length\} Provider/);
  assert.match(app, /function requestPrivilegedPassword/);
  assert.match(app, /async function withOwnerStepUp/);
  assert.match(app, /await stepUp\(password\)/);
  assert.match(app, /withOwnerStepUp\(\(\) => updateProviderHubCredential\(item\.providerId, 'SET', secret\)/);
  assert.match(adapter, /PROVIDER_AUTH_FAILED: 'AI Provider ปฏิเสธ API key นี้/);
  assert.match(adapter, /PROVIDER_RATE_LIMITED: 'AI Provider จำกัดการเรียกใช้ชั่วคราว/);
  assert.doesNotMatch(adapter, /PROVIDER_(?:AUTH_FAILED|PERMISSION_DENIED|QUOTA_EXHAUSTED|RATE_LIMITED|UNAVAILABLE|TEST_FAILED): '.*OpenAI/);
  assert.doesNotMatch(app, /เปิดโหมดผู้ดูแลขั้นสูง|pendingPrivilegedAction/);
});

test("Chat shell exposes modern assistant UX without raw tool logs by default", async () => {
  const [thread, css, html] = await Promise.all([
    read("web/chat-island/thread.tsx"), read("web/chat-island/chat.css"), read("web/index.html"),
  ]);
  for (const token of ["ThreadPrimitive", "ComposerPrimitive", "MarkdownTextPrimitive", "TaskCard",
    "รายละเอียดงาน", "ดูรายละเอียดเครื่องมือ", "อนุญาตครั้งนี้", "Artifact Panel",
    "awh.chat.draft.v1", "searchConversations", "แยกเป็นแชทใหม่", "awh-message-more"]) assert.ok(thread.includes(token), token);
  assert.doesNotMatch(thread, /task\.progress > 0 && task\.progress < 100/);
  assert.doesNotMatch(thread, /<progress/);
  assert.match(thread, /task\?\.state === "FAILED"/);
  assert.doesNotMatch(thread, /AWH Server|🖥|snapshot\.project && <span>/);
  assert.match(html, /id="awh-chat-root"[^>]*hidden/);
  assert.match(html, /class="workstream awh-chat-fallback"/);
  assert.match(html, /id="goal-form" class="composer awh-chat-fallback"/);
  assert.match(css, /body\.awh-modern-chat-ready/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(thread, /desktop_commander|github\.get_commit|playwright\.browser_navigate/);
});


test("Temporary Chat stays on the existing conversation authority and out of history", async () => {
  const [service, adapter, app, bridge, thread] = await Promise.all([
    read("hub/src/HubControlPlaneService.php"), read("web/control-plane-adapter.js"),
    read("web/app.js"), read("web/chat-island/bridge.ts"), read("web/chat-island/thread.tsx"),
  ]);
  assert.match(service, /origin <> \\'temporary\\'/);
  assert.match(service, /expireTemporaryConversations/);
  assert.match(service, /origin = \$temporary \? 'temporary' : 'native'/);
  assert.match(adapter, /createConversation\(projectId, title = 'การสนทนาใหม่', temporary = false\)/);
  assert.match(app, /newTemporaryConversation/);
  assert.match(app, /origin !== 'temporary'/);
  assert.match(bridge, /temporary: boolean/);
  assert.match(bridge, /stream: \{ phase:/);
  assert.match(thread, /แชทชั่วคราว/);
  assert.match(thread, /snapshot\.temporary/);
  assert.match(thread, /snapshot\.stream\.phase/);
  assert.match(thread, /temporary \|\| !conversationId/);
});

test("Chat dependencies are pinned and the release emits one island bundle", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.dependencies["@assistant-ui/react"], "0.15.22");
  assert.equal(pkg.dependencies["@assistant-ui/react-markdown"], "0.14.17");
  assert.equal(pkg.dependencies.react, "19.3.0");
  assert.equal(pkg.dependencies["react-dom"], "19.3.0");
  assert.equal(pkg.devDependencies.esbuild, "0.28.2");
  await runFile(process.execPath, ["--import", "tsx", "scripts/build-web-preview.ts", "--control"], {
    cwd: ROOT,
    env: { ...process.env, AWH_PREVIEW_GENERATED_AT: "2026-09-28T16:55:00.000Z",
      AWH_WEB_RELEASE_ID: "chat-presentation-test", AWH_WEB_OUTPUT_DIR: OUTPUT },
  });
  const [builtHtml, js, css] = await Promise.all([
    readFile(join(OUTPUT, "index.html"), "utf8"),
    readFile(join(OUTPUT, "chat-ui.js"), "utf8"),
    readFile(join(OUTPUT, "chat-ui.css"), "utf8"),
  ]);
  assert.match(builtHtml, /chat-ui\.css\?release=chat-presentation-test/);
  assert.match(builtHtml, /chat-ui\.js\?release=chat-presentation-test/);
  assert.equal((builtHtml.match(/chat-ui\.js/g) || []).length, 1);
  assert.ok(js.length > 100000);
  assert.match(css, /awh-chat-shell/);
  assert.doesNotMatch(builtHtml + js + css, /__AWH_WEB_RELEASE_ID__/);
});
