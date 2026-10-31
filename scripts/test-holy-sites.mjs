import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Catalog } from './holy/catalog.mjs';
import { SiteRegistry, cleanSite, checkSite } from './holy/site-registry.mjs';
import { startServer } from './holy/server.mjs';
import { onlyflix } from './holy/more-sources.mjs';

// The window «Webs»: moving a site keeps its parsers and saved titles working. No Internet.
const dir = mkdtempSync(join(tmpdir(), 'holy-sites-'));
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; };
const connector = { id: 'x', name: 'Sitio X', site: 'https://viejo.example/', parseHome: () => [], resolve: async item => ({ url: item.url + 'player', referrer: item.url, alternatives: [] }) };
const registry = () => new SiteRegistry(join(dir, 'sites.json'));
try {
  await check('Solo acepta direcciones https públicas', () => {
    assert.equal(cleanSite(' https://nuevo.example/ruta '), 'https://nuevo.example/');
    for (const bad of ['http://a.example', 'https://192.168.1.1/', 'https://tv.local/', 'https://localhost/', 'nada']) assert.throws(() => cleanSite(bad));
  });
  await check('Un sitio mudado se pide en la nueva dirección y se lee como el original, y sobrevive al reinicio', async () => {
    const asked = [];
    const sites = registry();
    const catalog = new Catalog({ file: join(dir, 'c.json'), detailsFile: join(dir, 'd.json'), connectors: [connector], sites, probe: null, fetch: async (url, options) => { asked.push([url, options?.referrer]); return '<a href="https://nuevo.example/a">x</a>'; } });
    sites.move('x', 'https://nuevo.example/');
    assert.equal(await catalog.fetch('https://viejo.example/lista', { referrer: 'https://viejo.example/' }), '<a href="https://viejo.example/a">x</a>');
    assert.deepEqual(asked[0], ['https://nuevo.example/lista', 'https://nuevo.example/']);
    const target = await catalog.resolve({ source: 'x', url: 'https://viejo.example/t/1/', title: 'T' });
    assert.equal(target.url, 'https://nuevo.example/t/1/player'); assert.equal(target.referrer, 'https://nuevo.example/t/1/');
    assert.equal(registry().attach([connector]).toLive('https://viejo.example/a'), 'https://nuevo.example/a');
    sites.reset('x'); assert.equal(sites.toLive('https://viejo.example/a'), 'https://viejo.example/a');
  });
  await check('Una web nueva queda por integrar; no se duplica ni se confunde con una integrada', () => {
    const sites = registry().attach([connector]);
    const before = sites.pending().length;
    sites.add('https://otro.example/', 'Otro');
    assert.equal(sites.pending().length, before + 1); assert.equal(sites.pending().at(-1).known, undefined);
    assert.throws(() => sites.add('https://otro.example/x'), /ya está/); assert.throws(() => sites.add('https://viejo.example/'), /integrado/);
    sites.remove('https://otro.example/'); assert.equal(sites.pending().length, before);
  });
  await check('Comprobar avisa si el sitio redirige a otro dominio o no responde', async () => {
    assert.equal((await checkSite('https://a.example/', async () => ({ ok: true, status: 200, url: 'https://b.example/x' }))).final, 'https://b.example/');
    assert.equal((await checkSite('https://a.example/', async () => ({ ok: true, status: 200, url: 'https://www.a.example/' }))).moved, false);
    assert.equal((await checkSite('https://a.example/', async () => { throw Error('caído'); })).ok, false);
  });
  await check('La ventana y su API funcionan desde esta computadora', async () => {
    const sites = registry();
    const catalog = new Catalog({ file: join(dir, 'c2.json'), detailsFile: join(dir, 'd2.json'), connectors: [connector], sites, probe: null, fetch: async () => '' });
    catalog.refresh = async () => {};
    const server = startServer({ catalog, library: { entries: [], votes: [], version: 1 }, port: 0, root: dir, webRoot: '', imageDir: join(dir, 'img'), log: () => {} });
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      assert.match(await (await fetch(base + '/holy-sites/')).text(), /Webs de Holy/);
      const post = body => fetch(base + '/holy-api/sites', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
      assert.equal((await (await fetch(base + '/holy-api/sites')).json()).sites[0].site, 'https://viejo.example/');
      assert.equal((await (await post({ action: 'move', id: 'x', url: 'https://nuevo.example/' })).json()).sites[0].moved, true);
      assert.equal((await post({ action: 'move', id: 'x', url: 'http://mal' })).status, 400);
      assert.equal((await post({ action: 'otra' })).status, 400);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
} finally { rmSync(dir, { recursive: true, force: true }); }

await check('OnlyFlix: tres tipos de tarjeta, todo marcado en inglés', () => {
  const page = `<article class="of-title-card-v2" data-title="The Matrix" data-url="https://onlyflix.to/the-matrix/" data-backdrop="https://onlyflix.to/b.jpg" data-year="1999" data-rating="8.7" data-genres="Action, Sci-Fi" data-overview="Neo"><a class="x"><img class="of-title-card-v2__poster" src="https://onlyflix.to/p.jpg"></a>
  <article class="ofb-card"><a class="ofb-card-link" href="https://onlyflix.to/series/carrie/" aria-label="Carrie"></a><img src="https://onlyflix.to/c.jpg"></article>
  <article class="of-media-card of-lazy-bg" data-of-lazy-bg="https://onlyflix.to/h.jpg"><a class="of-media-card__link" href="https://onlyflix.to/clayface/"></a><span class="of-media-card__name">Clayface</span><span class="of-media-card__genres">Horror</span></article>`;
  const items = onlyflix.parseHome(page);
  assert.deepEqual(items.map(item => [item.title, item.kind, !!item.isShow, item.language]), [['The Matrix', 'movie', false, 'Inglés'], ['Carrie', 'series', true, 'Inglés'], ['Clayface', 'movie', false, 'Inglés']]);
  assert.equal(items[0].year, '1999');
});
await check('OnlyFlix: temporadas completas y servidores en inglés, con los demás de respaldo', async () => {
  const load = async (url, options) => {
    if (!options?.method) return '<body class="single postid-77"><div class="player-frame" data-player-nonce="n1" data-player-post-id="5" data-player-content-type="episode"></div>';
    const form = new URLSearchParams(options.body);
    if (form.get('action') === 'mcs_home_hero_tv_episodes') { assert.equal(form.get('show_id'), '77'); return JSON.stringify({ data: { seasons: [{ season: 2, episodes: [{ permalink: 'https://onlyflix.to/episodes/x-s02e01/', episode: 1 }] }, { season: 1, episodes: [{ permalink: 'https://malo.example/', episode: 1 }, { permalink: 'https://onlyflix.to/episodes/x-s01e01/', episode: 1 }] }] } }); }
    assert.equal(form.get('type'), 'episode');
    return JSON.stringify({ data: { players: [{ url: 'https://a.example/1', language: 'EN' }, { url: 'https://b.example/1', language: 'ES' }, { url: 'https://c.example/1', language: '' }, { url: 'http://d.example/1', language: 'EN' }] } });
  };
  const seasons = await onlyflix.episodes('https://onlyflix.to/series/x/', load);
  assert.deepEqual(seasons.map(season => [season.number, season.episodes.length]), [[1, 1], [2, 1]]);
  assert.deepEqual(await onlyflix.resolve({ url: 'https://onlyflix.to/episodes/x-s01e01/' }, load), { url: 'https://a.example/1', referrer: 'https://onlyflix.to/episodes/x-s01e01/', alternatives: ['https://c.example/1'] });
  await assert.rejects(() => onlyflix.resolve({ url: 'https://onlyflix.to/x/' }, async () => '<html>'), /no muestra reproductor/);
});
console.log(`${passed} comprobaciones de la ventana Webs y OnlyFlix correctas.`);
