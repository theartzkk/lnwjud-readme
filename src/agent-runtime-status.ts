export type AgentCurrentActivity='IDLE'|'READING_FILES'|'CHECKING_WEBSITE'|'USING_CHROME'|'USING_ADOBE'|'EXPORTING'|'UPDATING_TOOL_PACK'|'RUNNING_PROCESS'|'OTHER';

export interface AgentRuntimeStatus {
  activity:AgentCurrentActivity;
  capability:string|null;
  provider:string|null;
  foreground:boolean;
  updatedAt:string;
}

let current:AgentRuntimeStatus={activity:'IDLE',capability:null,provider:null,foreground:false,updatedAt:new Date().toISOString()};
let lastAgentForegroundActionAt=0;

export function setAgentRuntimeStatus(next:Omit<AgentRuntimeStatus,'updatedAt'>):void{
  current={...next,updatedAt:new Date().toISOString()};
}

export function clearAgentRuntimeStatus():void{
  setAgentRuntimeStatus({activity:'IDLE',capability:null,provider:null,foreground:false});
}

export function agentRuntimeStatus():AgentRuntimeStatus{
  return {...current};
}

export function markAgentForegroundAction():void{ lastAgentForegroundActionAt=Date.now(); }
export function recentAgentForegroundAction(windowMs=3000):boolean{return Date.now()-lastAgentForegroundActionAt<=windowMs;}
