import {createProfileRecovery} from './profile-recovery.mjs';
import {createDesktopRepair} from './desktop-repair.mjs';
import {DiagnosticLog} from '../../scripts/diagnostics.mjs';
import {spawn} from 'node:child_process';
import {mkdirSync, openSync, closeSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config, saveConfig, readJSON, tvAddress, lanAddress, localName, ROOT} from './desktop-config.mjs';
import {tcpOpen} from '../../scripts/holy/doctor.mjs';
import {syncDeviceProfile} from '../../scripts/webos-cli.mjs';
import {PORT} from '../../scripts/holy/config.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function ask(path, method = 'GET') {
  const owner = readJSON(join(ROOT, '.local', 'desktop-owner.json'));
  if (!owner?.port || !owner.token) return null;
  try {
    const response = await fetch(`http://127.0.0.1:${owner.port}${path}`, {method, headers:{'X-Luma-Token':owner.token}, signal:AbortSignal.timeout(1200)});
    return response.ok ? await response.json() : null;
  } catch { return null; }
}
const labels = {connected:'Conectado a la TV',waiting:'En espera: abre Holy o Luma en la TV',standby:'En respaldo · la TV tiene otra sesión activa',
  stopped:'Apagado',starting:'Iniciando',offline:'Sin conexión con la TV',setup:'Falta vincular esta computadora con webOS',conflict:'Otro runtime local está activo',restarting:'Reiniciando',error:'Error',unresponsive:'El servicio no está respondiendo: reinicia la conexión'};
