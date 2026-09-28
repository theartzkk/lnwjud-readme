import { loadStoredSettings, saveStoredSettings, type AgentRuntimeMode } from './settings.js';

export type AgentWorkPlane = 'BACKGROUND' | 'FOREGROUND';

export function currentAgentMode(dataDir:string):AgentRuntimeMode {
  return loadStoredSettings(dataDir).runtimeMode ?? 'OFF';
}

export async function setAgentMode(dataDir:string,mode:AgentRuntimeMode,emergency=false):Promise<AgentRuntimeMode> {
  const stored=loadStoredSettings(dataDir);
  const now=new Date().toISOString();
  await saveStoredSettings(dataDir,{
    ...stored,
    runtimeMode:mode,
    runtimeModeUpdatedAt:now,
    ...(emergency?{lastEmergencyStopAt:now}:{}),
  });
  return mode;
}

export function modeCapability(mode:AgentRuntimeMode):string {
  return 'runtime.ai.'+mode.toLowerCase();
}

export function capabilityPlane(capability:string):AgentWorkPlane {
  return /^(?:device\.gui\.operate|creative\.(?:photoshop|premiere|aftereffects)|browser\.automation|browser\.session)$/.test(capability)
    ? 'FOREGROUND'
    : 'BACKGROUND';
}

export function actionPlane(tool:string):AgentWorkPlane {
  return ['input_event','accessibility','computer_use','dom_cdp'].includes(tool)?'FOREGROUND':'BACKGROUND';
}

export function modeAllowsPlane(mode:AgentRuntimeMode,plane:AgentWorkPlane):boolean {
  if(plane==='BACKGROUND') return true;
  return mode!=='OFF';
}

export function modeLabel(mode:AgentRuntimeMode):string {
  return mode==='OFF'?'OFF · ไม่รบกวน':mode==='ON'?'ON · ใช้งานร่วมกัน':'LIVE · AWH ควบคุมได้เต็มที่';
}
