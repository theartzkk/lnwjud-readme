#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { watchExternalCapabilityUpstreams } from '../../src/tool-upstream-watcher.js';

const execFileAsync=promisify(execFile);
const root=resolve(process.cwd());
const registry=JSON.parse(await readFile(resolve(root,'config/external-capabilities.json'),'utf8'));

async function resolveHead(repository:string):Promise<string|null>{
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return null;
  try{
    const url='https://github.com/'+repository+'.git';
    const result=await execFileAsync('git',['ls-remote',url,'HEAD'],{
      cwd:root,timeout:20_000,maxBuffer:64*1024,env:{PATH:process.env.PATH??'/usr/bin:/bin',GIT_TERMINAL_PROMPT:'0'}
    });
    const match=/^([0-9a-f]{40})\s+HEAD\s*$/m.exec(result.stdout);
    return match?.[1]??null;
  }catch{return null;}
}

const report=await watchExternalCapabilityUpstreams(registry,resolveHead);
process.stdout.write(JSON.stringify(report,null,2)+'\n');