export async function status({probe = false} = {}) {
  const live = await ask('/status');
  const tv = tvAddress();
  const state = live?.updated && Date.now()-live.updated > 15000 ? 'unresponsive' : live?.state || 'stopped';
  const repairNeeded=state==='setup'&&tv.configured&&!tv.needsUpdate;
  const label=repairNeeded?'El servicio necesita recargar el perfil de Windows'
    :state==='standby'&&live?.paused?`TV cedida a otra computadora; reintenta en ${live.paused} s`
    :state==='standby'&&live?.holder?`La TV la atiende ${live.holder}`:labels[state] || state;
  // The catalogue page for any device on the WiFi: served by this same process whenever it
  // answers at all (even before the TV connects), as long as `npm run build:all` made it.
  const webBuilt = existsSync(join(ROOT,'dist-holy-web/index.html'));
  const friendlyHost = localName();
  const web = {running:!!live && webBuilt, built:webBuilt, url:`http://${lanAddress()}:${PORT}/`, friendlyUrl:friendlyHost?`http://${friendlyHost}:${PORT}/`:''};
  return {...live,state,error:state==='standby'?'':live?.error||'',...(state==='standby'?{standbyReason:live?.error||'',checks:[label]}:{}),repairNeeded,label,running:!!live,host:lanAddress(),tv,web,
    ...(probe ? {tvReachable:!!tv.host && await tcpOpen(tv.host,tv.port,1200)} : {}),
    build:{luma:existsSync(join(ROOT,'dist/index.html')),holy:existsSync(join(ROOT,'dist-holy/index.html')),holyWeb:webBuilt}, config:config(),
    history:live?.peerSync?.state==='synced'?'Gustos, historial, idiomas y progreso sincronizados entre tus computadoras por la red local.':
      live?.peerSync?.state==='needs-update'?'Vínculo de sincronización creado. Falta actualizar el otro equipo para combinar las bibliotecas automáticamente.':
      live?.peerSync?.paired?'Cambios guardados en esta computadora; se compartirán cuando el otro equipo esté conectado.':
      live?.profile?.state==='synced'?'Preferencias e historial compartidos mediante la TV con las computadoras que usan esta versión.':
      'Copia local activa. El perfil se comparte por SSH al conectar con la TV; ambos equipos deben usar esta versión.'};
}
export async function start() {
  mkdirSync(join(ROOT,'.local'),{recursive:true});
  writeFileSync(join(ROOT,'.local','node-path.txt'),process.execPath);
  if (!(await ask('/status'))) {
    mkdirSync(join(ROOT,'.local/logs'),{recursive:true});
    const out = openSync(join(ROOT,'.local/logs/desktop.log'),'a');
    try {
      const child = spawn(process.execPath,[join(ROOT,'scripts/desktop-supervisor.mjs')],{cwd:ROOT,detached:true,windowsHide:true,stdio:['ignore',out,out]});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
      child.unref();
    } finally { closeSync(out); }
    for(let i=0;i<40;i++) { if(await ask('/status')) break; await sleep(150); }
  }
  return status();
}
export async function stop() {
  if (await ask('/stop','POST')) for(let i=0;i<60;i++) { if (!(await ask('/status'))) break; await sleep(150); }
  const after = await status();
  if (after.running) throw Error('El servicio aún se está deteniendo. Revisa el registro.');
  return after;
}
export async function restart() { await stop(); return start(); }
// «Usar esta computadora para la TV»: asks the computer serving it to yield, then wakes this
// service so it takes the TV as soon as it is free. The other one waits 2 min before retrying.
export async function handoff({request = async () => (await import('../../scripts/inspector-tunnel.mjs')).requestHandoff(), wait = 10000} = {}) {
  let before = await status();
  if (before.state === 'connected') return {...before, actions:['Esta computadora ya atiende la TV.']};
  if (!before.tv.configured) return {...before, actions:['Primero vincula esta computadora con la TV.']};
  if (!before.running) before = await start();
  const asked = await request().catch(error => ({state:'error', error:error.message}));
  if (asked.state === 'error') return {...await status(), actions:['No se pudo hablar con la TV: '+asked.error]};
  const actions = [asked.state === 'free' ? 'La TV estaba libre.'
    : asked.state === 'yielded' ? `${asked.holder || 'La otra computadora'} cedió la TV.`
    : `Pedido enviado a ${asked.holder || 'la otra computadora'}; si no la suelta, puede tener una versión anterior: reinicia su servicio o apágalo.`];
  for (let waited = 0; waited < wait; waited += 1500) {
    await ask('/wake', 'POST');
    await sleep(1500);
    const now = await status();
    if (['connected', 'waiting'].includes(now.state)) return {...now, actions:[...actions, 'Esta computadora atiende la TV.']};
  }
  return {...await status(), actions};
}
export async function doctor() {
  const report = await status({probe:true});
  const checks = [...(report.checks || [])];
  if (!report.tv.configured) checks.push(`Configura el perfil ${report.tv.device}: npm exec -- ares-setup-device. Después solicita la llave: npm exec -- ares-novacom --device ${report.tv.device} --getkey.`);
  if(report.tv.needsUpdate)checks.push('La IP configurada no coincide con el perfil SSH. Guarda la dirección actual en Configurar para actualizar ambos.');
  if(report.profile?.state==='error')checks.push('Perfil compartido: '+report.profile.error);
  if (!report.tv.host) checks.push('Configura la dirección actual de la TV.');
  else if (!report.tvReachable) checks.push(`La TV no responde en ${report.tv.host}:${report.tv.port}; comprueba Developer Mode, Key Server y la red local.`);
  if(!report.build.holy || !report.build.luma) checks.push('Genera los dos inicios: npm run build:all.');
  if(report.host === '127.0.0.1') checks.push('Sin dirección de red local: conecta Wi-Fi o Ethernet, o configura la IP de la computadora.');
  if(report.error) checks.push(report.error);
  const peers = await Promise.all(config().peers.map(async host => ({host,reachable:await tcpOpen(host,43190,800)})));
  return {...report,checks,peers};
}
const repairLog=new DiagnosticLog();
export const repair=createDesktopRepair({status,recovery:createProfileRecovery({diagnostics:repairLog}),start,restart,log:result=>repairLog.event('doctor','repair',{phase:result.before,state:result.after})});

export async function runCLI() {
  try {
    const action = process.argv[2] || 'status';
    const actions = {status,start,stop,restart,handoff:()=>handoff(),configure:async()=>{
      saveConfig(JSON.parse(process.argv[3] || readFileSync(0,'utf8')));
      syncDeviceProfile(config()); return status();
    },doctor,diagnose:doctor,repair};
    if(!actions[action]) throw Error('Uso: desktop-control.mjs status|start|stop|restart|handoff|doctor|diagnose|repair|configure');
    console.log(JSON.stringify(await actions[action]()));
  } catch(error) {console.error(error.message);process.exitCode=1;}
}

if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { await runCLI(); }
