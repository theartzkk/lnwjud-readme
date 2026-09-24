import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const script=new URL('../scripts/ops/remote-mission-state.mjs',import.meta.url);

function run(root,command,payload){
  return new Promise((resolve)=>{
    const p=spawn(process.execPath,[script.pathname,command],{
      env:{...process.env,AWH_REMOTE_MISSION_ROOT:root},
      stdio:['pipe','pipe','pipe']
    });
    let out='',err='';
    p.stdout.on('data',(c)=>out+=c);
    p.stderr.on('data',(c)=>err+=c);
    p.on('close',(code)=>resolve({code,out,err}));
    p.stdin.end(JSON.stringify(payload));
  });
}

test('remote mission state allows parallel missions per device while preserving resource leases',async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-mission-'));
  try{
    const deviceId='11111111-1111-4111-8111-111111111111';
    const base={deviceId,deviceName:'VPS',project:'fixture',objective:'bounded work',mutationMode:'MUTATE',ownerKey:null};
    let r=await run(root,'start',{...base,missionId:'mission-a',resourceKey:'project:fixture:source'});
    assert.equal(r.code,0,r.err);assert.equal(JSON.parse(r.out).status,'ACTIVE');assert.equal(JSON.parse(r.out).authorityClass,'DEVICE_TRANSPORT_LEASE');
    r=await run(root,'start',{...base,missionId:'mission-b',resourceKey:'project:fixture:web'});
    assert.equal(r.code,0,r.err);assert.equal(JSON.parse(r.out).status,'ACTIVE');

    r=await run(root,'status',{deviceId});
    assert.equal(r.code,0,r.err);
    const status=JSON.parse(r.out);assert.equal(status.parallelMissionsAllowed,true);assert.equal(status.count,2);

    r=await run(root,'start',{...base,missionId:'mission-c',resourceKey:'project:fixture:source'});
    assert.equal(r.code,2);assert.match(r.err,/MISSION_RESOURCE_LEASE_HELD/);

    r=await run(root,'heartbeat',{deviceId,missionId:'mission-a',currentOperation:'working'});
    assert.equal(r.code,0,r.err);assert.equal(JSON.parse(r.out).status,'ACTIVE');
    r=await run(root,'finish',{deviceId,missionId:'mission-a',result:'PASS'});
    assert.equal(r.code,0,r.err);assert.equal(JSON.parse(r.out).status,'COMPLETED');

    r=await run(root,'start',{...base,missionId:'mission-c',resourceKey:'project:fixture:source'});
    assert.equal(r.code,0,r.err);
    for(const missionId of ['mission-b','mission-c']){
      r=await run(root,'finish',{deviceId,missionId,result:'PASS'});
      assert.equal(r.code,0,r.err);
    }
  }finally{await rm(root,{recursive:true,force:true});}
});

test('simultaneous mission starts serialize only the same resource atomically',async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-mission-race-'));
  try{
    const deviceId='22222222-2222-4222-8222-222222222222';
    const base={deviceId,deviceName:'VPS',project:'fixture',objective:'race proof',mutationMode:'MUTATE',resourceKey:'project:fixture:canonical-source',ownerKey:null};
    const results=await Promise.all([
      run(root,'start',{...base,missionId:'race-a'}),
      run(root,'start',{...base,missionId:'race-b'})
    ]);
    assert.deepEqual(results.map((item)=>item.code).sort((a,b)=>a-b),[0,2]);
    const winner=results.find((item)=>item.code===0),loser=results.find((item)=>item.code===2);
    assert.ok(winner);assert.ok(loser);assert.match(loser.err,/MISSION_RESOURCE_LEASE_HELD/);
    const missionId=JSON.parse(winner.out).missionId;
    const done=await run(root,'finish',{deviceId,missionId,result:'PASS'});
    assert.equal(done.code,0,done.err);
  }finally{await rm(root,{recursive:true,force:true});}
});
