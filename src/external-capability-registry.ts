import { readFile } from 'node:fs/promises';

const ID=/^[a-z][a-z0-9._-]{1,63}$/;
const REPOSITORY=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA=/^[0-9a-f]{40}$/;
const CAPABILITY=/^[a-z][a-z0-9:._-]{0,63}$/;
const TOOL=/^tool\.[a-z0-9][a-z0-9._-]{0,55}$/;
const COMMAND=/^[a-z0-9][a-z0-9._-]{0,63}$/;

export type ExternalIntegrationMode='OPTIONAL_LOCAL_ADAPTER'|'SEPARATE_LAZY_ADAPTER_ONLY'|'LAZY_EXTERNAL_SERVICE_CLIENT'|'REFERENCE_SKILL'|'REFERENCE_CORPUS'|'DISCOVERY_ONLY'|'APPROVED_SKILL_PACK';
export type ExternalRuntimeKind='MCP'|'CLI'|'SERVICE_CLIENT'|'MODEL_RUNTIME'|'REFERENCE'|'DISCOVERY';
export type ToolLifecycleState='DISCOVERED'|'REVIEWED'|'APPROVED'|'PREVIEW'|'STABLE'|'REJECTED'|'RETIRED';
export type ExternalProvisionSpec =
  | {
      kind:'GITHUB_RELEASE_BINARY'; revision:string; version:string; transport:'stdio'; executable:string; args:string[];
      authProviderId?:string; credentialEnv?:string;
      artifacts:Partial<Record<'darwin-arm64'|'darwin-x64'|'linux-x64'|'windows-x64',{url:string;sha256:string;archive:'tar.gz'|'zip'}>>;
    }
  | {
      kind:'NPM_CLI'; revision:string; version:string; packageName:string; integrity:string; bin:string; nodeMinimum:string;
    };
