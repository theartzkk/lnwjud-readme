import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyReport, viewports } from '../scripts/qa/visual-evidence-gate.mjs';

const SHA = 'a'.repeat(40);
function png(width) {
  const bytes = Buffer.alloc(1100);
  Buffer.from('89504e470d0a1a0a','hex').copy(bytes,0);
  bytes.writeUInt32BE(13,8);
  bytes.write('IHDR',12);
  bytes.writeUInt32BE(width,16);
  bytes.writeUInt32BE(1300,20);
  return bytes.toString('base64');
}
function report() {
  const specs = [];
  for (const viewport of viewports) {
    const width = Number(viewport.split('-')[1]);
    specs.push({
      title:'Control Panel: responsive layout, mobile navigation and visual evidence',
      tests:[{projectName:viewport,status:'expected',results:[{status:'passed',attachments:[
        {name:'owner-panel-render.png',body:png(width)},
        {name:'owner-panel-metrics.json',body:Buffer.from(JSON.stringify({
          viewport,metrics:{clientWidth:width,documentWidth:width,csp:[]},exceptions:[],csp:[]
        })).toString('base64')}
      ]}]}]
    });
    specs.push({
      title:'Control Panel: accessibility audit on current responsive viewport',
      tests:[{projectName:viewport,status:'expected',results:[{status:'passed',attachments:[
        {name:'accessibility-findings.json',body:Buffer.from('[]').toString('base64')}
      ]}]}]
    });
  }
  return {config:{metadata:{revision:SHA}},stats:{unexpected:0,flaky:0,skipped:0},suites:[{specs}]};
}
test('all five responsive and axe results require real attachment evidence', async () => {
  const result = await verifyReport(report(),SHA);
  assert.equal(result.verdict,'PASS');
  assert.equal(result.checks.length,10);
  assert.equal(result.viewportCount,5);
});
test('partial single-viewport QA cannot release', async () => {
  const partial=report(); partial.suites[0].specs=partial.suites[0].specs.slice(0,2);
  await assert.rejects(verifyReport(partial,SHA),/missing or extra viewport tests/);
});
test('wrong revision, skipped test, missing image and CSP error fail closed', async () => {
  const a=report();a.config.metadata.revision='b'.repeat(40);
  await assert.rejects(verifyReport(a,SHA),/not attested/);
  const b=report();b.suites[0].specs[0].tests[0].results[0].status='skipped';
  await assert.rejects(verifyReport(b,SHA),/did not pass cleanly/);
  const c=report();c.suites[0].specs[0].tests[0].results[0].attachments.shift();
  await assert.rejects(verifyReport(c,SHA),/missing attachment/);
  const d=report();const a0=d.suites[0].specs[0].tests[0].results[0].attachments[1];
  a0.body=Buffer.from(JSON.stringify({viewport:'iphone-390',metrics:{clientWidth:390,documentWidth:395,csp:[]},exceptions:[],csp:[]})).toString('base64');
  await assert.rejects(verifyReport(d,SHA),/horizontal overflow/);
});
test('unknown screenshot viewport and accessibility violations fail closed', async () => {
  const a=report(); a.suites[0].specs[0].tests[0].results[0].attachments[0].body=png(820);
  await assert.rejects(verifyReport(a,SHA),/screenshot width/);
  const b=report();b.suites[0].specs[1].tests[0].results[0].attachments[0].body=Buffer.from('[{"id":"color-contrast"}]').toString('base64');
  await assert.rejects(verifyReport(b,SHA),/axe violations/);
});
