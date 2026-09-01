import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url);

function capture(source: string, pattern: RegExp, label: string): string {
  const match = source.match(pattern);
  assert.ok(match?.[1], `${label} must be declared explicitly`);
  return match[1];
}

test('schema migrations have one monotonic authority per user_version', async () => {
  const migrationDir = new URL('../hub/migrations/', import.meta.url);
  const sourceDir = new URL('../hub/src/', import.meta.url);
  const sqlFiles = (await readdir(migrationDir))
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort();
  const prefixes = sqlFiles.map((name) => Number(name.slice(0, 3)));
  assert.equal(new Set(prefixes).size, prefixes.length, 'migration file prefixes must be unique');
  for (let index = 1; index < prefixes.length; index += 1) {
    assert.equal(prefixes[index], prefixes[index - 1] + 1, 'migration file prefixes must be contiguous');
  }

  const phpFiles = (await readdir(sourceDir)).filter((name) => /^Hub.*Migration\.php$/.test(name));
  const authorities: Array<{ file: string; version: number; id: string }> = [];
  for (const file of phpFiles) {
    const source = await readFile(join(sourceDir.pathname, file), 'utf8');
    if (!source.includes('TARGET_USER_VERSION')) continue;
    const version = Number(capture(source, /TARGET_USER_VERSION\s*=\s*(\d+)/, `${file} TARGET_USER_VERSION`));
    const id = capture(source, /MIGRATION_ID\s*=\s*['"]([^'"]+)['"]/, `${file} MIGRATION_ID`);
    authorities.push({ file: basename(file), version, id });
  }
  const versions = authorities.map((item) => item.version);
  const ids = authorities.map((item) => item.id);
  assert.equal(new Set(versions).size, versions.length, 'TARGET_USER_VERSION must have exactly one migration authority');
  assert.equal(new Set(ids).size, ids.length, 'MIGRATION_ID must be globally unique');
  authorities.sort((a, b) => a.version - b.version);
  assert.equal(authorities.at(-1)?.version, prefixes.at(-1)! + 1, 'latest SQL prefix must map to the latest user_version');
  assert.equal(authorities.at(-1)?.id, 'm20-project-source-authority', 'schema 20 is owned by project source authority');
  const lifecycle = authorities.find((item) => item.version === 19);
  assert.equal(lifecycle?.id, 'm19-conversation-lifecycle', 'schema 19 remains owned by conversation lifecycle');
});

test('project source authority advances beyond schema 19 without replacing conversation lifecycle', async () => {
  const lifecycle = await readFile(new URL('../hub/src/HubConversationLifecycleMigration.php', import.meta.url), 'utf8');
  assert.match(lifecycle, /TARGET_USER_VERSION\s*=\s*19/);
  assert.match(lifecycle, /MIGRATION_ID\s*=\s*['"]m19-conversation-lifecycle['"]/);
  assert.doesNotMatch(lifecycle, /project-source-authority/i);
  const projectSource = await readFile(new URL('../hub/src/HubProjectSourceAuthorityMigration.php', import.meta.url), 'utf8');
  assert.match(projectSource, /TARGET_USER_VERSION\s*=\s*20/);
  assert.match(projectSource, /MIGRATION_ID\s*=\s*['"]m20-project-source-authority['"]/);
});
