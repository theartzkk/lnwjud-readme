import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ID=/^[a-z][a-z0-9._-]{1,63}$/;
const REPOSITORY=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA=/^[0-9a-f]{40}$/;
const CAPABILITY=/^[a-z][a-z0-9:._-]{0,63}$/;
const TOOL=/^tool\.[a-z0-9][a-z0-9._-]{0,55}$/;
const COMMAND=/^[a-z0-9][a-z0-9._-]{0,63}$/;

export type ExternalIntegrationMode='OPTIONAL_LOCAL_ADAPTER'|'REFERENCE_SKILL'|'REFERENCE_CORPUS';
export interface ExternalCapabilityRecord {
  id:string; displayName:string; repository:string; revision:string; license:'MIT'|'Elastic-2.0';
  capability:string; integrationMode:ExternalIntegrationMode; command:string|null; workerTool:string|null;
  enabledByDefault:boolean; approvalRequired:boolean; hostedServiceAllowed:boolean;
  authorityBoundary:'AWH_EXISTING_CONTROL_PLANE';
  dataPolicy:'NO_EXTERNAL_SOURCE_OF_TRUTH'|'REFERENCE_ONLY'|'EPHEMERAL_LOCAL_OPTIMIZATION_ONLY';
  purpose:string; rollback:string;
}
export interface ExternalCapabilityRegistry {
  schemaVersion:1; registryId:'awh.external-capabilities.v1'; controlPlaneAuthority:'AWH'; entries:ExternalCapabilityRecord[];
}
function boundedText(value:unknown,name:string,max=600):string {
  if(typeof value!=='string') throw new Error(name+' is invalid');
  const out=value.trim();
  if(!out||out.length>max||/[\u0000-\u001f\u007f]/.test(out)) throw new Error(name+' is invalid');
  return out;
}
export function validateExternalCapabilityRegistry(value:unknown):ExternalCapabilityRegistry {
  if(!value||typeof value!=='object') throw new Error('External capability registry is invalid');
  const registry=value as ExternalCapabilityRegistry;
  if(registry.schemaVersion!==1||registry.registryId!=='awh.external-capabilities.v1'||registry.controlPlaneAuthority!=='AWH') throw new Error('External capability registry authority is invalid');
  if(!Array.isArray(registry.entries)||registry.entries.length<1||registry.entries.length>64) throw new Error('External capability registry entries are invalid');
  const ids=new Set<string>(),caps=new Set<string>();
  for(const entry of registry.entries){
    if(!ID.test(entry.id)||ids.has(entry.id)) throw new Error('External capability id is invalid or duplicated'); ids.add(entry.id);
    boundedText(entry.displayName,'displayName',120);
    if(!REPOSITORY.test(entry.repository)||!SHA.test(entry.revision)) throw new Error('External capability source pin is invalid');
    if(!['MIT','Elastic-2.0'].includes(entry.license)) throw new Error('External capability license is invalid');
    if(!CAPABILITY.test(entry.capability)||caps.has(entry.capability)) throw new Error('External capability is invalid or duplicated'); caps.add(entry.capability);
    if(!['OPTIONAL_LOCAL_ADAPTER','REFERENCE_SKILL','REFERENCE_CORPUS'].includes(entry.integrationMode)) throw new Error('External integration mode is invalid');
    if(entry.integrationMode==='OPTIONAL_LOCAL_ADAPTER'){
      if(typeof entry.command!=='string'||!COMMAND.test(entry.command)||typeof entry.workerTool!=='string'||!TOOL.test(entry.workerTool)) throw new Error('Local adapter discovery contract is invalid');
    }else if(entry.command!==null||entry.workerTool!==null) throw new Error('Reference-only integration cannot expose executable tooling');
    if(entry.enabledByDefault!==false) throw new Error('External capabilities must be opt-in');
    if(typeof entry.approvalRequired!=='boolean'||entry.hostedServiceAllowed!==false) throw new Error('External capability approval/hosting boundary is invalid');
    if(entry.authorityBoundary!=='AWH_EXISTING_CONTROL_PLANE') throw new Error('External capability cannot own a control plane');
    if(!['NO_EXTERNAL_SOURCE_OF_TRUTH','REFERENCE_ONLY','EPHEMERAL_LOCAL_OPTIMIZATION_ONLY'].includes(entry.dataPolicy)) throw new Error('External capability data policy is invalid');
    boundedText(entry.purpose,'purpose'); boundedText(entry.rollback,'rollback');
    if(entry.id==='context-mode'&&(entry.license!=='Elastic-2.0'||entry.integrationMode!=='OPTIONAL_LOCAL_ADAPTER'||entry.hostedServiceAllowed)) throw new Error('Context Mode ELv2 boundary is invalid');
  }
  return registry;
}
export async function loadExternalCapabilityRegistry(path:string):Promise<ExternalCapabilityRegistry>{
  return validateExternalCapabilityRegistry(JSON.parse(await readFile(path,'utf8')));
}


export async function loadBundledExternalCapabilityRegistry():Promise<ExternalCapabilityRegistry>{
  return loadExternalCapabilityRegistry(fileURLToPath(new URL('../config/external-capabilities.json',import.meta.url)));
}
