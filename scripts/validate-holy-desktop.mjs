// Holy end to end on the Mac only: a headless Chrome stands in for the TV.
// For each site it plays the newest title through the real bridge (curtain,
// direct player, autoplay), checks that the video advances, goes back and
// checks the saved position; the first title is replayed to check resuming.
// Never touches the TV. Results: evidence/holy/desktop/.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.HOLY_PORT ||= '43191';
process.env.LAB_ORIGIN ||= 'http://127.0.0.1:' + process.env.HOLY_PORT;
const { connectTV, waitFor } = await import('./cdp.mjs');
const { HolyBridge } = await import('./holy/holy-bridge.mjs');
const { Catalog } = await import('./holy/catalog.mjs');
const { Library, entryKey } = await import('./holy/library.mjs');
const { startServer } = await import('./holy/server.mjs');
const { APP_ID, origin } = await import('./holy/config.mjs');
const { home } = await import('./browser-bridge.mjs');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out = 'evidence/holy/desktop';
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'holy-desktop-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { capturedAt: new Date().toISOString(), scope: 'Chrome de escritorio sin interfaz en el Mac, no la TV. Muestras cortas, el título más nuevo de cada sitio.', samples: [], errors: [] };
const save = () => writeFileSync(join(out, 'validation.json'), JSON.stringify(report, null, 2));

const catalog = new Catalog();
if (!catalog.items.length || process.argv.includes('--refresh')) await catalog.refresh();
const library = new Library(join(scratch, 'library.json'));
const server = startServer({ catalog, library, port: Number(process.env.HOLY_PORT), log: () => {} });
const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', '--window-size=1920,1080', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${join(scratch, 'chrome')}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
let cdp, bridge;
try {
  const portFile = join(scratch, 'chrome', 'DevToolsActivePort');
  await waitFor(() => existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n'), 15000);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  // Present the desktop tab as the Holy app, like the TV inspector does.
  const proxy = http.createServer(async (req, res) => {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(targets.filter(target => target.type === 'page').slice(0, 1).map(target => ({ ...target, description: APP_ID }))));
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  cdp = await connectTV(`http://127.0.0.1:${proxy.address().port}`);
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await cdp.call('Page.navigate', { url: home });
  await waitFor(() => cdp.evaluate('window.__lumaReady === true'), 15000);
  bridge = await new HolyBridge(cdp, { catalog, library, preferencesFile: join(scratch, 'settings.json'), recorder: false, mute: true }).start();
  const tick = setInterval(() => bridge.status().catch(() => {}), 1000);
  const shot = async name => writeFileSync(join(out, name + '.jpg'), Buffer.from((await cdp.call('Page.captureScreenshot', { format: 'jpeg', quality: 70 })).data, 'base64'));
  await waitFor(() => cdp.evaluate('document.querySelectorAll(".card").length > 10'), 20000);
  await sleep(1500); await shot('home');

  const pick = (source, kind) => catalog.items.find(item => item.source === source && !item.isShow && (!kind || item.kind === kind));
  const pickPlayable = source => catalog.items.find(item => item.source === source && !item.isShow);
  const samples = [pick('cuevana', 'movie'), pick('repelishd'), pick('jkanime'), pick('doramasmp4'), pick('cuevana', 'series'), pickPlayable('animeyt'), pickPlayable('doramasflix'), pickPlayable('asialiveaction')].filter(Boolean);
  const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
  // --item=source:Title plays exactly that catalogue title (e.g. a copy with no servers, to see the fallback).
  const wanted = process.argv.find(arg => arg.startsWith('--item='))?.slice(7);
  if (wanted) { const [source, ...title] = wanted.split(':'); samples.splice(0, samples.length, catalog.items.find(item => item.source === source && item.title.toLowerCase() === title.join(':').toLowerCase())); }
  const watch = async (item, label, holdSeconds = 8) => {
    const sample = { label, source: item.source, title: item.title, page: item.url };
    report.samples.push(sample); save();
    const started = Date.now();
    await bridge.command({ action: 'play', value: item });
    sample.player = bridge.session?.target?.split('?')[0]; // player addresses carry site tokens
    await waitFor(() => ['playing', 'manual', 'failed'].includes(bridge.session?.phase) || bridge.navigation.phase === 'error', 100000).catch(() => {});
    sample.phase = bridge.session?.phase || 'ended';
    sample.secondsToPlay = sample.phase === 'playing' ? Math.round((Date.now() - started) / 100) / 10 : null;
    sample.frames = bridge.session?.frames;
    sample.servers = bridge.session?.servers || 0;
    sample.finalPlayer = bridge.session?.target?.split('?')[0];
    sample.site = bridge.session?.site || '';
    sample.key = bridge.session?.key || entryKey(item);
    sample.navigation = bridge.navigation.phase === 'error' ? bridge.navigation.error : 'ok';
    if (sample.phase === 'playing') {
      await waitFor(() => bridge.session?.position, 5000).catch(() => {});
      const first = bridge.session?.position;
      await sleep(holdSeconds * 1000);
      const last = bridge.session?.position;
      sample.position = { first, last };
      sample.advancing = !!(first && last && last.t > first.t + holdSeconds / 2);
    }
    sample.curtainGone = await cdp.evaluate('!document.querySelector("holy-curtain") || getComputedStyle(document.querySelector("holy-curtain")).opacity === "0"').catch(() => null);
    await shot(label);
    await bridge.command({ action: 'back' });
    await waitFor(() => cdp.evaluate('location.href').then(url => url === home), 15000).catch(() => {});
    sample.afterBack = (await cdp.evaluate('location.href').catch(error => 'error: ' + error.message)).split('?')[0];
    sample.homeShown = await waitFor(() => cdp.evaluate('document.querySelectorAll(".row").length > 0'), 10000).then(() => true, () => false);
    const entry = library.get(sample.key || entryKey(item));
    sample.saved = entry ? { t: entry.t, duration: entry.duration } : null;
    console.log(JSON.stringify({ label, phase: sample.phase, secondsToPlay: sample.secondsToPlay, advancing: sample.advancing, servers: sample.servers, site: sample.site, player: sample.finalPlayer, saved: sample.saved }));
    save();
    return sample;
  };
  for (const [index, item] of samples.entries()) {
    if (only && item.source !== only) continue;
    try { await watch(item, `${index + 1}-${item.source}`, index === 0 && !wanted ? 30 : 8); }
    catch (error) { report.errors.push(`${item.source}: ${error.message}`); save(); }
  }
  // Resume: the first title opens again at the saved second.
  const first = samples.find(item => !only || item.source === only);
  const saved = first && library.get(entryKey(first));
  if (saved?.t > 20) {
    const sample = await watch(first, 'resume', 4);
    sample.resumedFrom = saved.t;
    sample.resumeOk = !!(sample.position?.last && sample.position.last.t >= saved.t);
    save();
  }
  await shot('home-after');
  report.homeRows = await cdp.evaluate('[...document.querySelectorAll(".row h2")].map(h=>h.textContent)');
  report.bridgeErrors = bridge.errors.slice(-20);
  clearInterval(tick);
  proxy.close();
} catch (error) { report.errors.push(error.message); console.error(error); }
finally {
  save();
  await bridge?.stop().catch(() => {});
  cdp?.close(); chrome.kill('SIGTERM'); server.close();
  await sleep(500);
  rmSync(scratch, { recursive: true, force: true });
}
console.log('Informe:', join(out, 'validation.json'), '· origen', origin());
process.exit(0);
