import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cuevana, repelishd, jkanime, doramasmp4 } from './holy/sources.mjs';
import { doramasflix, asialiveaction, animeyt, flight, flixHost, rankFlixLinks } from './holy/more-sources.mjs';
import { CONNECTORS } from './holy/connectors.mjs';
import { Library } from './holy/library.mjs';
import { Catalog } from './holy/catalog.mjs';
import { HolyBridge } from './holy/holy-bridge.mjs';
import { startServer } from './holy/server.mjs';
import { sectionRows, episodeRows } from '../src/holy.js';

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
    // A refused title (only unsafe servers) never navigates.
    const before = calls.filter(call => call.method === 'Page.navigate').length;
    catalog.resolve = async () => { throw Object.assign(Error('solo servidores que cierran la app'), { unsafe: true }); };
    await bridge.command({ action: 'play', value: { url: 'https://site.example/u', title: 'U', kind: 'movie', source: 'x' } });
    assert.equal(calls.filter(call => call.method === 'Page.navigate').length, before);
    assert.equal(bridge.statusPayload().holy.session.phase, 'failed');
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
      const ok = await (await vote(JSON.stringify({ item: { url: 'https://x/1', title: 'A', kind: 'movie', genres: ['Acción'] }, vote: 1 }))).json();
      assert.deepEqual([ok.ok, ok.vote, ok.taste.liked], [true, 1, 1]);
      assert.equal((await fetch(base + '/holy-api/vote', { method: 'OPTIONS' })).status, 204);
      assert.deepEqual((await (await fetch(base + '/holy-api/search?source=nada&q=a')).json()).items, []);
      assert.deepEqual((await (await fetch(base + '/holy-api/episodes?source=jkanime&show=javascript:1')).json()).seasons, []);
      assert.equal((await fetch(base + '/holy-api/img?u=' + encodeURIComponent('https://evil.example/x.jpg'))).status, 403);
      assert.equal((await fetch(base + '/holy/..%2F..%2Fetc%2Fpasswd')).status === 200, false);
      const health = await (await fetch(base + '/holy-api/health')).json();
      assert.deepEqual([health.ok, health.library.votes], [true, 1]);
      assert.ok(Array.isArray((await (await fetch(base + '/holy-api/taste')).json()).rows));
      assert.ok((await (await fetch(base + '/holy-api/home')).json()).taste);
    } finally { server.close(); }
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
