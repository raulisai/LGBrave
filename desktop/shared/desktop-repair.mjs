// Passive repairs only. Never launch apps, navigate TV or evict another inspector.
export function createDesktopRepair({status,recovery,start,restart,log=()=>{}}) {
  let pending;
  return function repair() {
    if(pending)return pending;
    const task=(async()=>{
      const before=await status({probe:true}),actions=[];
      if(before.state==='standby')return {...before,actions:['La TV tiene otra sesión: se espera sin interrumpirla.'],repair:{ok:true,waiting:true}};
      const recovered=recovery.restore();
      if(recovered.restored)actions.push('Perfil restaurado usando la llave existente de esta computadora.');
      recovery.capture();
      let after=await status({probe:true});
      if(!after.tv.configured||!recovery.keyPresent())return {...after,actions:[...actions,'Se necesita vincular esta computadora desde Developer Mode; no se dispone de una llave utilizable.'],repair:{ok:false,needsAuthorization:true}};
      if(after.tv.needsUpdate)return {...after,actions:[...actions,'Confirma la IP actual en Configurar direcciones.'],repair:{ok:false,needsAddress:true}};
      if(!after.tvReachable)return {...after,actions:[...actions,'La TV no responde al puerto de desarrollo; el servicio seguirá reintentando.'],repair:{ok:false,waiting:true}};
      if(!after.running){await start();actions.push('Servicio iniciado.');}
      else if(['setup','unresponsive','error','offline'].includes(after.state)||after.repairNeeded){await restart();actions.push('Servicio recargado con el perfil actual de Windows.');}
      else actions.push(after.state==='connected'?'La conexión ya está activa.':'Servicio activo; esperando que Holy o Luma esté abierta en la TV.');
      after=await status({probe:true});log({before:before.state,after:after.state,actions});
      return {...after,actions,repair:{ok:!['error','setup','unresponsive'].includes(after.state),pending:['starting','restarting','waiting','offline'].includes(after.state)}};
    })();pending=task;return task.finally(()=>{if(pending===task)pending=null;});
  };
}
