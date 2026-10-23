// Holy on the real TV. One process is Holy's only interceptor (server, catalogue,
// passive runtime). It opens Holy, plays the newest title of each site muted, goes
// back, checks the saved position and resumes the first one. Test history goes to
// its own file and is deleted. At the end the app that was in front is reopened.
// Run only when no other session uses the TV. Results: evidence/holy/tv/.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LabRuntime } from './lab-runtime.mjs';
import { acquireRuntimeLock } from './runtime-lock.mjs';
import { openInspectorTunnel } from './inspector-tunnel.mjs';
import { waitFor } from './cdp.mjs';
import { home } from './browser-bridge.mjs';
import { Catalog } from './holy/catalog.mjs';
import { Library, entryKey } from './holy/library.mjs';
import { HolyBridge } from './holy/holy-bridge.mjs';
import { startServer } from './holy/server.mjs';
import { APP_ID } from './holy/config.mjs';

const run = promisify(execFile);
const ares = (tool, ...args) => run('npx', ['--no-install', tool, '--device', 'lg-lab', ...args], { timeout: 60000 }).then(result => result.stdout);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const out = 'evidence/holy/tv';
mkdirSync(out, { recursive: true });
const report = { capturedAt: new Date().toISOString(), scope: 'LG 75UR8750PSA real, vídeo silenciado, muestras cortas del título más nuevo de cada sitio.', samples: [], errors: [] };
const reportFile = join(out, process.argv.includes('--search') ? 'search-validation.json' : 'validation.json');
const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2));
const memory = async () => (await ares('ares-device', '-r').catch(() => '')).split('\n').find(line => line.startsWith('memory'))?.trim();
const libraryFile = '.local/holy-library-tvtest.json';

