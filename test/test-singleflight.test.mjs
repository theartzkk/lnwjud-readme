import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withSingleFlight } from '../scripts/qa/test-singleflight.mjs';

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
test('same project+sha test runs are single-flight and reuse the first result',async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-qa-singleflight-'));const counter=join(root,'counter.txt');let runs=0;
  const runner=async()=>{runs++;await writeFile(counter,String(runs));await sleep(180);return 0;};
  try{
    const [a,b]=await Promise.all([
      withSingleFlight({lockRoot:root,key:'awh',sha:'a'.repeat(40),runner,pollMs:20}),
      withSingleFlight({lockRoot:root,key:'awh',sha:'a'.repeat(40),runner,pollMs:20}),
    ]);
    assert.equal(Number(await readFile(counter,'utf8')),1);
    assert.equal([a.reused,b.reused].filter(Boolean).length,1);
    assert.equal(a.code,0);assert.equal(b.code,0);
  }finally{await rm(root,{recursive:true,force:true});}
});


test('same-sha waiter reclaims lock when owner dies after waiting starts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-qa-singleflight-stale-same-'));
  const lock=join(root,'awh.lock');
  try{
    await import('node:fs/promises').then(fs=>fs.mkdir(lock,{recursive:true}));
    const startedAt=new Date(Date.now()-10_000).toISOString();
    await writeFile(join(lock,'owner.json'),JSON.stringify({schemaVersion:1,pid:process.pid,key:'awh',sha:'b'.repeat(40),mode:'test',startedAt}));
    setTimeout(()=>{void writeFile(join(lock,'owner.json'),JSON.stringify({schemaVersion:1,pid:999999999,key:'awh',sha:'b'.repeat(40),mode:'test',startedAt}));},80);
    let runs=0;
    const result=await withSingleFlight({lockRoot:root,key:'awh',sha:'b'.repeat(40),runner:async()=>{runs++;return 0;},pollMs:20,waitTimeoutMs:1500,staleMs:60_000});
    assert.equal(result.code,0);
    assert.equal(runs,1);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('different-sha waiter reclaims lock when owner dies after waiting starts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-qa-singleflight-stale-different-'));
  const lock=join(root,'awh.lock');
  try{
    await import('node:fs/promises').then(fs=>fs.mkdir(lock,{recursive:true}));
    const startedAt=new Date(Date.now()-10_000).toISOString();
    await writeFile(join(lock,'owner.json'),JSON.stringify({schemaVersion:1,pid:process.pid,key:'awh',sha:'c'.repeat(40),mode:'test',startedAt}));
    setTimeout(()=>{void writeFile(join(lock,'owner.json'),JSON.stringify({schemaVersion:1,pid:999999999,key:'awh',sha:'c'.repeat(40),mode:'test',startedAt}));},80);
    let runs=0;
    const result=await withSingleFlight({lockRoot:root,key:'awh',sha:'d'.repeat(40),runner:async()=>{runs++;return 0;},pollMs:20,waitTimeoutMs:1500,staleMs:60_000});
    assert.equal(result.code,0);
    assert.equal(runs,1);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('completed PASS is reused immediately for the same exact SHA and mode',async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-qa-singleflight-reuse-'));let runs=0;
  const runner=async()=>{runs++;return 0;};
  try{
    const first=await withSingleFlight({lockRoot:root,key:'awh',sha:'b'.repeat(40),mode:'test',runner,pollMs:20});
    const second=await withSingleFlight({lockRoot:root,key:'awh',sha:'b'.repeat(40),mode:'test',runner,pollMs:20});
    assert.equal(runs,1);
    assert.equal(first.reused,false);
    assert.equal(second.reused,true);
    assert.equal(second.reuseKind,'EXACT_SHA_PASS');
    assert.equal(second.code,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('join-only singleflight reruns after a completed pass but still deduplicates concurrent owners',async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-qa-singleflight-join-only-'));let runs=0;
  const runner=async()=>{runs++;await sleep(120);return 0;};
  try{
    const [first,joined]=await Promise.all([
      withSingleFlight({lockRoot:root,key:'awh-qa',sha:'c'.repeat(40),mode:'qa-full',runner,pollMs:20,reuseCompletedPass:false}),
      withSingleFlight({lockRoot:root,key:'awh-qa',sha:'c'.repeat(40),mode:'qa-full',runner,pollMs:20,reuseCompletedPass:false}),
    ]);
    assert.equal(runs,1);
    assert.equal([first.reused,joined.reused].filter(Boolean).length,1);
    const later=await withSingleFlight({lockRoot:root,key:'awh-qa',sha:'c'.repeat(40),mode:'qa-full',runner,pollMs:20,reuseCompletedPass:false});
    assert.equal(later.reused,false);
    assert.equal(runs,2);
  }finally{await rm(root,{recursive:true,force:true});}
});
