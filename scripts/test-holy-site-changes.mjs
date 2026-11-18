// Site changes and playback fixes found in the 2026-11-17 review (docs/REPRODUCCION-REVISION-20261117.md).
// Offline: real markup shapes seen that day, no TV, no Internet.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cuevana, repelishd, REPELIS_SERIES, rankServers } from './holy/sources.mjs';
import { doramasflixbeer, animeyt } from './holy/more-sources.mjs';
import { CONNECTORS, RETIRED_SOURCES } from './holy/connectors.mjs';
import { Catalog } from './holy/catalog.mjs';
import { HolyBridge } from './holy/holy-bridge.mjs';

const directory = mkdtempSync(join(tmpdir(), 'holy-site-changes-'));
const nativeFetch = globalThis.fetch;
globalThis.fetch = () => { throw Error('Network forbidden in this test'); };
let passed = 0;
const check = async (name, fn) => { try { await fn(); passed++; } catch (error) { error.message = name + ': ' + error.message; throw error; } };

try {
  await check('Cuevana cambia de dominio (3c → 3t): su propio reproductor sigue valiendo; otros servidores no', () => {
    const target = cuevana.player({ players: ['https://tungtungsahur.cuevana3t.pro/?token=abc', 'https://tungtungsahur.cuevana3c.pro/?token=def', 'https://evil.example/?x=1', 'javascript:alert(1)'] }, 'https://cuevana3t.pro/pelicula/x');
    assert.deepEqual(target, { url: 'https://tungtungsahur.cuevana3t.pro/?token=abc&pops=false', referrer: 'https://cuevana3t.pro/pelicula/x', alternatives: ['https://tungtungsahur.cuevana3c.pro/?token=def&pops=false'] });
    assert.equal(cuevana.player({ players: ['https://cuevana3t.pro.evil.example/?t=1'] }, ''), null);
  });

  const card = (path, title, extra = '') => `<a class="cv" href="${path}" title="${title}" data-voto="8,2"${extra}><div class="cv-art"><img src="https://image.tmdb.org/t/p/w342/p.jpg" alt="${title}"/><span class="vers"><b class="vers-latino">LAT</b><b class="vers-castellano">CAST</b></span></div><div class="cv-t">${title}</div><div class="cv-m">2026</div></a>`;
  await check('RePelisHD rediseñado: tarjetas «cv» y búsqueda nueva; sus series no se listan (solo Dropload/Doodstream)', () => {
    const html = '<h2 class="rail-title">Últimas añadidas</h2>' + card('/ver-pelicula/687163-proyecto-salvacion-online-espanol', 'Proyecto Salvación') + card('/ver-serie/1418-big-bang-online-espanol', 'Big Bang') + card('/ver-serie/1418-big-bang-online-espanol/temporada-1/episodio-1', 'Piloto');
    const items = repelishd.parseHome(html);
    assert.equal(REPELIS_SERIES, false);
    assert.deepEqual(items.map(item => [item.kind, item.title, item.url, item.year, item.rating, item.language]),
      [['movie', 'Proyecto Salvación', 'https://repelishd.blog/ver-pelicula/687163-proyecto-salvacion-online-espanol', '2026', '8.2', 'Latino · Castellano']]);
    assert.equal(repelishd.searchURL('juego de tronos'), 'https://repelishd.blog/buscar?q=juego%20de%20tronos');
    assert.equal(repelishd.parseSearch(html).length, 1);
  });

  await check('RePelisHD: ficha nueva (JSON-LD, iframe de playlatinsrc) y capítulos desde el reproductor de series', async () => {
    const detail = repelishd.parseDetail('<meta property="og:description" content="Ver Big Bang online gratis en HD: todas las temporadas y capítulos en español latino. Leonard y Sheldon son dos físicos."/>' +
      '<script type="application/ld+json">{"image":["https://image.tmdb.org/t/p/w500/a.jpg","https://image.tmdb.org/t/p/w1280/b.jpg"],"genre":["Comedia","Drama"]}</script><li><b>País</b><span>EE. UU.</span></li><a href="https://playlatinsrc.co/serial/tt0898266">x</a>');
    assert.deepEqual([detail.imdb, detail.genres, detail.overview, detail.backdrop], ['tt0898266', ['Comedia', 'Drama'], 'Leonard y Sheldon son dos físicos.', 'https://image.tmdb.org/t/p/w1280/b.jpg']);
    const show = 'https://repelishd.blog/ver-serie/1418-big-bang-online-espanol';
    const pages = { [show]: '<a href="https://playlatinsrc.co/serial/tt0898266">', 'https://playlatinsrc.co/serial/tt0898266': '<div class="_ep " data-season="1" data-episode="2" data-label="S1 E2 — La hipótesis"></div><div class="_ep " data-season="1" data-episode="1" data-label="S1 E1 — Piloto"></div><div class="_ep" data-season="2" data-episode="1" data-label="S2 E1 — Otra"></div>' };
    const seasons = await repelishd.episodes(show, async url => pages[url]);
    assert.deepEqual(seasons.map(season => [season.number, season.episodes.map(episode => [episode.episode, episode.url, episode.label])]), [
      [1, [[1, show + '/temporada-1/episodio-1', 'T1 · Episodio 1 · Piloto'], [2, show + '/temporada-1/episodio-2', 'T1 · Episodio 2 · La hipótesis']]],
      [2, [[1, show + '/temporada-2/episodio-1', 'T2 · Episodio 1 · Otra']]]]);
    // An episode asks the series API; only Dropload/Doodstream there: refused, never opened.
    const tv = { ok: true, tv: { version: 'latino', seasons: [{ season_number: 1, episodes: [{ episode_number: 1, sources: [{ url: 'https://dr0pstream.com/e/1' }, { url: 'https://doodstream.com/e/2' }] }, { episode_number: 2, sources: [{ url: 'https://mxdrop.to/e/9' }] }] }] } };
    const load = async (url, options = {}) => (url === show ? pages[show] : url.endsWith('/serial/tt0898266') ? 'token: "T"' : (assert.equal(JSON.parse(options.body).type, 'tv'), JSON.stringify(tv)));
    await assert.rejects(repelishd.resolve({ url: show + '/temporada-1/episodio-1' }, load), /cierran la app/);
    assert.deepEqual(await repelishd.resolve({ url: show + '/temporada-1/episodio-2' }, load), { url: 'https://mxdrop.to/e/9', referrer: 'https://playlatinsrc.co/serial/tt0898266', server: undefined, version: 'latino', alternatives: [] });
    await assert.rejects(repelishd.resolve({ url: show + '/temporada-3/episodio-1' }, load), /todavía no tiene el capítulo 1 de la temporada 3/);
  });

  await check('Doodstream y su redirección playmogo cuentan como servidores que cierran la app', () => {
    assert.deepEqual(rankServers([{ url: 'https://doodstream.com/e/1' }, { url: 'https://playmogo.com/e/1' }, { url: 'https://dood.wf/e/1' }, { url: 'https://mxdrop.to/e/1' }]).map(source => source.url), ['https://mxdrop.to/e/1']);
  });

  await check('DoramasFlix .beer: tarjetas «v6-clean-card» y búsqueda /search/', () => {
    const html = '<a href="https://doramasflix.beer/series/between-steps-2026/" class="v6-clean-card"><div class="v6-frame-tall"><img src="https://image.tmdb.org/t/p/w500/x.jpg" class="v6-img-core" /><div class="v6-badge-box-rating">⭐ 7.5</div></div><h3 class="v6-text-primary-title">Between Steps (2026)</h3></a>' +
      '<a href="https://doramasflix.beer/episodios/love-1x10/" class="v6-clean-card"><h3 class="v6-text-primary-title">Love</h3></a>';
    assert.deepEqual(doramasflixbeer.parseHome(html).map(item => [item.title, item.year, item.rating, item.url]), [['Between Steps', '2026', '7.5', 'https://doramasflix.beer/series/between-steps-2026/']]);
    assert.equal(doramasflixbeer.searchURL('between steps'), 'https://doramasflix.beer/search/between%20steps/');
  });

  await check('AnimeYT: reproductor «multiplayer» nuevo (botón → contenedor con videoTabs); ok.ru primero, MEGA y falsos nunca', async () => {
    const episode = 'https://animeyt.cc/110444/anime/one-piece-heroines-capitulo-1/';
    const options = 'https://mytsumi.com/multiplayer/options.php?server=multi&value=VfS4Q9RzBt&bg=x';
    const tabs = [{ tab_name: 'Moon', url: 'https://bysesukior.com/e/q', status: 'active', is_mp4: false, is_fake_player: false },
      { tab_name: 'Fake', url: 'https://fake.example/e', status: 'active', is_mp4: false, is_fake_player: true },
      { tab_name: 'Mega', url: 'https://mega.nz/embed/x', status: 'active', is_mp4: false, is_fake_player: false },
      { tab_name: 'OK', url: 'https://ok.ru/videoembed/1534', status: 'active', is_mp4: false, is_fake_player: false },
      { tab_name: 'Old', url: 'https://old.example/e', status: 'inactive', is_mp4: false, is_fake_player: false }];
    const pages = { [episode]: `<iframe src="${options.replace(/&/g, '&amp;')}"></iframe>`,
      'https://mytsumi.com/multiplayer/contenedor.php?id=VfS4Q9RzBt': `<script>const videoTabs = ${JSON.stringify(tabs)};\nconst x=1;</script>` };
    const asked = [];
    const target = await animeyt.resolve({ url: episode }, async (url, opts = {}) => { asked.push([url, opts.referrer || '']); return pages[url] || ''; });
    assert.deepEqual(target, { url: 'https://ok.ru/videoembed/1534?autoplay=1', referrer: 'https://mytsumi.com/multiplayer/contenedor.php?id=VfS4Q9RzBt', alternatives: ['https://bysesukior.com/e/q'] });
    assert.equal(asked[1][1], options, 'el contenedor se pide desde su botón');
    await assert.rejects(animeyt.resolve({ url: episode }, async url => (url === episode ? pages[episode] : '<script>const videoTabs = [];</script>')), /no mostró servidores/);
  });

  await check('PelisFlix y OnlyFlix retirados: fuera de las fuentes y de la caché', () => {
    for (const id of ['pelisflix', 'onlyflix', 'tmdb']) { assert.ok(RETIRED_SOURCES.has(id), id); assert.ok(!CONNECTORS.some(connector => connector.id === id), id); }
  });

  await check('«Siguiente capítulo» adivinado: se quita cuando la lista del sitio no lo tiene; se queda si lo tiene', async () => {
    const show = 'https://doramasmp4.cyou/series/between-steps/';
    const site = { id: 'doramasmp4', name: 'DoramasMP4', site: 'https://doramasmp4.cyou/', parseHome: () => [], episodes: async () => [{ title: 'Capítulos', episodes: [12, 11].map(number => ({ url: `https://doramasmp4.cyou/cap/between-steps-capitulo-${number}/`, episode: number })) }] };
    const catalog = new Catalog({ file: join(directory, 'c.json'), detailsFile: join(directory, 'd.json'), connectors: [site], knownLists: null, credits: null, fetch: async () => { throw Error('doramasmp4.cyou respondió 404'); } });
    const ahead = { source: 'doramasmp4', show, url: 'https://doramasmp4.cyou/cap/between-steps-capitulo-13/', upNext: true };
    const listed = { ...ahead, url: 'https://doramasmp4.cyou/cap/between-steps-capitulo-12' };
    const version = catalog.version;
    assert.equal(catalog.upNextKnown(ahead), null, 'sin comprobar todavía: se muestra');
    assert.equal(catalog.upNextKnown(listed), null);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(catalog.upNextKnown(ahead), false);
    assert.equal(catalog.upNextKnown(listed), true, 'la barra final no cambia el capítulo');
    assert.ok(catalog.version > version, 'el inicio se vuelve a pedir');
    // A site without a list: the page's own 404 decides.
    const lone = { source: 'jkanime', url: 'https://jkanime.net/x/6/', upNext: true };
    assert.equal(catalog.upNextKnown(lone), null);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(catalog.upNextKnown(lone), false);
    catalog.stop();
  });

  await check('Página del reproductor vacía al cargar (JW Player por script): espera la apertura antes de darlo por caído', async () => {
    const make = () => {
      const bridge = Object.create(HolyBridge.prototype), failed = [];
      const session = { phase: 'opening', opened: Date.now(), item: { title: 'Prueba' }, queue: ['https://otro.example/'], tried: new Set() };
      Object.assign(bridge, { session, mainFrame: 'main', frames: new Map([['main', 'https://nupload.my/watch/x']]), navigation: { phase: 'error', error: 'El sitio no mostró contenido. Reintenta o abre otra página.', empty: true },
        serverTimeout: 28000, emptyTimeout: 15000, startTimeout: 45000, stallTimeout: 20000, midStall: 25000, mute: true, library: { progress() {} },
        isHome: () => false, playerContexts: async () => [], recordPlayback() {}, status: async () => {}, serverFailed: async value => { failed.push(value.failReason); return true; } });
      return { bridge, session, failed };
    };
    const early = make();
    await early.bridge.watch();
    assert.deepEqual(early.failed, [], 'recién cargada: todavía no');
    const late = make(); late.session.opened = Date.now() - 16000;
    await late.bridge.watch();
    assert.equal(late.failed.length, 1, 'pasado el plazo de página vacía sí');
    const hard = make(); hard.bridge.navigation = { phase: 'error', error: 'net::ERR_NAME_NOT_RESOLVED', empty: false };
    await hard.bridge.watch();
    assert.deepEqual(hard.failed, ['net::ERR_NAME_NOT_RESOLVED'], 'un error real de red no espera');
  });

  await check('Vídeo sin un solo dato (espejo del CDN caído): se cambia a los 25 s, no a los 45', async () => {
    const make = (opened, video) => {
      const bridge = Object.create(HolyBridge.prototype), failed = [];
      const session = { phase: 'opening', opened: Date.now() - opened, item: { title: 'Game of Thrones' }, queue: [], tried: new Set() };
      Object.assign(bridge, { session, mainFrame: 'main', frames: new Map([['main', 'https://tungtungsahur.cuevana3t.pro/?token=x']]), navigation: { phase: 'ready' },
        serverTimeout: 28000, emptyTimeout: 15000, startTimeout: 45000, starvedTimeout: 25000, stallTimeout: 20000, midStall: 25000, mute: true, library: { progress() {}, resumeAt: () => 0 },
        isHome: () => false, playerContexts: async () => [{ id: 1 }], evaluateWithGesture: async () => ({ url: 'https://lkhjerbhye3wikhoduh5xiczuvd.lol/v/x', top: false, action: '', videos: [video] }),
        isUserPaused: () => false, recordPlayback() {}, status: async () => {}, serverFailed: async value => { failed.push(value.failReason); return true; } });
      return { bridge, failed };
    };
    const empty = { t: 0, d: 0, paused: false, ready: 0, network: 2 };
    const early = make(20000, empty); await early.bridge.watch();
    assert.deepEqual(early.failed, [], 'a los 20 s todavía espera');
    const dead = make(26000, empty); await dead.bridge.watch();
    assert.deepEqual(dead.failed, ['el vídeo no recibió datos en 25 s']);
    // A video that has data but is still loading keeps the usual 45 s.
    const loading = make(26000, { ...empty, ready: 1 }); await loading.bridge.watch();
    assert.deepEqual(loading.failed, [], 'con datos sigue esperando');
  });

  console.log(passed + ' comprobaciones de cambios de sitios y arranque del 17/11 correctas (sin TV ni Internet).');
} finally { globalThis.fetch = nativeFetch; rmSync(directory, { recursive: true, force: true }); }
