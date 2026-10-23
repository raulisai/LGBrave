import {setTimeout as delay} from 'node:timers/promises';
import {LabRuntime} from './lab-runtime.mjs';
import {acquireRuntimeLock} from './runtime-lock.mjs';
import {FilterUpdates} from './filter-updates.mjs';

let release;
try { release = acquireRuntimeLock(); }
catch (error) { console.error(error.message); process.exit(1); }
const runtime = new LabRuntime();
const updates = new FilterUpdates().start();
const abort = new AbortController();
let finishing;
function finish() {
  if (finishing) return finishing;
  abort.abort();
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
