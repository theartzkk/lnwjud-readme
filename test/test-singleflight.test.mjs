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
