import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read=(p:string)=>readFile(new URL(`../${p}`,import.meta.url),'utf8');

test('canonical Work markup and renderer own the mobile chat experience',async()=>{
 const [html,css,app,desktopHtml,desktopCss,desktopJs]=await Promise.all([read('web/index.html'),read('web/styles.css'),read('web/app.js'),read('desktop/index.html'),read('desktop/styles.css'),read('desktop/renderer.js')]);
 assert.match(html,/id="dashboard-home-button" class="workspace-home"/);
 assert.match(css,/assistant-turn::before/); assert.match(css,/Canonical Work surface/);
 assert.match(app,/visibleMessages/); assert.match(app,/state === 'CANCELLED'/);
 assert.match(desktopHtml,/section-overview" class="section active/); assert.doesNotMatch(desktopHtml,/section-autopilot" class="section active/);
 assert.match(desktopCss,/Canonical Work surface/); assert.match(desktopJs,/showSection\('overview'\)/);
});