export interface ExternalCapabilityRecord {
  id:string; displayName:string; repository:string; revision:string; license:'MIT'|'Apache-2.0'|'Elastic-2.0'|'GPL-3.0-or-later'|'Apache-2.0+MIT+CC-BY-4.0'|'MIT+CC-BY-4.0';
  capability:string; integrationMode:ExternalIntegrationMode; runtimeKind?:ExternalRuntimeKind; lifecycleState?:ToolLifecycleState; command:string|null; workerTool:string|null;
  enabledByDefault:boolean; approvalRequired:boolean; hostedServiceAllowed:boolean;
  authorityBoundary:'AWH_EXISTING_CONTROL_PLANE';
  dataPolicy:'NO_EXTERNAL_SOURCE_OF_TRUTH'|'REFERENCE_ONLY'|'EPHEMERAL_LOCAL_OPTIMIZATION_ONLY';
  purpose:string; rollback:string; installPolicy?:string; licenseNotes?:string;
  vendorRoot?:string; skillProfile?:'design'|'copy'|'code'; reviewState?:'APPROVED';
  runtimeNetworkAllowed?:boolean; telemetryAllowed?:boolean; persistentInstallAllowed?:boolean;
  externalDataTransferAllowed?:boolean; userDataAccess?:'TASK_CONTEXT_ONLY'; networkPolicy?:'NONE'|'OUTBOUND_HTTPS_ALLOWED'|'AUTHENTICATED_API_REQUIRED'|'LOCAL_BROWSER_SESSION'; modelLicenseRequired?:boolean; provision?:ExternalProvisionSpec;
}
export interface ExternalCapabilityRegistry {
  schemaVersion:1; registryId:'awh.external-capabilities.v1'; controlPlaneAuthority:'AWH'; entries:ExternalCapabilityRecord[];
}
function hashEquals(a:string,b:string):boolean { return a.length===b.length&&a===b; }
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
  if(!Array.isArray(registry.entries)||registry.entries.length<1||registry.entries.length>32) throw new Error('External capability registry entries are invalid');
  const ids=new Set<string>(),caps=new Set<string>();
  for(const entry of registry.entries){
    if(!ID.test(entry.id)||ids.has(entry.id)) throw new Error('External capability id is invalid or duplicated'); ids.add(entry.id);
    boundedText(entry.displayName,'displayName',120);
    if(!REPOSITORY.test(entry.repository)||!SHA.test(entry.revision)) throw new Error('External capability source pin is invalid');
    if(!['MIT','Apache-2.0','Elastic-2.0','GPL-3.0-or-later','Apache-2.0+MIT+CC-BY-4.0','MIT+CC-BY-4.0'].includes(entry.license)) throw new Error('External capability license is invalid');
    if(!CAPABILITY.test(entry.capability)||caps.has(entry.capability)) throw new Error('External capability is invalid or duplicated'); caps.add(entry.capability);
    if(!['OPTIONAL_LOCAL_ADAPTER','SEPARATE_LAZY_ADAPTER_ONLY','LAZY_EXTERNAL_SERVICE_CLIENT','REFERENCE_SKILL','REFERENCE_CORPUS','DISCOVERY_ONLY','APPROVED_SKILL_PACK'].includes(entry.integrationMode)) throw new Error('External integration mode is invalid');
    if(entry.runtimeKind!==undefined&&!['MCP','CLI','SERVICE_CLIENT','MODEL_RUNTIME','REFERENCE','DISCOVERY'].includes(entry.runtimeKind)) throw new Error('External runtime kind is invalid');
    if(entry.lifecycleState!==undefined&&!['DISCOVERED','REVIEWED','APPROVED','PREVIEW','STABLE','REJECTED','RETIRED'].includes(entry.lifecycleState)) throw new Error('External lifecycle state is invalid');
    if(['OPTIONAL_LOCAL_ADAPTER','SEPARATE_LAZY_ADAPTER_ONLY','LAZY_EXTERNAL_SERVICE_CLIENT'].includes(entry.integrationMode)){
      if(typeof entry.command!=='string'||!COMMAND.test(entry.command)||typeof entry.workerTool!=='string'||!TOOL.test(entry.workerTool)) throw new Error('Local adapter discovery contract is invalid');
    }else if(entry.command!==null||entry.workerTool!==null) throw new Error('Reference/discovery integration cannot expose executable tooling');
    if(entry.integrationMode==='APPROVED_SKILL_PACK'){
      if(typeof entry.vendorRoot!=='string'||!/^skills\/approved\/[a-z0-9][a-z0-9._-]{1,63}$/.test(entry.vendorRoot)) throw new Error('Approved skill vendor root is invalid');
      if(!['design','copy','code'].includes(String(entry.skillProfile))||entry.reviewState!=='APPROVED') throw new Error('Approved skill review/profile is invalid');
      if(entry.runtimeNetworkAllowed!==false||entry.telemetryAllowed!==false||entry.persistentInstallAllowed!==false||entry.externalDataTransferAllowed!==false||entry.userDataAccess!=='TASK_CONTEXT_ONLY') throw new Error('Approved skill runtime boundary is invalid');
    }
    if(entry.enabledByDefault!==false) throw new Error('External capabilities must be opt-in');
    if(typeof entry.approvalRequired!=='boolean') throw new Error('External capability approval boundary is invalid');
    if(entry.integrationMode==='LAZY_EXTERNAL_SERVICE_CLIENT'){ if(entry.hostedServiceAllowed!==true||entry.runtimeKind!=='SERVICE_CLIENT'||entry.externalDataTransferAllowed!==true) throw new Error('External service client boundary is invalid'); }
    else if(entry.hostedServiceAllowed!==false) throw new Error('External capability hosting boundary is invalid');
    if(entry.integrationMode==='SEPARATE_LAZY_ADAPTER_ONLY'&&entry.persistentInstallAllowed!==false) throw new Error('Separated adapter cannot be merged into AWH core');
    if(entry.networkPolicy!==undefined&&!['NONE','OUTBOUND_HTTPS_ALLOWED','AUTHENTICATED_API_REQUIRED','LOCAL_BROWSER_SESSION'].includes(entry.networkPolicy)) throw new Error('External capability network policy is invalid');
    if(entry.modelLicenseRequired!==undefined&&typeof entry.modelLicenseRequired!=='boolean') throw new Error('External model license boundary is invalid');
    if(entry.provision!==undefined){
      if(!entry.provision||typeof entry.provision!=='object'||Array.isArray(entry.provision)) throw new Error('External provision contract is invalid');
      if(entry.integrationMode==='REFERENCE_SKILL'||entry.integrationMode==='REFERENCE_CORPUS'||entry.integrationMode==='DISCOVERY_ONLY'||entry.integrationMode==='APPROVED_SKILL_PACK') throw new Error('Reference capability cannot provision runtime');
      if(entry.provision.kind==='GITHUB_RELEASE_BINARY'){
        if(!SHA.test(entry.provision.revision)||!hashEquals(entry.provision.revision,entry.revision)||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(entry.provision.version)||entry.provision.transport!=='stdio'||!COMMAND.test(entry.provision.executable)||!Array.isArray(entry.provision.args)||entry.provision.args.length>16||entry.provision.args.some((arg)=>typeof arg!=='string'||arg.length>160||/[\u0000-\u001f\u007f]/.test(arg))) throw new Error('GitHub release provision contract is invalid');
        if(entry.provision.authProviderId!==undefined&&!/^[a-z][a-z0-9._-]{1,63}$/.test(entry.provision.authProviderId)) throw new Error('Provision auth provider is invalid');
        if(entry.provision.credentialEnv!==undefined&&!/^[A-Z][A-Z0-9_]{2,80}$/.test(entry.provision.credentialEnv)) throw new Error('Provision credential environment is invalid');
        const artifacts=entry.provision.artifacts;
        if(!artifacts||typeof artifacts!=='object'||Array.isArray(artifacts)||Object.keys(artifacts).length<1) throw new Error('GitHub release artifacts are invalid');
        for(const [target,artifact] of Object.entries(artifacts)){
          if(!['darwin-arm64','darwin-x64','linux-x64','windows-x64'].includes(target)||!artifact||typeof artifact!=='object') throw new Error('GitHub release target is invalid');
          if(!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(artifact.url)||!/^[0-9a-f]{64}$/.test(artifact.sha256)||!['tar.gz','zip'].includes(artifact.archive)) throw new Error('GitHub release artifact integrity is invalid');
        }
      }else if(entry.provision.kind==='NPM_CLI'){
        if(!SHA.test(entry.provision.revision)||!hashEquals(entry.provision.revision,entry.revision)||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(entry.provision.version)||!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(entry.provision.packageName)||!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.provision.integrity)||!COMMAND.test(entry.provision.bin)||!/^\d+\.\d+\.\d+$/.test(entry.provision.nodeMinimum)) throw new Error('NPM provision contract is invalid');
      }else throw new Error('External provision kind is invalid');
    }
    if(entry.authorityBoundary!=='AWH_EXISTING_CONTROL_PLANE') throw new Error('External capability cannot own a control plane');
    if(!['NO_EXTERNAL_SOURCE_OF_TRUTH','REFERENCE_ONLY','EPHEMERAL_LOCAL_OPTIMIZATION_ONLY'].includes(entry.dataPolicy)) throw new Error('External capability data policy is invalid');
    boundedText(entry.purpose,'purpose'); boundedText(entry.rollback,'rollback'); if(entry.installPolicy!==undefined) boundedText(entry.installPolicy,'installPolicy',80); if(entry.licenseNotes!==undefined) boundedText(entry.licenseNotes,'licenseNotes',500);
    if(entry.id==='context-mode'&&(entry.license!=='Elastic-2.0'||entry.integrationMode!=='OPTIONAL_LOCAL_ADAPTER'||entry.hostedServiceAllowed)) throw new Error('Context Mode ELv2 boundary is invalid');
  }
  return registry;
}
export async function loadExternalCapabilityRegistry(path:string):Promise<ExternalCapabilityRegistry>{
  return validateExternalCapabilityRegistry(JSON.parse(await readFile(path,'utf8')));
}
