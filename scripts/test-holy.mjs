import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cuevana, jkanime, repelishd, doramasmp4, decode, attr, genre, genresFromWords, pickServer } from './holy/sources.mjs';
import { Library, nextEpisode, entryKey } from './holy/library.mjs';
import { holyAutoplay, holySeek, remoteSource } from './holy/page-scripts.mjs';
import { home } from './browser-bridge.mjs';
import { Catalog } from './holy/catalog.mjs';
import { HolyBridge } from './holy/holy-bridge.mjs';
import { sectionRows, clock, remaining } from '../src/holy.js';

// Holy without the TV or the Internet: site snippets shaped like the real pages
// (2026-10-23), a fake clock and a fake CDP connection.
const directory = mkdtempSync(join(tmpdir(), 'holy-'));
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };

const cuevanaHome = `<style>.home-episodes{}</style><section class="home-movies"><ul><li class="TPostMv"><div class="TPost C"><a href="https://cuevana3c.pro/pelicula/street-fighter-2" data-instant><div class="Image"><span class="Year">2026</span><figure><img width=160 height=242 src=https://image.tmdb.org/t/p/w200/abc.jpg alt="Pelicula Street Fighter" loading="eager" ></figure></div><h2 class="Title">Street Fighter</h2></a><div class="TPMvCn"><p class="Info"><span class="Vote">6.6</span><span class="Date">2026</span><span class="Qlty">CAM</span></p><div class="Description"><p>Ryu y Ken vuelven [...]</p></div></div></div></li></ul></section>
<section class="home-series home-episodes"><li><article class="TPost C"><a href="https://cuevana3c.pro/serie/nadie-quiere-esto/episodio-3x10" data-instant><img width=160 height=242 src=https://image.tmdb.org/t/p/w1280/ep.jpg alt="Nadie 3x10"><h2 class="Title">Nadie quiere esto</h2><p> Episodio <span>3x10</span></p></a></article></li></section>`;
const cuevanaMovie = `<div class="backdrop-info"><h1 class="title"> Street Fighter </h1><p>En 1993, Ryu &amp; Ken…</p></div><div class="backdrop-image"><figure><img src=https://image.tmdb.org/t/p/w1280/back.jpg alt=""></figure></div><div class="player" id="player"><ul><li role="presentation" data-server="https://tungtungsahur.cuevana3c.pro/?token=AAA"><span>Servidor Hyper</span></li><li data-server="https://ads.example/?x"></li></ul></div>
<p><a href="https://cuevana3c.pro/peliculas?genero=accion" class="jump-link">Accion</a><a href="https://cuevana3c.pro/peliculas?genero=fantasia" class="jump-link">Fantasia</a></p>`;
const jkHome = `<div class="tab-pane fade show active" id="animes" role="tabpanel" aria-labelledby="animes-tab"><div class="mb-4 dir1"><div class="card ml-2 mr-2"><a href="https://jkanime.net/one-piece/1180/"><div class="d-thumb"><img class="card-img-top" src="https://cdn.jkdesa.com/ep.jpg" data-animepic="https://cdn.jkdesa.com/op.jpg" alt="One Piece - 1180"><span class="badge badge-primary">Ep 1180</span></div><div class="card-body"><h5 class="strlimit card-title">One Piece</h5></div></a></div></div></div>
<div class="tab-pane fade" id="hentai" role="tabpanel"><div class="card ml-2"><a href="https://jkanime.net/adult/1/"><h5 class="card-title">No</h5></a></div></div>`;
const jkEpisode = `<script>var video = [];video[0] = '<iframe class="player_conte" src="https://jkanime.net/jkplayer/um?e=TOKEN&t=1" width="565"></iframe>';video[1] = '<iframe class="player_conte" src="https://other.example/embed"></iframe>';</script>`;
const jkShow = `<a href="https://jkanime.net/genero/accion/">Accion</a><a href="https://jkanime.net/genero/shounen/">Shounen</a><p class="scroll">Luffy &quot;Sombrero de paja&quot; quiere ser rey.</p>`;
const repelisHome = `<h2>Últimas Películas Agregadas</h2></header><div class="items"><article class="item movies"><div class="poster"><img src="/uploads/thumb/185x278-0-85/idiots.webp" alt="Idiots"><div class="rating"><span class=icon-star2></span>5.5</div><span class="quality">HD</span><a href="https://repelishd.blog/ver-pelicula/25950-idiots-online-espanol.html"></a></div><div class="data"><h3><a href="https://repelishd.blog/ver-pelicula/25950-idiots-online-espanol.html">Idiots</a></h3> <span>2026</span></div></article></div><h2>Acción</h2>`;
const repelisMovie = `<meta property="og:description" content="Dos delincuentes son contratados para un trabajo. Dos delincuentes son contratados"><div class="extra"> <span>2026</span><span itemprop="duration">100 Min.</span><span>Comedia Ciencia ficción</span></div><script>var imdb = 'tt6628920';</script>`;
const doramasHome = `<h3>Últimos Estrenos</h3><article class="bs"><div class="bsx"><a href="https://doramasmp4.cyou/cap/till-i-see-you-capitulo-9/" itemprop="url" title="Till I See You Capitulo 9" class="tip"><span class="epx">CAP 9</span><img src="https://i0.wp.com/x.jpg?resize=246,350" /><div class="ttt"><div class="tt"> Till I See You <h2>Till I See You Capitulo 9</h2></div></div></a></div></article><h3>Más populares</h3>`;
const okru = Buffer.from('<iframe src="https://ok.ru/videoembed/123" width="640"></iframe>').toString('base64');
const other = Buffer.from('<iframe src="https://pkaa.top/embed.php?id=1"></iframe>').toString('base64');
const doramasEpisode = `<select><option value="${other}">Multi</option><option value="${okru}">Ok.ru</option></select><div class="genxed"><a href="https://doramasmp4.cyou/genres/romance/" rel="tag">Romance</a></div><div class="side"><a href="https://doramasmp4.cyou/genres/terror/" rel="tag">Terror</a></div>`;

