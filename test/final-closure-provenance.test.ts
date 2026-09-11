import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
const run = promisify(execFile);
const root = process.cwd();
const adapter = await import('../web/control-plane-adapter.js');
const endpoint = 'https://kruart.great-site.net/remote-update.php';
const relay = {command:'STATUS'};
const response = (body: unknown, status=200) => async () => new Response(typeof body==='string'?body:JSON.stringify(body), {status});

test('BAY transport, auth, challenge and explicit bridge absence remain distinct', async () => {
  const cases: Array<[any,string]> = [
    [async()=>{throw new TypeError('Failed to fetch')},'BAY_TRANSPORT_UNAVAILABLE'],
    [response('forbidden',403),'BAY_AUTH_REJECTED'],
    [response('<html>challenge</html>'),'BAY_RESPONSE_INVALID'],
    [response('not found',404),'BAY_RESPONSE_INVALID'],
    [response({ok:false,code:'REMOTE_UPDATE_REJECTED'},400),'BAY_COMMAND_REJECTED'],
    [response({schemaVersion:1,ok:false,authority:'BAY PackageManager/Update Center',code:'BRIDGE_NOT_INSTALLED'},404),'BAY_BRIDGE_NOT_INSTALLED'],
    [response({schemaVersion:1,ok:true}),'BAY_RESPONSE_INVALID'],
  ];
  for(const [fetchImpl,code] of cases) await assert.rejects(adapter.relayBayRemoteCommand(endpoint,relay,fetchImpl),{code});
  await assert.rejects(adapter.relayBayRemoteCommand(endpoint,{command:'INSTALL'},async()=>{throw new TypeError('connection lost after dispatch')}),{code:'BAY_INSTALL_OUTCOME_UNKNOWN'});
  const truth={schemaVersion:1,ok:true,authority:'BAY PackageManager/Update Center',currentVersion:'2.0.0-RC5.4.26',packages:[],preflight:{ready:true}};
  assert.deepEqual(await adapter.relayBayRemoteCommand(endpoint,relay,response(truth)),truth);
  const panel=await readFile('web/panel.js','utf8');
  assert.doesNotMatch(panel,/RC5\.4\.9|ล่าสุดแล้ว|Production พร้อมใช้/);
  assert.match(panel,/bayPendingRelease/);
  assert.match(panel,/bayVerifiedRelease/);
  assert.match(panel,/BAY_INSTALL_OUTCOME_UNKNOWN/);
  assert.match(panel,/ห้ามส่ง INSTALL ซ้ำ/);
});

test('built source and package lineage fail closed before pointer activation', async () => {
  const output=await mkdtemp(join(tmpdir(),'awh-lineage-'));
  const releaseId='m20-source-contract', sourceSha='a'.repeat(40);
  try {
    await run(process.execPath,['--import','tsx','scripts/build-web-preview.ts','--control'],{env:{...process.env,AWH_WEB_OUTPUT_DIR:output,AWH_WEB_RELEASE_ID:releaseId}});
    const configPath=join(output,'web-config.json');
    const originalConfig=JSON.parse(await readFile(configPath,'utf8'));
    assert.match(originalConfig.sourceSha,/^[0-9a-f]{40}$/);
    const config={...originalConfig,sourceSha,sourceState:'COMMITTED'};
    await writeFile(configPath,JSON.stringify(config));
    await run(process.execPath,['scripts/create-web-release-manifest.mjs',output]);
    const args=['deploy/awh-control-plane/verify-web-release.php',output,releaseId,sourceSha];
    assert.match((await run('php',args)).stdout,/WEB_RELEASE_MANIFEST=PASS/);
    await assert.rejects(run('php',[...args.slice(0,3),'b'.repeat(40)]),/WEB_RELEASE_SOURCE_MISMATCH/);
    const manifestPath=join(output,'release.json'), manifest=JSON.parse(await readFile(manifestPath,'utf8'));
    await writeFile(manifestPath,JSON.stringify({...manifest,sourceState:'DIRTY'}));
    await assert.rejects(run('php',args),/WEB_RELEASE_SOURCE_MISMATCH/);
    await mkdir(join(output,'downloads'));
    const bytes=Buffer.from('test archive fixture');
    await writeFile(join(output,'downloads/AWH-macOS-x64.zip'),bytes);
    await assert.rejects(run(process.execPath,['scripts/create-web-release-manifest.mjs',output]),/provenance is missing/);
    const evidence={kind:'AWH_DESKTOP_RELEASE_EVIDENCE',authority:'CI_PACKAGE_EVIDENCE_ONLY',sourceSha,packageVerification:'VERIFIED',packageSha256:createHash('sha256').update(bytes).digest('hex'),sizeBytes:bytes.length,downloadKey:'AWH-macOS-x64.zip',productVersion:'1.0.0-rc.1'};
    await writeFile(join(output,'downloads/AWH-macOS-x64.release.json'),JSON.stringify(evidence));
    await run(process.execPath,['scripts/create-web-release-manifest.mjs',output]);
    assert.equal(JSON.parse(await readFile(manifestPath,'utf8')).desktopReleases[0].sourceSha,sourceSha);
    await writeFile(join(output,'downloads/AWH-macOS-x64.zip'),'tamper');
    await assert.rejects(run(process.execPath,['scripts/create-web-release-manifest.mjs',output]),/provenance is invalid/);
  } finally { await rm(output,{recursive:true,force:true}); }
});

test('legacy m20c labels cannot become control source identity and web-only mutation is retired',async()=>{
  const output=await mkdtemp(join(tmpdir(),'awh-runtime-lineage-'));
  try {
    const path=join(output,'release.json');
    const php=`require $argv[1]; echo json_encode(HubInfrastructureService::manifestSource($argv[2], 'm20c'));`;
    await writeFile(path,JSON.stringify({schemaVersion:1,releaseId:'m20c'}));
    assert.equal((await run('php',['-r',php,join(root,'hub/src/HubInfrastructureService.php'),path])).stdout,'null');
    await writeFile(path,JSON.stringify({schemaVersion:1,releaseId:'m20c',sourceSha:'a'.repeat(40),sourceState:'COMMITTED'}));
    assert.equal(JSON.parse((await run('php',['-r',php,join(root,'hub/src/HubInfrastructureService.php'),path])).stdout),'a'.repeat(40));
    await assert.rejects(run('sh',['deploy/awh-web/deploy-preview.sh','--deploy']),/web-only activation is retired/);
  }finally{await rm(output,{recursive:true,force:true});}
});
