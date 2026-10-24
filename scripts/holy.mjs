import { setTimeout as delay } from 'node:timers/promises';
import { LabRuntime } from './lab-runtime.mjs';
import { acquireRuntimeLock } from './runtime-lock.mjs';
import { FilterUpdates } from './filter-updates.mjs';
import { Catalog } from './holy/catalog.mjs';
import { Library } from './holy/library.mjs';
import { HolyBridge } from './holy/holy-bridge.mjs';
import { startServer } from './holy/server.mjs';
import { APP_ID, origin } from './holy/config.mjs';
import { installCrashGuard } from './holy/guard.mjs';

// One process for Holy: home server, catalogue, and the passive bridge to the TV.
// Like Luma's lab it never opens the app; it connects when Holy is already open.
// `npm run holy` runs it under holy-supervisor.mjs, which restarts it if it stops.

installCrashGuard();
let release = () => {};
if (process.env.HOLY_TV !== '0') {
  try { release = acquireRuntimeLock('.local/holy-runtime.lock'); }
  catch (error) { console.error(error.message); process.exit(1); }
}
// HOLY_LIBRARY: another history file (a preview that must not touch the owner's).
const library = new Library(process.env.HOLY_LIBRARY || undefined);
const catalog = new Catalog({ log: console.log }).start(console.log);
const server = startServer({ catalog, library, status: () => ({ tv: runtime?.state || 'sin TV', playing: runtime?.bridge?.session ? { title: runtime.bridge.session.item.title, phase: runtime.bridge.session.phase } : null }) });
// HOLY_TV=0 serves the home and catalogue only (desktop preview, or while another session uses the TV).
const withTV = process.env.HOLY_TV !== '0';
const runtime = new LabRuntime({ makeBridge: (cdp, options) => new HolyBridge(cdp, { ...options, catalog, library }) });
const updates = withTV && process.env.HOLY_FILTER_UPDATES !== '0' ? new FilterUpdates().start() : null;
const abort = new AbortController();
let finishing;
function finish() {
  if (finishing) return finishing;
  abort.abort(); updates?.stop(); catalog.stop(); server.close();
  finishing = runtime.close();
  return finishing;
}
process.once('SIGINT', finish); process.once('SIGTERM', finish);
console.log(`Holy: inicio en ${origin()}/holy/ · ` + (withTV ? `espera a que abras ${APP_ID} en la TV (no se abrirá sola).` : 'sin conexión con la TV (HOLY_TV=0).'));
try {
  while (withTV && !runtime.stopping) {
    await runtime.step();
    if (runtime.stopping) break;
    await delay(runtime.state === 'offline' ? 5000 : 1500, undefined, { signal: abort.signal }).catch(() => {});
  }
  if (!withTV) await new Promise(resolve => abort.signal.addEventListener('abort', resolve));
} finally {
  await finish(); release();
}
