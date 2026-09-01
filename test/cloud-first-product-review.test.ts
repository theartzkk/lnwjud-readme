import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const ROOT = process.cwd();
function run(command:string,args:string[],env:NodeJS.ProcessEnv={}) { return new Promise<void>((resolve,reject)=>{ const child=spawn(command,args,{cwd:ROOT,shell:false,env:{...process.env,...env},stdio:['ignore','ignore','pipe']}); let stderr=''; child.stderr.on('data',c=>stderr+=String(c)); child.once('error',reject); child.once('close',code=>code===0?resolve():reject(new Error(stderr||`exit ${code}`))); }); }

test('Cloud-first Product Review is emitted by canonical build and deploy bundle', async()=>{
  const output=await mkdtemp(join(tmpdir(),'awh-cloud-review-'));
  try {
    await run(process.execPath,['--import','tsx','scripts/build-web-preview.ts','--control'],{AWH_WEB_OUTPUT_DIR:output,AWH_WEB_RELEASE_ID:'cloud-review-fixture',AWH_PREVIEW_GENERATED_AT:'2026-09-01T00:00:00Z'});
    await run(process.execPath,['scripts/create-web-release-manifest.mjs',output],{AWH_RELEASE_ID:'cloud-review-fixture'});
    const [html,index,js,css,adapter,owner,sw,manifest,deploy,cloudService,fixture,ci,qaWorkflow,reviewWorkflow]=await Promise.all([
      readFile(join(output,'review.html'),'utf8'),readFile(join(output,'index.html'),'utf8'),readFile(join(output,'review.js'),'utf8'),readFile(join(output,'review.css'),'utf8'),readFile(join(output,'control-plane-adapter.js'),'utf8'),readFile(join(output,'dashboard.js'),'utf8'),readFile(join(output,'sw.js'),'utf8'),readFile(join(output,'release.json'),'utf8'),readFile(join(ROOT,'deploy/awh-control-plane/deploy-control-plane.sh'),'utf8'),readFile(join(ROOT,'hub/src/HubCloudWorkflowService.php'),'utf8'),readFile(join(ROOT,'scripts/qa/control-web-fixture.mjs'),'utf8'),readFile(join(ROOT,'.github/workflows/ci.yml'),'utf8'),readFile(join(ROOT,'.github/workflows/awh-cloud-qa.yml'),'utf8'),readFile(join(ROOT,'.github/workflows/awh-cloud-review.yml'),'utf8')]);
    assert.match(html,/Product Review/); assert.match(html,/data-awh-back/); assert.match(html,/href="\.\/\?awh-surface=files"/); assert.match(html,/data-awh-surface-link="files"/); assert.match(css,/@media\(max-width:(?:660|760)px\)/); assert.match(css,/\.review-back\{min-height:44px/); assert.match(css,/\.review-ghost\{min-height:44px/); assert.match(css,/\.review-stop\{min-height:44px/);
    assert.match(index,/id="session-check-view"/); assert.match(index,/id="sign-in-view"[\s\S]*?hidden/); assert.match(owner,/requestedDeepLinkSurface/); assert.match(owner,/awh-surface/); assert.match(owner,/consumeDeepLinkSurface/);
    assert.match(js,/loadCloudRevision/); assert.match(js,/submitCloudTask/); assert.match(js,/cancelTask/); assert.match(js,/stepUp/); assert.match(js,/updateCloudCredential/);
    assert.doesNotMatch(`${html}\n${js}`,/localStorage|sessionStorage|Authorization|Bearer\s/);
    assert.match(cloudService,/storeQaArtifact/); assert.match(cloudService,/cloud-qa-evidence/); assert.match(cloudService,/AWH-CLOUD-QA-/);
    assert.match(cloudService,/CURLOPT_UNRESTRICTED_AUTH'\)\) \$options\[CURLOPT_UNRESTRICTED_AUTH\]=false/); assert.match(cloudService,/CURLOPT_PROTOCOLS/); assert.match(cloudService,/CURLPROTO_HTTPS/); assert.match(cloudService,/CURLOPT_REDIR_PROTOCOLS/);
    assert.match(adapter,/\/api\/v1\/control\/cloud\/revision/); assert.match(adapter,/\/api\/v1\/control\/cloud\/tasks/); assert.match(owner,/Product Review/);
    assert.match(ci,/Verify Cloud artifact import with ZipArchive/); assert.match(ci,/class_exists\(\"ZipArchive\"\)/); assert.match(ci,/php hub\/tests\/m18-cloud-first-control\.php/);
    assert.match(fixture,/AWH_WEB_FIXTURE_ROOT/); assert.match(fixture,/\/api\/v1\/control\/cloud\/revision/); assert.match(fixture,/\/api\/v1\/control\/cloud\/tasks/); assert.match(fixture,/const cancelTaskMatch/); assert.match(fixture,/task\.state = 'CANCELLED'/);
    const workflowSources = `${qaWorkflow}\n${reviewWorkflow}`;
    assert.doesNotMatch(workflowSources,/\n\s{6}(?:secret|token|credential|authorization|password|api_key):/i);
    assert.match(qaWorkflow,/inputs:\s*\n\s{6}revision:[\s\S]*?\n\s{6}execution_id:/);
    assert.doesNotMatch(qaWorkflow,/\n\s{6}review_profile:/);
    assert.match(reviewWorkflow,/inputs:\s*\n\s{6}revision:[\s\S]*?\n\s{6}execution_id:[\s\S]*?\n\s{6}review_profile:/);
    assert.match(qaWorkflow,/test "\$\(git rev-parse HEAD\)" = "\$\{\{ inputs\.revision \}\}"/);
    assert.match(reviewWorkflow,/test "\$\(git rev-parse HEAD\)" = "\$\{\{ inputs\.revision \}\}"/);
    for (const asset of ['review.html','review.css','review.js']) { assert.match(sw,new RegExp(`\\./${asset.replace('.','\\.')}`)); assert.match(manifest,new RegExp(`"path": "${asset.replace('.','\\.')}"`)); assert.ok(deploy.includes(`dist-web/${asset}`)); }
  } finally { await rm(output,{recursive:true,force:true}); }
});
