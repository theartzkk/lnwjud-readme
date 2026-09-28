import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultCandidateArchive } from './vault-transfer.js';

const SECRET_KEY=/password|secret|token|credential|api[_-]?key|private[_-]?key/i;
const PATH_LIKE=/(?:\/Users\/|\/home\/|[A-Za-z]:[\\/])[^\s"']+/g;

function safe(value:unknown,depth=0):unknown{
  if(depth>5)return '[bounded]';
  if(value===null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string')return value.replace(/(?:Bearer\s+)[A-Za-z0-9._~-]+/gi,'Bearer [redacted]').replace(/((?:password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s&]+/gi,'$1[redacted]').replace(PATH_LIKE,'[path]').slice(0,500);
  if(Array.isArray(value))return value.slice(0,100).map((item)=>safe(item,depth+1));
  if(typeof value==='object'){
    const out:Record<string,unknown>={};
    for(const [key,item] of Object.entries(value as Record<string,unknown>).slice(0,100))out[key]=SECRET_KEY.test(key)?'[redacted]':safe(item,depth+1);
    return out;
  }
  return String(value).slice(0,120);
}

export async function createDiagnosticsBundle(destination:string,payload:Record<string,unknown>):Promise<{sha256:string;sizeBytes:number}>{
  const stage=await mkdtemp(join(tmpdir(),'awh-diagnostics-'));
  try{
    await writeFile(join(stage,'diagnostics.json'),JSON.stringify(safe(payload),null,2)+'\n',{encoding:'utf8',mode:0o600});
    const result=await createVaultCandidateArchive(stage,destination);
    return {sha256:result.sha256,sizeBytes:result.sizeBytes};
  }finally{await rm(stage,{recursive:true,force:true});}
}
