// Desktop simulation of a Holy start, on this computer (never the TV): resolves a title the way
// Holy does, opens each of its servers in a local headless Chrome through the real BrowserBridge
// (filters, navigation shield, page scripts) and runs Holy's own autoplay script in every frame.
// A server "plays" when its video advances by 3 s. Chrome here is newer than the TV's Chromium 120
// and has no remote: a pass is strong evidence, not proof, and a fail can still need a TV check.
//   node scripts/simulate-player.mjs --source=cuevana --q="big bang" [--season=1 --episode=1] [--seconds=40]
//   node scripts/simulate-player.mjs --url=https://… [--referrer=https://…]
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectTV } from './cdp.mjs';
import { BrowserBridge } from './browser-bridge.mjs';
import { autoplaySource } from './holy/page-scripts.mjs';
import { connectorFor } from './holy/connectors.mjs';
import { Catalog } from './holy/catalog.mjs';
import { fetchText } from './holy/sources.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => /^--([^=]+)=?(.*)$/.exec(arg)).filter(Boolean).map(([, key, value]) => [key, value || 'true']));
const seconds = Math.min(120, Number(args.seconds) || 40);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(path => existsSync(path));
const TV_AGENT = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 WebAppManager';

async function targets() {
  if (args.url) return { title: args.url, servers: [{ url: args.url, referrer: args.referrer || '' }] };
  const connector = connectorFor(args.source);
  if (!connector || !args.q) throw Error('Uso: --source=<fuente> --q="título" o --url=<reproductor>.');
  const directory = mkdtempSync(join(tmpdir(), 'holy-simulate-'));
  const load = (url, options = {}) => fetchText(url, { referrer: connector.site, ...options, timeout: 15000 });
  const catalog = new Catalog({ file: join(directory, 'c.json'), detailsFile: join(directory, 'd.json'), connectors: [connector], knownLists: null, fetch: load });
  try {
    const found = connector.search ? await connector.search(args.q, load) : connector.parseSearch(await load(connector.searchURL(args.q)), connector.site);
    let item = found.find(entry => args.season || args.episode ? entry.isShow : !entry.isShow) || found[0];
    if (!item) throw Error(`${connector.name} no encontró «${args.q}».`);
    if (item.isShow) {
      // Through the catalogue, as Holy asks (some sites need its POST helper).
      const list = (await catalog.episodes(connector.id, item.show)).flatMap(season => season.episodes);
      const episode = (args.episode && list.find(entry => (entry.season || 1) === Number(args.season || 1) && entry.episode === Number(args.episode))) || list[0];
      if (!episode) throw Error(`${connector.name} no lista capítulos de «${item.title}».`);
      item = { ...item, ...episode, isShow: false };
    }
    const resolved = await catalog.resolve(item, {});
    const target = resolved?.target || resolved;
    if (!target?.url) throw Error('La fuente no entregó reproductor.');
    return { title: `${item.title}${item.episode ? ` · T${item.season || 1}E${item.episode}` : ''}`, servers: [target.url, ...(target.alternatives || [])].map(url => ({ url, referrer: target.referrer || item.url })) };
  } finally { catalog.stop(); rmSync(directory, { recursive: true, force: true }); }
}

async function simulate(server) {
  const profile = mkdtempSync(join(tmpdir(), 'holy-chrome-'));
  const port = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    '--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process', '--window-size=1920,1080', '--no-first-run', `--user-agent=${TV_AGENT}`, 'about:blank'], { stdio: 'ignore' });
  const result = { host: new URL(server.url).hostname, played: false, sawVideo: false, best: null, blocked: 0, challenge: false, text: '' };
  let cdp, bridge;
  try {
    for (let i = 0; i < 40 && !cdp; i++) { await sleep(250); cdp = await connectTV(`http://127.0.0.1:${port}`, 'chrome', { select: list => list.find(entry => entry.type === 'page') }).catch(() => null); }
    if (!cdp) throw Error('Chrome no abrió su inspector.');
    bridge = await new BrowserBridge(cdp).start();
    await cdp.call('Page.navigate', { url: server.url, referrer: server.referrer });
    const started = Date.now(); let first = null;
    while (Date.now() - started < seconds * 1000) {
      await sleep(3000);
      const contexts = [...bridge.contexts].filter(([, context]) => context.auxData?.isDefault).map(([id]) => id);
      const frames = (await Promise.all(contexts.map(id => Promise.race([
        cdp.call('Runtime.evaluate', { expression: autoplaySource({ passive: false, mute: true }), contextId: id, returnByValue: true, awaitPromise: true, userGesture: true }).then(answer => answer.result?.value).catch(() => null),
        sleep(2500).then(() => null)])))).filter(Boolean);
      const videos = frames.flatMap(frame => frame.videos || []);
      if (videos.length) result.sawVideo = true;
      const best = videos.filter(video => video.d > 60).sort((a, b) => b.t - a.t)[0];
      if (best) { result.best = { t: Math.round(best.t), d: Math.round(best.d), paused: best.paused }; first ??= { t: best.t, at: Date.now() }; }
      if (best && first && best.t >= first.t + 3 && !best.paused) { result.played = true; result.startedAfter = Math.round((first.at - started) / 1000); break; }
    }
    const page = await cdp.evaluate(`({text:(document.body?.innerText||'').trim().slice(0,120),cf:/challenges\\.cloudflare|Just a moment|cf-chl/i.test(document.documentElement.outerHTML.slice(0,30000))})`).catch(() => ({}));
    result.text = page.text || ''; result.challenge = !!page.cf; result.blocked = bridge.records.filter(record => record.blocked).length;
  } catch (error) { result.error = error.message; }
  finally { await Promise.race([bridge?.stop(), sleep(2000)]).catch(() => {}); try { cdp?.close(); } catch { /* closed */ } chrome.kill(); await sleep(600); rmSync(profile, { recursive: true, force: true }); }
  return result;
}

if (!CHROME) throw Error('No hay Chrome ni Edge en este equipo.');
const { title, servers } = await targets();
console.log(`«${title}»: ${servers.length} servidor(es).`);
let any = false;
for (const server of servers.slice(0, 4)) {
  const result = await simulate(server);
  any ||= result.played;
  console.log(JSON.stringify(result));
  if (result.played && !args.all) break;
}
console.log(any ? 'Reproduce en la simulación de escritorio.' : 'Ningún servidor reprodujo en la simulación de escritorio.');
process.exit(any ? 0 : 1);