const release = acquireRuntimeLock('.local/holy-runtime.lock');
const catalog = new Catalog();
if (!catalog.items.length || Date.now() - catalog.updatedAt > 3600000) await catalog.refresh();
const library = new Library(libraryFile);
const server = startServer({ catalog, library, log: () => {} });
const runtime = new LabRuntime({ log: () => {}, makeBridge: (cdp, options) => new HolyBridge(cdp, { ...options, catalog, library, mute: true }) });
let ticking = true;
(async () => { while (ticking) { await runtime.step().catch(() => {}); await sleep(1000); } })();
try {
  // What the owner had in front, to put it back afterwards.
  const tunnel = await openInspectorTunnel();
  const targets = await (await fetch(tunnel.endpoint + '/json', { signal: AbortSignal.timeout(5000) })).json();
  tunnel.close();
  report.before = { running: (await ares('ares-launch', '-r')).split('\n').filter(line => /^[a-z]+\./.test(line.trim())), targets: targets.map(target => ({ app: target.description, url: (target.url || '').split('?')[0] })), memory: await memory() };
  await ares('ares-launch', APP_ID);
  await waitFor(() => runtime.bridge?.mainFrame, 40000).catch(() => { throw Error('Holy no se conectó (estado ' + runtime.state + ')'); });
  const bridge = runtime.bridge;
  const cdp = runtime.cdp;
  const shot = async name => writeFileSync(join(out, name + '.jpg'), Buffer.from((await cdp.call('Page.captureScreenshot', { format: 'jpeg', quality: 70 })).data, 'base64'));
  await bridge.command({ action: 'home' });
  await waitFor(() => cdp.evaluate('document.querySelectorAll(".card").length > 10'), 30000).catch(async () => { throw Error('El inicio no mostró títulos: ' + await cdp.evaluate('location.href + " " + document.body.innerText.slice(0, 120)').catch(e => e.message)); });
  await sleep(2500); await shot('home');
  const alive = () => runtime.bridge === bridge && !runtime.connectionClosed;
  const pick = (source, kind) => catalog.items.find(item => item.source === source && (!kind || item.kind === kind));
  const samples = [pick('cuevana', 'movie'), pick('repelishd'), pick('jkanime'), pick('doramasmp4'), pick('cuevana', 'series')].filter(Boolean);
  const watch = async (item, label, holdSeconds) => {
    const sample = { label, source: item.source, title: item.title, page: item.url };
    report.samples.push(sample); save();
    const started = Date.now();
    await bridge.command({ action: 'play', value: item });
    sample.player = bridge.session?.target?.split('?')[0];
    await waitFor(() => !alive() || ['playing', 'manual', 'failed'].includes(bridge.session?.phase) || bridge.navigation.phase === 'error', 80000).catch(() => {});
    sample.appAlive = alive();
    sample.phase = bridge.session?.phase || 'ended';
    sample.error = bridge.session?.error || (bridge.navigation.phase === 'error' ? bridge.navigation.error : '');
    sample.secondsToPlay = sample.phase === 'playing' ? Math.round((Date.now() - started) / 100) / 10 : null;
    sample.frames = bridge.session?.frames;
    if (sample.phase === 'playing') {
      // The bridge records the position on its next one-second pass.
      await waitFor(() => bridge.session?.position, 5000).catch(() => {});
      const first = bridge.session?.position;
      await sleep(holdSeconds * 1000);
      const last = bridge.session?.position;
      sample.position = { first, last };
      sample.advancing = !!(first && last && last.t > first.t + holdSeconds / 2);
      sample.appAlive = alive();
    }
    if (alive()) {
      sample.curtainGone = await cdp.evaluate('!document.querySelector("holy-curtain") || getComputedStyle(document.querySelector("holy-curtain")).opacity === "0"').catch(() => null);
      await shot(label).catch(() => {});
      await bridge.command({ action: 'back' });
      sample.homeShown = await waitFor(() => cdp.evaluate('location.href.startsWith(' + JSON.stringify(home) + ') && document.querySelectorAll(".row").length > 0'), 20000).then(() => true, () => false);
    }
    const entry = library.get(entryKey(item));
    sample.saved = entry ? { t: entry.t, duration: entry.duration } : null;
    console.log(JSON.stringify({ label, phase: sample.phase, secondsToPlay: sample.secondsToPlay, advancing: sample.advancing, alive: sample.appAlive, back: sample.homeShown, saved: sample.saved, error: sample.error }));
    save();
    return sample;
  };
  // --search: the search flow through the home itself, with the remote's keys.
  if (process.argv.includes('--search')) {
    const keys = codes => cdp.evaluate(`(async()=>{for(const code of ${JSON.stringify(codes)}){window.dispatchEvent(new KeyboardEvent('keydown',{keyCode:code,bubbles:true}));await new Promise(r=>setTimeout(r,150))}})()`);
    const sample = { label: 'search', query: 'one piece' };
    report.samples.push(sample);
    await keys([38, 39, 39, 39, 39, 39, 13]);
    await sleep(500);
    const started = Date.now();
    await cdp.evaluate(`(()=>{const input=document.querySelector('.searchbar input');input.value='one piece';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await waitFor(() => cdp.evaluate(`(s=>s.length>1&&s.every(x=>!x.className.includes('loading')))([...document.querySelectorAll('.sources-status span')])`), 20000).catch(() => {});
    sample.seconds = (Date.now() - started) / 1000;
    sample.status = await cdp.evaluate(`[...document.querySelectorAll('.sources-status span')].map(s=>s.textContent)`);
    sample.rows = await cdp.evaluate(`[...document.querySelectorAll('.row h2')].map(h=>h.textContent)`);
    await shot('search');
    await keys([40]);
    for (let i = 0; i < 5 && !(await cdp.evaluate(`document.querySelector('.row.active h2')?.textContent.startsWith('JKAnime')`)); i++) await keys([40]);
    await keys([13]);
    sample.episodes = await waitFor(() => cdp.evaluate(`document.querySelectorAll('.row').length && document.querySelector('.row h2').textContent.startsWith('Episodios') ? [...document.querySelectorAll('.row h2')].length : 0`), 20000).catch(() => 0);
    sample.focus = await cdp.evaluate(`document.querySelector('.card.focus')?.getAttribute('aria-label')`);
    await shot('episodes');
    const playStarted = Date.now();
    await keys([13]);
    await waitFor(() => !alive() || ['playing', 'manual', 'failed'].includes(bridge.session?.phase), 80000).catch(() => {});
    sample.phase = bridge.session?.phase; sample.secondsToPlay = (Date.now() - playStarted) / 1000; sample.appAlive = alive();
    sample.player = bridge.session?.target?.split('?')[0];
    if (sample.phase === 'playing') { await sleep(8000); sample.position = bridge.session?.position; }
    if (alive()) {
      await bridge.command({ action: 'back' });
      sample.homeShown = await waitFor(() => cdp.evaluate('document.querySelectorAll(".row").length > 0'), 20000).then(() => true, () => false);
    }
    console.log(JSON.stringify(sample));
    save();
    samples.length = 0;
  }
  const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
  const hold = Number(process.argv.find(arg => arg.startsWith('--hold='))?.slice(7)) || 0;
  for (const [index, item] of samples.entries()) {
    if (only && item.source !== only) continue;
    const sample = await watch(item, `${index + 1}-${item.source}`, hold || (index === 0 ? 25 : 10));
    if (!sample.appAlive) { report.errors.push('La app se cerró en ' + item.source); break; }
  }
  const first = samples.find(item => !only || item.source === only);
  const saved = first && library.get(entryKey(first));
  if (alive() && saved?.t > 20) {
    const sample = await watch(first, 'resume', 5);
    sample.resumedFrom = saved.t;
    sample.resumeOk = !!(sample.position?.last && sample.position.last.t >= saved.t);
    save();
  }
  report.after = { memory: await memory() };
  report.bridgeErrors = bridge.errors.slice(-20);
} catch (error) { report.errors.push(error.message); console.error(error.message); }
finally {
  save();
  ticking = false;
  await runtime.close().catch(() => {});
  server.close(); catalog.stop();
  rmSync(libraryFile, { force: true }); rmSync(libraryFile + '.tmp', { force: true });
  release();
}
console.log('Informe:', reportFile);
process.exit(0);
