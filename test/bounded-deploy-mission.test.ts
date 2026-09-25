import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { desktopImpactForFiles, localOperatorInvocation, missionModeFromArgs } from '../scripts/ops/bounded-deploy-mission.mjs';
import { hydrateDesktopReleaseArtifacts, verifyDesktopReleaseArtifacts } from '../scripts/release/hydrate-desktop-release-artifacts.mjs';

test('bounded deploy mission reuses verified desktop artifacts only for server-safe deltas',()=>{
  assert.equal(desktopImpactForFiles(['hub/src/HubControlPlaneService.php','scripts/ops/example.mjs']),false);
  assert.equal(desktopImpactForFiles(['desktop/index.html']),true);
  assert.equal(desktopImpactForFiles(['src/worker-capability-discovery.ts']),false);
  assert.equal(desktopImpactForFiles(['src/config.ts']),true);
  assert.equal(desktopImpactForFiles(['src/control-plane-worker-runtime.ts']),true);
  assert.equal(desktopImpactForFiles(['package-lock.json']),true);
});

test('bounded deploy mission has one explicit owner approval and a deterministic default deploy mode',()=>{
  assert.equal(missionModeFromArgs([]),'--identity-convergence');
  assert.equal(missionModeFromArgs(['--cloud-first']),'--cloud-first');
  assert.throws(()=>missionModeFromArgs(['--cloud-first','--project-source-authority']),/MISSION_MODE_AMBIGUOUS/);
});

test('root core release demotes typed operator calls to the guarded awh-remote identity',()=>{
  assert.deepEqual(localOperatorInvocation('/usr/local/bin/awh-operator',['verification-regressions'],{uid:0}),{
    command:'/usr/sbin/runuser',
    args:['-u','awh-remote','--','/usr/local/bin/awh-operator','verification-regressions'],
    identity:'awh-remote',
  });
  assert.deepEqual(localOperatorInvocation('/usr/local/bin/awh-operator',['verification-regressions'],{uid:987}),{
    command:'/usr/local/bin/awh-operator',
    args:['verification-regressions'],
    identity:'current',
  });
});

