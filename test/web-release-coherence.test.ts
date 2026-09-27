import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
const run=promisify(execFile);
const ROOT=process.cwd();

test('web release is one immutable module graph',async()=>{
  const output=await mkdtemp(join(tmpdir(),'awh-web-coherence-'));
  const releaseId='coherence-fixture';
  try{
    await run(process.execPath,['--import','tsx','scripts/build-web-preview.ts','--control'],{cwd:ROOT,env:{...process.env,AWH_WEB_OUTPUT_DIR:output,AWH_WEB_RELEASE_ID:releaseId,AWH_PREVIEW_GENERATED_AT:'2026-09-27T00:00:00.000Z'}});
    await run(process.execPath,['scripts/create-web-release-manifest.mjs',output],{cwd:ROOT,env:{...process.env,AWH_RELEASE_ID:releaseId,AWH_PREVIEW_GENERATED_AT:'2026-09-27T00:00:00.000Z'}});
    const manifest=JSON.parse(await readFile(join(output,'release.json'),'utf8'));
    assert.match(manifest.webBundleSha256,/^[0-9a-f]{64}$/);
    assert.match((await run('php',['deploy/awh-control-plane/verify-web-release.php',output,releaseId],{cwd:ROOT})).stdout,/WEB_RELEASE_MANIFEST=PASS/);
    const updates=join(output,'updates.js');
    const original=await readFile(updates,'utf8');
    assert.match(original,/control-plane-adapter\.js\?release=coherence-fixture/);
    await writeFile(updates,original.replace('control-plane-adapter.js?release=coherence-fixture','control-plane-adapter.js?release=mixed-release'));
    await run(process.execPath,['scripts/create-web-release-manifest.mjs',output],{cwd:ROOT,env:{...process.env,AWH_RELEASE_ID:releaseId,AWH_PREVIEW_GENERATED_AT:'2026-09-27T00:00:00.000Z'}});
    await assert.rejects(run('php',['deploy/awh-control-plane/verify-web-release.php',output,releaseId],{cwd:ROOT}),/WEB_RELEASE_GRAPH_MISMATCH/);
    const operator=await readFile(join(ROOT,'hub/src/HubCoreReleaseOperator.php'),'utf8');
    assert.match(operator,/AWH_RELEASE_ATTEMPT.*attemptCount>1.*r/);
  }finally{
    await rm(output,{recursive:true,force:true});
  }
});
