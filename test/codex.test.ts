import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCodexArgs, codexEnvironment, codexInstructionContainsSecretValue } from '../src/codex.js';

test('Codex invocation is non-interactive, sandboxed, ephemeral, JSONL, and network-disabled', () => {
  const args = buildCodexArgs('/workspace', 'read-only');
  assert.deepEqual(args.slice(0, 2), ['exec', '--experimental-json']);
  assert.ok(args.includes('--ephemeral'));
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
