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


test('KRUART Golden Home uses LearnLab human cartoon art and keeps mascot art out of the primary home', async () => {
  const [html, css, build, manifest, sw] = await Promise.all([
    read('web/index.html'),
    read('web/awh-light-system.css'),
    read('scripts/build-web-preview.ts'),
    read('scripts/create-web-release-manifest.mjs'),
    read('web/sw.js'),
  ]);
  for (const asset of [
    'kruart-human-student-hero.webp',
    'kruart-human-teacher-hero.webp',
    'kruart-human-student-thai.webp',
    'kruart-human-student-english.webp',
    'kruart-human-student-math.webp',
    'kruart-reference-role-parent.webp',
    'kruart-reference-role-staff.webp',
    'kruart-campus-bg.svg',
  ]) {
    assert.ok(html.includes(asset) || css.includes(asset), `human artwork is not used: ${asset}`);
    assert.ok(build.includes(asset), `human artwork is not copied by web build: ${asset}`);
    assert.ok(manifest.includes(asset), `human artwork is not release-manifested: ${asset}`);
    assert.ok(sw.includes(asset), `human artwork is not cached by release-aware PWA shell: ${asset}`);
  }
  const publicHome = html.match(/<section id="public-home-view"[\s\S]*?<section id="sign-in-view"/)?.[0] || '';
  assert.doesNotMatch(publicHome, /kruart-learnlab-mascot\.svg/);
  assert.doesNotMatch(html, /<img[^>]+kruart-learnlab-mascot\.svg/);
  assert.match(html, /kruart-login-avatar[^>]*><img src="\.\/kruart-human-student-thai\.webp"/);
  assert.match(publicHome, /kruart-human-student-english\.webp/);
  assert.match(publicHome, /kruart-human-teacher-hero\.webp/);
  assert.match(css, /kruart-role-card\.parent[^\n]*kruart-reference-role-parent\.webp/);
  assert.match(css, /kruart-role-card\.staff[^\n]*kruart-reference-role-staff\.webp/);
  assert.match(html, /kruart-brand-icon[^>]*src="\.\/bay-icon-learnlab\.svg"/);
  assert.match(css, /kruart-campus-bg\.svg/);
  assert.doesNotMatch(css, /kruart-role-card\.staff[^\n]*kruart-human-student-computer\.webp/);
  assert.match(css, /Human-only hero composition/);
  assert.match(css, /Approved-reference calibration — 1536×864 desktop frame/);
});
