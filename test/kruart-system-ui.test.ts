import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

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
  assert.match(panel, /system-control-panel\.webp/);
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
  assert.match(sw, /kruart-hero-final\.webp/);
  assert.match(sw, /kruart-role-student-final\.webp/);
  assert.match(sw, /kruart-role-teacher-final\.webp/);
  assert.match(sw, /kruart-role-parent-final\.webp/);
  assert.match(sw, /kruart-role-staff-final\.webp/);
  for (const dedicated of ['project-awh.webp','project-bay-excuse-x.webp','project-learnlab.webp','project-school.webp','project-parent-connect.webp','project-computer-lab.webp','system-control-panel.webp']) {
    assert.ok(sw.includes(dedicated), dedicated + ' missing from release-aware cache');
    assert.ok(releaseContract.required.includes(dedicated), dedicated + ' missing from release contract');
  }
  assert.doesNotMatch(sw, /kruart-human-student-hero-hq\.webp/);
  assert.doesNotMatch(sw, /kruart-human-teacher-hero-hq\.webp/);
  assert.doesNotMatch(sw, /kruart-reference-role-staff-hq\.webp/);
  assert.match(sw, /const RUNTIME_VISUALS = new Set/);
  const shell = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[0] || '';
  const runtimeVisuals = sw.match(/const RUNTIME_VISUALS = new Set\(\[([\s\S]*?)\]\);/)?.[0] || '';
  assert.doesNotMatch(shell, /project-awh\.webp|project-bay-excuse-x\.webp|news-school-activity\.webp/);
  assert.match(runtimeVisuals, /project-awh\.webp/);
  assert.match(runtimeVisuals, /project-bay-excuse-x\.webp/);
  assert.match(runtimeVisuals, /news-school-activity\.webp/);
  assert.match(sw, /runtimeVisual/);
  assert.match(deploy, /list-web-release-files\.mjs/);
  assert.match(css, /KRUART System UI Authority/);
  assert.match(css, /kruart-role-staff-final\.webp/);
  assert.match(css, /kruart-role-student-final\.webp/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /Mobile composition closure/);
  assert.match(css, /grid-template-columns:118px minmax\(0,1fr\)!important/);
  assert.match(css, /grid-template-columns:108px minmax\(0,1fr\)!important/);
  assert.match(css, /min-width:320px/);
  assert.doesNotMatch(css, /overflow-x:\s*visible/);
});

test('generated build reinserts KRUART system UI after legacy light authority', async () => {
  const build = await read('scripts/build-web-preview.ts');
  assert.match(build, /\(\?:awh-light-system\|kruart-system\)/);
  assert.match(build, /awh-light-system\.css\?release=__AWH_WEB_RELEASE_ID__\" \/>\\n  <link rel=\"stylesheet\" href=\"\.\/kruart-system\.css/);
});


test('KRUART visual asset slots are centralized and all deployed fallbacks exist', async () => {
  const [raw, css, index, panel] = await Promise.all([
    read('config/kruart-visual-assets.json'),
    read('web/kruart-system.css'),
    read('web/index.html'),
    read('web/panel.html'),
  ]);
  const manifest = JSON.parse(raw) as {
    version: number;
    slots: Array<{ id: string; fallback: string | null; plannedWebAsset?: string; status: string }>;
  };
  assert.equal(manifest.version, 2);
  assert.ok(manifest.slots.length >= 30);
  assert.equal(new Set(manifest.slots.map((slot) => slot.id)).size, manifest.slots.length);
  for (const slot of manifest.slots) {
    if (slot.fallback) await access('web/' + slot.fallback);
    for (const asset of [slot.fallback, slot.plannedWebAsset]) {
      if (!asset?.endsWith('.webp')) continue;
      const path = 'web/' + asset;
      try {
        await access(path);
      } catch {
        continue;
      }
      const bytes = await readFile(path);
      assert.ok(bytes.length >= 12, path + ' is truncated');
      assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF', path + ' is not RIFF WebP');
      assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP', path + ' is not WebP');
    }
  }
  assert.match(css, /--kruart-art-public-hero:url\("\.\/kruart-hero-final\.webp"\)/);
  assert.match(css, /background-image:var\(--kruart-art-public-hero\)!important/);
  assert.match(css, /--kruart-art-system-infrastructure/);
  assert.match(index, /data-kruart-art-slot="public\.account-avatar"[^>]*account-avatar\.webp/);
  assert.match(index, /data-kruart-art-slot="public\.today-message"[^>]*today-community\.webp/);
  assert.match(index, /brand-kruart-workspace\.webp/);
  assert.match(panel, /data-kruart-art-slot="system\.control-panel"[^>]*system-control-panel\.webp/);
  const expectedReady = new Map([
    ['public.news.school','news-school-activity.webp'],['public.news.activity','news-learning.webp'],['public.news.pride','news-pride.webp'],
    ['owner.system.learnlab','project-learnlab.webp'],['owner.system.bay','project-bay-excuse-x.webp'],['owner.system.awh','project-awh.webp'],
    ['owner.system.school','project-school.webp'],['owner.control','owner-control.webp'],['awh.home.hero','awh-home-hero.webp'],
    ['system.infrastructure','system-infrastructure.webp'],['system.hosting','system-hosting.webp'],['system.control-panel','system-control-panel.webp'],
  ]);
  for (const [id, fallback] of expectedReady) {
    const slot = manifest.slots.find((entry) => entry.id === id);
    assert.equal(slot?.status, 'ready', id + ' must be ready');
    assert.equal(slot?.fallback, fallback, id + ' must bind the approved asset');
  }
  assert.ok(manifest.slots.some((slot) => slot.status === 'needs-dedicated'));
  const projectSources = (manifest as any).projectSources;
  assert.equal(projectSources.unifiedArchive.name, 'KRUART-ECOSYSTEM-SOURCES-READY-FINAL.zip');
  assert.equal(projectSources.unifiedArchive.version, '2026-09-10-final');
  assert.equal(projectSources.unifiedArchive.schoolName, 'โรงเรียนบ้านเอือดใหญ่');
  assert.equal(projectSources.unifiedArchive.status, 'approved-project-source');
  assert.equal(projectSources.unifiedArchive.canonicalRoot, '01_PRODUCTION_READY');
  assert.equal(projectSources.unifiedArchive.referenceRoot, '02_REFERENCE_ONLY');
  assert.match(projectSources.ingestPolicy.production, /01_PRODUCTION_READY/);
  assert.match(projectSources.ingestPolicy.reference, /must never auto-promote/);
});
