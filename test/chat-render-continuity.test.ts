import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('web/app.js', 'utf8');
function functionSource(name: string, next: string) {
  return source.slice(source.indexOf(`  async function ${name}(`), source.indexOf(`  ${next}`, source.indexOf(`  async function ${name}(`)));
}
const poll = functionSource('pollConversation', 'function startWorkspacePolling');
function harness() {
  let resolve: (value: unknown) => void = () => {};
  let reject: (error: Error) => void = () => {};
  let reads = 0;
  const context = vm.createContext({
    state: { control: { authenticated: true }, selectedConversationId: 'a', conversation: { messages: ['confirmed'] } },
    document: { hidden: false }, pollingConversation: false, conversationRefresh: null, sendingMessage: false,
    conversationRequest: 0, rendered: 0, notices: [],
    loadConversation: () => { reads++; return new Promise((yes, no) => { resolve = yes; reject = no; }); },
  });
  vm.runInContext(`function renderWorkspace(){rendered++} function message(...args){notices.push(args)} ${poll}`, context);
  return { context, run: () => vm.runInContext('pollConversation()', context), resolve: (value: unknown) => resolve(value), reject: () => reject(new Error('offline')), reads: () => reads };
}

test('poll rejects a late response after switching conversations', async () => {
  const h = harness(); const pending = h.run(); h.context.state.selectedConversationId = 'b';
  h.resolve({ messages: ['old room'] }); await pending;
  assert.equal(h.context.state.conversation.messages[0], 'confirmed'); assert.equal(h.context.rendered, 0);
});
test('poll is single flight and cannot replace an optimistic submission', async () => {
  const h = harness(); const pending = h.run(); await h.run(); assert.equal(h.reads(), 1);
  h.context.sendingMessage = true; h.resolve({ messages: [] }); await pending;
  assert.equal(h.context.rendered, 0); assert.equal(h.context.pollingConversation, false);
});
test('offline poll preserves confirmed messages and can reconnect', async () => {
  const h = harness(); const pending = h.run(); h.reject(); await pending;
  assert.equal(h.context.state.conversation.messages[0], 'confirmed'); assert.equal(h.context.pollingConversation, false);
  const reconnected = h.run(); h.resolve({ messages: ['new confirmed'] }); await reconnected;
  assert.equal(h.context.state.conversation.messages[0], 'new confirmed'); assert.equal(h.context.rendered, 1);
});
test('newer refresh invalidates an older poll even in the same room', async () => {
  const h = harness(); const pending = h.run(); h.context.conversationRequest++;
  h.resolve({ messages: ['stale'] }); await pending; assert.equal(h.context.rendered, 0);
});
test('login hydration installs one polling lifecycle and thread does not clear live DOM', () => {
  assert.match(source, /async function hydrateAuthenticatedControl[^]*?startWorkspacePolling\(\)/);
  assert.match(source, /if \(!state.conversationTimer\)/);
  assert.match(source, /document\.addEventListener\('visibilitychange', refreshWorkspaceOnReturn\)/);
  assert.match(source, /window\.addEventListener\('pageshow', refreshWorkspaceOnReturn\)/);
  assert.match(source, /window\.addEventListener\('online', refreshWorkspaceOnReturn\)/);
  assert.match(source, /workspaceReturnRefresh = refreshWorkspace\(false\)\.finally/);
  assert.match(source, /now - lastWorkspaceReturnRefreshAt < 1500/);
  const render = source.slice(source.indexOf('  function renderThread('), source.indexOf('  function renderConversationSheet('));
  assert.doesNotMatch(render, /thread\.replaceChildren/);
  assert.match(render, /previous\?\._awhMarkup === markup/);
});


