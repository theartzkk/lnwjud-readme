import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read=(p:string)=>readFile(new URL(`../${p}`,import.meta.url),'utf8');

test('Experience V2 is a presentation layer over the canonical dashboard',async()=>{
  const [css,js,build]=await Promise.all([read('web/experience-v2.css'),read('web/experience-v2.js'),read('scripts/build-web-preview.ts')]);
  assert.match(css,/awh-experience-v2/);
  assert.match(css,/grid-template-columns:repeat\(5,1fr\)/);
  assert.match(css,/work-active/);
  for(const label of ['หน้าแรก','AI','แชท','เครื่องมือ','เพิ่มเติม']) assert.match(js,new RegExp(label));
  assert.match(js,/Multi Chat/);
  assert.doesNotMatch(js,/fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|Authorization|Bearer\s/);
  assert.match(build,/asset\('experience-v2\.css'\)/);
  assert.match(build,/asset\('experience-v2\.js'\)/);
  assert.match(build,/AWH Experience V2/);
});
