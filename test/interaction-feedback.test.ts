import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const pages=['index','panel','hosting','database','infrastructure','updates','trust','review'];

test('every canonical AWH web surface mounts one shared interaction feedback layer',async()=>{
  for(const page of pages){
    const html=await readFile(join(ROOT,'web',`${page}.html`),'utf8');
    assert.match(html,/interaction-feedback\.css\?release=__AWH_WEB_RELEASE_ID__/);
    assert.match(html,/interaction-feedback\.js\?release=__AWH_WEB_RELEASE_ID__/);
  }
});

test('interaction feedback is progressive, bounded and PWA-cached',async()=>{
  const [js,css,sw]=await Promise.all([
    readFile(join(ROOT,'web/interaction-feedback.js'),'utf8'),
    readFile(join(ROOT,'web/interaction-feedback.css'),'utf8'),
    readFile(join(ROOT,'web/sw.js'),'utf8'),
  ]);
  assert.match(js,/setTimeout\(\(\) => \{/);
  assert.match(js,/140\)/);
  assert.match(js,/aria-busy/);
  assert.match(js,/pointerdown/);
  assert.match(js,/ยังทำงานอยู่/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(css,/safe-area-inset-top/);
  assert.match(css,/kruart-ui-progress/);
  assert.match(sw,/\.\/interaction-feedback\.css\?release=__AWH_WEB_RELEASE_ID__/);
  assert.match(sw,/\.\/interaction-feedback\.js\?release=__AWH_WEB_RELEASE_ID__/);
});
