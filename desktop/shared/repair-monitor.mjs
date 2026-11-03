// The supervisor invokes this even when the tray is closed.
// A suspended computer stops every timer: the silence it leaves is not a stuck worker.
export function createSleepClock({now=Date.now,gap=10000}={}) {
 let last=now();
 return ()=>{const time=now(),slept=time-last>gap;last=time;return slept;};
}
export function createRepairMonitor({readState,repair,now=Date.now}) {
 let pending,nextAt=0,signature='';
 return {tick(){
   const state=readState(),key=[state.state,state.tv?.configured,state.tv?.needsUpdate,state.profileContext?.mismatch].join('|');
   if(key!==signature){signature=key;nextAt=0;}
   if(!['setup','error','unresponsive'].includes(state.state)||now()<nextAt)return Promise.resolve(null);
   if(pending)return pending;
   const task=Promise.resolve().then(()=>repair()).then(result=>{
     const info=result?.repair||{};
     if(['blocked','failed','cooldown','busy'].includes(info.outcome))nextAt=now()+(info.retryAfterMs||60000);
     return result;
   });
   const shared=task.finally(()=>{if(pending===shared)pending=null;});pending=shared;return shared;
 }};
}
