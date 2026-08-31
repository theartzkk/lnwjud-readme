import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
const root=new URL('../',import.meta.url);
const read=(p:string)=>readFile(new URL(p,root),'utf8');

test('AWH presentation overlays are removed from the canonical web build',async()=>{
 const [build,dashboard,styles]=await Promise.all([read('scripts/build-web-preview.ts'),read('web/dashboard.js'),read('web/styles.css')]);
 for(const file of ['web/experience-v2.css','web/experience-v2.js','web/experience-v3.css','web/experience-v3.js','web/final-home-polish.css','web/final-home-polish.js']) await assert.rejects(access(new URL(file,root)));
 assert.doesNotMatch(build,/experience-v[23]|final-home-polish|AWH Experience V[23]|Final Home V1/);
 assert.match(dashboard,/mountMobileNavigation/);
 assert.doesNotMatch(dashboard,/mountWelcome/);
 assert.match(dashboard,/วันนี้อยากให้ช่วยอะไร\?/);
 assert.match(dashboard,/make\('✦', 'แชท', 'work'/);
 assert.match(styles,/Canonical Work surface/);
});
