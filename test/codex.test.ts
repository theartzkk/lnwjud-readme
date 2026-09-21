import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCodexArgs, buildCodexDeviceArgs, codexEnvironment, codexInstructionContainsSecretValue, codexInstructionContainsUnsafeControl } from '../src/codex.js';

test('Codex invocation is non-interactive, sandboxed, ephemeral, JSONL, and network-disabled', () => {
  const args = buildCodexArgs('/workspace', 'read-only');
  assert.deepEqual(args.slice(0, 2), ['exec', '--experimental-json']);
  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('--skip-git-repo-check'));
  assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), ['--sandbox', 'read-only']);
  assert.deepEqual(args.slice(args.indexOf('--cd'), args.indexOf('--cd') + 2), ['--cd', '/workspace']);
  assert.ok(args.includes('web_search="disabled"'));
  assert.ok(args.includes('sandbox_workspace_write.network_access=false'));
  assert.ok(args.includes('approval_policy="never"'));
});

test('Codex child environment does not forward generic API key variables', () => {
  const previousOpenAI = process.env.OPENAI_API_KEY;
  const previousCodexApi = process.env.CODEX_API_KEY;
  process.env.OPENAI_API_KEY = 'should-not-pass';
  process.env.CODEX_API_KEY = 'should-not-pass';
  try {
    const env = codexEnvironment();
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.CODEX_API_KEY, undefined);
  } finally {
    if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAI;
    if (previousCodexApi === undefined) delete process.env.CODEX_API_KEY;
    else process.env.CODEX_API_KEY = previousCodexApi;
  }
});

test('Codex instruction secret guard allows policy prose but rejects credential-like values', () => {
  assert.equal(codexInstructionContainsSecretValue('Permanent bearer token must never be placed in browser storage.'), false);
  assert.equal(codexInstructionContainsSecretValue('Do not expose password stores or API key material.'), false);
  assert.equal(codexInstructionContainsSecretValue('Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345'), true);
  assert.equal(codexInstructionContainsSecretValue('token=abcdefghijklmnopqrstuvwxyz012345'), true);
  assert.equal(codexInstructionContainsSecretValue('-----BEGIN PRIVATE KEY-----'), true);
});

test('Codex instruction control guard allows normal multiline prompt structure only', () => {
  assert.equal(codexInstructionContainsUnsafeControl('OWNER\n\nGOAL\r\n\titem'), false);
  assert.equal(codexInstructionContainsUnsafeControl('OWNER\u0000GOAL'), true);
  assert.equal(codexInstructionContainsUnsafeControl('OWNER\u000bGOAL'), true);
  assert.equal(codexInstructionContainsUnsafeControl('OWNER\u001fGOAL'), true);
  assert.equal(codexInstructionContainsUnsafeControl('OWNER\u007fGOAL'), true);
});


test('AWH device Codex invocation is isolated from user config and injects only validated providers', () => {
  const args = buildCodexDeviceArgs('/private/tmp/device-task', {
    guiMcpUrl: 'http://127.0.0.1:59702/mcp',
    systemMcpCommand: '/Users/example/.local/share/bay-remote/node_modules/.bin/desktop-commander',
  });
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--approve-for-me'));
  assert.equal(args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
  assert.ok(args.includes('mcp_servers.awh_device_gui.url="http://127.0.0.1:59702/mcp"'));
  assert.ok(args.includes('mcp_servers.awh_device_system.enabled=true'));
  assert.throws(() => buildCodexDeviceArgs('/tmp', { guiMcpUrl: 'https://example.com/mcp' }), /invalid/);
  assert.throws(() => buildCodexDeviceArgs('/tmp', { systemMcpCommand: 'desktop-commander' }), /invalid/);
  assert.throws(() => buildCodexDeviceArgs('/tmp', {}), /unavailable/);
});
