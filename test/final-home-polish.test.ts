import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read=(p:string)=>readFile(new URL(`../${p}`,import.meta.url),'utf8');

test('canonical Dashboard is intent-first with a three-item mobile navigation',async()=>{
 const [dashboard,css,index,constitution]=await Promise.all([read('web/dashboard.js'),read('web/dashboard.css'),read('web/index.html'),read('docs/AWH-UX-CONSTITUTION.md')]);
 for(const text of ['วันนี้อยากให้ช่วยอะไร?','พิมพ์สิ่งที่อยากให้ช่วย…','สร้างเอกสาร','จัดการ PDF','สร้าง QR','งานของฉัน','เครื่องมือ']) assert.ok(dashboard.includes(text),`missing ${text}`);
 for(const technical of ['ค้นหา ⌘K','Memory พร้อม','Project + Chat','ยังไม่มี Project']) assert.ok(!dashboard.includes(technical),`primary UX leaked technical copy: ${technical}`);
 const mobileNav=dashboard.match(/function mountMobileNavigation\(\)[\s\S]*?document\.body\.append\(nav\);/)?.[0]||'';
 for(const label of ['แชท','งานของฉัน','เครื่องมือ']) assert.match(mobileNav,new RegExp(label));
 for(const duplicate of ["'หน้าแรก'","'ไฟล์'"]) assert.doesNotMatch(mobileNav,new RegExp(duplicate));
 assert.match(constitution,/at most three primary destinations/);
 for(const leaked of ['งาน/AI','Cloud พร้อมใช้งาน','ทุกงาน เริ่มจากตรงนี้']) assert.doesNotMatch(dashboard,new RegExp(leaked));
 assert.match(css,/awh-mobile-nav/); assert.match(css,/repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(dashboard,/dashboard-attachment-open/);
 assert.match(dashboard,/แนบไฟล์หรือรูปภาพ/);
 assert.doesNotMatch(dashboard,/kruart-reference-role-staff-hq\.webp/);
 assert.doesNotMatch(dashboard,/hero\.append\(heroArt\)/);
 assert.match(dashboard,/\['home', '⌂', 'เริ่มงาน'/);
 assert.match(dashboard,/dataset\.view === 'files' \? 'files' : 'home'/);
 assert.match(index,/data-owner-destination="home"/);
 assert.match(index,/data-owner-destination="awh"/);
 assert.doesNotMatch(index,/Channel และ SHA-256|Source of Truth ของตัวเอง|AI WORKSPACE/);
 assert.match(index,/โปรแกรมสำหรับ Windows และ macOS พร้อมติดตั้ง/);
 assert.match(index,/พื้นที่ทำงาน/);
 assert.match(dashboard,/openWork\(command\.value, false\)/);
 assert.match(dashboard,/\$\('attachment-open'\)\?\.click\(\)/);
 assert.match(css,/awh-command-attach/);
 assert.match(index,/href="\.\/infrastructure\.html"/); assert.doesNotMatch(`${dashboard}\n${css}`,/awh-experience-v[23]|final-home-polish/);
});


test('KRUART Golden Home ships the approved generated human artwork family and app branding', async () => {
  const [html, css, finalCss, build, releaseScript, releaseContractRaw, sw, pwaManifest] = await Promise.all([
    read('web/index.html'),
    read('web/awh-light-system.css'),
    read('web/kruart-system.css'),
    read('scripts/build-web-preview.ts'),
    read('scripts/create-web-release-manifest.mjs'),
    read('scripts/web-release-files.json'),
    read('web/sw.js'),
    read('web/manifest.webmanifest'),
  ]);
  const releaseContract = JSON.parse(releaseContractRaw) as { required: string[]; sourceCopies: [string,string][] };
  const finalAssets = [
    'kruart-hero-final.webp',
    'kruart-role-student-final.webp',
    'kruart-role-teacher-final.webp',
    'kruart-role-parent-final.webp',
    'kruart-role-staff-final.webp',
    'kruart-footer-final.webp',
    'kruart-logo-final.webp',
    'kruart-app-icon-512.png',
  ];
  assert.match(build,/releaseContract\.sourceCopies/);
  assert.match(releaseScript,/web-release-files\.json/);
  for (const asset of finalAssets) {
    assert.ok(releaseContract.required.includes(asset), 'final artwork is not release-contracted: '+asset);
    assert.ok(releaseContract.sourceCopies.some(([,destination]) => destination === asset), 'final artwork is not copied by canonical build contract: '+asset);
    assert.ok(sw.includes(asset), 'final artwork is not cached by release-aware PWA shell: '+asset);
  }
  const vaultAssets = [
    'brand-kruart-workspace.webp','brand-kruart-online.webp','brand-awh.webp','account-avatar.webp',
    'logo-school.webp','logo-bay-excuse-x.webp','logo-bay-learnlab.webp','logo-bay-computer-lab.webp','logo-bay-app.webp',
    'project-bay-excuse-x.webp','project-learnlab.webp','project-awh.webp','project-school.webp',
    'project-computer-lab.webp','project-parent-connect.webp','project-kruart-online.webp','project-kruart-workspace.webp',
    'news-school-activity.webp','news-learning.webp','news-pride.webp','today-community.webp',
    'awh-home-hero.webp','owner-control.webp','system-infrastructure.webp','system-hosting.webp','system-control-panel.webp',
  ];
  for (const asset of vaultAssets) {
    assert.ok(releaseContract.required.includes(asset), 'vault artwork is not release-contracted: '+asset);
    assert.ok(releaseContract.sourceCopies.some(([,destination]) => destination === asset), 'vault artwork is not copied by canonical build contract: '+asset);
    assert.ok(sw.includes(asset), 'vault artwork is not cached by release-aware PWA shell: '+asset);
  }
  const publicHome = html.match(/<section id="public-home-view"[\s\S]*?<section id="sign-in-view"/)?.[0] || '';
  assert.doesNotMatch(publicHome, /kruart-learnlab-mascot\.svg|bay-golden-mascot\.svg/);
  assert.match(html, /kruart-brand-logo[^>]*brand-kruart-workspace\.webp/);
  assert.match(html, /kruart-login-avatar[^>]*><img[^>]*src="\.\/account-avatar\.webp/);
  assert.match(html, /kruart-signin-logo[^>]*brand-kruart-workspace\.webp/);
  assert.match(publicHome, /today-community\.webp/);
  assert.match(css, /KRUART generated final artwork authority/);
  assert.match(css, /kruart-main-hero[^\n]*kruart-hero-final\.webp/);
  for (const role of ['student','teacher','parent','staff']) assert.match(css, new RegExp('kruart-role-card\\.'+role+'[\\s\\S]{0,180}kruart-role-'+role+'-final\\.webp'));
  assert.match(css, /kruart-footer-banner[\s\S]{0,520}kruart-footer-final\.webp/);
  assert.match(pwaManifest, /"name": "KRUART · Art’s Workspace Hub"/);
  assert.match(pwaManifest, /kruart-app-icon-512\.png/);
  assert.match(css, /Approved-reference calibration — 1536×864 desktop frame/);
  assert.match(css, /body\.public-home-active \.awh-mobile-nav\{display:none!important\}/);
  assert.match(html, /https:\/\/school\.kruart\.online\/news\//);
  assert.match(html, /https:\/\/school\.kruart\.online\/parent\//);
  for (const quickLogo of ['brand-awh.webp','logo-bay-learnlab.webp','logo-bay-excuse-x.webp','logo-bay-app.webp']) assert.ok(html.includes(quickLogo), quickLogo+' missing from owner quick access');
  assert.doesNotMatch(html, /banauedyai\.ac\.th\/mainpage/);
  assert.match(finalCss, /Public mobile accessibility closure/);
  assert.match(finalCss, /body\.public-home-active \.kruart-shortcut small\{font-size:11\.5px!important/);
  assert.match(finalCss, /body\.public-home-active \.kruart-role-copy>b\{font-size:12px!important/);
});
