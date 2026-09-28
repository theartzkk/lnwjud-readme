import { validateExternalCapabilityRegistry, type ExternalCapabilityRegistry } from './external-capability-registry.js';

const SHA=/^[0-9a-f]{40}$/;

export interface ToolUpstreamObservation {
  id:string;
  capability:string;
  repository:string;
  pinnedRevision:string;
  observedRevision:string|null;
  state:'CURRENT'|'UPSTREAM_CHANGED'|'UNAVAILABLE';
  intakeState:'DISCOVERED'|null;
}

export interface ToolUpstreamWatchReport {
  schemaVersion:1;
  kind:'AWH_TOOL_UPSTREAM_WATCH';
  authority:'AWH_UPDATE_CENTER';
  discoveryMode:'METADATA_ONLY';
  runtimeMutation:false;
  observedAt:string;
  observations:ToolUpstreamObservation[];
}

export async function watchExternalCapabilityUpstreams(
  registryValue: unknown,
  resolveHead: (repository:string)=>Promise<string|null>,
  observedAt=new Date().toISOString(),
):Promise<ToolUpstreamWatchReport>{
  const registry:ExternalCapabilityRegistry=validateExternalCapabilityRegistry(registryValue);
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('TOOL_UPSTREAM_WATCH_TIME_INVALID');
  const repositories=[...new Set(registry.entries.map((entry)=>entry.repository))].sort();
  const resolved=new Map<string,string|null>();
  for(const repository of repositories){
    let revision:string|null=null;
    try{
      const candidate=await resolveHead(repository);
      revision=typeof candidate==='string'&&SHA.test(candidate.toLowerCase())?candidate.toLowerCase():null;
    }catch{ revision=null; }
    resolved.set(repository,revision);
  }
  const observations=registry.entries.map((entry):ToolUpstreamObservation=>{
    const observedRevision=resolved.get(entry.repository)??null;
    if(observedRevision===null) return {id:entry.id,capability:entry.capability,repository:entry.repository,pinnedRevision:entry.revision,observedRevision:null,state:'UNAVAILABLE',intakeState:null};
    if(observedRevision===entry.revision) return {id:entry.id,capability:entry.capability,repository:entry.repository,pinnedRevision:entry.revision,observedRevision,state:'CURRENT',intakeState:null};
    return {id:entry.id,capability:entry.capability,repository:entry.repository,pinnedRevision:entry.revision,observedRevision,state:'UPSTREAM_CHANGED',intakeState:'DISCOVERED'};
  });
  return {schemaVersion:1,kind:'AWH_TOOL_UPSTREAM_WATCH',authority:'AWH_UPDATE_CENTER',discoveryMode:'METADATA_ONLY',runtimeMutation:false,observedAt,observations};
}
