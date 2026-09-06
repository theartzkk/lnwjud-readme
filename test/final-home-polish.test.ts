import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read=(p:string)=>readFile(new URL(`../${p}`,import.meta.url),'utf8');

test('canonical Dashboard is intent-first with a three-item mobile navigation',async()=>{
 const [dashboard,css,index,constitution]=await Promise.all([read('web/dashboard.js'),read('web/dashboard.css'),read('web/index.html'),read('docs/AWH-UX-CONSTITUTION.md')]);
 for(const text of ['วันนี้อยากให้ช่วยอะไร?','พิมพ์สิ่งที่อยากให้ช่วย…','สร้างเอกสาร','จัดการ PDF','สร้าง QR','งานของฉัน','เครื่องมือ']) assert.ok(dashboard.includes(text),`missing ${text}`);
 const mobileNav=dashboard.match(/function mountMobileNavigation\(\)[\s\S]*?document\.body\.append\(nav\);/)?.[0]||'';
 for(const label of ['แชท','งานของฉัน','เครื่องมือ']) assert.match(mobileNav,new RegExp(label));
 for(const duplicate of ["'หน้าแรก'","'ไฟล์'"]) assert.doesNotMatch(mobileNav,new RegExp(duplicate));
 assert.match(constitution,/at most three primary destinations/);
 for(const leaked of ['งาน/AI','Cloud พร้อมใช้งาน','ทุกงาน เริ่มจากตรงนี้']) assert.doesNotMatch(dashboard,new RegExp(leaked));
 assert.match(css,/awh-mobile-nav/); assert.match(css,/repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(dashboard,/dashboard-attachment-open/);
 assert.match(dashboard,/แนบไฟล์หรือรูปภาพ/);
 assert.match(dashboard,/openWork\(command\.value, false\)/);
 assert.match(dashboard,/\$\('attachment-open'\)\?\.click\(\)/);
 assert.match(css,/awh-command-attach/);
 assert.match(index,/Infrastructure/); assert.doesNotMatch(`${dashboard}\n${css}`,/awh-experience-v[23]|final-home-polish/);
});

test('Work chat keeps failures human-readable and restores unsent drafts',async()=>{
 const app=await read('web/app.js');
 for(const text of ['humanizeWorkError','เชื่อมต่อไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง','ส่งแล้ว · AWH กำลังทำงานให้','ส่งไม่สำเร็จ ข้อความยังอยู่ กดส่งอีกครั้งได้','ระบบพร้อมใช้งาน','AI พร้อม','ใช้ข้อมูลล่าสุดที่บันทึกไว้']) assert.ok(app.includes(text),`missing ${text}`);
 for(const technical of ['AWH Server · Online','AI · Ready','AI · Connected','ใช้ checkpoint ล่าสุดบน AWH','มีงานที่ยัง sync ไม่ครบ',"title || 'Work'",'>Work<','รีเฟรช Work']) assert.ok(!app.includes(technical),`Work UX leaked technical copy: ${technical}`);
 assert.match(app,/message\('goal-message', 'กำลังส่ง…'\)/);
 assert.match(app,/\$\('goal-submit'\)\.disabled = true; \$\('attachment-open'\)\.disabled = true;/);
 assert.match(app,/const localIds = new Set\(\[localMessageId, `local-progress-\$\{idempotencyKey\}`\]\)/);
 assert.match(app,/\$\('goal-input'\)\.value = goal; resizeGoalInput\(\); renderPendingAttachments\(\)/);
 assert.doesNotMatch(app,/message\('goal-message', error instanceof Error \? error\.message : 'ส่งงานไม่สำเร็จ'\)/);
 assert.match(app,/createConversation\(project\.projectId, 'แชทใหม่'\)/);
 const index=await read('web/index.html'); assert.match(index,/selected-conversation-name">แชท<\/span>/); assert.doesNotMatch(index,/>Work<|รีเฟรช Work/);
});
