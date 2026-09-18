import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const script=new URL('../scripts/ops/remote-mission-state.mjs',import.meta.url);
function run(root,command,payload){return new Promise((resolve)=>{const p=spawn(process.execPath,[script.pathname,command],{env:{...process.env,AWH_REMOTE_MISSION_ROOT:root},stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>err+=c);p.on('close',code=>resolve({code,out,err}));p.stdin.end(JSON.stringify(payload));});}
const deviceId='a5e185c7-1b52-4852-9776-ca3012f3a6a6';

test('remote mission state persists, heartbeats renew, and finish releases device lease',async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-mission-'));
  try{
    const base={missionId:'vtr-opening-20260918',deviceId,deviceName:'ART-MAC-M5',project:'VTR',objective:'Complete opening',checkpoint:'start',nextStep:'build'};
    let r=await run(root,'start',base);assert.equal(r.code,0);let row=JSON.parse(r.out);assert.equal(row.status,'ACTIVE');assert.equal(row.deviceName,'ART-MAC-M5');
    r=await run(root,'status',{deviceId,missionId:base.missionId});assert.equal(r.code,0);assert.equal(JSON.parse(r.out).leaseActive,true);
    r=await run(root,'heartbeat',{deviceId,missionId:base.missionId,checkpoint:'cover complete',nextStep:'render QC',pid:1234,app:'After Effects'});assert.equal(r.code,0);row=JSON.parse(r.out);assert.equal(row.checkpoint,'cover complete');assert.equal(row.pid,1234);
    r=await run(root,'start',{...base,missionId:'other-mission'});assert.equal(r.code,2);assert.match(r.err,/MISSION_DEVICE_LEASE_HELD/);
    r=await run(root,'finish',{deviceId,missionId:base.missionId,result:'PASS',checkpoint:'opening complete'});assert.equal(r.code,0);assert.equal(JSON.parse(r.out).status,'COMPLETED');
    r=await run(root,'status',{deviceId,missionId:base.missionId});assert.equal(r.code,2);assert.match(r.err,/MISSION_NOT_FOUND/);
  }finally{await rm(root,{recursive:true,force:true});}
});
