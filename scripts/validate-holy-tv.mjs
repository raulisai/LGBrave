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
const reportFile = join(out, process.argv.includes('--ending') ? 'ending-validation.json' : process.argv.includes('--search') ? 'search-validation.json' : process.argv.includes('--taste') ? 'taste-validation.json' : process.argv.some(arg => arg.startsWith('--episodes=')) ? 'episodes-validation.json' : process.argv.some(arg => arg.startsWith('--item=')) ? 'fallback-validation.json' : 'validation.json');
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
  const pick = (source, kind) => catalog.items.find(item => item.source === source && !item.isShow && (!kind || item.kind === kind));
  const pickPlayable = source => catalog.items.find(item => item.source === source && !item.isShow);
  const samples = [pick('cuevana', 'movie'), pick('repelishd'), pick('jkanime'), pick('doramasmp4'), pick('cuevana', 'series'), pickPlayable('animeyt'), pickPlayable('doramasflix'), pickPlayable('asialiveaction')].filter(Boolean);
  const watch = async (item, label, holdSeconds) => {
    const sample = { label, source: item.source, title: item.title, page: item.url };
    report.samples.push(sample); save();
    const started = Date.now();
    await bridge.command({ action: 'play', value: item });
    sample.player = bridge.session?.target?.split('?')[0];
    await waitFor(() => !alive() || ['playing', 'manual', 'failed'].includes(bridge.session?.phase) || (bridge.navigation.phase === 'error' && !bridge.session?.queue?.length), 120000).catch(() => {});
    sample.appAlive = alive();
    sample.phase = bridge.session?.phase || 'ended';
    sample.error = bridge.session?.error || (bridge.navigation.phase === 'error' ? bridge.navigation.error : '');
    sample.secondsToPlay = sample.phase === 'playing' ? Math.round((Date.now() - started) / 100) / 10 : null;
    sample.frames = bridge.session?.frames;
    sample.servers = bridge.session?.servers || 0;
    sample.finalPlayer = bridge.session?.target?.split('?')[0];
    sample.site = bridge.session?.site || '';
    sample.key = bridge.session?.key || entryKey(item);
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
    const entry = library.get(sample.key || entryKey(item));
    sample.saved = entry ? { t: entry.t, duration: entry.duration } : null;
    console.log(JSON.stringify({ label, phase: sample.phase, secondsToPlay: sample.secondsToPlay, advancing: sample.advancing, alive: sample.appAlive, back: sample.homeShown, servers: sample.servers, site: sample.site, player: sample.finalPlayer, saved: sample.saved, error: sample.error }));
    save();
    return sample;
  };
  // --search: the search flow through the home itself, with the remote's keys.
  if (process.argv.includes('--search')) {
    const keys = codes => cdp.evaluate(`(async()=>{for(const code of ${JSON.stringify(codes)}){window.dispatchEvent(new KeyboardEvent('keydown',{keyCode:code,bubbles:true}));await new Promise(r=>setTimeout(r,150))}})()`);
    const sample = { label: 'search', query: 'one piece' };
    report.samples.push(sample);
    // To «Buscar» by its place in the menu (all the way left, then right).
    const { SECTIONS } = await import('../src/holy.js');
    await keys([38, ...Array(SECTIONS.length + 1).fill(37), ...Array(SECTIONS.findIndex(entry => entry.id === 'buscar')).fill(39), 13]);
    await sleep(500);
    const started = Date.now();
    await cdp.evaluate(`(()=>{const input=document.querySelector('.searchbar input');input.value='one piece';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await waitFor(() => cdp.evaluate(`(s=>s.length>1&&s.every(x=>!x.className.includes('loading')))([...document.querySelectorAll('.sources-status span')])`), 20000).catch(() => {});
    sample.seconds = (Date.now() - started) / 1000;
    sample.status = await cdp.evaluate(`[...document.querySelectorAll('.sources-status span')].map(s=>s.textContent)`);
    sample.rows = await cdp.evaluate(`[...document.querySelectorAll('.row h2')].map(h=>h.textContent)`);
    // «Mejores resultados» on top, the series first (JKAnime for anime), and its newest episodes under it.
    sample.bestRow = await waitFor(() => cdp.evaluate(`[...document.querySelectorAll('.row h2')].findIndex(h=>/· Episodios/.test(h.textContent))>=0 && [...document.querySelectorAll('.row h2')].map(h=>h.textContent)`), 25000).catch(() => null);
    sample.rows = await cdp.evaluate(`[...document.querySelectorAll('.row h2')].map(h=>h.textContent)`);
    await shot('search');
    await keys([40]);
    await sleep(600);
    sample.firstResult = await cdp.evaluate(`document.querySelector('.card.focus')?.getAttribute('aria-label') + ' · ' + (document.querySelector('.preview .meta')?.textContent || '').replace(/\\s+/g,' ').trim()`);
    sample.bestOk = sample.rows?.[0] === 'Mejores resultados' && /^One Piece\b/.test(sample.firstResult || '') && /JKAnime/.test(sample.firstResult || '') && /^One Piece · Episodios 1\d{3}–1\d{3}$/.test(sample.rows?.[1] || '');
    await keys([13]);
    sample.episodes = await waitFor(() => cdp.evaluate(`document.querySelectorAll('.row').length && document.querySelector('.row h2').textContent.startsWith('Episodios') ? [...document.querySelectorAll('.row h2')].length : 0`), 20000).catch(() => 0);
    sample.firstBlock = await cdp.evaluate(`document.querySelector('.row h2')?.textContent`);
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
  // --ending: the end of an episode (card, countdown, the next one by itself; or the remote's
  // keys) and of a film (home or similar films), on the real player pages.
  if (process.argv.includes('--ending')) {
    const key = async code => { for (const type of ['rawKeyDown', 'keyUp']) await cdp.call('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code }); };
    // Jump to a few seconds before the end of the main video (shadow DOM and iframes included).
    const toEnd = async seconds => {
      const expression = `(()=>{const deep=(r,o=[])=>{o.push(...r.querySelectorAll('video'));for(const n of r.querySelectorAll('*'))if(n.shadowRoot)deep(n.shadowRoot,o);return o};for(const v of deep(document))if(Number.isFinite(v.duration)&&v.duration>60){v.currentTime=v.duration-${seconds};return true}return false})()`;
      for (const { id, sessionId } of await bridge.playerContexts()) if (await bridge.evaluateWithGesture(expression, id, sessionId).catch(() => false) === true) return true;
      return false;
    };
    const cardShown = () => cdp.evaluate(`!!document.querySelector('holy-end')`).catch(() => false);
    const waitCard = () => waitFor(async () => !!bridge.session?.card && await cardShown(), 40000).then(() => true, () => false);
    const playing = test => waitFor(() => !alive() || (bridge.session?.phase === 'playing' && (!test || test())), 90000).then(() => alive(), () => false);
    const show = 'https://jkanime.net/one-piece/';
    const episode = n => ({ source: 'jkanime', kind: 'anime', title: 'One Piece', show, url: show + n + '/', episode: n, subtitle: 'Episodio ' + n, genres: [] });
    const done = sample => { console.log(JSON.stringify(sample)); save(); };
    // 1. An episode ends: «Siguiente capítulo» with its countdown, then the next one plays by itself.
    const next = { label: 'ending-next' };
    report.samples.push(next);
    await bridge.command({ action: 'play', value: episode(1178) });
    next.started = await playing();
    await sleep(4000);
    next.seeked = await toEnd(12);
    let started = Date.now();
    next.card = await waitCard();
    next.cardAfter = (Date.now() - started) / 1000;
    next.options = bridge.session?.card?.options.map(option => option.action === 'play' ? option.item.subtitle : 'Volver al inicio');
    next.countdown = !!bridge.session?.card?.timer;
    await shot('ending-next').catch(() => {});
    started = Date.now();
    next.playedNext = await playing(() => bridge.session.item.episode === 1179);
    next.secondsToNext = (Date.now() - started) / 1000;
    next.ok = next.card && next.countdown && next.playedNext && bridge.session?.item?.episode === 1179;
    done(next);
    // 2. With the remote: → stops the countdown on «Volver al inicio», OK goes home.
    const keys = { label: 'ending-keys' };
    report.samples.push(keys);
    await sleep(4000);
    keys.seeked = await toEnd(12);
    keys.card = await waitCard();
    await key(39);
    await sleep(1500);
    keys.countdownStopped = bridge.session?.card?.timer === null && bridge.session?.card?.focus === 1;
    await sleep(8000);
    keys.stayed = bridge.session?.item?.episode === 1179 && !!bridge.session?.card;
    await key(13);
    keys.home = await waitFor(() => cdp.evaluate('location.href.startsWith(' + JSON.stringify(home) + ') && document.querySelectorAll(".row").length > 0'), 20000).then(() => true, () => false);
    keys.ok = keys.card && keys.countdownStopped && keys.stayed && keys.home && !bridge.session;
    done(keys);
    // 3. A film ends: «Volver al inicio» and similar films; → and OK play the first similar one.
    const film = pick('cuevana', 'movie');
    const ending = { label: 'ending-film', title: film?.title };
    report.samples.push(ending);
    if (film) {
      await bridge.command({ action: 'play', value: film });
      ending.started = await playing();
      await sleep(4000);
      ending.seeked = await toEnd(25);
      ending.card = await waitCard();
      ending.options = bridge.session?.card?.options.map(option => option.action === 'play' ? option.item.title : 'Volver al inicio');
      ending.countdown = !!bridge.session?.card?.timer;
      await shot('ending-film').catch(() => {});
      await key(39);
      await sleep(800);
      await key(13);
      ending.similarPlaying = await playing(() => bridge.session.item.title === ending.options?.[1]);
      if (alive()) {
        await bridge.command({ action: 'back' });
        ending.home = await waitFor(() => cdp.evaluate('document.querySelectorAll(".row").length > 0'), 20000).then(() => true, () => false);
      }
      ending.ok = ending.card && !ending.countdown && ending.options?.[0] === 'Volver al inicio' && ending.options.length > 1 && ending.similarPlaying && ending.home;
    }
    done(ending);
    samples.length = 0;
  }
  // --taste: the «Gustos» screen with the remote (test profile only, deleted at the end).
  if (process.argv.includes('--taste')) {
    const keys = codes => cdp.evaluate(`(async()=>{for(const code of ${JSON.stringify(codes)}){window.dispatchEvent(new KeyboardEvent('keydown',{keyCode:code,bubbles:true}));await new Promise(r=>setTimeout(r,250))}})()`);
    const sample = { label: 'taste' };
    report.samples.push(sample);
    // 1. «¿Qué te pareció?» after watching: a test title watched to 80 % (test profile only).
    const watched = pick('cuevana', 'movie');
    library.start(watched); library.progress(watched.url, watched.url, 2000, 2500);
    await bridge.command({ action: 'home' });
    sample.prompt = await waitFor(() => cdp.evaluate(`document.querySelector('.sheet-kicker')?.textContent + ' · ' + document.querySelector('.sheet h2')?.textContent`).then(text => (/Qué te pareció/.test(text) ? text : null)), 20000).catch(() => null);
    await keys([39, 13]);
    await sleep(2500);
    sample.promptVote = library.voteOf(watched);
    // 2. «Gustos»: chips (genre like, genre dislike, producer like), then a title: OK and green → «Me encanta».
    const { SECTIONS } = await import('../src/holy.js');
    await keys([38, ...Array(SECTIONS.length + 1).fill(37), ...Array(SECTIONS.findIndex(entry => entry.id === 'gustos')).fill(39), 13]);
    await waitFor(() => cdp.evaluate('document.querySelectorAll(".row .card").length > 5'), 20000).catch(() => {});
    sample.rows = await cdp.evaluate(`[...document.querySelectorAll('.row h2')].map(h=>h.textContent)`);
    await keys([13, 39, 403, 40, 13]);
    await sleep(2000);
    sample.prefs = library.prefs.map(pref => `${pref.type}:${pref.name}:${pref.value}`);
    const titleRow = sample.rows.findIndex(title => !['Géneros', 'Productoras y estudios', 'Países', 'Ya calificados'].includes(title));
    const down = Math.max(0, titleRow - 1);
    await keys([...Array(down).fill(40), 404]);
    await sleep(800);
    sample.sheet = await cdp.evaluate(`document.querySelector('.sheet-kicker')?.textContent`);
    await keys([39, 13]);
    await sleep(2500);
    sample.loved = library.votes.filter(vote => vote.vote === 2).length;
    sample.panel = await cdp.evaluate(`document.querySelector('.taste')?.innerText`);
    sample.marks = await cdp.evaluate(`document.querySelectorAll('.vote').length`);
    await shot('taste');
    sample.ok = /Qué te pareció/.test(sample.prompt || '') && sample.promptVote === 2 && sample.prefs.length === 3 && /Calificar/.test(sample.sheet || '') && sample.loved >= 2 && /gustos elegidos/.test(sample.panel || '');
    console.log(JSON.stringify(sample));
    library.clearVotes();
    save();
    samples.length = 0;
  }
  const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
  // --item=source:Title plays exactly that catalogue title (e.g. a copy with no servers, to see the fallback).
  const wanted = process.argv.find(arg => arg.startsWith('--item='))?.slice(7);
  if (wanted) { const [source, ...title] = wanted.split(':'); samples.splice(0, samples.length, catalog.items.find(item => item.source === source && !item.isShow && item.title.toLowerCase() === title.join(':').toLowerCase())); }
  // --episodes=source|show URL|title|1180,1100,1[|kind] plays those episodes of a show (e.g. One Piece on JKAnime;
  // Cuevana's One Piece is listed as a series: «|series»).
  const episodesArg = process.argv.find(arg => arg.startsWith('--episodes='))?.slice(11);
  if (episodesArg) {
    const [source, show, title, numbers, kind = 'anime'] = episodesArg.split('|');
    const list = (await catalog.episodes(source, show)).flatMap(season => season.episodes);
    const picked = numbers.split(',').map(Number).map(number => list.find(entry => entry.episode === number)).filter(Boolean);
    // With --item too, that title plays first (e.g. an AnimeYT episode that should open on JKAnime).
    samples.splice(0, samples.length, ...(wanted ? samples.slice(0, 1) : []), ...picked.map(entry => ({ source, kind, title, show, url: entry.url, episode: entry.episode, subtitle: entry.label, genres: [] })));
  }
  const hold = Number(process.argv.find(arg => arg.startsWith('--hold='))?.slice(7)) || 0;
  for (const [index, item] of samples.entries()) {
    if (only && item.source !== only) continue;
    const sample = await watch(item, `${index + 1}-${item.source}${item.episode ? '-' + item.episode : ''}`, hold || (index === 0 && !episodesArg ? 25 : 10));
    if (!sample.appAlive) { report.errors.push('La app se cerró en ' + item.source); break; }
  }
  const first = episodesArg ? null : samples.find(item => !only || item.source === only);
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
