// YouTube in Holy's search: only whole films and episodes, in Spanish, of the title searched,
// best first; how they play on the TV and on the web page. No TV, no Internet.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { youtube, parseSearch, cleanTitle, seconds, embedURL, watchURL, episodeNames } from './holy/youtube.mjs';
import { Catalog } from './holy/catalog.mjs';
import { Library } from './holy/library.mjs';
import { startServer, IMAGE_HOSTS } from './holy/server.mjs';
import { CONNECTORS } from './holy/connectors.mjs';

const directory = mkdtempSync(join(tmpdir(), 'holy-youtube-'));
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
// A results page shaped like YouTube's (2026-11-03): ytInitialData with videoRenderer entries.
const video = (id, title, length, { channel = 'Canal', verified = false, badges = [], views = '1,000 vistas' } = {}) => ({ videoRenderer: {
  videoId: id, title: { runs: [{ text: title }] }, lengthText: { simpleText: length }, ownerText: { runs: [{ text: channel }] },
  ownerBadges: verified ? [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_VERIFIED' } }] : [],
  badges: badges.map(label => ({ metadataBadgeRenderer: { label } })), viewCountText: { simpleText: views } } });
const page = videos => `<html><script>var ytInitialData = ${JSON.stringify({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: videos } }] } } } } })};</script></html>`;
const results = page([
  video('aaaaaaaaaa1', 'SHREK 1 🧅💚 | Película Completa en Español Latino | Una Aventura Inolvidable', '1:22:23', { views: '5,385,454 vistas' }),
  video('aaaaaaaaaa2', 'Shrek 2 (2004) | Película Completa en Español Latino 4K', '1:33:00', { channel: 'Estudio Oficial', verified: true, badges: ['4K'], views: '20,000 vistas' }),
  video('aaaaaaaaaa3', 'Shrek | Escena del pantano | Español Latino', '3:10'),
  video('aaaaaaaaaa4', 'Shrek (2001) Review and Facts | Película en Español', '1:45:34'),
  video('aaaaaaaaaa5', 'SHREK 3 PELICULA COMPLETA EN ESPAÑOL (Película del Juego)', '1:32:44'),
  video('aaaaaaaaaa6', 'Shrek Full Movie HD', '1:30:00'),
  video('aaaaaaaaaa7', 'Monster Inc película completa en español latino', '1:32:16'),
  video('aaaaaaaaaa8', 'Shrek película completa en español latino', '1:31:00', { badges: ['Solo para miembros'] }),
  video('aaaaaaaaaa1', 'SHREK 1 🧅💚 | Película Completa en Español Latino | Una Aventura Inolvidable', '1:22:23'),
  video('aaaaaaaaaa9', 'Shrek CAM película completa español', '1:30:00'),
  video('aaaaaaaaab1', 'Shrek: La serie | Temporada 2 Episodio 5 | Episodio completo en Español Latino', '24:10', { verified: true })
]);

try {
  await check('Duración: «1:36:32» y «24:10» en segundos; vacío es 0', () => {
    assert.deepEqual([seconds('1:36:32'), seconds('24:10'), seconds(''), seconds('EN VIVO')], [5792, 1450, 0, 0]);
  });

  await check('Título limpio: el nombre de la película, sin «Película completa en Español Latino» ni emojis', () => {
    assert.equal(cleanTitle('TE ENSEÑARÉ A SOÑAR | Película completa en Español Latino | Películas de amor'), 'Te Enseñaré A Soñar');
    assert.equal(cleanTitle('Hansel y Gretel Cazadores de brujas Pelicula Completa Español Latino 4k-Hansel and Gretel'), 'Hansel y Gretel Cazadores de brujas');
    assert.equal(cleanTitle('Lone Survivor | Mark Wahlberg | Película Completa en Español Latino | Acción'), 'Lone Survivor');
    assert.equal(cleanTitle('SHREK 1 🧅💚 | Película Completa en Español Latino'), 'Shrek 1');
  });

  await check('Solo completas en español del título buscado: fuera cortos, reseñas, juegos, sin español, otro título, miembros y CAM', () => {
    const items = parseSearch(results, 'shrek');
    assert.deepEqual(items.map(item => item.url.slice(-11)).sort(), ['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaab1']);
  });

  await check('Primero canal verificado y 4K/HD; cada vídeo una vez; datos de la tarjeta', () => {
    const items = parseSearch(results, 'shrek');
    assert.equal(items[0].url, watchURL('aaaaaaaaaa2'));
    const film = items.find(item => item.url.endsWith('aaaaaaaaaa2'));
    assert.deepEqual([film.source, film.kind, film.title, film.year, film.language, film.badge, film.verified], ['youtube', 'movie', 'Shrek 2', '2004', 'Latino', '4K', true]);
    assert.equal(film.subtitle, 'Estudio Oficial · 1 h 33 min');
    assert.equal(film.poster, 'https://i.ytimg.com/vi/aaaaaaaaaa2/hqdefault.jpg');
    assert.ok(IMAGE_HOSTS.test(new URL(film.poster).hostname), 'el servidor sirve sus miniaturas');
  });

  await check('Un episodio completo es serie, con su número', () => {
    const episode = parseSearch(results, 'shrek').find(item => item.kind === 'series');
    assert.deepEqual([episode.episode, episode.subtitle], [5, 'Capítulo 5 · Canal · 24 min']);
  });

  await check('Sin palabras de título («película completa en español»): cualquier película completa en español', () => {
    const items = parseSearch(results, 'película completa en español latino');
    assert.ok(items.some(item => item.url.endsWith('aaaaaaaaaa7')), 'Monster Inc entra cuando no se pidió Shrek');
  });

  await check('La búsqueda pide a YouTube «completa» y vídeos de más de 20 minutos', () => {
    const url = new URL(youtube.searchURL('shrek'));
    assert.deepEqual([url.searchParams.get('search_query'), url.searchParams.get('sp')], ['shrek completa', 'EgIYAg==']);
    assert.equal(new URL(youtube.searchURL('serie completa')).searchParams.get('search_query'), 'serie completa');
  });

  await check('Una página que no es de resultados avisa en vez de devolver nada', async () => {
    await assert.rejects(youtube.search('shrek', async () => '<html>consent</html>'), /YouTube/);
  });

  await check('Reproducir: la TV abre la página de YouTube; la web incrusta si el canal lo permite', async () => {
    const asked = [];
    const target = await youtube.resolve({ url: watchURL('aaaaaaaaaa2') }, async url => { asked.push(url); return '{"type":"video","title":"Shrek 2"}'; });
    assert.deepEqual(target, { url: watchURL('aaaaaaaaaa2'), embed: embedURL('aaaaaaaaaa2') });
    assert.match(asked[0], /^https:\/\/www\.youtube\.com\/oembed\?/);
    const closed = await youtube.resolve({ url: watchURL('aaaaaaaaaa2') }, async () => { throw Error('www.youtube.com respondió 401'); });
    assert.equal(closed.embed, '');
    await assert.rejects(youtube.resolve({ url: watchURL('aaaaaaaaaa2') }, async () => { throw Error('www.youtube.com respondió 404'); }), /ya no está disponible/);
    await assert.rejects(youtube.resolve({ url: 'https://www.youtube.com/watch?v=bad' }, async () => '{}'), /no válida/);
    // A page that is not YouTube's answer never becomes a player; a network failure says so.
    await assert.rejects(youtube.resolve({ url: watchURL('aaaaaaaaaa2') }, async () => '<html>cambió</html>'), /no confirmó/);
    await assert.rejects(youtube.resolve({ url: watchURL('aaaaaaaaaa2') }, async () => { throw Error('timeout'); }), /timeout/);
  });

  await check('Catálogo: YouTube es solo búsqueda; no se lee como sitio ni marca error al refrescar', async () => {
    assert.ok(CONNECTORS.some(connector => connector.id === 'youtube'));
    const site = { id: 'x', name: 'X', site: 'https://x.example/', parseHome: () => [{ source: 'x', kind: 'movie', title: 'Una', url: 'https://x.example/una' }], parseDetail: () => ({}) };
    const catalog = new Catalog({ file: join(directory, 'c.json'), detailsFile: join(directory, 'd.json'), knownLists: null, connectors: [site, youtube],
      fetch: async url => (url.includes('youtube.com/results') ? results : '<html></html>') });
    await catalog.run();
    const sources = catalog.sources();
    assert.deepEqual(sources.find(source => source.id === 'youtube'), { id: 'youtube', name: 'YouTube · completas', count: 0, error: '', search: true, versions: false, health: null });
    assert.deepEqual(catalog.items.map(item => item.source), ['x']);
    const found = await catalog.search('youtube', 'shrek');
    assert.equal(found.length, 3);
    catalog.stop();
  });

  await check('Servidor: la web recibe el reproductor incrustable, o una pestaña si el canal no deja incrustar', async () => {
    let embeddable = true;
    const site = { ...youtube, async resolve(entry) { return { url: entry.url, embed: embeddable ? embedURL('aaaaaaaaaa2') : '' }; } };
    const library = new Library(join(directory, 'lib.json'));
    const catalog = new Catalog({ file: join(directory, 's.json'), detailsFile: join(directory, 'sd.json'), knownLists: null, connectors: [site], fetch: async () => '' });
    const server = startServer({ catalog, library, port: 0, log: () => {}, imageDir: join(directory, 'img'), root: directory, webRoot: join(directory, 'none') });
    await new Promise(resolve => (server.listening ? resolve() : server.once('listening', resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const play = () => fetch(base + '/holy-api/resolve', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ item: { source: 'youtube', url: watchURL('aaaaaaaaaa2'), kind: 'movie', title: 'Shrek 2' } }) }).then(response => response.json());
    try {
      const inPage = await play();
      assert.deepEqual([inPage.ok, inPage.url, inPage.needsReferrer, inPage.site], [true, embedURL('aaaaaaaaaa2'), false, 'YouTube · completas']);
      embeddable = false; catalog.forgetPlayer(watchURL('aaaaaaaaaa2'));
      const tab = await play();
      assert.deepEqual([tab.url, tab.needsReferrer], [watchURL('aaaaaaaaaa2'), true]);
    } finally { server.close(); catalog.stop(); }
  });
  await check('Series de canales (RCN, Super Campeones): «Capítulo 3» basta como español; se agrupan en una serie', () => {
    const owner = path => ({ ownerText: { runs: [{ text: path === '/@canalrcn' ? 'Canal RCN' : 'Otro', navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: path } } }] } });
    const episode = (id, title, path = '/@canalrcn') => ({ videoRenderer: { ...video(id, title, '45:20').videoRenderer, ...owner(path) } });
    const found = parseSearch(page([
      episode('rcnrcnrcn01', 'Alfredo Ferro y Mercedes Ramos inician una relación | Dr. Mata | Capítulo 1'),
      episode('rcnrcnrcn02', 'Mercedes Ramos busca respuestas | Capítulo 3 | Dr. Mata'),
      episode('otrootro001', 'Matallana escapa | Capítulo 4 | Dr. Mata', '/@otro'),
      episode('rcnrcnrcn03', 'Dr. Mata: el abogado psicópata colombiano')
    ]), 'dr mata');
    assert.deepEqual(found.map(item => [item.title, !!item.isShow, item.kind]), [['Dr. Mata', true, 'series'], ['Dr. Mata', false, 'series']]);
    assert.equal(found[0].show, 'https://www.youtube.com/@canalrcn/search?query=Dr.%20Mata');
    assert.deepEqual(episodeNames('Nosotros los guapos | Capítulo 3 | Distrito Comedia', 'Distrito Comedia'), { series: 'Nosotros los guapos', episode: '' });
    assert.deepEqual(episodeNames('Momento de tensión | Capítulo 53 Completo en Español Latino | Super Campeones'), { series: 'Super Campeones', episode: 'Momento de tensión' });
    assert.equal(parseSearch(page([video('scscscscs01', 'Super Campeones   Cap 61 Latino', '24:24')]), 'supercampeones')[0]?.title, 'Super Campeones');
  });

  await check('Capítulos de una serie de canal: búsqueda del canal, páginas siguientes y, si faltan, sus vídeos (formato nuevo)', async () => {
    const lockup = (id, title, length) => ({ lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', contentId: id, metadata: { lockupMetadataViewModel: { title: { content: title } } },
      contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: length } }] } }] } } } });
    const cap = n => lockup(('cap' + n).padEnd(11, 'x'), `El partido ${n} | Capítulo ${n} Completo en Español Latino | Super Campeones`, '21:10');
    const channel = { channelMetadataRenderer: { title: 'Super Campeones | Oficial', vanityChannelUrl: 'http://www.youtube.com/@supercampeones_oficial' } };
    const tagged = (items, token) => `<script>var ytInitialData = ${JSON.stringify({ metadata: channel, contents: [...items, ...(token ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token } } } }] : [])] })};</script>"INNERTUBE_CLIENT_VERSION":"2.1"`;
    const asked = [];
    const seasons = await youtube.episodes('https://www.youtube.com/@supercampeones_oficial/search?query=Super%20Campeones', async (url, options) => {
      asked.push(url.replace('https://www.youtube.com/', ''));
      if (url.includes('/search?')) return tagged([cap(3), cap(1), lockup('clipclipcl1', 'La trampa del fuera de lugar | Super Campeones', '5:13')], 'next-search');
      if (url.endsWith('/videos')) return tagged([cap(2), cap(5)], 'next-videos');
      const token = JSON.parse(options.body).continuation;
      return JSON.stringify({ items: token === 'next-search' ? [cap(4)] : token === 'next-videos' ? [cap(6)] : [] });
    });
    assert.deepEqual(seasons[0].episodes.map(entry => entry.episode), [1, 2, 3, 4, 5, 6]);
    assert.equal(seasons[0].episodes[0].label, 'Capítulo 1 · El partido 1');
    assert.deepEqual(asked.filter(url => url.startsWith('youtubei')).length, 2);
  });
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log(`${checks.length} comprobaciones de YouTube (películas y capítulos completos) correctas.`);
