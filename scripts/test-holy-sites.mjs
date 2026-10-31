import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Catalog } from './holy/catalog.mjs';
import { SiteRegistry, cleanSite, checkSite } from './holy/site-registry.mjs';
import { startServer } from './holy/server.mjs';

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
console.log(`${passed} comprobaciones de la ventana Webs correctas.`);
