import {createProfileRecovery} from './profile-recovery.mjs';
import {DiagnosticLog} from '../../scripts/diagnostics.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {writeFileSync, mkdirSync} from 'node:fs';
import {LabRuntime} from '../../scripts/lab-runtime.mjs';
import {findLumaTarget} from '../../scripts/cdp.mjs';
import {BrowserBridge} from '../../scripts/browser-bridge.mjs';
import {HolyBridge} from '../../scripts/holy/holy-bridge.mjs';
import {Catalog} from '../../scripts/holy/catalog.mjs';
import {Library} from '../../scripts/holy/library.mjs';
import {startServer} from '../../scripts/holy/server.mjs';
import {createDoctor} from '../../scripts/holy/doctor.mjs';
import {createAutostart} from '../../scripts/holy/autostart.mjs';
import {lanAddress, tvAddress, config, ROOT,lumaOrigin} from './desktop-config.mjs';
import {acquireRuntimeLock} from '../../scripts/runtime-lock.mjs';
import {FilterUpdates} from '../../scripts/filter-updates.mjs';
import {installCrashGuard} from '../../scripts/crash-guard.mjs';
import {Preferences} from '../../scripts/preferences.mjs';
import {ProfileState} from './profile-state.mjs';
import {openInspectorTunnel} from '../../scripts/inspector-tunnel.mjs';

process.chdir(ROOT);
const diagnostics=new DiagnosticLog();
installCrashGuard(console.log,diagnostics);
diagnostics.event('service','started');
const recovery=createProfileRecovery({diagnostics});
try{recovery.restore();recovery.capture();}catch(error){diagnostics.event('profile','recovery-error',{error},'error');}
let release;
try { release = acquireRuntimeLock(); }
catch (error) { console.error(error.message); process.exit(2); }
const library = new Library();
const preferences=new Preferences();
const profiles=new ProfileState({preferences,library,diagnostics});
let activeStore;
const catalog = new Catalog({log:console.log,diagnostics});
if (process.env.LUMA_OFFLINE_TEST !== '1') catalog.start(console.log);
const runtime = new LabRuntime({
  openTunnel:async()=>{
    const tunnel=await openInspectorTunnel();
    if(tunnel.profile){
      activeStore=tunnel.profile;
      await profiles.connect(tunnel.profile);
      tunnel.closed.then(()=>{if(activeStore===tunnel.profile){activeStore=null;profiles.disconnect();}});
    }
    return tunnel;
  },
  selectTarget: targets => findLumaTarget(targets, 'com.lgapp.holy') || findLumaTarget(targets),
  makeBridge: (cdp, options) => options.target.description === 'com.lgapp.holy' || options.target.url?.includes('/com.lgapp.holy/')
    ? new HolyBridge(cdp, {...options, catalog, library,preferences,diagnostics}) : new BrowserBridge(cdp, {...options,preferences,diagnostics,home:lumaOrigin()+'/luma-home/'})
});
const startedAddress = lanAddress();
const doctor = createDoctor({catalog, library, runtime, tv:tvAddress(), startedAddress, currentAddress:lanAddress,
  supervised:!!process.send, restart:() => { finish().then(() => process.exit(1)); },
  autostart:createAutostart()});
const server = startServer({catalog, library, doctor, diagnostics,
  status:() => ({tv:runtime.state || 'starting', computer:lanAddress(),profile:profiles.status()})});
await import('../../scripts/fixture-server.mjs');
const updates = process.env.LUMA_OFFLINE_TEST === '1' ? null : new FilterUpdates().start();
const abort = new AbortController();
let finishing;
function finish() {
  if (finishing) return finishing;
  diagnostics.event('service','stopping');
  abort.abort(); clearInterval(statusTimer); updates?.stop(); catalog.stop(); server.close();
  finishing = profiles.flush().catch(()=>{}).then(()=>runtime.close()).finally(() => {profiles.disconnect();release();});
  return finishing;
}
let reportedState='';
const report = () => {
  const state = runtime.state || 'starting';
  const status = {state, app:runtime.cdp?.target.description || '', host:lanAddress(), tv:tvAddress(),
    error:runtime.lastError || '', profile:profiles.status(), updated:Date.now(), pid:process.pid};
  const stateKey=[state,status.app,status.error,status.profile.state].join('|');
  if(stateKey!==reportedState){reportedState=stateKey;diagnostics.event('connection','state',{state,error:status.error,phase:status.profile.state},status.error?'warn':'info');}
  process.send?.({type:'status', status});
  mkdirSync('.local', {recursive:true});
  writeFileSync('.local/lab-status.json', JSON.stringify(status));
};
const statusTimer = setInterval(report, 2000); statusTimer.unref();
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => finish().finally(() => process.exit(0)));
process.on('message', message => { if (message === 'stop') finish().finally(() => process.exit(0)); });
process.on('disconnect', () => finish().finally(() => process.exit(0)));
try {
  report();
  while (!runtime.stopping) {
    if(lanAddress()!==startedAddress){await finish();process.exit(1);}
    if (process.env.LUMA_OFFLINE_TEST === '1') runtime.setState('waiting','Prueba local sin TV ni Internet.');
    else if (!tvAddress().configured||tvAddress().needsUpdate) {
      try{recovery.restore();}catch(error){diagnostics.event('profile','recovery-error',{error},'error');}
      runtime.lastError = tvAddress().needsUpdate?'La IP guardada no coincide con el perfil SSH; actualízala en Configurar.':`Falta vincular el perfil webOS ${config().device} en esta computadora.`;
      runtime.setState('setup', runtime.lastError);
    } else {
      try{recovery.capture();}catch(error){diagnostics.event('profile','recovery-error',{error},'error');}
      await runtime.step();
    }
    if(runtime.state==='connected'||runtime.state==='waiting')await profiles.flush();
    report();
    await delay(['offline','standby','setup'].includes(runtime.state) ? 5000 : 1500, undefined, {signal:abort.signal}).catch(() => {});
  }
} finally { await finish(); }
