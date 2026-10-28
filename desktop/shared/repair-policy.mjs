// Shared, passive repair decisions. No TV navigation, process killing or key replacement here.
export function profileMismatch(live, localContext, localTV) {
  return !!(live?.context?.id && localContext?.id && live.context.id!==localContext.id ||
    live?.tv?.configured===false && localTV?.configured && ['setup','error','offline'].includes(live.state));
}
export function repairPlan(report, inspection={}) {
  const state=report?.state;
  const plan=(code,action,message,extra={})=>({code,action,message,...extra});
  if(state==='standby')return plan('other-owner',null,'La TV la atiende otro equipo; esta computadora permanece en respaldo.',{waiting:true});
  if(state==='connected')return plan(report.profileContext?.mismatch?'context-deferred':'healthy',null,
    report.profileContext?.mismatch?'La reproducción sigue conectada; el cambio de entorno se aplicará cuando se desconecte.':'La conexión ya está activa.',{verified:!report.profileContext?.mismatch});
  if(['starting','restarting'].includes(state))return plan('service-starting',null,'El servicio está iniciando; se comprobará de nuevo.',{pending:true});
  if(state==='conflict')return plan('local-conflict',null,'Hay otro proceso usando el servicio o sus puertos; no se cerrará automáticamente.',{waiting:true});
  if(inspection.registry==='unreadable')return plan('registry-unreadable',null,'El registro webOS no se puede leer; se conserva para no perder otros equipos.',{needsReview:true});
  if(state==='unresponsive')return plan('service-unresponsive','restart','El servicio no responde; recargar una sola instancia.');
  if(state==='error')return plan('service-error','restart','Recargar el servicio que informó un error.');
  if(report.tv?.needsUpdate)return plan('tv-address-mismatch',null,'La dirección guardada no coincide con el perfil de la TV; confirma su IP actual.',{needsAddress:true});
  if(!report.tv?.configured||inspection.keyPresent===false)return plan('authorization-missing',null,'Falta un perfil con llave utilizable. Se conserva la autorización existente; Developer Mode debe autorizar una llave si ya no existe.',{needsAuthorization:true});
  if(!report.running)return plan('service-stopped','start','Iniciar el servicio de esta computadora.');
  if(report.repairNeeded||report.profileContext?.mismatch)return plan('profile-context-mismatch','restart','Recargar el servicio con el perfil actual de esta computadora.');
  if(state==='setup')return plan('profile-stale','restart','El perfil ya existe; recargar el servicio que todavía no lo reconoce.');
  if(report.tvReachable===false)return plan('tv-unreachable',null,'La TV no responde al puerto de desarrollo; se esperará sin reiniciar en bucle.',{waiting:true});
  if(state==='waiting')return plan('app-not-open',null,'Servicio disponible. Abre Holy o Luma con el control de la TV.',{waiting:true});
  if(state==='offline')return plan('connection-retry','wake','Reintentar la conexión pasiva. Si el inspector no está disponible, abre Holy o Luma en la TV.',{pending:true});
  return plan('diagnosis-required',null,'No hay una reparación automática acreditada para este estado; se conserva el servicio.',{needsReview:true});
}
