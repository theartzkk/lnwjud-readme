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
 assert.doesNotMatch(index,/Channel และ SHA-256|Source of Truth ของตัวเอง|AI WORKSPACE/);
 assert.match(index,/โปรแกรมสำหรับ Windows และ macOS พร้อมติดตั้ง/);
 assert.match(index,/พื้นที่ทำงาน/);
 assert.match(dashboard,/openWork\(command\.value, false\)/);
 assert.match(dashboard,/\$\('attachment-open'\)\?\.click\(\)/);
 assert.match(css,/awh-command-attach/);
 assert.match(index,/Infrastructure/); assert.doesNotMatch(`${dashboard}\n${css}`,/awh-experience-v[23]|final-home-polish/);
});


test('KRUART Golden Home ships the approved generated human artwork family and app branding', async () => {
  const [html, css, build, releaseManifest, sw, pwaManifest] = await Promise.all([
    read('web/index.html'),
    read('web/awh-light-system.css'),
    read('scripts/build-web-preview.ts'),
    read('scripts/create-web-release-manifest.mjs'),
    read('web/sw.js'),
    read('web/manifest.webmanifest'),
  ]);
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
  for (const asset of finalAssets) {
    assert.ok(build.includes(asset), `final artwork is not copied by web build: ${asset}`);
    assert.ok(releaseManifest.includes(asset), `final artwork is not release-manifested: ${asset}`);
    assert.ok(sw.includes(asset), `final artwork is not cached by release-aware PWA shell: ${asset}`);
  }
  const publicHome = html.match(/<section id="public-home-view"[\s\S]*?<section id="sign-in-view"/)?.[0] || '';
  assert.doesNotMatch(publicHome, /kruart-learnlab-mascot\.svg|bay-golden-mascot\.svg/);
  assert.match(html, /kruart-brand-icon[^>]*logo-256x256\.png/);
  assert.match(html, /kruart-login-avatar[^>]*><img src="\.\/kruart-role-staff-final\.webp/);
  assert.match(html, /kruart-signin-logo[^>]*kruart-logo-final\.webp/);
  assert.match(publicHome, /kruart-role-student-final\.webp/);
  assert.match(css, /KRUART generated final artwork authority/);
  assert.match(css, /kruart-main-hero[^\n]*kruart-hero-final\.webp/);
  for (const role of ['student','teacher','parent','staff']) assert.match(css, new RegExp(`kruart-role-card\\.${role}[\\s\\S]{0,180}kruart-role-${role}-final\\.webp`));
  assert.match(css, /kruart-footer-banner[\s\S]{0,520}kruart-footer-final\.webp/);
  assert.match(pwaManifest, /"name": "KRUART · Art’s Workspace Hub"/);
  assert.match(pwaManifest, /kruart-app-icon-512\.png/);
  assert.match(css, /Approved-reference calibration — 1536×864 desktop frame/);
  assert.match(css, /body\.public-home-active \.awh-mobile-nav\{display:none!important\}/);
});
