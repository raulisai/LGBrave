import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cuevana, repelishd, jkanime, doramasmp4 } from './holy/sources.mjs';
import { doramasflix, asialiveaction, animeyt, flight, flixHost, rankFlixLinks } from './holy/more-sources.mjs';
import { CONNECTORS } from './holy/connectors.mjs';
import { Library, entryKey as entryKeyOf } from './holy/library.mjs';
import { Catalog, sameTitle, episodeOf, sameEpisode } from './holy/catalog.mjs';
import { HolyBridge } from './holy/holy-bridge.mjs';
import { home } from './browser-bridge.mjs';
import { startServer } from './holy/server.mjs';
import { sectionRows, episodeRows, bestResults, searchScore } from '../src/holy.js';

// Holy must not break: new sites, the taste engine, server failover, HTTP edge
// cases, damaged files and random input to every parser. No TV, no Internet.
const directory = mkdtempSync(join(tmpdir(), 'holy-robust-'));
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const nextFlight = text => `<script>self.__next_f.push([1,${JSON.stringify(text)}])</script>`;
const jwt = (url, server) => `https://embedshortener.co/e/eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ link: Buffer.from(url).toString('base64'), server })).toString('base64url')}.firma`;

try {
  await check('DoramasFlix: capítulos y portada desde los datos de la página, con dominio espejo', async () => {
    const episode = { _id: 'a'.repeat(24), name: 'Teach Me Touch Me 1x2', slug: 'teach-me-touch-me-1x2', name_es: 'Enséñame', still_path: '/still.jpg', serie_backdrop_path: '/back.jpg', season_number: 1, episode_number: 2, overview: '', __typename: 'EpisodeMin' };
    const page = nextFlight(`25:["$","$L45",null,{"items":[${JSON.stringify(episode)}],"slides":[{"id":"/peliculas/hope-2026","title":"Hope","subtitle":"$undefined","type":"Película","imageUrl":"/hope.jpg","href":"/peliculas/hope-2026"},{"id":"/doramas/dive","title":"Dive into You","type":"Dorama","imageUrl":"/dive.jpg","href":"/doramas/dive"}]}]`);
    const items = doramasflix.parseHome(page, 'https://doramasflix.io/');
    assert.deepEqual(items.map(item => [item.kind, item.title, !!item.isShow]), [['dorama', 'Teach Me Touch Me', false], ['movie', 'Hope', false], ['dorama', 'Dive into You', true]]);
    assert.deepEqual([items[0].url, items[0].show, items[0].subtitle, items[0].backdrop], ['https://doramasflix.io/capitulos/teach-me-touch-me-1x2', 'https://doramasflix.io/doramas/teach-me-touch-me', 'T1 · Capítulo 2', 'https://image.tmdb.org/t/p/w780/still.jpg']);
    const tried = [];
    const mirrored = await doramasflix.home(async url => { tried.push(url); if (url.includes('.io')) throw Error('caído'); return page; });
    assert.deepEqual(tried, ['https://doramasflix.io/', 'https://doramasflix.in/']);
    assert.equal(mirrored[0].url, 'https://doramasflix.in/capitulos/teach-me-touch-me-1x2');
  });
  await check('DoramasFlix: enlaces del propio sitio decodificados, ok.ru primero, Mega fuera', async () => {
    assert.equal(flixHost(jwt('https://streamtape.com/e/X', '8309')), 'https://streamtape.com/e/X');
    assert.equal(flixHost(jwt('http://inseguro.example/e/1', '8309')), '');
    assert.equal(flixHost('no es una dirección'), '');
    const ranked = rankFlixLinks([{ server: '453634', link: jwt('https://mega.nz/x', '453634') }, { server: '8309', link: jwt('https://streamtape.com/e/X', '8309') }, { server: '1113', link: jwt('https://ok.ru/videoembed/9', '1113') }, { server: '999', link: jwt('https://raro.example/e', '999') }]);
    assert.deepEqual(ranked, ['https://ok.ru/videoembed/9?autoplay=1', 'https://streamtape.com/e/X']);
    // The action id is read from the site's scripts; a POST to the episode page returns the links.
    const chunk = 'createServerReference)("40' + 'b'.repeat(40) + '",a.callServer,void 0,a.findSourceMapURL,"getEpisodeLinks")';
    const page = '<script src="/_next/static/chunks/zz1.js"></script>' + nextFlight(`2a:{"episode":{"_id":"${'c'.repeat(24)}","name":"X 1x1","slug":"x-1x1"}}`);
    const requests = [];
    const target = await doramasflix.resolve({ url: 'https://doramasflix.io/capitulos/x-1x1' }, async (url, options = {}) => {
      requests.push({ url, ...options });
      if (url.endsWith('zz1.js')) return chunk;
      if (options.method === 'POST') return '0:{"a":"$@1"}\n1:' + JSON.stringify([{ server: '8309', link: jwt('https://streamtape.com/e/Y', '8309') }, { server: '3889', link: jwt('https://mixdrop.ag/e/Z', '3889') }]);
      return page;
    });
    assert.deepEqual(target, { url: 'https://mixdrop.ag/e/Z', referrer: 'https://doramasflix.io/capitulos/x-1x1', alternatives: ['https://streamtape.com/e/Y'] });
    const post = requests.find(request => request.method === 'POST');
    assert.equal(post.headers['Next-Action'], '40' + 'b'.repeat(40));
    assert.deepEqual(JSON.parse(post.body), [{ episode_id: 'c'.repeat(24) }]);
    await assert.rejects(doramasflix.resolve({ url: 'https://doramasflix.io/capitulos/y-1x1' }, async () => '<html></html>'), /no indicó/);
  });
  await check('DoramasFlix: temporadas y búsqueda', async () => {
    const show = nextFlight('{"href":"/capitulos/x-1x2"},{"href":"/capitulos/x-1x1"},{"href":"/capitulos/x-2x1"},{"href":"/generos/drama"}');
    const seasons = await doramasflix.episodes('https://doramasflix.io/doramas/x', async () => show);
    assert.deepEqual(seasons.map(season => season.title + ':' + season.episodes.map(entry => entry.episode).join(',')), ['Temporada 1:1,2', 'Temporada 2:1']);
    assert.deepEqual(doramasflix.parseDetail(show).genres, ['Drama']);
    const chunk = 'createServerReference)("40' + 'd'.repeat(40) + '",a.callServer,void 0,a.findSourceMapURL,"searchQuickAction")';
    const found = await doramasflix.search('amor', async (url, options = {}) => options.method === 'POST'
      ? '1:' + JSON.stringify({ data: { doramas: [{ slug: 'revolutionary-love', name: 'Revolutionary Love', name_es: 'Amor revolucionario', poster_path: '/p.jpg' }], movies: [{ slug: 'amor-x', name: 'Amor X' }] } })
      : url.endsWith('.js') ? chunk : '<script src="/_next/static/chunks/zz2.js"></script>');
    assert.deepEqual(found.map(entry => [entry.kind, entry.title, !!entry.isShow]), [['dorama', 'Revolutionary Love', true], ['movie', 'Amor X', false]]);
  });
  await check('Asia Live Action: últimos episodios, ficha con géneros y ok.ru primero', async () => {
    const home = 'Últimos Episodios</h3><ul class="episodios-grid"><li><a href="https://asialiveaction.com/e/27/305551t1/0325115/"><div class="Image"><figure><img src="https://image.tmdb.org/t/p/w533_and_h300_multi_faces/back.jpg" alt="Merry"></figure></div><h5>Merry Berry Love<span><i class="fa-solid fa-hashtag"></i> 3</span></h5></a></li></ul></section>';
    const items = asialiveaction.parseHome(home);
    assert.deepEqual([items[0].title, items[0].episode, items[0].backdrop], ['Merry Berry Love', 3, 'https://image.tmdb.org/t/p/w780/back.jpg']);
    const players = asialiveaction.parsePlayers('<script>var allVideos = {"1385-1":[["VK","https:\\/\\/vkvideo.ru\\/video_ext.php?id=1"],["FM","https:\\/\\/bysejikuar.com\\/e\\/x"],["OK","https:\\/\\/ok.ru\\/videoembed\\/7"],["X","http:\\/\\/inseguro.example"]]};</script>');
    assert.deepEqual(players, ['https://ok.ru/videoembed/7?autoplay=1', 'https://bysejikuar.com/e/x', 'https://vkvideo.ru/video_ext.php?id=1']);
    const detail = await asialiveaction.detail(items[0], async url => url.includes('/e/') ? '<a href="https://asialiveaction.com/tv/305551t1-merry/">serie</a>' : '<a class="tag genero" href="x">Drama</a><a class="tag genero child" href="y">Comedia</a><meta property="og:description" content="Ver y Descargar spam"><div class="quality-tags"></div><p>Una historia de amor.</p>');
    assert.deepEqual([detail.show, detail.genres, detail.overview], ['https://asialiveaction.com/tv/305551t1-merry/', ['Drama', 'Comedia'], 'Una historia de amor.']);
    await assert.rejects(asialiveaction.resolve(items[0], async () => '<p>sin reproductores</p>'), /no tiene reproductores/);
  });
  await check('AnimeYT: episodios del día sin los «sin censura», reproductor Mytsumi y búsqueda', async () => {
    const card = (id, slug, label) => `<article class="aniyt-episode-card"><a class="aniyt-episode-media" href="https://animeyt.cc/${id}/anime/${slug}/" aria-label="${label}"><img src="https://i0.wp.com/animeyt.cc/x.jpg?resize=480%2C270&#038;ssl=1"><span class="aniyt-season-badge aniyt-episode-season">T4</span></a></article>`;
    const items = animeyt.parseHome(card(1, 'tokyo-revengers-capitulo-4', 'Ver Tokyo Revengers, episodio 4: Échame una mano') + card(2, 'kamui-capitulo-1-sin-censura', 'Ver Kamui, episodio 1'));
    assert.equal(items.length, 1);
    assert.deepEqual([items[0].title, items[0].episode, items[0].badge, items[0].backdrop], ['Tokyo Revengers', 4, 'T4 · Ep 4', 'https://i0.wp.com/animeyt.cc/x.jpg?resize=480%2C270&ssl=1']);
    const container = '<button data-player-url="https://mega.nz/embed/x" data-player-kind="iframe" data-player-label="MEGA"></button><button data-player-url="https://bysesukior.com/e/1" data-player-kind="iframe" data-player-label="Byse"></button><button data-player-url="https://archive.org/download/x/y.mp4" data-player-kind="video" data-player-label="Omega"></button><button data-player-url="https://ok.ru/videoembed/5" data-player-kind="iframe" data-player-label="OK"></button>';
    const target = await animeyt.resolve(items[0], async url => url.includes('mytsumi') ? container : '<iframe src="https://mytsumi.com/container.php?id=Z&#038;only=SUB&#038;lang=SUB"></iframe>');
    assert.deepEqual(target, { url: 'https://archive.org/download/x/y.mp4', referrer: 'https://mytsumi.com/container.php?id=Z&only=SUB&lang=SUB&open=1',
      alternatives: ['https://ok.ru/videoembed/5?autoplay=1', 'https://bysesukior.com/e/1', 'https://mytsumi.com/container.php?id=Z&only=SUB&lang=SUB&open=1'] });
    const found = await animeyt.search('tokyo', async () => JSON.stringify({ results: [{ title: 'Tokyo Revengers', url: 'https://animeyt.cc/tv/tokyo-revengers/', image: 'https://animeyt.cc/p.webp', rating: 9.199999, type: 'TV' }, { title: 'Malo', url: 'javascript:alert(1)' }] }));
    assert.deepEqual(found.map(entry => [entry.title, entry.rating, entry.isShow]), [['Tokyo Revengers', '9.2', true]]);
    const episodes = await animeyt.episodes('https://animeyt.cc/tv/one-piece-arco/', async () => '<a href="https://animeyt.cc/9/anime/one-piece-capitulo-1180/"></a><a href="https://animeyt.cc/8/anime/one-piece-capitulo-1179/"></a>');
    assert.deepEqual(episodes[0].episodes.map(entry => entry.episode), [1179, 1180]);
  });

  await check('Gustos: sin señales no hay porcentaje; con señales, el porcentaje sigue los géneros', () => {
    const library = new Library(join(directory, 'taste.json'), () => Date.UTC(2026, 9, 23));
    const action = { url: 'https://x/accion', title: 'Acción pura', kind: 'movie', genres: ['Acción'] };
    assert.equal(library.match(action).percent, null);
    library.vote({ url: 'https://x/1', title: 'A', kind: 'movie', genres: ['Acción', 'Aventura'] }, 1);
    library.vote({ url: 'https://x/2', title: 'B', kind: 'movie', genres: ['Terror'] }, -1);
    const percents = () => [library.match(action).percent, library.match({ ...action, genres: ['Documental'] }).percent, library.match({ ...action, genres: ['Terror'] }).percent];
    const [liked, neutral, disliked] = percents();
    // Two votes: modest but ordered. Many votes: confident.
    assert.ok(liked > neutral + 8 && disliked < neutral - 8 && neutral >= 40 && neutral <= 60, `${liked} / ${neutral} / ${disliked}`);
    for (let index = 3; index < 15; index++) library.vote({ url: 'https://x/' + index, title: 'T' + index, kind: 'movie', genres: index % 3 ? ['Acción'] : ['Terror'] }, index % 3 ? 1 : -1);
    const [sure, , away] = percents();
    assert.ok(sure >= 80 && away <= 20, `${sure} / ${away}`);
    for (let index = 3; index < 15; index++) library.vote({ url: 'https://x/' + index }, 0);
    assert.equal(library.match(action).reason, 'Te gusta Acción');
    assert.ok(library.match({ ...action, rating: '9.5' }).percent >= library.match({ ...action, rating: '4' }).percent);
    assert.deepEqual(library.summary().avoid.map(entry => entry.name), ['Terror']);
    // Votes can be changed, removed and reset, and survive a restart.
    assert.equal(library.vote({ url: 'https://x/2' }, 0), 0);
    assert.equal(new Library(join(directory, 'taste.json')).votes.length, 1);
    library.clearVotes();
    assert.equal(new Library(join(directory, 'taste.json')).votes.length, 0);
    assert.throws(() => library.vote({ url: 'javascript:1' }, 1));
  });
  await check('Gustos 2: «me encanta» pesa más, gustos elegidos (género, productora, país) y pregunta al terminar', () => {
    let now = Date.UTC(2026, 9, 24);
    const library = new Library(join(directory, 'taste2.json'), () => now);
    const anime = (title, studios, genres = ['Acción']) => ({ url: 'https://x/' + title, title, kind: 'anime', genres, studios, country: 'Japón' });
    library.vote(anime('A', ['MAPPA']), 2);
    library.vote(anime('B', ['Toei']), 1);
    // «Me encanta» weighs more than «me gusta» (with only two ratings the % stays modest).
    assert.ok(library.profile().studios.get('MAPPA') > library.profile().studios.get('Toei'));
    assert.ok(library.match(anime('C', ['MAPPA'])).percent >= library.match(anime('D', ['Toei'])).percent);
    assert.match(library.match(anime('C', ['MAPPA'])).reason, /MAPPA/);
    // A chosen dislike of a genre pulls its titles down; a chosen country pulls up.
    const before = library.match(anime('E', [], ['Terror'])).percent;
    library.prefer('genre', 'Terror', -1);
    assert.ok(library.match(anime('E', [], ['Terror'])).percent < before);
    library.prefer('country', 'Corea del Sur', 1);
    const korean = library.match({ url: 'https://x/k', title: 'K', kind: 'dorama', genres: ['Drama'], country: 'Corea del Sur' }).percent;
    const other = library.match({ url: 'https://x/c', title: 'Ch', kind: 'dorama', genres: ['Drama'], country: 'China' }).percent;
    assert.ok(korean > other, `${korean} > ${other}`);
    assert.deepEqual(library.summary().countries.map(entry => entry.name), ['Corea del Sur', 'Japón']);
    assert.equal(library.prefer('studio', 'MAPPA', 0), 0);
    assert.throws(() => library.prefer('actor', 'X', 1));
    // Watched a good while and not rated → asked once; answering or «ahora no» stops asking.
    const movie = { url: 'https://x/peli', title: 'Peli', kind: 'movie', genres: ['Drama'] };
    library.start(movie); library.progress(movie.url, movie.url, 1000, 6000);
    assert.equal(library.pendingRating()?.title, 'Peli');
    library.dismissRating(movie);
    assert.equal(library.pendingRating(), null);
    const show = { url: 'https://x/show/3/', show: 'https://x/show/', title: 'Serie', kind: 'anime', genres: [] };
    library.start(show); library.progress(show.show, show.url, 1300, 1400);
    assert.equal(library.pendingRating()?.key, 'https://x/show/');
    library.vote(library.pendingRating(), 1);
    assert.equal(library.pendingRating(), null);
    // Ratings and tastes survive a restart; «borrar» clears both.
    const again = new Library(join(directory, 'taste2.json'), () => now);
    assert.deepEqual([again.votes.length, again.prefs.length], [3, 2]);
    again.clearVotes();
    assert.deepEqual([again.votes.length, again.prefs.length, again.entries.length], [0, 0, 2]);
  });
  await check('Catálogo grande: páginas de género sin etiquetas falsas y filas por género', async () => {
    const { genrePages } = await import('./holy/sources.mjs');
    const page = urls => urls.map(url => ({ url, title: url }));
    const lists = { default: page(['a', 'b', 'c']), accion: page(['x', 'y', 'z']), falso: page(['a', 'b', 'c']) };
    const found = await genrePages(async url => url, [['accion', 'Acción'], ['falso', 'Western']], key => lists[key] || [], 'default');
    assert.deepEqual(found.map(entry => [entry.url, entry.genres[0]]), [['x', 'Acción'], ['y', 'Acción'], ['z', 'Acción']]);
    const site = { id: 's', name: 'S', site: 'https://s.example/', parseHome: () => [{ source: 's', kind: 'movie', url: 'https://s.example/1', title: 'Uno', genres: [] }],
      more: async () => Array.from({ length: 8 }, (_, index) => ({ source: 's', kind: 'movie', url: 'https://s.example/' + (index + 1), title: 'Peli ' + index, genres: ['Acción'] })) };
    const catalog = new Catalog({ file: join(directory, 'big.json'), detailsFile: join(directory, 'bigd.json'), connectors: [site], fetch: async () => '' });
    await catalog.refresh();
    assert.equal(catalog.items.length, 8);
    assert.deepEqual(catalog.find('https://s.example/1').genres, ['Acción']);
    const home = catalog.home(new Library(join(directory, 'big-lib.json')));
    assert.ok(home.rows.some(row => row.id === 'genre-Acción' && row.items.length === 8));
    const calibration = catalog.calibration(new Library(join(directory, 'big-lib.json')));
    assert.equal(calibration.rows[0].id, 'pref-genre');
    assert.deepEqual(calibration.rows[0].items[0], { chip: true, type: 'genre', name: 'Acción', title: 'Acción', count: 8, value: 0, url: 'holy:gusto:genre:Acción' });
  });

  await check('Archivos dañados: se apartan y Holy arranca limpio, sin perderlos', () => {
    const file = join(directory, 'broken.json');
    writeFileSync(file, '{"entries": [ {"key": tro');
    const library = new Library(file);
    assert.deepEqual([library.entries.length, library.votes.length], [0, 0]);
    assert.ok(readdirSync(directory).some(name => name.startsWith('broken.json.dañado-')));
    writeFileSync(join(directory, 'old.json'), JSON.stringify({ entries: [{ key: 'https://x/1', url: 'https://x/1', t: 'mucho', genres: 'Acción', plays: -3 }, { key: 5 }, null] }));
    const old = new Library(join(directory, 'old.json'));
    assert.deepEqual([old.entries.length, old.entries[0].t, old.entries[0].genres, old.entries[0].plays], [1, 0, [], 1]);
    writeFileSync(join(directory, 'cat-broken.json'), 'no es json');
    assert.equal(new Catalog({ file: join(directory, 'cat-broken.json'), detailsFile: join(directory, 'det-none.json') }).items.length, 0);
  });

  await check('Catálogo: un sitio colgado no frena a los demás; adultos fuera; calibración por géneros', async () => {
    const hanging = { id: 'lento', name: 'Lento', site: 'https://lento.example/', home: () => new Promise(() => {}), parseHome: () => [] };
    const good = { id: 'bueno', name: 'Bueno', site: 'https://bueno.example/',
      parseHome: () => [{ source: 'bueno', kind: 'anime', url: 'https://bueno.example/1/', title: 'Normal', genres: [] }, { source: 'bueno', kind: 'anime', url: 'https://bueno.example/2/', title: 'Adulto', genres: [] }, { source: 'bueno', url: 'javascript:1', title: 'Malo' }, { source: 'bueno', url: 'https://bueno.example/3/', title: '' }],
      detail: async entry => ({ genres: entry.url.endsWith('2/') ? ['Hentai'] : ['Acción', 'Comedia'], show: 'https://bueno.example/show/' }) };
    const catalog = new Catalog({ file: join(directory, 'c.json'), detailsFile: join(directory, 'd.json'), connectors: [hanging, good], fetch: async () => '' });
    const original = setTimeout;
    globalThis.setTimeout = (fn, ms, ...rest) => original(fn, Math.min(ms, 50), ...rest);
    try { await catalog.refresh(); } finally { globalThis.setTimeout = original; }
    assert.deepEqual(catalog.items.map(item => item.title), ['Normal']);
    assert.equal(catalog.items[0].show, 'https://bueno.example/show/');
    assert.match(catalog.errors.lento, /tardó/);
    assert.equal(catalog.health.bueno.ok, true);
    const library = new Library(join(directory, 'cal.json'));
    const calibration = catalog.calibration(library);
    assert.ok(Array.isArray(calibration.rows) && calibration.taste.signals === 0);
  });

  await check('Puente: si el primer servidor no arranca, prueba el siguiente tras la cortina', async () => {
    const calls = [];
    const cdp = {
      async call(method, params = {}) { calls.push({ method, params }); if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: 'https://example.com/' } } }; if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: String(calls.length) }; if (method === 'Runtime.evaluate') return { result: { value: { url: 'https://a.example/', top: true, videos: [], action: '' } } }; return {}; },
      async evaluate(expression) { return expression.includes('hasContent') ? { url: 'https://example.com/', hasContent: true } : 'https://example.com/'; },
      onEvent() { return () => {}; }
    };
    const library = new Library(join(directory, 'bridge.json'));
    const catalog = { version: 1, find: () => null, pageFallback: () => false, resolve: async () => ({ url: 'https://a.example/e/1', referrer: 'https://site.example/t', alternatives: ['https://b.example/e/2'] }) };
    const bridge = await new HolyBridge(cdp, { preferencesFile: join(directory, 'settings.json'), catalog, library, recorder: false, serverTimeout: 30 }).start();
    clearInterval(bridge.watchTimer);
    await bridge.command({ action: 'play', value: { url: 'https://site.example/t', title: 'T', kind: 'movie', source: 'x' } });
    assert.equal(calls.filter(call => call.method === 'Page.navigate').at(-1).params.url, 'https://a.example/e/1');
    bridge.frames.set(bridge.mainFrame, 'https://a.example/e/1'); bridge.navigation.phase = 'complete';
    await new Promise(resolve => setTimeout(resolve, 60));
    await bridge.watch();
    const last = calls.filter(call => call.method === 'Page.navigate').at(-1).params;
    assert.deepEqual(last, { url: 'https://b.example/e/2', referrer: 'https://site.example/t' });
    assert.equal(bridge.session.servers, 2);
    // A server that starts and then sticks at its first second is swapped too.
    bridge.stallTimeout = 30;
    bridge.session.queue = ['https://c.example/e/3'];
    let position = 1;
    cdp.call = (original => async (method, params = {}) => method === 'Runtime.evaluate' && !params.expression.includes('__holyCurtain')
      ? { result: { value: { url: 'https://b.example/', top: true, videos: [{ t: position, d: 1200, paused: false, ready: 4, area: 1 }], action: '' } } }
      : original(method, params))(cdp.call);
    bridge.frames.set(bridge.mainFrame, 'https://b.example/e/2'); bridge.navigation.phase = 'complete';
    bridge.contexts.set(5, { id: 5, auxData: { isDefault: true, frameId: 'main' } });
    await bridge.watch();
    assert.equal(bridge.session.phase, 'playing');
    await new Promise(resolve => setTimeout(resolve, 60));
    await bridge.watch();
    assert.equal(calls.filter(call => call.method === 'Page.navigate').at(-1).params.url, 'https://c.example/e/3');
    bridge.contexts.delete(5);
    // Every server of this copy failed (or it has none): the same title on another site.
    catalog.resolve = async item => (item.source === 'otro' ? { url: 'https://otro.example/e/9', referrer: 'https://otro.example/t' } : null);
    catalog.elsewhere = async () => [{ source: 'otro', kind: 'movie', title: 'T', url: 'https://otro.example/t' }];
    catalog.connector = id => ({ name: id === 'otro' ? 'Otro sitio' : id });
    await bridge.command({ action: 'play', value: { url: 'https://site.example/v', title: 'V', kind: 'movie', source: 'x' } });
    assert.equal(calls.filter(call => call.method === 'Page.navigate').at(-1).params.url, 'https://otro.example/e/9');
    assert.equal(bridge.statusPayload().holy.session.site, 'Otro sitio');
    await assert.rejects(bridge.command({ action: 'play', value: { url: 'https://site.example/serie/', title: 'Serie', kind: 'anime', isShow: true } }), /episodio/);
    // Anime goes to JKAnime first; the picked site is the next choice.
    const asked = [];
    catalog.resolve = async item => { asked.push(item.source); return item.source === 'jkanime' ? { url: 'https://jkanime.net/jkplayer/um?e=1', referrer: item.url } : { url: 'https://animeyt.example/mp4' }; };
    catalog.elsewhere = async (item, tried, options = {}) => (options.only === 'jkanime' ? [{ source: 'jkanime', kind: 'anime', title: 'One Piece', url: 'https://jkanime.net/one-piece/1180/', show: 'https://jkanime.net/one-piece/' }] : []);
    catalog.connector = id => ({ name: id === 'jkanime' ? 'JKAnime' : id });
    await bridge.command({ action: 'play', value: { url: 'https://animeyt.cc/1/anime/one-piece-capitulo-1180/', title: 'One Piece: Arco de Elbaph', kind: 'anime', source: 'animeyt', episode: 1180 } });
    assert.equal(calls.filter(call => call.method === 'Page.navigate').at(-1).params.url, 'https://jkanime.net/jkplayer/um?e=1');
    assert.deepEqual([asked, bridge.session.site, bridge.session.candidates.map(entry => entry.source)], [['jkanime'], 'JKAnime', ['animeyt']]);
    catalog.connector = id => ({ name: id === 'otro' ? 'Otro sitio' : id });
    // Back reaching the home by itself (no Mac answer) ends the playback session.
    await bridge.event({ method: 'Page.frameNavigated', params: { frame: { id: 'main', url: home } } });
    assert.equal(bridge.session, null);
    // A refused title (only unsafe servers, nowhere else) never navigates.
    catalog.elsewhere = async () => [];
    const before = calls.filter(call => call.method === 'Page.navigate').length;
    catalog.resolve = async () => { throw Object.assign(Error('solo servidores que cierran la app'), { unsafe: true }); };
    await bridge.command({ action: 'play', value: { url: 'https://site.example/u', title: 'U', kind: 'movie', source: 'x' } });
    assert.equal(calls.filter(call => call.method === 'Page.navigate').length, before);
    assert.equal(bridge.statusPayload().holy.session.phase, 'failed');
    await bridge.stop();
  });

  await check('Otro sitio: mismo título (o mismo episodio) cuando el propio no tiene reproductor', async () => {
    assert.ok(sameTitle({ title: 'Hope', kind: 'movie' }, { title: 'HOPE', kind: 'movie', year: '2026' }));
    assert.ok(sameTitle({ title: 'Hope', kind: 'movie' }, { title: 'Hope: El primer impacto', kind: 'movie' }));
    assert.ok(!sameTitle({ title: 'Hope', kind: 'movie', year: '2026' }, { title: 'Hope', kind: 'movie', year: '2013' }));
    assert.ok(!sameTitle({ title: 'Tokyo Revengers: Santen', kind: 'anime' }, { title: 'Tokyo Revengers: Tenjiku', kind: 'anime' }));
    assert.ok(sameTitle({ title: 'One Piece: Arco de Elbaph', kind: 'anime' }, { title: 'One Piece', kind: 'anime' }));
    assert.ok(sameTitle({ title: 'One Piece', kind: 'anime' }, { title: 'One Piece: Arco de Elbaph', kind: 'anime' }));
    assert.deepEqual(episodeOf({ url: 'https://doramasflix.io/capitulos/x-2x7' }), { season: 2, episode: 7 });
    assert.deepEqual(episodeOf({ url: 'https://jkanime.net/one-piece/1180/' }), { season: null, episode: 1180 });
    const site = (id, results, seasons = []) => ({ id, name: id, site: `https://${id}.example/`, parseHome: () => [], search: async () => results, episodes: async () => seasons });
    const catalog = new Catalog({ file: join(directory, 'e.json'), detailsFile: join(directory, 'ed.json'), fetch: async () => '',
      connectors: [site('cuevana', [{ source: 'cuevana', kind: 'movie', title: 'Hope', year: '2019', url: 'https://cuevana.example/hope-2019' }, { source: 'cuevana', kind: 'movie', title: 'Hope', year: '2026', url: 'https://cuevana.example/hope' }]),
        site('repelishd', []), site('animeyt', [{ source: 'animeyt', kind: 'anime', title: 'One Piece', url: 'https://animeyt.example/tv/op/', show: 'https://animeyt.example/tv/op/', isShow: true }],
          [{ title: 'Episodios', episodes: [{ url: 'https://animeyt.example/1180/', episode: 1180, label: 'Episodio 1180' }, { url: 'https://animeyt.example/1179/', episode: 1179 }] }]), site('jkanime', [])] });
    catalog.items = [{ source: 'repelishd', kind: 'movie', title: 'Hope', year: '2026', url: 'https://repelishd.example/hope', genres: [] }];
    const movie = await catalog.elsewhere({ source: 'doramasflix', kind: 'movie', title: 'Hope', year: '2026', url: 'https://doramasflix.example/hope' }, new Set(['doramasflix']));
    assert.deepEqual(movie.map(entry => entry.url), ['https://repelishd.example/hope', 'https://cuevana.example/hope']);
    const episode = await catalog.elsewhere({ source: 'jkanime', kind: 'anime', title: 'One Piece', url: 'https://jkanime.net/one-piece/1180/' }, new Set(['jkanime']));
    assert.deepEqual(episode.map(entry => [entry.url, entry.isShow]), [['https://animeyt.example/1180/', false]]);
  });

  await check('One Piece: la serie primero al buscar, «Anime en emisión» y el anime que Cuevana llama serie va a JKAnime', async () => {
    // Search: the series named exactly that first (JKAnime for anime); LEGO ONE PIECE only «contains» it.
    const groups = [
      { items: [{ title: 'One Piece: Heroines', url: 'https://c.example/heroines', kind: 'movie', source: 'cuevana' }, { title: 'LEGO ONE PIECE', url: 'https://c.example/lego', kind: 'series', source: 'cuevana', isShow: true }] },
      { items: [{ title: 'ONE PIECE', url: 'https://c.example/op2', kind: 'series', source: 'cuevana', isShow: true }] },
      { items: [{ title: 'One Piece Film Z', url: 'https://jk.example/z/', kind: 'anime', source: 'jkanime', isShow: true }, { title: 'One Piece', url: 'https://jk.example/op/', kind: 'anime', source: 'jkanime', isShow: true }] }];
    assert.deepEqual(bestResults(groups, 'onepiece', { anime: 'jkanime' }).map(item => item.url), ['https://jk.example/op/', 'https://c.example/op2', 'https://jk.example/z/', 'https://c.example/heroines']);
    assert.deepEqual([searchScore({ title: 'One Piece' }, 'ONE  piece!'), searchScore({ title: 'LEGO ONE PIECE' }, 'one piece'), searchScore({ title: 'x' }, '')], [3, 1, 0]);
    // JKAnime's schedule: airing shows with their latest episode.
    const schedule = `<div title="One Piece" class='box img'><div class="boxx"><a href="https://jkanime.net/one-piece/"><img title="One Piece" src="https://cdn.jkdesa.com/op.jpg"></a></div><a class="shadowTitle" href="https://jkanime.net/one-piece/"><h3>One Piece</h3></a><div class="last"><a href="https://jkanime.net/one-piece/"><span>Último capítulo: 1180 </span><time>hace 3 semanas </time></a></div></div>
<div title="Psyren" class='box img'><div class="boxx"><a href="https://jkanime.net/psyren/"><img title="Psyren" src="https://cdn.jkdesa.com/p.jpg"></a></div><h3>Psyren</h3><span>Último capítulo: 3 </span><time>hace 11 horas </time></div>`;
    const airing = jkanime.parseAiring(schedule);
    assert.deepEqual(airing.map(item => [item.title, item.latest, item.ago, item.isShow, item.airing, item.poster]), [['One Piece', 1180, 504, true, true, 'https://cdn.jkdesa.com/op.jpg'], ['Psyren', 3, 11, true, true, 'https://cdn.jkdesa.com/p.jpg']]);
    // The same show in «Animes recientes» and the schedule keeps «en emisión»; the row puts what you watch first, then long runs.
    const recent = { source: 'jkanime', kind: 'anime', title: 'One Piece', url: 'https://jkanime.net/one-piece/', show: 'https://jkanime.net/one-piece/', isShow: true, genres: [], badge: 'Serie' };
    const episode = { source: 'jkanime', kind: 'anime', title: 'Psyren', url: 'https://jkanime.net/psyren/3/', show: 'https://jkanime.net/psyren/', episode: 3, genres: [] };
    const fake = { id: 'jkanime', name: 'JKAnime', site: 'https://jkanime.net/', parseHome: () => [recent, episode], more: async () => airing, parseDetail: () => ({ genres: [] }), episodeURL: jkanime.episodeURL,
      search: async () => [{ source: 'jkanime', kind: 'anime', title: 'One Piece', url: 'https://jkanime.net/one-piece/', show: 'https://jkanime.net/one-piece/', isShow: true }],
      episodes: async () => { throw Error('no hace falta la lista'); } };
    const cuevanaFake = { id: 'cuevana', name: 'Cuevana 3', site: 'https://cuevana.example/', parseHome: () => [{ source: 'cuevana', kind: 'movie', title: 'Film', url: 'https://cuevana.example/f', genres: [] }], parseDetail: () => ({ genres: [] }),
      detail: async item => ({ genres: item.url.includes('lego') ? ['Comedia', 'Animación'] : ['Acción', 'Animación', 'Anime'] }) };
    const catalog = new Catalog({ file: join(directory, 'op.json'), detailsFile: join(directory, 'opd.json'), fetch: async () => '', connectors: [cuevanaFake, fake] });
    await catalog.refresh();
    const library = new Library(join(directory, 'op-library.json'));
    let data = catalog.home(library);
    const row = id => data.rows.find(entry => entry.id === id)?.items.map(item => item.title) || [];
    assert.deepEqual([row('anime-airing'), row('anime-shows'), data.preferred], [['One Piece', 'Psyren'], [], { anime: 'jkanime' }]);
    library.start(episode); library.progress('https://jkanime.net/psyren/', episode.url, 600, 1400);
    data = catalog.home(library);
    assert.deepEqual(row('anime-airing'), ['Psyren', 'One Piece']);
    const anime = sectionRows(data, 'anime');
    assert.deepEqual(anime.map(entry => entry.id).slice(0, 3), ['continue', 'anime-airing', 'source-jkanime']);
    assert.ok(!anime.find(entry => entry.id === 'source-jkanime').items.some(item => item.airing));
    assert.deepEqual(catalog.searchLocal('onepiece').map(item => item.title), ['One Piece']);
    // Cuevana files the One Piece anime as a series (genre «Anime»): JKAnime first, its episode by address, no list needed.
    const cuevanaOP = { source: 'cuevana', kind: 'series', title: 'One Piece', show: 'https://cuevana.example/serie/one-piece', url: 'https://cuevana.example/serie/one-piece/episodio-15x642', episode: 642, genres: [] };
    const preference = await catalog.preference(cuevanaOP);
    assert.deepEqual(preference, { site: 'jkanime', kind: 'anime' });
    assert.equal(await catalog.preference({ ...cuevanaOP, title: 'LEGO ONE PIECE', show: 'https://cuevana.example/serie/lego-one-piece', url: 'https://cuevana.example/serie/lego-one-piece/episodio-1x1' }), null);
    const copies = await catalog.elsewhere(cuevanaOP, new Set(['cuevana']), { only: 'jkanime', kind: preference.kind });
    assert.deepEqual(copies.map(copy => [copy.url, copy.isShow]), [['https://jkanime.net/one-piece/642/', false]]);
    // «2x5» is no one's episode 5; absolute numbering (15x642) and first seasons match a site without seasons.
    assert.deepEqual([sameEpisode({ season: 2, episode: 5 }, { season: null, episode: 5 }), sameEpisode({ season: 15, episode: 642 }, { season: null, episode: 642 }), sameEpisode({ season: 1, episode: 3 }, { season: null, episode: 3 }), sameEpisode({ season: 2, episode: 5 }, { season: 2, episode: 5 })], [false, true, true, true]);
    assert.deepEqual(await catalog.elsewhere({ ...cuevanaOP, url: 'https://cuevana.example/serie/one-piece/episodio-2x5', episode: 5 }, new Set(['cuevana']), { only: 'jkanime', kind: 'anime' }), []);
    catalog.stop();
  });

  await check('Final de un título: siguiente capítulo con cuenta atrás; película → inicio o parecidas', async () => {
    const calls = [], drawn = [];
    let video = { t: 100, d: 1400, paused: false, ready: 4, area: 1, ended: false };
    const cdp = {
      async call(method, params = {}) {
        calls.push({ method, params });
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: 'https://example.com/' } } };
        if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: String(calls.length) };
        if (method === 'Runtime.evaluate') return { result: { value: { url: 'https://p.example/', top: true, videos: [video], action: '' } } };
        return {};
      },
      async evaluate(expression) { drawn.push(expression); return expression.includes('hasContent') ? { url: 'https://example.com/', hasContent: true } : 'https://example.com/'; },
      onEvent() { return () => {}; }
    };
    const library = new Library(join(directory, 'end.json'));
    const show = 'https://jkanime.net/one-piece/';
    const similar = [{ source: 'cuevana', kind: 'movie', title: 'Oro sin ley', url: 'https://c.example/oro', poster: 'https://img.example/oro.jpg', genres: ['Acción'], match: 80 }];
    const catalog = { version: 1, find: () => null, pageFallback: () => false, resolve: async item => ({ url: 'https://p.example/play?u=' + encodeURIComponent(item.url) }),
      next: async item => (item.episode < 1180 ? { url: show + (item.episode + 1) + '/', episode: item.episode + 1, label: 'Episodio ' + (item.episode + 1), still: '' } : null),
      similar: () => similar };
    const bridge = await new HolyBridge(cdp, { preferencesFile: join(directory, 'end-settings.json'), catalog, library, recorder: false, nextDelay: 40 }).start();
    clearInterval(bridge.watchTimer);
    bridge.contexts.set(5, { id: 5, auxData: { isDefault: true, frameId: 'main' } });
    bridge.remoteContexts.add(9);
    const navigated = () => calls.filter(call => call.method === 'Page.navigate').at(-1)?.params.url;
    const playTo = async (item, at) => {
      await bridge.command({ action: 'play', value: item });
      bridge.frames.set(bridge.mainFrame, 'https://p.example/'); bridge.navigation.phase = 'complete';
      video = { ...video, t: 100, ended: false, paused: false };
      await new Promise(resolve => setTimeout(resolve, 60));
      await bridge.watch();
      assert.equal(bridge.session.phase, 'playing');
      video = { ...video, ...at };
      await bridge.watch();
    };
    // An episode ends: «Siguiente capítulo» and, after the countdown, the next one plays.
    await playTo({ source: 'jkanime', kind: 'anime', title: 'One Piece', show, url: show + '1178/', episode: 1178 }, { t: 1397 });
    assert.ok(drawn.some(expression => expression.includes('holyEndCard') && expression.includes('"mode":"next"') && expression.includes('Episodio 1179')));
    assert.ok(drawn.some(expression => expression.includes("holyCard='1'")));
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(navigated(), 'https://p.example/play?u=' + encodeURIComponent(show + '1179/'));
    assert.equal(bridge.session.item.episode, 1179);
    assert.equal(library.get(show)?.url, show + '1179/');
    // The owner moves to «Volver al inicio»: no countdown; OK goes home.
    await playTo(bridge.session.item, { ended: true, t: 1400, paused: true });
    await bridge.event({ method: 'Runtime.bindingCalled', params: { name: '__lgLabCommand', executionContextId: 9, payload: JSON.stringify({ action: 'card', key: 39 }) } });
    assert.ok(drawn.at(-1).includes('__holyEnd.focus(1,true)'));
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(bridge.session.item.episode, 1179);
    await bridge.event({ method: 'Runtime.bindingCalled', params: { name: '__lgLabCommand', executionContextId: 9, payload: JSON.stringify({ action: 'card', key: 13 }) } });
    assert.equal(bridge.session, null);
    assert.ok(navigated().endsWith('/holy/'));
    // The last episode available: no countdown, only home.
    await playTo({ source: 'jkanime', kind: 'anime', title: 'One Piece', show, url: show + '1180/', episode: 1180 }, { t: 1399 });
    assert.ok(drawn.some(expression => expression.includes('"mode":"last"')));
    assert.equal(bridge.session.card.timer, null);
    // Rewinding from the card hides it.
    video = { ...video, t: 600 };
    await bridge.watch();
    assert.equal(bridge.session.card, null);
    assert.ok(drawn.at(-1).includes('__holyEnd.remove()'));
    // A stream stuck just before its end (last piece never loads) counts as finished; a pause by the owner does not.
    await bridge.hideEndCard(bridge.session);
    bridge.endStall = 30;
    video = { ...video, t: 1385, paused: true };
    await bridge.watch(); await new Promise(resolve => setTimeout(resolve, 60)); await bridge.watch();
    assert.equal(bridge.session.card, null);
    video = { ...video, paused: false };
    await bridge.watch(); await new Promise(resolve => setTimeout(resolve, 60)); await bridge.watch();
    assert.ok(bridge.session.card);
    // A film ends: «Volver al inicio» first, then similar films; a click picks one.
    await playTo({ source: 'cuevana', kind: 'movie', title: 'Street Fighter', url: 'https://c.example/sf', genres: ['Acción'] }, { t: 5999, d: 6000 });
    assert.ok(drawn.some(expression => expression.includes('"mode":"movie"') && expression.includes('Oro sin ley')));
    assert.equal(bridge.session.card.timer, null);
    // Only Holy's own isolated contexts may answer the card.
    await bridge.event({ method: 'Runtime.bindingCalled', params: { name: '__lgLabCommand', executionContextId: 1234, payload: JSON.stringify({ action: 'card', choose: 1 }) } });
    assert.equal(bridge.session.item.title, 'Street Fighter');
    await bridge.event({ method: 'Runtime.bindingCalled', params: { name: '__lgLabCommand', executionContextId: 9, payload: JSON.stringify({ action: 'card', choose: 1 }) } });
    assert.equal(bridge.session.item.title, 'Oro sin ley');
    assert.equal(navigated(), 'https://p.example/play?u=' + encodeURIComponent('https://c.example/oro'));
    await bridge.stop();
    // Catalogue: the next episode by number (JKAnime lists newest first), none after the last, address pattern otherwise.
    const real = new Catalog({ file: join(directory, 'n.json'), detailsFile: join(directory, 'nd.json'), fetch: async () => '', connectors: [
      { id: 'jkanime', name: 'JKAnime', site: 'https://jkanime.net/', parseHome: () => [], episodes: async () => [{ title: 'Episodios 1131–1180', episodes: [1180, 1179, 1178].map(n => ({ url: show + n + '/', episode: n, label: 'Episodio ' + n })) }] },
      { id: 'cuevana', name: 'Cuevana', site: 'https://cuevana.example/', parseHome: () => [], episodes: async () => [{ title: 'Temporada 1', episodes: [{ url: 'https://cuevana.example/serie/x/episodio-1x10', season: 1, episode: 10 }] }, { title: 'Temporada 2', episodes: [{ url: 'https://cuevana.example/serie/x/episodio-2x1', season: 2, episode: 1 }] }] }] });
    assert.equal((await real.next({ source: 'jkanime', show, url: show + '1178/', episode: 1178 })).url, show + '1179/');
    assert.equal(await real.next({ source: 'jkanime', show, url: show + '1180/', episode: 1180 }), null);
    assert.equal((await real.next({ source: 'cuevana', show: 'https://cuevana.example/serie/x', url: 'https://cuevana.example/serie/x/episodio-1x10', episode: 10 })).url, 'https://cuevana.example/serie/x/episodio-2x1');
    assert.equal((await real.next({ source: 'doramasmp4', url: 'https://doramasmp4.example/cap/x-capitulo-4/' })).url, 'https://doramasmp4.example/cap/x-capitulo-5/');
    // Similar films: shared genres first, never the same title twice or one already finished.
    real.items = [
      { source: 'cuevana', kind: 'movie', title: 'Comedia', url: 'https://c.example/1', poster: 'p', genres: ['Comedia'] },
      { source: 'cuevana', kind: 'movie', title: 'Acción 1', url: 'https://c.example/2', poster: 'p', genres: ['Acción', 'Fantasía'] },
      { source: 'repelishd', kind: 'movie', title: 'Acción 1', url: 'https://r.example/2', poster: 'p', genres: ['Acción'] },
      { source: 'cuevana', kind: 'movie', title: 'Vista', url: 'https://c.example/3', poster: 'p', genres: ['Acción'] },
      { source: 'cuevana', kind: 'movie', title: 'Street Fighter', url: 'https://r.example/sf', poster: 'p', genres: ['Acción'] }];
    const seen = new Library(join(directory, 'similar.json'));
    seen.start(real.items[3]); seen.progress(entryKeyOf(real.items[3]), real.items[3].url, 5990, 6000);
    assert.deepEqual(real.similar({ kind: 'movie', title: 'Street Fighter', url: 'https://c.example/sf', genres: ['Acción', 'Fantasía'] }, seen).map(item => item.title), ['Acción 1', 'Comedia']);
    real.stop();
    // In the player's iframe, OK and the arrows go to the card only while it is up.
    const { holyRemote } = await import('./holy/page-scripts.mjs');
    const sent = [];
    const listeners = [];
    const root = { dataset: { holyBridge: 'w|' + Date.now() } };
    globalThis.window = { addEventListener: (type, fn) => type === 'keydown' && listeners.push(fn), location: { href: 'https://player.example/' }, __lgLabCommand: payload => sent.push(payload) };
    window.top = window; globalThis.location = window.location; globalThis.addEventListener = window.addEventListener; globalThis.document = { documentElement: root };
    holyRemote([], 'http://mac/holy/', 'w');
    const press = code => { const event = { keyCode: code, timeStamp: Math.random(), preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} }; listeners.forEach(fn => fn(event)); return event; };
    assert.equal(press(13).prevented, undefined);
    root.dataset.holyCard = '1';
    assert.equal(press(13).prevented, true);
    press(39);
    assert.deepEqual(sent, ['{"action":"card","key":13}', '{"action":"card","key":39}']);
    delete globalThis.window; delete globalThis.location; delete globalThis.addEventListener; delete globalThis.document;
  });

  await check('Idioma: versiones del sitio, valor por sitio, vacío si no se sabe y copias en dos idiomas', async () => {
    const { languageLabel } = await import('./holy/sources.mjs');
    const { languageTag } = await import('../src/holy.js');
    assert.equal(languageLabel(['Subtitulado', ' Latino ', 'Servidor Hyper']), 'Latino · Subtitulado');
    assert.equal(languageLabel('Castellano'), 'Castellano');
    assert.equal(languageLabel(['Calidad · CAM']), '');
    assert.equal(languageLabel(undefined), '');
    assert.equal(languageTag('Latino · Subtitulado'), 'LAT · SUB');
    assert.equal(languageTag(''), '');
    const tabs = '<ul class="tabs-video"><li class="tab-video-item"><div><div class="tab-item-name"> Latino <div>Calidad · CAM</div></div></div></li><li class="tab-video-item"><div><div class="tab-item-name"> Subtitulado <div>x</div></div></div></li></ul>';
    assert.equal(cuevana.parseDetail(tabs, 'https://cuevana3c.pro/').language, 'Latino · Subtitulado');
    assert.equal(cuevana.parseDetail('<p>nada</p>', 'https://cuevana3c.pro/').language, '');
    // Per site: its usual version; Cuevana only what its page says; unknown (Asia Live Action) stays empty.
    const films = [
      { source: 'cuevana', kind: 'movie', title: 'Hope', url: 'https://c.example/hope', genres: [] },
      { source: 'repelishd', kind: 'movie', title: 'Hope', url: 'https://r.example/hope', genres: [] },
      { source: 'asialiveaction', kind: 'dorama', title: 'Raro', url: 'https://a.example/raro', genres: [] },
      { source: 'jkanime', kind: 'anime', title: 'One Piece', url: 'https://jkanime.net/one-piece/', isShow: true, genres: [] }];
    const catalog = new Catalog({ file: join(directory, 'lang.json'), detailsFile: join(directory, 'langd.json'), fetch: async () => '', connectors: [
      { id: 'cuevana', name: 'Cuevana', site: 'https://c.example/', parseHome: () => [films[0]], parseDetail: () => ({ genres: ['Acción'], language: 'Latino · Subtitulado' }) },
      { id: 'repelishd', name: 'RePelisHD', site: 'https://r.example/', language: 'Latino', parseHome: () => [films[1]], parseDetail: () => ({ genres: ['Acción'] }) },
      { id: 'asialiveaction', name: 'Asia', site: 'https://a.example/', parseHome: () => [films[2]], parseDetail: () => ({ genres: [] }) },
      { id: 'jkanime', name: 'JKAnime', site: 'https://jkanime.net/', language: 'Subtitulado', parseHome: () => [films[3]], parseDetail: () => ({ genres: [] }) }] });
    await catalog.refresh();
    assert.deepEqual(catalog.items.map(entry => [entry.source, entry.language]), [['cuevana', 'Latino · Subtitulado'], ['repelishd', 'Latino'], ['asialiveaction', ''], ['jkanime', 'Subtitulado']]);
    // The same film on two sites in different languages is listed twice; the same language once.
    let data = catalog.home(new Library(join(directory, 'lang-lib.json')));
    assert.deepEqual(data.rows.find(row => row.id === 'movies').items.map(entry => [entry.source, entry.language]), [['cuevana', 'Latino · Subtitulado'], ['repelishd', 'Latino']]);
    catalog.items[1].language = 'Latino · Subtitulado';
    data = catalog.home(new Library(join(directory, 'lang-lib2.json')));
    assert.equal(data.rows.find(row => row.id === 'movies').items.length, 1);
    // Search results carry it too, and history remembers it.
    const lib = new Library(join(directory, 'lang-lib3.json'));
    assert.equal(lib.start(catalog.items[3]).language, 'Subtitulado');
    catalog.stop();
  });

  await check('Botón azul: busca con la voz (código 406) desde cualquier pantalla', async () => {
    const source = readFileSync(new URL('../src/App.svelte', import.meta.url), 'utf8');
    assert.match(source, /code === 406\) \{ event\.preventDefault\(\); voiceRetry = 0; voiceSearch\(\)/);
    assert.match(source, /SpeechRecognition/);
    // Voice never opens the on-screen keyboard first (it would hold the microphone), and a second press cancels.
    const voice = source.slice(source.indexOf('function voiceSearch'), source.indexOf('function leaveSearch'));
    assert.ok(voice.includes("section = 'buscar'") && !voice.includes("chooseSection('buscar')"));
    assert.ok(voice.indexOf('focusSearch()') > voice.indexOf('if (!Speech)') && voice.split('focusSearch()').length === 2);
    assert.match(voice, /if \(listening && !retrying\)/);
    assert.match(voice, /El procesador de audio es inestable\. Vuelve a intentar\./);
    assert.match(voice, /voiceRetry < 2/);
    // The key is handled before the search field takes the letters, so it also works while typing.
    assert.ok(source.indexOf('code === 406') < source.indexOf('While typing, letters'));
    // Magic Remote pointer: resting on a card lights it up without scrolling anything (scrolling
    // slid the next card under the pointer, again and again); only a real move counts.
    const hover = source.slice(source.indexOf('function hover('), source.indexOf('function unhover'));
    assert.ok(!/columns|rowIndex/.test(hover) && /realPointer\(\)/.test(hover) && /setTimeout/.test(hover));
    assert.match(source, /onmouseenter=\{\(\) => hover\(r, c\)\} onmouseleave=\{unhover\} onclick=\{\(\) => pick\(r, c, item\)\}/);
    assert.match(source, /class="page-arrow right"/);
    assert.match(source, /onwheel=\{wheel\}/);
    // The TV only says whether it reaches the Mac; the Doctor lives in the Mac's menu bar.
    assert.ok(!/doctor/i.test(source));
    assert.match(source, /Conectado al Mac/);
  });

  await check('Rapidez y rescate: reproductor preparado al detenerse en la tarjeta; servidor atascado a mitad → otro, mismo segundo', async () => {
    // Catalogue: a found player is reused for a while; a failed lookup is not; forgetPlayer drops it.
    let asked = 0, answer = { url: 'https://p.example/1' };
    const site = { id: 'x', name: 'X', site: 'https://x.example/', parseHome: () => [], resolve: async () => { asked++; return answer; } };
    const catalog = new Catalog({ file: join(directory, 'r.json'), detailsFile: join(directory, 'rd.json'), fetch: async () => '', connectors: [site] });
    const film = { source: 'x', kind: 'movie', title: 'F', url: 'https://x.example/f' };
    await catalog.resolve(film); await catalog.resolve(film);
    assert.equal(asked, 1);
    catalog.forgetPlayer(film.url); await catalog.resolve(film);
    assert.equal(asked, 2);
    answer = null; const other = { ...film, url: 'https://x.example/g' };
    assert.equal(await catalog.resolve(other), null); answer = { url: 'https://p.example/2' };
    assert.equal((await catalog.resolve(other)).url, 'https://p.example/2');
    catalog.stop();

    // Bridge: «prepare» warms the JKAnime copy (anime) once; never twice in a minute nor during playback.
    const calls = [];
    let video = { t: 100, d: 3000, paused: false, ready: 4, area: 1, ended: false };
    const cdp = {
      async call(method, params = {}) {
        calls.push({ method, params });
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: 'https://example.com/' } } };
        if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: String(calls.length) };
        if (method === 'Runtime.evaluate') return { result: { value: params.expression.includes('holySeek') ? true : { url: 'https://p.example/', top: true, videos: [video], action: '' } } };
        return {};
      },
      async evaluate() { return 'https://example.com/'; },
      onEvent() { return () => {}; }
    };
    const resolved = [];
    const fake = { version: 1, find: () => null, pageFallback: () => false, forgetPlayer: url => resolved.push('olvida ' + url),
      preference: async item => (item.kind === 'anime' ? { site: 'jkanime', kind: 'anime' } : null),
      elsewhere: async () => [{ source: 'jkanime', kind: 'anime', title: 'A', url: 'https://jkanime.net/a/3/' }],
      resolve: async item => { resolved.push(item.url); return { url: 'https://p.example/play?' + item.url, alternatives: ['https://p.example/second'] }; } };
    const library = new Library(join(directory, 'rescue.json'));
    const bridge = await new HolyBridge(cdp, { preferencesFile: join(directory, 'rescue-settings.json'), catalog: fake, library, recorder: false, midStall: 30 }).start();
    clearInterval(bridge.watchTimer);
    await bridge.command({ action: 'prepare', value: { source: 'animeyt', kind: 'anime', title: 'A', url: 'https://animeyt.example/a-3/', episode: 3 } });
    await bridge.preparing;
    assert.deepEqual(resolved, ['https://jkanime.net/a/3/']);
    await bridge.command({ action: 'prepare', value: { source: 'animeyt', kind: 'anime', title: 'A', url: 'https://animeyt.example/a-3/', episode: 3 } });
    assert.equal(bridge.preparing, null);
    await bridge.command({ action: 'prepare', value: { url: 'https://x.example/serie', isShow: true } });
    assert.equal(bridge.preparing, null);
    // Playing a film, then its server stops advancing at 1500 s (not paused).
    bridge.contexts.set(5, { id: 5, auxData: { isDefault: true, frameId: 'main' } });
    await bridge.command({ action: 'play', value: { source: 'x', kind: 'movie', title: 'F', url: 'https://x.example/f' } });
    bridge.frames.set(bridge.mainFrame, 'https://p.example/'); bridge.navigation.phase = 'complete';
    await new Promise(resolve => setTimeout(resolve, 60));
    await bridge.watch();
    assert.equal(bridge.session.phase, 'playing');
    resolved.length = 0;
    await bridge.command({ action: 'prepare', value: { source: 'x', kind: 'movie', title: 'G', url: 'https://x.example/g' } });
    assert.deepEqual(resolved, []);
    video = { ...video, t: 1500 };
    await bridge.watch(); await new Promise(resolve => setTimeout(resolve, 60));
    video = { ...video, t: 1500 }; await bridge.watch();
    const last = calls.filter(call => call.method === 'Page.navigate').at(-1).params.url;
    assert.equal(last, 'https://p.example/second');
    assert.deepEqual([bridge.session.rescues, bridge.session.forceResume, bridge.session.resumeAt], [1, 1495, 1495]);
    assert.ok(resolved.includes('olvida https://x.example/f'));
    // A pause by the owner is never «stuck».
    bridge.session.phase = 'playing'; bridge.session.midStall = null;
    video = { ...video, t: 1600, paused: true };
    await bridge.watch(); await new Promise(resolve => setTimeout(resolve, 60)); await bridge.watch();
    assert.equal(bridge.session.rescues, 1);
    await bridge.stop();
    // The screen asks for it after resting on a card.
    const source = readFileSync(new URL('../src/App.svelte', import.meta.url), 'utf8');
    assert.match(source, /command\('prepare', plainItem\(item\)\)/);
  });

  await check('Arranque que falla: servidor vacío se deja antes; tras 2 servidores, otro sitio; si falla, los que quedaban', async () => {
    const calls = [];
    let videos = [];
    const cdp = {
      async call(method, params = {}) {
        calls.push({ method, params });
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: 'https://example.com/' } } };
        if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: String(calls.length) };
        if (method === 'Runtime.evaluate') return { result: { value: { url: 'https://p.example/', top: true, videos, action: '' } } };
        return {};
      },
      async evaluate() { return 'https://example.com/'; },
      onEvent() { return () => {}; }
    };
    let otherSite = true;
    const catalog = { version: 1, find: () => null, pageFallback: () => false, connector: id => ({ name: id }),
      resolve: async item => (item.source === 'a' ? { url: 'https://a.example/1', referrer: 'https://a.example/t', alternatives: ['https://a.example/2', 'https://a.example/3', 'https://a.example/4'] } : { url: 'https://b.example/1', referrer: 'https://b.example/t' }),
      elsewhere: async () => (otherSite ? [{ source: 'b', kind: 'movie', title: 'K', url: 'https://b.example/k' }] : []) };
    const library = new Library(join(directory, 'order.json'));
    const bridge = await new HolyBridge(cdp, { preferencesFile: join(directory, 'order-settings.json'), catalog, library, recorder: false, emptyTimeout: 30, serverTimeout: 5000, startTimeout: 5000 }).start();
    clearInterval(bridge.watchTimer);
    bridge.contexts.set(5, { id: 5, auxData: { isDefault: true, frameId: 'main' } });
    const opened = () => calls.filter(call => call.method === 'Page.navigate').map(call => call.params.url);
    const fail = async () => { bridge.frames.set(bridge.mainFrame, 'https://p.example/'); bridge.navigation.phase = 'complete'; await new Promise(resolve => setTimeout(resolve, 60)); await bridge.watch(); };
    await bridge.command({ action: 'play', value: { source: 'a', kind: 'movie', title: 'K', url: 'https://a.example/k' } });
    await fail();                         // a1 shows no player: dropped after 30 ms (not 5 s)
    await fail();                         // a2 too: two servers of «a» → «b» before a3 and a4
    await fail();                         // b1 fails, «b» has nothing else → back to a3
    assert.deepEqual(opened(), ['https://a.example/1', 'https://a.example/2', 'https://b.example/1', 'https://a.example/3']);
    assert.equal(bridge.session.item.source, 'a');
    // A server with a player that is still loading gets the full time.
    videos = [{ t: 0, d: 3000, paused: true, ready: 1, area: 1 }];
    await fail();
    assert.equal(opened().length, 4);
    await bridge.stop();
  });

  await check('Servidor: rutas con datos malos responden sin caerse', async () => {
    const library = new Library(join(directory, 'server.json'));
    const catalog = new Catalog({ file: join(directory, 'sc.json'), detailsFile: join(directory, 'sd.json'), connectors: [], fetch: async () => '' });
    const server = startServer({ catalog, library, port: 0, log: () => {}, imageDir: join(directory, 'img'), root: directory });
    await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const vote = (body, type = 'text/plain') => fetch(base + '/holy-api/vote', { method: 'POST', headers: { 'Content-Type': type }, body });
      assert.equal((await vote('{roto')).status, 400);
      assert.equal((await vote(JSON.stringify({ item: { url: 'javascript:1' }, vote: 1 }))).status, 400);
      assert.equal((await vote('x'.repeat(40000))).status, 400);
      const ok = await (await vote(JSON.stringify({ item: { url: 'https://x/1', title: 'A', kind: 'movie', genres: ['Acción'] }, vote: 2 }))).json();
      assert.deepEqual([ok.ok, ok.vote, ok.taste.liked, ok.taste.loved], [true, 2, 1, 1]);
      const pref = await (await vote(JSON.stringify({ pref: { type: 'studio', name: 'MAPPA', value: 1 } }))).json();
      assert.deepEqual([pref.vote, pref.taste.prefs], [1, 1]);
      assert.equal((await vote(JSON.stringify({ pref: { type: 'actor', name: 'X', value: 1 } }))).status, 400);
      assert.equal((await (await vote(JSON.stringify({ dismiss: { url: 'https://x/2' } }))).json()).ok, true);
      assert.equal((await fetch(base + '/holy-api/vote', { method: 'OPTIONS' })).status, 204);
      assert.deepEqual((await (await fetch(base + '/holy-api/search?source=nada&q=a')).json()).items, []);
      assert.deepEqual((await (await fetch(base + '/holy-api/episodes?source=jkanime&show=javascript:1')).json()).seasons, []);
      assert.equal((await fetch(base + '/holy-api/img?u=' + encodeURIComponent('https://evil.example/x.jpg'))).status, 403);
      // Every site's own image host is allowed (AnimeYT's were refused on the TV, 2026-10-23).
      const { IMAGE_HOSTS } = await import('./holy/server.mjs');
      for (const host of ['image.tmdb.org', 'cdn.jkdesa.com', 'i0.wp.com', 'repelishd.blog', 'cuevana3c.pro', 'doramasmp4.cyou', 'animeyt.cc', 'asialiveaction.com', 'doramasflix.io']) assert.ok(IMAGE_HOSTS.test(host), host);
      assert.equal((await fetch(base + '/holy/..%2F..%2Fetc%2Fpasswd')).status === 200, false);
      const health = await (await fetch(base + '/holy-api/health')).json();
      assert.deepEqual([health.ok, health.library.votes], [true, 1]);
      assert.ok(Array.isArray((await (await fetch(base + '/holy-api/taste')).json()).rows));
      assert.ok((await (await fetch(base + '/holy-api/home')).json()).taste);
      const gz = await fetch(base + '/holy-api/home', { headers: { 'Accept-Encoding': 'gzip' } });
      assert.ok(gz.ok && (await gz.json()).rows);
      // Packed home (?v=2): same rows once unpacked; built once per version; older screens keep the plain one.
      const { unpackHome, packHome } = await import('../src/holy.js');
      const packed = await (await fetch(base + '/holy-api/home?v=2')).json();
      assert.equal(packed.v, 2);
      const plain = await (await fetch(base + '/holy-api/home')).json();
      assert.equal(plain.v, undefined);
      assert.deepEqual(unpackHome(packed).rows.map(row => row.items.map(item => item.url)), plain.rows.map(row => row.items.map(item => item.url)));
      const sample = { items: [{ url: 'https://a/1', title: 'A', genres: ['Drama'], overview: '' }, { url: 'https://a/2', title: 'B', genres: [] }],
        rows: [{ id: 'x', items: [{ url: 'https://a/2', title: 'B', genres: [] }, { url: 'https://a/1', title: 'A', genres: ['Drama'], resume: true }] }] };
      const small = packHome(sample);
      assert.deepEqual(small.rows[0].refs, [1, { url: 'https://a/1', title: 'A', genres: ['Drama'], resume: true }]);
      assert.equal('overview' in small.items[0], false);
      assert.deepEqual(unpackHome(small).rows[0].items.map(item => [item.title, item.genres.length, !!item.resume]), [['B', 0, false], ['A', 1, true]]);
    } finally { server.close(); }
  });

  await check('Atrás: la conexión viva pide el inicio; una vieja se aparta; sin conexión va al inicio sola', async () => {
    const { holyRemote, heartbeatSource } = await import('./holy/page-scripts.mjs');
    let assigned = '';
    const sent = [];
    const root = { dataset: {} };
    const worlds = name => {
      // Each isolated world has its own window but shares the page's DOM.
      const listeners = [];
      const win = { addEventListener: (type, fn) => type === 'keydown' && listeners.push(fn), location: { get href() { return 'https://player.example/'; }, set href(url) { assigned = url; } } };
      win.top = win;
      globalThis.window = win; globalThis.location = win.location; globalThis.addEventListener = win.addEventListener; globalThis.document = { documentElement: root };
      holyRemote(['http://mac/holy/'], 'http://mac/holy/', name);
      return { win, listeners };
    };
    const old = worlds('w1'), current = worlds('w2');
    let stamp = 0;
    const press = () => { const event = { keyCode: 461, timeStamp: ++stamp, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
      for (const fn of [...old.listeners, ...current.listeners]) { if (event.stopped) break; fn(event); } return event; };
    current.win.__lgLabCommand = payload => sent.push('w2 ' + payload);
    old.win.__lgLabCommand = payload => sent.push('w1 ' + payload);
    // The newer connection (w2) is live: the old world steps aside, w2 asks the Mac.
    eval(heartbeatSource('w2').replace('document.documentElement', 'root').replace('document.documentElement', 'root'));
    press();
    assert.deepEqual([sent, assigned], [['w2 {"action":"back"}'], '']);
    // No live connection (stamp too old): the page goes home itself, once.
    root.dataset.holyBridge = 'w2|' + (Date.now() - 20000);
    const event = press();
    assert.deepEqual([assigned, event.defaultPrevented, sent.length], ['http://mac/holy/', true, 1]);
    delete globalThis.window; delete globalThis.location; delete globalThis.addEventListener; delete globalThis.document;
    const manifest = JSON.parse(readFileSync(new URL('../public/appinfo.json', import.meta.url), 'utf8'));
    assert.equal(manifest.disableBackHistoryAPI, true);
  });

  await check('Proceso del Mac: sobrevive al corte de conexión con la TV; otros errores salen para reiniciarse', async () => {
    const { spawnSync } = await import('node:child_process');
    const run = message => spawnSync(process.execPath, ['--input-type=module', '-e', `import { installCrashGuard } from ${JSON.stringify(new URL('./holy/guard.mjs', import.meta.url).href)}; installCrashGuard(() => {}); setImmediate(() => { throw new Error(${JSON.stringify(message)}); }); setTimeout(() => process.exit(0), 200);`], { encoding: 'utf8' });
    assert.equal(run('Callback was already called.').status, 0);
    assert.equal(run('read ETIMEDOUT').status, 0);
    assert.equal(run('otra cosa rota').status, 1);
  });

  await check('Fuzz: ningún lector de sitios se rompe con páginas basura, cortadas o vacías', async () => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pieces = ['<a href="', '">', '</a>', '<article class="item movies"', '<li class="TPostMv', 'class="card ', '<div class="movie-item">', 'self.__next_f.push([1,"', '"])', '<article class="aniyt-episode-card',
      'var allVideos = {', 'video[0] = \'<iframe class="player_conte" src="', '"__typename":"EpisodeMin"', '{"_id":"', 'Últimos Episodios</h3>', '<option value="', '"', '\\', '{', '}', 'https://', 'é', '\u0000', ' '];
    const garbage = () => Array.from({ length: Math.floor(random() * 80) }, () => pieces[Math.floor(random() * pieces.length)] + (random() < 0.3 ? String(Math.floor(random() * 1e6)) : '')).join('');
    const inputs = ['', null, undefined, '<html>', 'x'.repeat(100000), ...Array.from({ length: 250 }, garbage)];
    for (const connector of CONNECTORS) {
      for (const input of inputs) {
        for (const name of ['parseHome', 'parseSearch', 'parseDetail', 'parsePlayers']) {
          if (typeof connector[name] !== 'function') continue;
          let result;
          try { result = connector[name](input ?? '', connector.site); } catch (error) { assert.fail(`${connector.id}.${name} lanzó ${error.message}`); }
          assert.ok(Array.isArray(result) || (result && typeof result === 'object'), `${connector.id}.${name}`);
        }
      }
      // Async readers either answer or fail with a message; they never hang or crash the process.
      for (const input of inputs.slice(0, 40)) {
        const load = async () => { if (random() < 0.2) throw Error('red'); return input ?? ''; };
        const subject = { url: connector.site + 'x/1/', show: connector.site + 'x/', source: connector.id, title: 'x' };
        for (const work of [connector.resolve && (() => connector.resolve(subject, load)), connector.episodes && (() => connector.episodes(subject.show, load, async () => input)), connector.search && (() => connector.search('a', load)), connector.home && (() => connector.home(load)), connector.detail && (() => connector.detail(subject, load))].filter(Boolean)) {
          const outcome = await Promise.race([work().then(() => 'ok', error => (error instanceof Error ? 'error' : 'raro')), new Promise(resolve => setTimeout(resolve, 3000, 'colgado'))]);
          assert.ok(['ok', 'error'].includes(outcome), `${connector.id}: ${outcome}`);
        }
      }
    }
    assert.deepEqual(flight('self.__next_f.push([1,"roto'), '');
    assert.deepEqual(sectionRows(null, 'movie'), []);
    assert.deepEqual(sectionRows({ rows: [{ id: 'x', items: [] }] }, 'inicio'), []);
    assert.deepEqual(episodeRows({ title: 'X' }, []), []);
    assert.deepEqual(new Library(join(directory, 'fuzz.json')).scored([null, {}, { genres: 'x' }]).length, 2);
  });
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log(`${checks.length} comprobaciones de resistencia de Holy correctas.`);
process.exit(0);
