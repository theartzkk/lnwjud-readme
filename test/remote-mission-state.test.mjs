import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const script=new URL('../scripts/ops/remote-mission-state.mjs',import.meta.url);
function run(root,command,payload){return new Promise((resolve)=>{const p=spawn(process.execPath,[script.pathname,command],{env:{...process.env,AWH_REMOTE_MISSION_ROOT:root},stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>err+=c);p.on('close',code=>resolve({code,out,err}));p.stdin.end(JSON.stringify(payload));});}
const deviceId='a5e185c7-1b52-4852-9776-ca3012f3a6a6';

test('remote mission state persists, heartbeats renew, and finish releases device lease',async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-mission-'));
  try{
    const history=join(root,'history');await mkdir(history,{recursive:true});const stale=join(history,'stale.json');await writeFile(stale,'{}\n');const old=new Date(Date.now()-40*86400000);await utimes(stale,old,old);
    const base={missionId:'vtr-opening-20260918',deviceId,deviceName:'ART-MAC-M5',project:'VTR',objective:'Complete opening',checkpoint:'start',nextStep:'build'};
    let r=await run(root,'start',base);assert.equal(r.code,0);let row=JSON.parse(r.out);assert.equal(row.status,'ACTIVE');assert.equal(row.deviceName,'ART-MAC-M5');
    await assert.rejects(access(stale));
    r=await run(root,'status',{deviceId,missionId:base.missionId});assert.equal(r.code,0);assert.equal(JSON.parse(r.out).leaseActive,true);
    r=await run(root,'heartbeat',{deviceId,missionId:base.missionId,checkpoint:'cover complete',nextStep:'render QC',currentOperation:'saving canonical AEP',stage:{current:3,total:7,label:'Opening polish'},doneSinceLast:['cover depth fixed','committee parallax fixed'],proofOfWork:['AEP mtime advanced to 10:20:31','QC frame opening_003.png created'],lastSaveOrArtifact:'VTR_2_2569_OPENING_MASTER.aep @ 10:20:31',nextSteps:['render QC frame','verify handoff','save canonical AEP'],pid:1234,app:'After Effects'});assert.equal(r.code,0);row=JSON.parse(r.out);assert.equal(row.checkpoint,'cover complete');assert.equal(row.pid,1234);assert.equal(row.heartbeatSequence,1);assert.equal(row.stage.current,3);assert.deepEqual(row.doneSinceLast,['cover depth fixed','committee parallax fixed']);assert.equal(row.proofOfWork.length,2);assert.equal(row.lastSaveOrArtifact,'VTR_2_2569_OPENING_MASTER.aep @ 10:20:31');assert.equal(row.nextSteps.length,3);
    r=await run(root,'heartbeat',{deviceId,missionId:base.missionId,currentOperation:'no proof'});assert.equal(r.code,2);assert.match(r.err,/MISSION_HEARTBEAT_PROOF_REQUIRED/);
    r=await run(root,'start',{...base,missionId:'other-mission'});assert.equal(r.code,2);assert.match(r.err,/MISSION_DEVICE_LEASE_HELD/);
    r=await run(root,'finish',{deviceId,missionId:base.missionId,result:'PASS',checkpoint:'opening complete'});assert.equal(r.code,0);assert.equal(JSON.parse(r.out).status,'COMPLETED');
    r=await run(root,'status',{deviceId,missionId:base.missionId});assert.equal(r.code,2);assert.match(r.err,/MISSION_NOT_FOUND/);
  }finally{await rm(root,{recursive:true,force:true});}
});