test('return refresh coalesces duplicate lifecycle events and refreshes full workspace state', async () => {
  const start = source.indexOf('  function refreshWorkspaceOnReturn(');
  const end = source.indexOf('  function startWorkspacePolling(', start);
  const fn = source.slice(start, end);
  let resolveRefresh: () => void = () => {};
  let refreshes = 0;
  let now = 2000;
  const context = vm.createContext({
    document: { hidden: false }, state: { control: { authenticated: true } }, workspaceReturnRefresh: null, lastWorkspaceReturnRefreshAt: 0,
    Date: { now: () => now }, refreshWorkspace: () => { refreshes++; return new Promise<void>((resolve) => { resolveRefresh = resolve; }); },
  });
  vm.runInContext(fn, context);
  vm.runInContext('refreshWorkspaceOnReturn(); refreshWorkspaceOnReturn();', context);
  assert.equal(refreshes, 1);
  resolveRefresh(); await Promise.resolve(); await Promise.resolve();
  now = 2500; vm.runInContext('refreshWorkspaceOnReturn()', context); assert.equal(refreshes, 1);
  now = 4000; vm.runInContext('refreshWorkspaceOnReturn()', context); assert.equal(refreshes, 2);
});

test('screen-reader announcer stays quiet on hydration and announces only newly added assistant work', () => {
  const start = source.indexOf('  function announceNewAssistantTurn(');
  const end = source.indexOf('  function renderThread(', start);
  const fn = source.slice(start, end);
  const announcer = { textContent: '' };
  const context = vm.createContext({ announcer, $: () => announcer, window: { requestAnimationFrame: (callback: () => void) => callback() } });
  vm.runInContext(fn, context);
  const messages = [{ kind: 'user', body: 'hello' }, { kind: 'assistant', body: 'พร้อมทำงาน' }];
  context.messages = messages;
  vm.runInContext('announceNewAssistantTurn(messages, 0, false)', context); assert.equal(announcer.textContent, '');
  vm.runInContext('announceNewAssistantTurn(messages, 1, true)', context); assert.equal(announcer.textContent, 'AWH: พร้อมทำงาน');
  context.messages = [...messages, { kind: 'user', body: 'ต่อเลย' }]; announcer.textContent = '';
  vm.runInContext('announceNewAssistantTurn(messages, 2, true)', context); assert.equal(announcer.textContent, '');
});


test('task progress announcer is milestone-based and live activity itself stays quiet', () => {
  const start = source.indexOf('  function announceTaskMilestones(');
  const end = source.indexOf('  function renderThread(', start);
  const fn = source.slice(start, end);
  const liveStart = source.indexOf('  function renderLiveActivity(');
  const liveEnd = source.indexOf('  function renderRetry(', liveStart);
  const live = source.slice(liveStart, liveEnd);
  assert.match(live, /setAttribute\('role', 'group'\)/);
  assert.doesNotMatch(live, /aria-live/);
  const announcer = { textContent: '' };
  const context = vm.createContext({ announcer, $: () => announcer, taskAnnouncementState: new Map(), taskExecutionStatus: (task: any) => ({ progress: task.progress, detail: task.detail, title: task.state }), window: { requestAnimationFrame: (callback: () => void) => callback() } });
  vm.runInContext(fn, context);
  context.tasks = [{ taskId: 't1', state: 'RUNNING', progress: 10, detail: 'กำลังเริ่มงาน' }];
  vm.runInContext('announceTaskMilestones(tasks, false)', context); assert.equal(announcer.textContent, '');
  vm.runInContext('announceTaskMilestones(tasks, true)', context); assert.equal(announcer.textContent, '');
  context.tasks[0].progress = 26; context.tasks[0].detail = 'ทำงานแล้ว 26%';
  vm.runInContext('announceTaskMilestones(tasks, true)', context); assert.equal(announcer.textContent, 'AWH: ทำงานแล้ว 26%');
  announcer.textContent = ''; context.tasks[0].progress = 30;
  vm.runInContext('announceTaskMilestones(tasks, true)', context); assert.equal(announcer.textContent, '');
  context.tasks[0].state = 'WAITING_FOR_APPROVAL'; context.tasks[0].detail = 'รออนุมัติ';
  vm.runInContext('announceTaskMilestones(tasks, true)', context); assert.equal(announcer.textContent, 'AWH: รออนุมัติ');
});


