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
  assert.match(source, /document\.addEventListener\('visibilitychange', refreshConversationOnReturn\)/);
  assert.match(source, /window\.addEventListener\('pageshow', refreshConversationOnReturn\)/);
  assert.match(source, /window\.addEventListener\('online', refreshConversationOnReturn\)/);
  const render = source.slice(source.indexOf('  function renderThread('), source.indexOf('  function renderConversationSheet('));
  assert.doesNotMatch(render, /thread\.replaceChildren/);
  assert.match(render, /previous\?\._awhMarkup === markup/);
});
