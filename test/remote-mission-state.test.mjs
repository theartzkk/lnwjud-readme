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

test('remote mission state keeps technical lease and single-writer integrity without behavior rituals',async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-mission-'));
  try{
    const deviceId='11111111-1111-4111-8111-111111111111';
    const base={missionId:'mission-a',deviceId,deviceName:'M5',project:'fixture',objective:'bounded work',mutationMode:'MUTATE',resourceKey:'project:fixture',ownerKey:null};
    let r=await run(root,'start',base);
    assert.equal(r.code,0,r.err);
    const started=JSON.parse(r.out);assert.equal(started.status,'ACTIVE');
    r=await run(root,'start',{...base,missionId:'mission-b'});
    assert.equal(r.code,2);assert.match(r.err,/MISSION_DEVICE_LEASE_HELD/);
    r=await run(root,'heartbeat',{deviceId,missionId:'mission-a',currentOperation:'working'});
    assert.equal(r.code,0,r.err);
    const beat=JSON.parse(r.out);assert.equal(beat.status,'ACTIVE');
    r=await run(root,'finish',{deviceId,missionId:'mission-a',result:'PASS'});
    assert.equal(r.code,0,r.err);
    const done=JSON.parse(r.out);assert.equal(done.status,'COMPLETED');
  }finally{await rm(root,{recursive:true,force:true});}
});
