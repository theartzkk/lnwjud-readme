import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read=(p:string)=>readFile(new URL(`../${p}`,import.meta.url),'utf8');

test('Experience V3 makes Work visibly mobile-first without new authority',async()=>{
  const [css,js,build]=await Promise.all([read('web/experience-v3.css'),read('web/experience-v3.js'),read('scripts/build-web-preview.ts')]);
  assert.match(css,/awh-experience-v3/);
  assert.match(css,/assistant-turn::before/);
  assert.match(css,/awh-mobile-home-nav\{display:grid!important/);
  assert.match(css,/composer textarea/);
  assert.match(js,/preferHomeOnEntry/);
  assert.match(js,/collapseCancelledRepeats/);
  assert.match(js,/dashboard-home-button/);
  assert.doesNotMatch(js,/fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|Authorization|Bearer\s/);
  assert.match(build,/asset\('experience-v3\.css'\)/);
  assert.match(build,/asset\('experience-v3\.js'\)/);
  assert.match(build,/AWH Experience V3/);
});
