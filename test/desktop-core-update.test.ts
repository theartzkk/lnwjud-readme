import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  currentApplicationRoot,
  desktopPackagePath,
  effectiveDesktopUpdateChannel,
  prepareDesktopCoreUpdateSwap,
  reconcileDesktopCoreUpdateBackups,
  resolveDesktopCoreUpdateCandidate,
  writeDesktopCoreUpdateHealth,
  type StagedDesktopCoreUpdate,
} from '../src/desktop-core-update.js';

function release(version='1.0.0-rc.2'){
  const path='downloads/AWH-macOS-x64.zip',sha='b'.repeat(64),source='a'.repeat(40);
  return {schemaVersion:1,releaseId:'m-open-beta-fixture',sourceSha:source,sourceState:'COMMITTED',generatedAt:'2026-09-28T16:30:00Z',
    files:[{path,sha256:sha,sizeBytes:1234}],
    desktopReleases:[{path,sourceSha:source,productVersion:version,packageSha256:sha,sizeBytes:1234,packageVerification:'VERIFIED'}]};
}

test('core update resolves exact verified package evidence and preserves preview/stable isolation',()=>{
  const candidate=resolveDesktopCoreUpdateCandidate(release(),'1.0.0-rc.1','darwin','x64','https://kruart.online');
  assert.equal(candidate?.version,'1.0.0-rc.2');
  assert.equal(candidate?.channel,'preview');
  assert.equal(candidate?.packageUrl,'https://kruart.online/downloads/AWH-macOS-x64.zip');
  assert.equal(effectiveDesktopUpdateChannel('1.0.0'),'stable');
  assert.equal(resolveDesktopCoreUpdateCandidate(release('1.0.1-rc.1'),'1.0.0','darwin','x64'),null);
  const reused=release();reused.desktopReleases[0]!.sourceSha='c'.repeat(40);
  assert.equal(resolveDesktopCoreUpdateCandidate(reused,'1.0.0-rc.1','darwin','x64')?.sourceSha,'c'.repeat(40));
  const bad=release();bad.desktopReleases[0]!.packageSha256='d'.repeat(64);
  assert.throws(()=>resolveDesktopCoreUpdateCandidate(bad,'1.0.0-rc.1','darwin','x64'),/PACKAGE_EVIDENCE_INVALID/);
});

test('core update package selection and app-root detection are platform exact',()=>{
  assert.equal(desktopPackagePath('darwin','arm64'),'downloads/AWH-macOS-arm64.zip');
  assert.equal(desktopPackagePath('darwin','x64'),'downloads/AWH-macOS-x64.zip');
  assert.equal(desktopPackagePath('win32','x64'),'downloads/AWH-Windows-x64.zip');
  assert.equal(currentApplicationRoot('darwin','/Applications/AWH Agent.app/Contents/MacOS/AWH Agent'),'/Applications/AWH Agent.app');
  assert.equal(currentApplicationRoot('win32','C:\\Users\\Teacher\\Apps\\AWH Agent\\AWH.exe'),'C:\\Users\\Teacher\\Apps\\AWH Agent');
  assert.throws(()=>desktopPackagePath('linux','x64'),/PLATFORM_UNSUPPORTED/);
});

test('atomic swap preparation copies next release beside current app and emits rollback-capable helper',async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-core-swap-'));
  const current=join(root,'AWH Agent.app'),execPath=join(current,'Contents','MacOS','AWH Agent');
  const stagedRoot=join(root,'stage','AWH Agent.app');
  await mkdir(join(current,'Contents','MacOS'),{recursive:true});await writeFile(execPath,'old');
  await mkdir(join(stagedRoot,'Contents','MacOS'),{recursive:true});await writeFile(join(stagedRoot,'Contents','MacOS','AWH Agent'),'new');
  const staged:StagedDesktopCoreUpdate={schemaVersion:1,channel:'preview',version:'1.0.0-rc.2',sourceSha:'a'.repeat(40),packageSha256:'b'.repeat(64),sizeBytes:1234,packagePath:'downloads/AWH-macOS-x64.zip',packageUrl:'https://kruart.online/downloads/AWH-macOS-x64.zip',releaseId:'fixture',publishedAt:'2026-09-28T16:30:00Z',stageRoot:join(root,'stage'),packageFile:join(root,'stage','package.zip'),extractedAppRoot:stagedRoot};
  const plan=await prepareDesktopCoreUpdateSwap(staged,join(root,'.awh'),'darwin',execPath);
  await access(join(plan.nextRoot,'Contents','MacOS','AWH Agent'));
  const helper=await readFile(plan.helper,'utf8');
  assert.match(helper,/HEALTH_FAILED/);assert.match(helper,/mv "\$PREVIOUS" "\$CURRENT"/);
  assert.equal(plan.previousRoot,current+'.previous');
});

test('mac backup reconciliation retains one rollback and removes stale repair/update copies',async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-core-cleanup-'));
  const current=join(root,'AWH Agent.app'),execPath=join(current,'Contents','MacOS','AWH Agent');
  await mkdir(join(current,'Contents','MacOS'),{recursive:true});await writeFile(execPath,'current');
  const legacyRollback=current+'.awh-prev-d213',legacyNext=current+'.awh-next-old',legacyFailed=current+'.failed-old',legacyRepair=current+'.pre-73428-runtime-repair';
  for(const path of [legacyRollback,legacyNext,legacyFailed,legacyRepair])await mkdir(path,{recursive:true});
  const first=await reconcileDesktopCoreUpdateBackups('darwin',execPath);
  assert.equal(first.previousRoot,current+'.previous');
  await access(current+'.previous');
  await assert.rejects(()=>access(legacyNext));
  await assert.rejects(()=>access(legacyFailed));
  await assert.rejects(()=>access(legacyRepair));
  await assert.rejects(()=>access(legacyRollback));
  const secondRollback=current+'.awh-prev-repeat',secondNext=current+'.awh-next-repeat';
  await mkdir(secondRollback,{recursive:true});await mkdir(secondNext,{recursive:true});
  const second=await reconcileDesktopCoreUpdateBackups('darwin',execPath);
  assert.equal(second.previousRoot,current+'.previous');
  await access(current+'.previous');
  await assert.rejects(()=>access(secondRollback));
  await assert.rejects(()=>access(secondNext));
});

test('core update health marker is constrained to AWH update root',async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-core-health-')),dataDir=join(root,'.awh');
  const marker=join(dataDir,'core-updates','health-fixture.json');
  await writeDesktopCoreUpdateHealth(dataDir,marker,'1.0.0-rc.2');
  assert.match(await readFile(marker,'utf8'),/"ok":true/);
  await assert.rejects(()=>writeDesktopCoreUpdateHealth(dataDir,join(root,'outside.json'),'1.0.0-rc.2'),/HEALTH_PATH_INVALID/);
});
