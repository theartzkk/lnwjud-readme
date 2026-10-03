import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const ROOT=process.cwd();

test("mobile AWH command composer avoids iOS focus zoom and horizontal overflow",async()=>{
  const [css,index]=await Promise.all([
    readFile(join(ROOT,"web/kruart-system.css"),"utf8"),
    readFile(join(ROOT,"web/index.html"),"utf8"),
  ]);
  assert.match(index,/name="viewport" content="width=device-width, initial-scale=1\.0, viewport-fit=cover"/);
  assert.doesNotMatch(index,/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i);
  assert.match(css,/\.owner-command-form input\{[^}]*font-size:16px!important[^}]*line-height:1\.4!important/s);
  assert.match(css,/@media\(max-width:760px\)\{[\s\S]*?\.owner-command-form\{[^}]*grid-template-columns:minmax\(0,1fr\) 58px!important[^}]*max-width:100%!important/s);
  assert.match(css,/\.owner-command-form input\{[^}]*min-height:48px!important[^}]*font-size:16px!important/s);
  assert.match(css,/\.owner-command-form button\{[^}]*width:58px!important[^}]*min-height:48px!important/s);
  assert.match(css,/#goal-input\{font-size:16px!important/);
});

test("owner command handoff preserves the prompt until the work composer accepts it",async()=>{
  const app=await readFile(join(ROOT,"web/app.js"),"utf8");
  assert.match(app,/async function routeOwnerCommand\(value\)/);
  assert.match(app,/input\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app,/ข้อความยังอยู่ กรุณากดส่งอีกครั้งเมื่อ AWH พร้อม/);
  assert.match(app,/กำลังส่งคำสั่งก่อนหน้า ข้อความใหม่นี้ยังอยู่/);
  assert.match(app,/form\.requestSubmit\(\);\n\s*return true;/);
  assert.match(app,/const handedOff = await routeOwnerCommand\(value\);/);
  assert.match(app,/if \(handedOff && field\) field\.value = ['"]{2};/);
  assert.doesNotMatch(app,/if\s*\(field\)\s*field\.value\s*=\s*['"]{2};\s*void\s+routeOwnerCommand\(value\)/);
});

test("owner command submit is single-flight and exposes busy state on the Send control",async()=>{
  const app=await readFile(join(ROOT,"web/app.js"),"utf8");
  assert.match(app,/let ownerCommandRouting = false;/);
  assert.match(app,/if \(ownerCommandRouting\) return;/);
  assert.match(app,/button\.disabled = true; button\.setAttribute\(['"]aria-busy['"], ['"]true['"]\)/);
  assert.match(app,/button\.disabled = false; button\.removeAttribute\(['"]aria-busy['"]\)/);
});
