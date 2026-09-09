import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(path, 'utf8');
const pages = ['index.html','database.html','infrastructure.html','hosting.html','trust.html','panel.html','review.html'];

test('KRUART system UI authority is loaded last on every web surface', async () => {
  for (const page of pages) {
    const html = await read('web/' + page);
    assert.match(html, /kruart-system\.css\?release=__AWH_WEB_RELEASE_ID__/);
    const systemAt = html.lastIndexOf('kruart-system.css');
    const headAt = html.indexOf('</head>');
    assert.ok(systemAt > 0 && systemAt < headAt, page + ' does not load system UI in head');
  }
});

test('owner surfaces use final KRUART branding instead of legacy single-letter marks', async () => {
  const [database, infra, hosting, trust, panel, review] = await Promise.all([
    read('web/database.html'), read('web/infrastructure.html'), read('web/hosting.html'),
    read('web/trust.html'), read('web/panel.html'), read('web/review.html'),
  ]);
  for (const html of [database, infra, hosting, trust, panel, review]) {
    assert.match(html, /system-brand-icon[^>]+logo-256x256\.png/);
  }
  assert.match(panel, /kruart-role-staff-final\.webp/);
  assert.doesNotMatch(panel, /kruart-reference-role-staff\.webp/);
});

test('system UI is build, release, cache and deploy authoritative', async () => {
  const [build, release, releaseContractRaw, sw, deploy, css] = await Promise.all([
    read('scripts/build-web-preview.ts'),
    read('scripts/create-web-release-manifest.mjs'),
    read('scripts/web-release-files.json'),
    read('web/sw.js'),
    read('deploy/awh-control-plane/deploy-control-plane.sh'),
    read('web/kruart-system.css'),
  ]);
  const releaseContract = JSON.parse(releaseContractRaw) as { required: string[] };
  assert.match(build, /kruart-system\.css/);
  assert.match(release, /web-release-files\.json/);
  assert.ok(releaseContract.required.includes('kruart-system.css'));
  assert.match(sw, /kruart-system\.css/);
  assert.match(deploy, /list-web-release-files\.mjs/);
  assert.match(css, /KRUART System UI Authority/);
  assert.match(css, /kruart-role-staff-final\.webp/);
  assert.match(css, /kruart-role-student-final\.webp/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /min-width:320px/);
  assert.doesNotMatch(css, /overflow-x:\s*visible/);
});

test('generated build reinserts KRUART system UI after legacy light authority', async () => {
  const build = await read('scripts/build-web-preview.ts');
  assert.match(build, /\(\?:awh-light-system\|kruart-system\)/);
  assert.match(build, /awh-light-system\.css\?release=__AWH_WEB_RELEASE_ID__\" \/>\\n  <link rel=\"stylesheet\" href=\"\.\/kruart-system\.css/);
});
