import net from 'node:net';
import {statfsSync} from 'node:fs';
import {repairPlan} from '../../desktop/shared/repair-policy.mjs';
import {RepairJournal} from '../../desktop/shared/repair-journal.mjs';

// «El Doctor»: mira qué está bien y qué no en el Mac de Holy (dirección, TV, puente,
// catálogo, arranque automático) y puede «recetar» los arreglos seguros. Nunca abre
// ni navega la TV: solo reconecta la sesión pasiva y reinicia el proceso del Mac.
// Niveles: ok = verde, warn = naranja (hay algo), info = nota que no cambia el color.
// El rojo lo decide quien mira (la pantalla o el menú) cuando no alcanza al Mac.
// El arranque automático es decisión del dueño: solo se instala si se pide expresamente.
const STALE_CATALOG = 3 * 3600 * 1000;
const MAX_RSS = 1.5 * 1024 ** 3;

export const tcpOpen = (host, port, ms = 2500) => new Promise(resolve => {
  const socket = net.connect({ host, port });
  const done = value => { socket.destroy(); resolve(value); };
  socket.setTimeout(ms, () => done(false));
  socket.once('connect', () => done(true));
  socket.once('error', () => done(false));
});

// Every dependency is injected so the tests need no TV, network or launchctl.
export function createDoctor({
  catalog, library, runtime, tv = { host: '192.168.1.134', port: 9922 }, startedAddress, currentAddress,
  autostart = { status: async () => ({ installed: true, loaded: true }), install: async () => {} },
  supervised = !!process.env.HOLY_SUPERVISED, restart = () => process.kill(process.pid, 'SIGTERM'),
  profile, reserveRepair, diskFree = () => { const fs = statfsSync('.'); return fs.bavail * fs.bsize; }, probe = tcpOpen, now = Date.now, rss = () => process.memoryUsage().rss, log = console.log
} = {}) {
  const check = (id, label, level, detail, fix = null, hint = '') => ({ id, label, level, detail, fix, hint });
  const journal=new RepairJournal({now});
  const reserve=reserveRepair||((action,code)=>journal.reserve(action,code));

  async function diagnose() {
    const checks = [];
    const address = currentAddress();
    checks.push(address === startedAddress
      ? check('ip', 'Dirección de la computadora', 'ok', address)
      : check('ip', 'Dirección de la computadora', 'warn', `Cambió de ${startedAddress} a ${address}`, 'restart', 'Se reinicia para anunciar la nueva dirección.'));

    const target=typeof tv==='function'?tv():tv;
    const inspection=profile?.inspect?.();
    const reachable = await probe(target.host, target.port);
    checks.push(reachable
      ? check('tv-net', 'TV en la red', 'ok', `${target.host} responde`)
      : check('tv-net', 'TV en la red', 'warn', `${target.host} no responde`, null, 'Enciende la TV y comprueba que está en la misma red que la computadora.'));

    const state = runtime?.state;
    const connection=repairPlan({state,tv:{...target,configured:target.configured??true},running:true,tvReachable:reachable},inspection||{});
    if(inspection){
      const valid=inspection.profilePresent&&inspection.keyPresent;
      const canRestore=inspection.registry!=='unreadable'&&inspection.backupUsable&&!valid;
      checks.push(check('profile','Perfil de desarrollo',valid?'ok':'warn',valid?'Perfil y llave existentes':inspection.registry==='unreadable'?'El registro no se puede leer':inspection.keyPresent===false?'Falta una llave utilizable':'Falta el perfil',canRestore?'profile':null,canRestore?'Restaurar metadatos con la llave existente.':'Se conserva la autorización; no se reemplazan llaves ni registros dañados.'));
    }
    if(state==='connected')checks.push(check('tv-link','Conexión con Holy en la TV','ok','Conectado'));
    else if(state==='standby')checks.push(check('tv-link','Conexión con Holy en la TV','info','En respaldo: la TV tiene otra sesión activa',null,'Se conserva la sesión del otro equipo.'));
    else if(state==='waiting')checks.push(check('tv-link','Conexión con Holy en la TV','warn','Holy no está abierta en la TV',null,'Abre Holy con el control; la computadora no la abre sola.'));
    else if(['starting','restarting'].includes(state))checks.push(check('tv-link','Conexión con Holy en la TV','info','La conexión está iniciando; se esperará.',null));
    else checks.push(check('tv-link','Conexión con Holy en la TV','warn',connection.message,connection.action==='wake'?'reconnect':connection.action==='restart'?'restart':null,connection.message));

    const failing = catalog.sources().filter(source => source.health && !source.health.ok).map(source => source.name || source.id);
    const age = now() - (catalog.updatedAt || 0);
    if (!catalog.items.length) checks.push(check('catalog', 'Catálogo', 'warn', 'Vacío', 'refresh', 'Se vuelve a leer cada sitio.'));
    else if (age > STALE_CATALOG) checks.push(check('catalog', 'Catálogo', 'warn', `Sin actualizar hace ${Math.round(age / 3600000)} h`, 'refresh', 'Se vuelve a leer cada sitio.'));
    else if (failing.length) checks.push(check('catalog', 'Catálogo', 'warn', `Sitios con fallo: ${failing.join(', ')}`, 'refresh', 'Se reintenta; si el sitio cambió, no hay arreglo automático.'));
    else checks.push(check('catalog', 'Catálogo', 'ok', `${catalog.items.length} títulos`));

    // A full disk stopped the service on 2026-10-27 (ENOSPC).
    try { const fs = diskFree(), gb = fs / 1024 ** 3; checks.push(gb < 2 ? check('disk', 'Espacio en disco', 'warn', `Quedan ${gb.toFixed(1)} GB`, null, 'Libera espacio: sin disco se pierden registros y progreso.') : check('disk', 'Espacio en disco', 'ok', `${gb.toFixed(0)} GB libres`)); } catch { /* Not available here. */ }
    checks.push(Array.isArray(library.entries) ? check('library', 'Historial y gustos', 'ok', `${library.entries.length} títulos vistos`) : check('library', 'Historial y gustos', 'warn', 'No se pudo leer'));

    const login = await autostart.status().catch(() => ({ installed: false, loaded: false }));
    checks.push(login.installed && login.loaded
      ? check('autostart', 'Inicio automático', 'ok', 'Activado')
      : check('autostart', 'Inicio automático', 'info', 'Desactivado: tras reiniciar hay que abrir Holy en la computadora', 'autostart', 'Se activa con `npm run holy:autostart -- on` (se quita con `-- off`).'));

    checks.push(supervised
      ? check('supervisor', 'Vigilante', 'ok', 'Reinicia Holy si se cae')
      : check('supervisor', 'Vigilante', 'warn', 'Holy corre sin vigilante', null, 'Inicia con `npm run holy` para que se reinicie sola.'));

    checks.push(rss() > MAX_RSS ? check('memory', 'Memoria del proceso', 'warn', `${Math.round(rss() / 1048576)} MB`, 'restart', 'Se reinicia para liberarla.') : check('memory', 'Memoria del proceso', 'ok', `${Math.round(rss() / 1048576)} MB`));

    const pending = checks.filter(item => item.level === 'warn');
    const level = pending.length ? 'orange' : 'green';
    return { level, summary: level === 'green' ? 'Todo en orden' : `${pending.length} cosa(s) por revisar`, checks, at: now() };
  }

  let busy = null;
  // Applies every available fix once; «restart» goes last, after the answer is sent.
  // { autostart: true } also installs the login start (only when the owner asks for it).
  async function prescribe({ autostart: withAutostart = false } = {}) {
    if (busy) return busy;
    busy = (async () => {
      const before = await diagnose();
      const fixes = [...new Set(before.checks.filter(item => (item.level === 'warn' || (withAutostart && item.id === 'autostart' && item.level !== 'ok')) && item.fix).map(item => item.fix))];
      const done = [];
      for (const fix of fixes.filter(name => name !== 'restart')) {
        try {
          if (fix === 'refresh') {const permit=reserve('refresh','catalog-refresh');if(!permit.allowed){done.push({fix,ok:false,pending:true,text:'Se espera para evitar consultas repetidas a los sitios'});continue;}catalog.refresh().catch(() => {}); done.push({ fix, ok: true, pending:true,text: 'Buscando títulos en los sitios' }); }
          else if (fix === 'reconnect') {
            if(['connected','standby','starting','restarting'].includes(runtime?.state)){done.push({fix,ok:true,text:'La sesión cambió durante el diagnóstico; se conserva'});continue;}
            const permit=reserve('wake','connection-retry');if(!permit.allowed){done.push({fix,ok:false,pending:true,text:'Reconexión en espera para evitar intentos repetidos'});continue;}
            await runtime.disconnect(); done.push({ fix, ok: true, pending:true,text: 'Sesión pasiva reiniciada; esperando conexión' });
          }
          else if(fix==='profile'){
            if(['connected','standby'].includes(runtime?.state)){done.push({fix,ok:true,text:'Se conserva la conexión activa'});continue;}
            const restored=profile.restore(),current=profile.inspect();
            const ok=current.profilePresent&&current.keyPresent;done.push({fix,ok,text:ok?'Perfil existente recuperado; esperando reconexión':'No se pudo restaurar el perfil sin nueva autorización'});
            if(ok&&!fixes.includes('restart'))fixes.push('restart');
          }
          else if (fix === 'autostart') { await autostart.install(); done.push({ fix, ok: true, text: 'Arranque automático activado' }); }
        } catch (error) { done.push({ fix, ok: false, text: error.message }); }
      }
      let restarting = false;
      if (fixes.includes('restart')) {
        if(runtime?.state==='standby'){done.push({fix:'restart',ok:false,pending:true,text:'La TV está atendida por otro equipo; se pospone el reinicio.'});}
        else if (supervised) {const permit=reserve('restart','doctor-restart');if(!permit.allowed){done.push({fix:'restart',ok:false,pending:true,text:'El reinicio está en espera para evitar bucles.'});}else{ restarting = true; done.push({ fix: 'restart', ok: true, text: 'Reiniciando el servicio de Holy (vuelve en unos segundos)' }); setTimeout(() => { log('Holy: el Doctor reinicia el proceso.'); restart(); }, 600); }}
        else done.push({ fix: 'restart', ok: false, text: 'Hace falta reiniciar, pero no hay vigilante: ejecuta `npm run holy` de nuevo' });
      }
      return { done, restarting, notFixable: before.checks.filter(item => item.level === 'warn' && !item.fix).map(item => ({ id: item.id, hint: item.hint })), before: before.level };
    })().finally(() => { busy = null; });
    return busy;
  }
  return { diagnose, prescribe };
}
