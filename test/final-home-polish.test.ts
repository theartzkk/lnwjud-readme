import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read=(p:string)=>readFile(new URL(`../${p}`,import.meta.url),'utf8');
test('final home keeps AI command and continuity first while moving complexity down',async()=>{
 const [js,css,build,dashboard]=await Promise.all([read('web/final-home-polish.js'),read('web/final-home-polish.css'),read('scripts/build-web-preview.ts'),read('web/dashboard.js')]);
 assert.match(dashboard,/วันนี้อยากให้ AWH ช่วยอะไร/); assert.match(dashboard,/dashboard-continuity/); assert.match(dashboard,/awh-tool-grid/);
 assert.match(js,/ART’S WORKSPACE HUB/); assert.match(js,/dashboard-attach-shortcut/); for(const label of ['หน้าแรก','งาน','ไฟล์','เพิ่มเติม'])assert.match(js,new RegExp(label));
 assert.match(css,/repeat\(4,minmax\(0,1fr\)\)/); assert.match(css,/awh-owner-center>\.awh-owner-grid\{display:none\}/); assert.match(css,/body:not\(\.product-dashboard-active\) \.awh-mobile-home-nav\{display:none\}/);
 assert.doesNotMatch(js,/fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|Authorization|Bearer\s/);
 assert.match(build,/asset\('final-home-polish\.js'\)/); assert.match(build,/asset\('final-home-polish\.css'\)/); assert.match(build,/Final Home V1/);
});