try {
  await check('Texto: entidades y atributos sin comillas', () => {
    assert.equal(decode('Let&#039;s &amp; go&nbsp;!'), "Let's & go !");
    assert.equal(attr('<img width=160 src=https://a/b.jpg alt="x">', 'src'), 'https://a/b.jpg');
    assert.equal(genre('Accion'), 'Acción');
    assert.deepEqual(genresFromWords('Comedia Ciencia ficción'), ['Ciencia ficción', 'Comedia']);
  });
  await check('Cuevana: películas, episodios, géneros y reproductor del propio sitio con pops=false', () => {
    const items = cuevana.parseHome(cuevanaHome);
    assert.equal(items.length, 2);
    assert.deepEqual([items[0].kind, items[0].title, items[0].year, items[0].rating, items[0].badge], ['movie', 'Street Fighter', '2026', '6.6', 'CAM']);
    assert.equal(items[0].poster, 'https://image.tmdb.org/t/p/w342/abc.jpg');
    assert.equal(items[1].kind, 'series'); assert.equal(items[1].subtitle, 'Episodio 3x10');
    const detail = cuevana.parseDetail(cuevanaMovie, 'https://cuevana3c.pro/pelicula/street-fighter-2');
    assert.deepEqual(detail.genres, ['Acción', 'Fantasía']);
    assert.equal(detail.backdrop, 'https://image.tmdb.org/t/p/w1280/back.jpg');
    assert.deepEqual(cuevana.player(detail, 'https://cuevana3c.pro/pelicula/street-fighter-2'), { url: 'https://tungtungsahur.cuevana3c.pro/?token=AAA&pops=false', referrer: 'https://cuevana3c.pro/pelicula/street-fighter-2', alternatives: [] });
    assert.equal(cuevana.player({ players: ['https://ads.example/?x'] }, 'p'), null);
  });
  await check('JKAnime: solo la pestaña Animes, episodio, géneros y su reproductor propio', async () => {
    const items = jkanime.parseHome(jkHome);
    assert.equal(items.length, 1);
    assert.deepEqual([items[0].title, items[0].episode, items[0].show], ['One Piece', 1180, 'https://jkanime.net/one-piece/']);
    const show = jkanime.parseDetail(jkShow + '<li><span>Studios:</span> <a href="https://jkanime.net/studio/18/">Toei Animation</a> </li>');
    assert.deepEqual([show.genres, show.overview, show.studios, show.country], [['Acción', 'Shounen'], 'Luffy "Sombrero de paja" quiere ser rey.', ['Toei Animation'], 'Japón']);
    assert.deepEqual(await jkanime.resolve(items[0], async () => jkEpisode), { url: 'https://jkanime.net/jkplayer/um?e=TOKEN&t=1', referrer: 'https://jkanime.net/one-piece/1180/', alternatives: [] });
  });
  await check('RePelisHD: lista, géneros, sinopsis sin repetir; Mixdrop latino directo y nunca servidores que cierran la app', async () => {
    const items = repelishd.parseHome(repelisHome);
    assert.deepEqual([items.length, items[0].title, items[0].poster], [1, 'Idiots', 'https://repelishd.blog/uploads/thumb/185x278-0-85/idiots.webp']);
    const detail = repelishd.parseDetail(repelisMovie);
    assert.deepEqual(detail.genres, ['Ciencia ficción', 'Comedia']);
    assert.equal(detail.overview, 'Dos delincuentes son contratados para un trabajo.');
    const sources = [{ url: 'https://dr0pstream.com/e/1', version: 'latino' }, { url: 'https://doodstream.com/e/2', version: 'latino' }, { url: 'https://mxdrop.to/e/3', version: 'subtitulado' }, { url: 'https://mxdrop.to/e/4', version: 'latino' }];
    assert.equal(pickServer(sources).url, 'https://mxdrop.to/e/4');
    assert.equal(pickServer([{ url: 'https://unlimplay.com/f/1' }, { url: 'https://dr0pstream.com/e/1' }]), null);
    const requests = [];
    const load = async (url, options = {}) => {
      requests.push({ url, ...options });
      if (url.includes('ver-pelicula')) return repelisMovie;
      if (url.endsWith('/movie/tt6628920')) return '<script>body: JSON.stringify({ type: "movie", id: "tt6628920", token: "TOKEN" })</script>';
      return JSON.stringify({ ok: true, sources });
    };
    assert.deepEqual(await repelishd.resolve(items[0], load), { url: 'https://mxdrop.to/e/4', referrer: 'https://playlatinsrc.co/movie/tt6628920', server: undefined, version: 'latino', alternatives: ['https://mxdrop.to/e/3', 'https://doodstream.com/e/2'] });
    assert.equal(JSON.parse(requests.at(-1).body).token, 'TOKEN');
    await assert.rejects(repelishd.resolve(items[0], async (url, options) => (options?.method === 'POST' ? '{"ok":true,"sources":[{"url":"https://unlimplay.com/f/1"}]}' : load(url))), error => error.unsafe === true);
  });
  await check('DoramasMP4: capítulo, géneros propios (no los de la barra) y ok.ru preferido', async () => {
    const items = doramasmp4.parseHome(doramasHome);
    assert.deepEqual([items[0].title, items[0].badge, items[0].kind], ['Till I See You', 'Cap 9', 'dorama']);
    const detail = doramasmp4.parseDetail(doramasEpisode);
    assert.deepEqual(detail.genres, ['Romance']);
    assert.equal(doramasmp4.player(detail, 'p').url, 'https://ok.ru/videoembed/123?autoplay=1');
    // pkaa.top is a picker: its own servers are used, ok.ru first, VK last.
    const picker = Buffer.from('<iframe src="https://pkaa.top/embed.php?id=9"></iframe>').toString('base64');
    const target = await doramasmp4.resolve({ url: 'https://doramasmp4.cyou/cap/x-capitulo-1/' }, async url => url.includes('pkaa')
      ? "<li onclick=\"go_to_player('https://vkvideo.ru/video_ext.php?id=1')\"></li><li onclick=\"go_to_player('https://voe.sx/e/2')\"></li><li onclick=\"go_to_player('https://ok.ru/videoembed/3')\"></li>"
      : `<option value="${picker}">Multi</option>`);
    assert.deepEqual(target, { url: 'https://ok.ru/videoembed/3?autoplay=1', referrer: 'https://doramasmp4.cyou/cap/x-capitulo-1/', alternatives: ['https://voe.sx/e/2', 'https://vkvideo.ru/video_ext.php?id=1'] });
  });

  await check('Autoplay en la página: vídeo dentro de shadow DOM, botón del reproductor y nada más', () => {
    const played = [];
    const video = (readyState, inShadow) => ({ tagName: 'VIDEO', currentTime: 0, duration: 1200, paused: true, ended: false, readyState, clientWidth: 1920, clientHeight: 1080, play() { played.push(inShadow ? 'shadow' : 'light'); return Promise.resolve(); } });
    const shadowVideo = video(1, true);
    const host = { shadowRoot: { querySelectorAll: selector => (selector === 'video' ? [shadowVideo] : []) } };
    const clicks = [];
    const button = { getBoundingClientRect: () => ({ width: 64, height: 64 }), click: () => clicks.push('vid_play') };
    globalThis.window = {}; globalThis.location = { href: 'https://ok.ru/videoembed/1', hostname: 'ok.ru', pathname: '/videoembed/1' };
    globalThis.getComputedStyle = () => ({ visibility: 'visible' });
    globalThis.document = { querySelectorAll: selector => (selector === '*' ? [host] : selector === 'video' ? [] : []), querySelector: selector => (selector === '.vid_play' ? button : null) };
    window.top = window;
    const first = holyAutoplay();
    assert.equal(first.videos.length, 1); assert.deepEqual(played, ['shadow']);
    assert.equal(first.action, 'click .vid_play');
    shadowVideo.paused = false; shadowVideo.currentTime = 3;
    assert.equal(holyAutoplay().action, '');
    assert.equal(holySeek(600), true); assert.equal(shadowVideo.currentTime, 600);
    delete globalThis.window; delete globalThis.document; delete globalThis.location; delete globalThis.getComputedStyle;
  });

  await check('Búsqueda: resultados de los 4 sitios, series como fichas con episodios', async () => {
    const cv = cuevana.parseSearch('<div class="movie-item"><a href="https://cuevana3c.pro/pelicula/batman-x" data-instant><figure><img src=https://image.tmdb.org/t/p/w200/b.jpg class="poster"><span class="year text-center">2026</span></figure><div class="item-detail"><p>Batman X</p></div></a></div><div class="movie-item"><a href="https://cuevana3c.pro/serie/nadie-quiere-esto"><img src=x><div class="item-detail"><p>Nadie quiere esto</p></div></a></div>');
    assert.deepEqual(cv.map(item => [item.kind, item.title, !!item.isShow]), [['movie', 'Batman X', false], ['series', 'Nadie quiere esto', true]]);
    assert.equal(cv[0].poster, 'https://image.tmdb.org/t/p/w342/b.jpg');
    assert.equal(jkanime.searchURL('one piece'), 'https://jkanime.net/buscar/one_piece/');
    const jk = jkanime.parseSearch('<div class="anime__item"> <a  href="https://jkanime.net/one-piece/"><div class="g-0 anime__item__pic set-bg" data-setbg="https://cdn.jkdesa.com/op.jpg"></div></a><div class="anime__item__text"><ul><li>En emision</li> <li class="anime">Serie</li></ul><h5><a  href="https://jkanime.net/one-piece/">One Piece</a></h5></div>');
    assert.deepEqual([jk[0].title, jk[0].show, jk[0].poster, jk[0].badge], ['One Piece', 'https://jkanime.net/one-piece/', 'https://cdn.jkdesa.com/op.jpg', 'Serie']);
    assert.equal(repelishd.parseSearch(repelisHome.replace('<h2>Últimas Películas Agregadas</h2>', ''))[0].title, 'Idiots');
    const dm = doramasmp4.parseSearch('<article class="bs"><a href="https://doramasmp4.cyou/series/love-on-hire/" itemprop="url" title="Love on Hire" class="tip"><span class="epx">En emisión</span><img src="https://i1.wp.com/p.jpg"/></a></article>');
    assert.deepEqual([dm[0].title, dm[0].isShow, dm[0].badge], ['Love on Hire', true, 'En emisión']);
    // Episodes: Cuevana by season pages, DoramasMP4 by the show's own chapter links, JKAnime by its paginated list.
    const seasons = await cuevana.episodes('https://cuevana3c.pro/serie/x', async url => url.endsWith('/x') ? '<a href="https://cuevana3c.pro/serie/x/temporada-2"></a><a href="https://cuevana3c.pro/serie/x/temporada-1"></a>' : url.endsWith('temporada-1') ? '<a href="https://cuevana3c.pro/serie/x/episodio-1x2"></a><a href="https://cuevana3c.pro/serie/x/episodio-1x1"></a>' : '<a href="https://cuevana3c.pro/serie/x/episodio-2x1"></a>');
    assert.deepEqual(seasons.map(season => season.title + ':' + season.episodes.map(e => e.label).join('|')), ['Temporada 1:Episodio 1x1|Episodio 1x2', 'Temporada 2:Episodio 2x1']);
    const chapters = await doramasmp4.episodes('https://doramasmp4.cyou/series/love-on-hire/', async () => '<a href="https://doramasmp4.cyou/cap/love-on-hire-capitulo-2/"></a><a href="https://doramasmp4.cyou/cap/love-on-hire-capitulo-1/"></a><a href="https://doramasmp4.cyou/cap/otra-capitulo-9/"></a>');
    assert.deepEqual(chapters[0].episodes.map(e => e.episode), [1, 2]);
    const pages = { 1: { last_page: 2, data: [{ number: 1, image: 'a.jpg' }] }, 2: { last_page: 2, data: [{ number: 60, image: 'z.jpg' }] } };
    const blocks = await jkanime.episodes('https://jkanime.net/x/', async () => 'ajax/episodes/201/', async url => JSON.stringify(pages[url.split('/').at(-1)]));
    assert.deepEqual(blocks.map(block => block.title), ['Episodios 11–60', 'Episodios 1–10']);
    assert.equal(blocks[0].episodes[0].still, 'https://cdn.jkdesa.com/assets/images/animes/video/image/z.jpg');
  });

  let now = Date.UTC(2026, 9, 23);
  const library = new Library(join(directory, 'library.json'), () => now);
  const anime = { source: 'jkanime', kind: 'anime', title: 'One Piece', url: 'https://jkanime.net/one-piece/1180/', show: 'https://jkanime.net/one-piece/', episode: 1180, genres: ['Acción', 'Shounen'] };
  const movie = { source: 'cuevana', kind: 'movie', title: 'Street Fighter', url: 'https://cuevana3c.pro/pelicula/street-fighter-2', genres: ['Acción', 'Fantasía'] };
  await check('Historial: una tarjeta por serie, posición guardada y reanudación exacta', () => {
    library.start(anime);
    library.progress(entryKey(anime), anime.url, 600, 1440);
    library.start(movie);
    library.progress(entryKey(movie), movie.url, 2700, 6000);
    const list = library.continueWatching();
    assert.deepEqual(list.map(entry => entry.title), ['Street Fighter', 'One Piece']);
    assert.equal(list[0].percent, 45);
    assert.equal(library.resumeAt(movie), 2700);
    assert.equal(library.resumeAt({ ...anime, url: 'https://jkanime.net/one-piece/1181/' }), 0);
    assert.equal(library.progress(entryKey(anime), 'https://jkanime.net/one-piece/999/', 10, 1440), null);
  });
  await check('Episodio terminado: aparece el siguiente; película terminada sale de la fila', () => {
    now += 60000;
    library.progress(entryKey(anime), anime.url, 1400, 1440);
    library.progress(entryKey(movie), movie.url, 5950, 6000);
    const list = library.continueWatching();
    assert.equal(list.length, 1);
    assert.deepEqual([list[0].url, list[0].upNext, list[0].subtitle], ['https://jkanime.net/one-piece/1181/', true, 'Episodio 1181']);
    assert.equal(nextEpisode({ url: 'https://doramasmp4.cyou/cap/till-i-see-you-capitulo-9/' }).url, 'https://doramasmp4.cyou/cap/till-i-see-you-capitulo-10/');
    assert.equal(nextEpisode({ url: 'https://cuevana3c.pro/serie/x/episodio-3x10' }).url, 'https://cuevana3c.pro/serie/x/episodio-3x11');
  });
  await check('Recomendaciones: gustos por género, sin repetir lo ya visto y con motivo', () => {
    const fresh = [
      { source: 'cuevana', kind: 'movie', title: 'Comedia ligera', url: 'https://c/1', genres: ['Comedia'] },
      { source: 'jkanime', kind: 'anime', title: 'Naruto', url: 'https://jkanime.net/naruto/1/', show: 'https://jkanime.net/naruto/', genres: ['Acción', 'Shounen'] },
      movie,
      { source: 'repelishd', kind: 'movie', title: 'STREET FIGHTER', url: 'https://r/sf', genres: ['Acción'] },
      { source: 'repelishd', kind: 'movie', title: 'Acción total', url: 'https://r/2', genres: ['Acción'] }
    ];
    const picks = library.recommend(fresh);
    assert.deepEqual(picks.map(item => item.title).sort(), ['Acción total', 'Naruto']);
    assert.ok(picks.every(item => item.match >= 60));
    assert.equal(picks.find(item => item.title === 'Naruto').reason, 'Porque viste One Piece');
    assert.deepEqual(new Library(join(directory, 'empty.json')).recommend(fresh), []);
  });
  await check('Secciones del inicio y formatos de tiempo', () => {
    const data = { rows: [{ id: 'continue', title: 'Continuar viendo', items: [{ ...anime, backdrop: 'b' }] }], items: [movie, anime, { ...movie, url: 'u2' }, { ...movie, url: 'u3' }, { ...movie, url: 'u4' }], sources: [{ id: 'cuevana', name: 'Cuevana 3' }] };
    assert.equal(sectionRows(data, 'inicio')[0].layout, 'landscape');
    assert.deepEqual(sectionRows(data, 'movie').map(row => row.title), ['Lo nuevo en Cuevana 3', 'Acción', 'Fantasía']);
    assert.equal(sectionRows(data, 'anime')[0].title, 'Continuar viendo');
    assert.equal(clock(3725), '1:02:05'); assert.equal(clock(65), '1:05'); assert.equal(remaining(600, 6000), 'Quedan 1 h 30 min');
  });

  await check('Catálogo: un sitio caído conserva sus títulos anteriores y no frena a los demás', async () => {
    const pages = { 'https://cuevana3c.pro/': cuevanaHome, 'https://jkanime.net/': jkHome, 'https://cuevana3c.pro/pelicula/street-fighter-2': cuevanaMovie, 'https://jkanime.net/one-piece/': jkShow };
    let down = false;
    const catalog = new Catalog({ file: join(directory, 'catalog.json'), detailsFile: join(directory, 'details.json'), connectors: [cuevana, jkanime],
      fetch: async url => { if (down && url.startsWith('https://jkanime')) throw Error('caído'); if (!pages[url]) throw Error('404 ' + url); return pages[url]; } });
    await catalog.refresh();
    assert.equal(catalog.items.length, 3);
    assert.deepEqual(catalog.find(movie.url).genres, ['Acción', 'Fantasía']);
    down = true;
    await catalog.refresh();
    assert.equal(catalog.items.filter(item => item.source === 'jkanime').length, 1);
    assert.equal(catalog.errors.jkanime, 'caído');
    const home = catalog.home(library);
    // Everything fresh here was already watched: no «Para ti» row, «Continuar viendo» first.
    assert.deepEqual(home.rows.map(row => row.id), ['continue', 'movies', 'anime', 'series']);
    assert.ok(home.hero);
  });

  await check('Puente: reproducir abre el reproductor del sitio con su referencia y la cortina antes', async () => {
    const calls = [];
    let script = 0;
    const cdp = {
      async call(method, params = {}) {
        calls.push({ method, params });
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: 'https://example.com/' } } };
        if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: String(++script) };
        return {};
      },
      async evaluate(expression) { return expression.includes('hasContent') ? { url: 'https://example.com/', hasContent: true } : 'https://example.com/'; },
      onEvent() { return () => {}; }
    };
    const catalog = { version: 3, find: () => null, resolve: async item => ({ url: 'https://tungtungsahur.cuevana3c.pro/?token=AAA&pops=false', referrer: item.url }) };
    const bridge = await new HolyBridge(cdp, { preferencesFile: join(directory, 'settings.json'), catalog, library, apiBase: 'http://mac:43190', recorder: false }).start();
    clearInterval(bridge.watchTimer);
    assert.ok(calls.some(call => call.method === 'Page.addScriptToEvaluateOnNewDocument' && call.params.source.includes('__holyRemote') && call.params.worldName === bridge.toolbarWorld));
    const mark = calls.length;
    await bridge.command({ action: 'play', value: movie });
    const curtain = calls.findIndex((call, index) => index >= mark && call.params.source?.includes('__holyCurtain'));
    const navigate = calls.findIndex((call, index) => index >= mark && call.method === 'Page.navigate');
    assert.ok(curtain > 0 && navigate > curtain);
    assert.deepEqual(calls[navigate].params, { url: 'https://tungtungsahur.cuevana3c.pro/?token=AAA&pops=false', referrer: movie.url });
    assert.equal(bridge.session.phase, 'opening');
    assert.equal(bridge.statusPayload().holy.apiBase, 'http://mac:43190');
    // A player frame may only ask to go back; it cannot navigate elsewhere.
    bridge.remoteContexts.add(77);
    const before = calls.length;
    await bridge.event({ method: 'Runtime.bindingCalled', params: { name: '__lgLabCommand', executionContextId: 77, payload: JSON.stringify({ action: 'navigate', value: 'https://evil.example/' }) } });
    assert.ok(!calls.slice(before).some(call => call.method === 'Page.navigate'));
    await bridge.event({ method: 'Runtime.bindingCalled', params: { name: '__lgLabCommand', executionContextId: 77, payload: JSON.stringify({ action: 'back' }) } });
    assert.equal(bridge.session, null);
    assert.ok(calls.slice(before).some(call => call.method === 'Page.navigate' && call.params.url.endsWith('/holy/')));
    assert.ok(calls.slice(before).some(call => call.method === 'Page.removeScriptToEvaluateOnNewDocument'));
    // Back on Holy's own home never walks back into an old player.
    bridge.frames.set(bridge.mainFrame, home);
    const idle = calls.length;
    await bridge.command({ action: 'back' });
    assert.ok(!calls.slice(idle).some(call => call.method === 'Page.navigate' || call.method === 'Page.navigateToHistoryEntry'));
    assert.ok(remoteSource([home]).includes(JSON.stringify([home])));
    await assert.rejects(bridge.command({ action: 'play', value: { url: 'javascript:alert(1)' } }));
    await bridge.stop();
  });
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log(`${checks.length} comprobaciones de Holy correctas.`);
