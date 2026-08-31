import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read=(p:string)=>readFile(new URL(`../${p}`,import.meta.url),'utf8');

test('canonical Dashboard is intent-first with a three-item mobile navigation',async()=>{
 const [dashboard,css,index]=await Promise.all([read('web/dashboard.js'),read('web/dashboard.css'),read('web/index.html')]);
 for(const text of ['วันนี้อยากให้ช่วยอะไร?','พิมพ์สิ่งที่อยากให้ช่วย…','สร้างเอกสาร','จัดการ PDF','สร้าง QR','งานของฉัน','เครื่องมือ']) assert.ok(dashboard.includes(text),`missing ${text}`);
 for(const label of ['แชท','งานของฉัน','เครื่องมือ']) assert.match(dashboard,new RegExp(label));
 for(const leaked of ['งาน/AI','Cloud พร้อมใช้งาน','ทุกงาน เริ่มจากตรงนี้']) assert.doesNotMatch(dashboard,new RegExp(leaked));
 assert.match(css,/awh-mobile-nav/); assert.match(css,/repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(index,/Infrastructure/); assert.doesNotMatch(`${dashboard}\n${css}`,/awh-experience-v[23]|final-home-polish/);
});