test('failed submission is recovered into the originating room draft after navigation', () => {
  const start = source.indexOf('  function rememberFailedSubmissionDraft(');
  const end = source.indexOf('  let pendingPrivilegedAction', start);
  const fn = source.slice(start, end);
  const file = { name: 'evidence.png' };
  const context = vm.createContext({ composerDrafts: new Map([['p:a', { text: '', attachments: [] }]]), composerDraftKey: 'p:b', projectId: 'p', conversationId: 'a', goal: 'ข้อความที่ส่งไม่สำเร็จ', files: [file] });
  vm.runInContext(fn, context);
  assert.equal(vm.runInContext('rememberFailedSubmissionDraft(projectId, conversationId, goal, files)', context), true);
  const recovered = context.composerDrafts.get('p:a');
  assert.equal(recovered.text, 'ข้อความที่ส่งไม่สำเร็จ');
  assert.equal(recovered.attachments.length, 1);
  assert.equal(recovered.attachments[0], file);
  context.composerDrafts.set('p:a', { text: 'ร่างใหม่ที่พิมพ์ไว้', attachments: [] });
  vm.runInContext('rememberFailedSubmissionDraft(projectId, conversationId, goal, files)', context);
  assert.equal(context.composerDrafts.get('p:a').text, 'ข้อความที่ส่งไม่สำเร็จ\n\nร่างใหม่ที่พิมพ์ไว้');
  context.composerDraftKey = 'p:a';
  assert.equal(vm.runInContext('rememberFailedSubmissionDraft(projectId, conversationId, goal, files)', context), false);
  assert.equal(context.composerDrafts.get('p:a').text, 'ข้อความที่ส่งไม่สำเร็จ\n\nร่างใหม่ที่พิมพ์ไว้');
});

test('submission catch preserves failed work for a room that is no longer selected', () => {
  const submit = source.slice(source.indexOf("  $('goal-form').addEventListener('submit'"), source.indexOf("  $('refresh-work').addEventListener", source.indexOf("  $('goal-form').addEventListener('submit'")));
  assert.match(submit, /failedSubmission = \{ conversationId, goal, pending, idempotencyKey, uploaded \};[^]*?rememberFailedSubmissionDraft\(project\.projectId, conversationId, goal, pending\);/);
});


test('composer stop follows canonical canCancel while retaining legacy pre-claim fallback', () => {
  const start = source.indexOf('  function taskCanCancel(');
  const end = source.indexOf('  function addPendingAttachments(', start);
  const fn = source.slice(start, end);
  const context = vm.createContext({ CANCELLABLE_TASK_STATES: new Set(['QUEUED','WAITING_FOR_WORKER','WAITING_FOR_APPROVAL']), state: { conversation: { tasks: [] } } });
  vm.runInContext(fn, context);
  context.task = { state: 'RUNNING', canCancel: true }; assert.equal(vm.runInContext('taskCanCancel(task)', context), true);
  context.task = { state: 'RUNNING', canCancel: false }; assert.equal(vm.runInContext('taskCanCancel(task)', context), false);
  context.task = { state: 'QUEUED' }; assert.equal(vm.runInContext('taskCanCancel(task)', context), true);
});


test('older history merges into the current room without replacing newer state', () => {
  const start = source.indexOf('  async function loadOlderConversationMessages(');
  const end = source.indexOf('  function renderConversationSheet(', start);
  const fn = source.slice(start, end);
  assert.match(fn, /conversationId !== state\.selectedConversationId/);
  assert.match(fn, /knownMessages/);
  assert.match(fn, /knownTasks/);
  assert.match(fn, /knownArtifacts/);
  assert.match(fn, /knownAttachments/);
  assert.match(fn, /knownApprovals/);
  assert.match(fn, /truncated: page\.history\.hasMore/);
  assert.match(fn, /visibleMessageCount: state\.conversation\.messages\.length/);
});
