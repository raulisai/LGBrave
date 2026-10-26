// «Atrás» on the real TV in every situation where it used to leave a black screen.
// Back is sent as webOS delivers it to the page once the app owns the key
// (appinfo disableBackHistoryAPI → keydown 461). The physical button's native path
// cannot be driven from the Mac without pairing a remote, so it is reported apart.
// One process, one interceptor; test history in its own file, deleted at the end.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LabRuntime } from './lab-runtime.mjs';
import { acquireRuntimeLock } from './runtime-lock.mjs';
import { waitFor } from './cdp.mjs';
import { home, packagedHome } from './browser-bridge.mjs';
import { Catalog } from './holy/catalog.mjs';
import { Library } from './holy/library.mjs';
import { HolyBridge } from './holy/holy-bridge.mjs';
import { startServer } from './holy/server.mjs';
import { APP_ID } from './holy/config.mjs';

const run = promisify(execFile);
const ares = (tool, ...args) => run('npx', ['--no-install', tool, '--device', 'lg-lab', ...args], { timeout: 60000 }).then(result => result.stdout);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const out = 'evidence/holy/tv';
// --home-only: just the single Back on Holy's home.
const homeOnly = process.argv.includes('--home-only');
mkdirSync(out, { recursive: true });
const report = { capturedAt: new Date().toISOString(), scope: 'TV real. Atrás enviado como keydown 461 (lo que webOS entrega con disableBackHistoryAPI). El botón físico lo confirma el usuario.', cases: [], errors: [] };
const reportFile = homeOnly ? 'back-home-validation.json' : 'back-validation.json';
const save = () => writeFileSync(join(out, reportFile), JSON.stringify(report, null, 2));
const libraryFile = '.local/holy-library-backtest.json';
const release = acquireRuntimeLock('.local/holy-runtime.lock');
const catalog = new Catalog();
const library = new Library(libraryFile);
const server = startServer({ catalog, library, log: () => {} });
let runtime = null, ticking = false;
const startRuntime = () => {
  runtime = new LabRuntime({ log: () => {}, makeBridge: (cdp, options) => new HolyBridge(cdp, { ...options, catalog, library, mute: true }) });
  ticking = true;
  const current = runtime;
  (async () => { while (ticking && runtime === current) { await current.step().catch(() => {}); await sleep(1000); } })();
};
const stopRuntime = async () => { ticking = false; await runtime?.close().catch(() => {}); runtime = null; };
const bridge = () => runtime?.bridge;
const url = () => bridge()?.cdp.evaluate('location.href').catch(() => '');
const back = async () => {
  for (const type of ['rawKeyDown', 'keyUp']) await bridge().cdp.call('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 461, nativeVirtualKeyCode: 461, key: 'GoBack', code: 'GoBack' });
};
const movie = catalog.items.find(item => item.source === 'cuevana' && item.kind === 'movie' && !item.isShow);
const playMovie = async () => {
  await bridge().command({ action: 'play', value: movie });
  await waitFor(() => bridge()?.session?.phase === 'playing', 90000);
  await sleep(4000);
  // Where Back will land: the focused frame and whether the player runs as its own target.
  return { focus: await bridge().cdp.evaluate(`(document.activeElement?.tagName || '') + ' ' + (document.activeElement?.src || '').split('?')[0]`).catch(() => ''), playerTargets: bridge().childSessions.size };
};
// Holy's home is the page served by the Mac or the same UI packaged in the app (after webOS restarts it).
const isHome = href => String(href).startsWith(home) || String(href).startsWith(packagedHome);
const atHome = async () => isHome(await url());
const check = async (name, steps) => {
  const entry = { name };
  report.cases.push(entry);
  const started = Date.now();
  try {
    const before = bridge()?.cdp.target.id;
    await steps(entry);
    entry.reachedHome = await waitFor(atHome, 15000).then(() => true, () => false);
    entry.seconds = Math.round((Date.now() - started) / 100) / 10;
    entry.sameApp = !!bridge() && bridge().cdp.target.id === before;
    entry.sessionEnded = !bridge()?.session;
    entry.url = String(await url()).split('?')[0];
    entry.ok = entry.reachedHome && entry.sessionEnded;
  } catch (error) { entry.error = error.message; entry.ok = false; }
  console.log(JSON.stringify(entry));
  save();
};
try {
  startRuntime();
  await ares('ares-launch', APP_ID);
  await waitFor(() => bridge()?.mainFrame, 40000);

  // Exactly the failing path: Holy just opened (its built-in first page), play, Back.
  if (!homeOnly) {
  await check('Recién abierta: reproducir desde la primera pantalla y Atrás', async entry => {
    entry.firstPage = String(await url()).startsWith(packagedHome);
    entry.player = await playMovie();
    await back();
  });
  await check('Reproducir desde el inicio y Atrás', async entry => { entry.player = await playMovie(); await back(); });
  await check('El Mac se reconecta mientras se ve una película; luego Atrás', async entry => {
    await playMovie();
    await stopRuntime(); startRuntime();
    await waitFor(() => bridge()?.mainFrame, 40000);
    await sleep(3000);
    entry.reconnected = true;
    await back();
  });
  await check('El Mac se desconecta mientras se ve una película; luego Atrás', async entry => {
    await playMovie();
    const page = String(await url());
    const target = bridge().cdp.target.id;
    await stopRuntime();
    await sleep(10000);
    // Without the Mac, send Back through a bare connection (no bridge, nothing intercepted).
    const { openInspectorTunnel } = await import('./inspector-tunnel.mjs');
    const { connectTV } = await import('./cdp.mjs');
    const tunnel = await openInspectorTunnel();
    try {
      const cdp = await connectTV(tunnel.endpoint);
      entry.stillOnPlayer = page.startsWith('https://') && cdp.target.id === target;
      for (const type of ['rawKeyDown', 'keyUp']) await cdp.call('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 461, nativeVirtualKeyCode: 461, key: 'GoBack', code: 'GoBack' });
      entry.homeWithoutMac = await waitFor(() => cdp.evaluate('location.href').then(isHome), 15000).then(() => true, () => false);
      cdp.close();
    } finally { tunnel.close(); }
    startRuntime();
    await waitFor(() => bridge()?.mainFrame, 40000);
  });
  await check('Salir a otra app durante una película y volver; luego Atrás', async entry => {
    await playMovie();
    // A system app, so the Luma lab running on this Mac never takes part.
    await ares('ares-launch', 'com.palm.app.settings');
    await sleep(6000);
    await ares('ares-launch', APP_ID);
    await waitFor(() => bridge()?.mainFrame, 40000);
    await sleep(3000);
    entry.returnedTo = String(await url()).split('?')[0];
    if (!(await atHome())) await back();
  });
  }
  // On Holy's home, one Back only warns; it never exits on a single press.
  const homeCase = { name: 'Atrás en el inicio: una pulsación solo avisa' };
  report.cases.push(homeCase);
  // Wait until the home has drawn its rows: a key sent while it loads is lost.
  await waitFor(() => bridge()?.cdp.evaluate(`document.querySelectorAll('.app .rows > *').length > 0`).catch(() => false), 30000);
  await sleep(1500);
  await back();
  const toast = () => bridge().cdp.evaluate(`document.querySelector('.toast')?.textContent || ''`).catch(() => '');
  await waitFor(async () => /otra vez para salir/.test(await toast()), 4000).catch(() => {});
  homeCase.toast = await toast();
  homeCase.stillOpen = await atHome();
  homeCase.ok = /otra vez para salir/.test(homeCase.toast) && homeCase.stillOpen;
  console.log(JSON.stringify(homeCase));
} catch (error) { report.errors.push(error.message); console.error(error.message); }
finally {
  save();
  await stopRuntime();
  server.close(); catalog.stop();
  rmSync(libraryFile, { force: true }); rmSync(libraryFile + '.tmp', { force: true });
  release();
}
console.log('Informe:', join(out, reportFile));
process.exit(0);
