const stoppers=new Set<()=>void>();
let epoch=0;

export function foregroundEpoch():number{return epoch;}

export function registerForegroundStop(stop:()=>void):()=>void{
  stoppers.add(stop);
  return ()=>{stoppers.delete(stop);};
}

export function emergencyStopForeground():number{
  epoch+=1;
  for(const stop of [...stoppers]){
    try{stop();}catch{}
  }
  return epoch;
}

export function assertForegroundEpoch(expected:number):void{
  if(expected!==epoch) throw new Error('AWH_EMERGENCY_STOPPED');
}