test('mission contract preserves QA, rehearsal, backup, drift and public exact-revision proof',async()=>{
  const source=await readFile(new URL('../scripts/ops/bounded-deploy-mission.mjs',import.meta.url),'utf8');
  assert.match(source,/node:child_process/);
  assert.match(source,/ls-remote/);
  assert.match(source,/branch\.main\.remote/);
  assert.doesNotMatch(source,/refs\/heads\/production','refs\/remotes\/vps\/production/);
  assert.match(source,/new URL\('\/api\/v1\/auth\/login',base\)/);
  assert.doesNotMatch(source,/new URL\('\/api\/v1\/control\/auth\/login',base\)/);
  assert.match(source,/state:'BLOCKED',result:'BLOCK'/);
  assert.match(source,/MISSION_REGRESSION_REPLAY=DEEP/);
  assert.match(source,/MISSION_DURABLE_REGISTRY_UNAVAILABLE/);
  assert.match(source,/loadExecutionPolicy/);
  assert.match(source,/qaScriptForBudget/);
  assert.doesNotMatch(source,/budget==='FAST'\?'qa:fast':'qa:local'/);
  assert.match(source,/AWH_OPERATOR_CLIENT.*\/usr\/local\/bin\/awh-operator/);
  assert.match(source,/awh-remote.*\/usr\/local\/bin\/awh-operator/);
  assert.match(source,/for\(let attempt=1;attempt<=3;attempt\+\+\)/);
  const localStart=source.indexOf("if(existsSync(local)){");
  const sshFallback=source.indexOf("const host=await canonicalOperatorHost()",localStart);
  assert.ok(localStart>=0&&sshFallback>localStart&&source.slice(localStart,sshFallback).includes('return null;'),'VPS-local operator failure must fail closed instead of self-SSH fallback');
  for(const marker of ['MISSION_PRIVILEGE_LANE=','MISSION_DEPENDENCIES=HYDRATING','MISSION_DEPENDENCY_HYDRATION_FAILED','verificationPlanForFiles','MISSION_RISK=','MISSION_VERIFICATION_BUDGET=','MISSION_STABILITY=','MISSION_GOLDEN_JOURNEYS=','MISSION_EVIDENCE_CAPSULE=','MISSION_DURABLE_REGISTRY=','MISSION_DURABLE_EVIDENCE=','verification-regressions','verification-store','MISSION_INCIDENT_FINGERPRINT=','--dry-run','--deploy','--approve','DEPLOY_STAGE=BACKUP_VERIFIED','DEPLOY_STAGE=SOURCE_DRIFT_VERIFIED','MISSION_APPROVALS_CONSUMED=1','MISSION_PUBLIC_VERIFY=PASS','AWH_REUSE_REMOTE_DESKTOP_ARTIFACTS']) assert.match(source,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});


test('KRUART Engineering Eval catalog is durable, unique and cross-project',async()=>{
  const catalog=JSON.parse(await readFile(new URL('../config/kruart-engineering-eval.json',import.meta.url),'utf8'));
  assert.equal(catalog.schemaVersion,1); assert.equal(catalog.name,'KRUART Engineering Eval');
  assert.ok(Array.isArray(catalog.scenarios)&&catalog.scenarios.length>=20);
  const ids=catalog.scenarios.map((row)=>row.id); assert.equal(new Set(ids).size,ids.length);
  for(const project of ['AWH','BAY EXCUSE X','BAY LearnLab','School Website']) assert.ok(catalog.scenarios.some((row)=>row.project===project));
  for(const row of catalog.scenarios){assert.match(row.id,/^[a-z0-9-]+$/);assert.ok(['MEDIUM','HIGH','CRITICAL'].includes(row.risk));assert.ok(Array.isArray(row.triggerPatterns)&&row.triggerPatterns.length>0);assert.ok(typeof row.evidence==='string'&&row.evidence.length>12);}
});


test('desktop artifact hydration accepts exact commit or exact tree-equivalent CI packages',async()=>{
  const sourceSha='a'.repeat(40);
  const sourceTreeSha='c'.repeat(40);
  const root=await mkdtemp(join(tmpdir(),'awh-artifact-hydration-'));
  const stagingRoot=join(root,'stage');
  const staged=join(stagingRoot,sourceSha);
  const sourceRoot=join(root,'source');
  await mkdir(staged,{recursive:true}); await mkdir(sourceRoot,{recursive:true});
  const targets=[
    ['AWH-macOS-arm64.zip','darwin','arm64'],
    ['AWH-macOS-x64.zip','darwin','x64'],
    ['AWH-Windows-x64.zip','win32','x64'],
  ];
  const sums=[];
  for(const [file,platform,architecture] of targets){
    const bytes=Buffer.from(`verified-${platform}-${architecture}-${sourceSha}`);
    const hash=createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(staged,file),bytes);
    await writeFile(join(staged,file.replace(/\.zip$/,'.release.json')),JSON.stringify({
      schemaVersion:1,kind:'AWH_DESKTOP_RELEASE_EVIDENCE',authority:'CI_PACKAGE_EVIDENCE_ONLY',productId:'awh',platform,architecture,
      productVersion:'1.0.0-rc.1',sourceSha,sourceTreeSha,packageSha256:hash,sizeBytes:bytes.length,downloadKey:file,packageVerification:'VERIFIED',
      publicationState:'NOT_PUBLISHED',updaterStatus:'FOUNDATION_LOCKED_NOT_ACTIVATED',
    }));
    sums.push(`${hash}  ${file}`);
  }
  await writeFile(join(staged,'SHA256SUMS.txt'),`${sums.join('\n')}\n`);

  const installerFile='AWH-Agent-Beta-macOS-arm64.dmg';
  const installerEvidence='AWH-Agent-Beta-macOS-arm64.installer.json';
  const installerBytes=Buffer.from(`beta-installer-${sourceSha}`);
  const installerHash=createHash('sha256').update(installerBytes).digest('hex');
  await writeFile(join(staged,installerFile),installerBytes);
  await writeFile(join(staged,installerEvidence),JSON.stringify({
    schemaVersion:1,kind:'AWH_DESKTOP_INSTALLER_EVIDENCE',authority:'CI_PACKAGE_EVIDENCE_ONLY',productId:'awh',
    channel:'beta',platform:'darwin',architecture:'arm64',productVersion:'1.0.0-rc.1',sourceSha,
    packageSha256:installerHash,sizeBytes:installerBytes.length,downloadKey:installerFile,packageVerification:'VERIFIED',
    platformTrust:'ADHOC_BETA',notarization:'NOT_NOTARIZED',
  }));

  const stagedProof=await verifyDesktopReleaseArtifacts(staged,sourceSha,sourceTreeSha);
  assert.equal(stagedProof.verified.length,3);
  const hydrated=await hydrateDesktopReleaseArtifacts({sourceRoot,sourceSha,sourceTreeSha,stagingRoot});
  assert.equal(hydrated.verified.length,3);
  assert.equal(hydrated.installers.length,1);
  assert.equal(hydrated.installers[0].file,installerFile);
  assert.equal(await readFile(join(sourceRoot,'dist-web/downloads',installerFile),'utf8'),installerBytes.toString('utf8'));
  assert.equal((await readFile(join(sourceRoot,'dist-web/downloads/SHA256SUMS.txt'),'utf8')).trim(),sums.join('\n'));

  const evidencePath=join(staged,'AWH-macOS-arm64.release.json');
  const evidence=JSON.parse(await readFile(evidencePath,'utf8')); evidence.sourceSha='b'.repeat(40);
  await writeFile(evidencePath,JSON.stringify(evidence));
  const treeEquivalent=await verifyDesktopReleaseArtifacts(staged,sourceSha,sourceTreeSha);
  assert.equal(treeEquivalent.verified.length,3);
  evidence.sourceTreeSha='d'.repeat(40);
  await writeFile(evidencePath,JSON.stringify(evidence));
  await assert.rejects(()=>verifyDesktopReleaseArtifacts(staged,sourceSha,sourceTreeSha),/DESKTOP_ARTIFACT_PROVENANCE_MISMATCH/);
  delete evidence.sourceTreeSha;
  await writeFile(evidencePath,JSON.stringify(evidence));
  await assert.rejects(()=>verifyDesktopReleaseArtifacts(staged,sourceSha,sourceTreeSha),/DESKTOP_ARTIFACT_PROVENANCE_MISMATCH/);
});
