import {repairPlan} from './repair-policy.mjs';
import {RepairJournal} from './repair-journal.mjs';
// Same coordinator for manual Doctor and the supervisor. Only existing authorization is restored.
export function createDesktopRepair({status,recovery,start,restart,wake,log=()=>{},journal=new RepairJournal(),lock,
  wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),verifyAttempts=6,verifyDelay=250}){
 let pending;
 return function repair(){
  if(pending)return pending;
  const task=(async()=>{
   let release,before,actions=[],plan,attempt;
   const result=(after,extra={})=>{
    const verified=after.state==='connected'&&!after.profileContext?.mismatch&&!after.repairNeeded;
    const waiting=['waiting','standby'].includes(after.state);
    const pending=!verified&&!waiting&&['starting','restarting','offline'].includes(after.state);
    const repair={ok:verified||waiting||pending,verified,code:plan?.code||'repair-failed',
      outcome:verified?'verified':waiting?'waiting':pending?'pending':'blocked',...(waiting?{waiting:true}:{}),...(pending?{pending:true}:{}),
      ...(attempt?{attempt:attempt.attempt}:{}),...extra};
    const output={...after,actions,diagnosis:plan,repair};
    if(actions.length)try{log({before:before?.state,after:after.state,code:repair.code,action:plan?.action||'',outcome:repair.outcome,attempt:repair.attempt||0});}catch{}
    return output;
   };
   try{
    before=await status({probe:true});plan=repairPlan(before);
    if(['connected','standby','starting','restarting','conflict'].includes(before.state)){actions.push(plan.message);return result(before,{...plan,outcome:plan.verified?'verified':plan.pending?'pending':'waiting',ok:true,verified:!!plan.verified});}
    if(lock)try{release=lock();}catch{actions.push('Doctor espera una reserva exclusiva; se conserva la sesión actual.');return result(before,{ok:false,verified:false,outcome:'busy',pending:true,code:'repair-busy'});}
    // Re-read after taking the cross-process lock: a healthy session may have appeared.
    let after=await status({probe:true});
    if(['connected','standby','starting','restarting'].includes(after.state)){plan=repairPlan(after);actions.push(plan.message);return result(after);}
    const recovered=recovery.restore();
    if(recovered.restored)actions.push('Perfil restaurado con la llave existente de esta computadora.');
    recovery.capture();
    after=await status({probe:true});
    const inspection=recovery.inspect?recovery.inspect():{keyPresent:recovery.keyPresent(),registry:recovered.reason==='registry-unreadable'?'unreadable':'ok'};
    plan=repairPlan(after,inspection);
    if(!plan.action){actions.push(plan.message);return result(after,{...plan,ok:!!plan.verified||!!plan.waiting,verified:!!plan.verified,outcome:plan.verified?'verified':plan.waiting?'waiting':plan.pending?'pending':'blocked'});}
    attempt=journal.reserve(plan.action,plan.code);
    if(!attempt.allowed){actions.push(attempt.reason==='cooldown'?`La recuperación espera ${Math.ceil((attempt.retryAfterMs||30000)/1000)} s para evitar reinicios repetidos.`:'No se pudo registrar el intento; se evita reiniciar sin control.');
      return result(after,{ok:false,verified:false,outcome:attempt.reason==='cooldown'?'cooldown':'blocked',pending:attempt.reason==='cooldown',needsReview:attempt.reason!=='cooldown',code:attempt.reason,retryAfterMs:attempt.retryAfterMs||30000});}
    // Do not turn a newly recovered connection or another owner's reservation into a restart.
    after=await status({probe:true});
    if(['connected','standby','starting','restarting'].includes(after.state)){actions.push('El estado cambió durante el diagnóstico; se conserva la sesión actual.');return result(after);}
    if(plan.action==='start')await start();
    else if(plan.action==='restart')await restart();
    else if(wake)await wake();
    else {actions.push('El servicio ya reintenta la conexión pasiva.');return result(after,{ok:true,pending:true,outcome:'pending',verified:false});}
    actions.push(plan.message);
    for(let index=0;index<verifyAttempts;index++){
      after=await status({probe:true});
      if(['connected','waiting','standby'].includes(after.state))break;
      if(index+1<verifyAttempts)await wait(verifyDelay);
    }
    if(!verifyAttempts)after=await status({probe:true});
    return result(after);
   }catch{
    actions.push('Doctor no pudo completar el arreglo. Se conserva la autorización y se registra el fallo.');
    return result(before||{state:'error'},{ok:false,verified:false,outcome:'failed',code:'repair-failed'});
   }finally{release?.();}
  })();
  pending=task.finally(()=>{if(pending===shared)pending=null;});const shared=pending;
  return pending;
 };
}
