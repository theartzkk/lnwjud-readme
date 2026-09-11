import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(p:string)=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('AWH final experience has one Morning Brief and progressive technical disclosure', async()=>{
  const [html,js,css,index]=await Promise.all([
    read('web/infrastructure.html'),
    read('web/infrastructure.js'),
    read('web/infrastructure.css'),
    read('web/index.html'),
  ]);
  assert.equal((html.match(/MORNING BRIEF/g)||[]).length,1);
  assert.doesNotMatch(html,/id="morning-list"/);
  assert.doesNotMatch(js,/function renderMorning\(data\)/);
  assert.match(js,/renderMorningBrief\(data\)/);
  assert.match(html,/class="infra-advanced"/);
  assert.match(css,/Final owner-first density closure/);
  assert.match(index,/owner-system-directory-link[^>]*>ระบบและบริการ</);
  assert.match(index,/<strong>ระบบและบริการ<\/strong>/);
  assert.doesNotMatch(index,/registration-type[^]*?<option value="PARENT">/);
  assert.doesNotMatch(index,/registration-type[^]*?<option value="STUDENT">/);
});
