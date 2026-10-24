import {setTimeout as delay} from 'node:timers/promises';
import {mkdirSync, writeFileSync} from 'node:fs';
import {LabRuntime} from './lab-runtime.mjs';
import {acquireRuntimeLock} from './runtime-lock.mjs';
import {FilterUpdates} from './filter-updates.mjs';
import {installCrashGuard} from './crash-guard.mjs';

// `npm run lab` runs this under lab-supervisor.mjs, which restarts it if it stops.
installCrashGuard();
let release;
try { release = acquireRuntimeLock(); }
catch (error) { console.error(error.message); process.exit(2); }
const runtime = new LabRuntime();
const updates = new FilterUpdates().start();
const abort = new AbortController();
// Read by scripts/luma-control.mjs (menu-bar app): connected | waiting | offline | starting | stopped.
const writeStatus = state => { try { mkdirSync('.local', {recursive:true}); writeFileSync('.local/lab-status.json', JSON.stringify({pid:process.pid, state:state ?? runtime.state ?? 'starting', updated:Date.now()})); } catch { /* Status is informational. */ } };
const statusTimer = setInterval(() => writeStatus(), 2000); statusTimer.unref();
writeStatus();
let finishing;
function finish() {
  if (finishing) return finishing;
  abort.abort();
  clearInterval(statusTimer); writeStatus('stopped');
  updates.stop();
  finishing = runtime.close();
  return finishing;
}
process.once('SIGINT', finish); process.once('SIGTERM', finish);
console.log('Laboratorio pasivo: solo conecta con Luma cuando ya está abierta. Servidor: npm run lab:server');
try {
  while (!runtime.stopping) {
    await runtime.step();
    if (runtime.stopping) break;
    await delay(runtime.state === 'offline' ? 5000 : 1500, undefined, {signal:abort.signal}).catch(() => {});
  }
} finally {
  await finish(); release();
}
