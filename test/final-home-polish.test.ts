import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read=(p:string)=>readFile(new URL(`../${p}`,import.meta.url),'utf8');

test('canonical Dashboard owns AWH Home, shortcuts and five-item mobile navigation',async()=>{
 const [dashboard,css,index]=await Promise.all([read('web/dashboard.js'),read('web/dashboard.css'),read('web/index.html')]);
 for(const text of ['ทุกงาน เริ่มจากตรงนี้','Multi Chat','สร้างเอกสาร','จัดการ PDF','สร้าง QR','Workspace ของคุณ','Cloud พร้อมใช้งาน']) assert.ok(dashboard.includes(text),`missing ${text}`);
 for(const label of ['หน้าแรก','AI','แชท','เครื่องมือ','เพิ่มเติม']) assert.match(dashboard,new RegExp(label));
 assert.match(css,/awh-mobile-nav/); assert.match(css,/repeat\(5,minmax\(0,1fr\)\)/);
 assert.match(index,/Infrastructure/); assert.doesNotMatch(`${dashboard}\n${css}`,/awh-experience-v[23]|final-home-polish/);
});
