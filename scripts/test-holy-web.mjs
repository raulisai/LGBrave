// The catalogue as a plain page for any device on the WiFi: resolving a title without the
// TV/CDP, the server routes it needs, and serving that page at the server's own root
// (the TV's packaged app keeps its own address untouched). No TV, no Internet.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Catalog } from './holy/catalog.mjs';
import { Library } from './holy/library.mjs';
import { startServer } from './holy/server.mjs';

const directory = mkdtempSync(join(tmpdir(), 'holy-web-'));
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const site = { id: 'x', name: 'X', site: 'https://x.example/', parseHome: () => [] };
const newCatalog = (connectors = [site]) => new Catalog({ file: join(directory, 'c' + checks.length + '.json'), detailsFile: join(directory, 'd' + checks.length + '.json'), fetch: async () => '', connectors });

try {
  await check('resolvePlayable: el sitio preferido (anime → JKAnime) se intenta primero', async () => {
    const catalog = newCatalog();
    const copy = { source: 'jkanime', kind: 'anime', title: 'One Piece', url: 'https://jkanime.net/one-piece/5/' };
    catalog.preference = async () => ({ site: 'jkanime', kind: 'anime' });
    catalog.elsewhere = async (_item, _tried, options) => (options?.only === 'jkanime' ? [copy] : []);
    catalog.resolve = async candidate => (candidate.source === 'jkanime' ? { url: 'https://p.example/jk' } : null);
    const item = { source: 'cuevana', kind: 'anime', title: 'One Piece', url: 'https://cuevana3c.pro/serie/one-piece/5' };
    const found = await catalog.resolvePlayable(item);
    assert.deepEqual([found.target.url, found.item.source, found.item.title], ['https://p.example/jk', 'jkanime', 'One Piece']);
  });

  await check('resolvePlayable: sin preferencia, resuelve en el propio sitio', async () => {
    const catalog = newCatalog();
    catalog.preference = async () => null;
    catalog.resolve = async item => ({ url: 'https://p.example/own-' + item.source });
    const item = { source: 'x', kind: 'movie', title: 'T', url: 'https://x.example/t' };
    const found = await catalog.resolvePlayable(item);
    assert.deepEqual([found.target.url, found.item], ['https://p.example/own-x', item]);
  });

  await check('resolvePlayable: sin reproductor propio, usa la página si el sitio lo permite', async () => {
    const catalog = newCatalog();
    catalog.preference = async () => null;
    catalog.resolve = async () => null;
    catalog.pageFallback = () => true;
    const item = { source: 'x', kind: 'movie', title: 'T', url: 'https://x.example/t' };
    const found = await catalog.resolvePlayable(item);
    assert.deepEqual(found, { item, target: { url: item.url, versions: [] } });
  });

  await check('resolvePlayable: sin reproductor propio ni página, prueba otros sitios (y no repite el preferido)', async () => {
    const catalog = newCatalog();
    const triedOnly = [];
    catalog.preference = async () => ({ site: 'jkanime', kind: 'anime' });
    catalog.elsewhere = async (_item, tried, options) => { triedOnly.push(options?.only || null); return options?.only ? [] : [{ source: 'animeyt', kind: 'anime', title: 'One Piece', url: 'https://animeyt.cc/op/5' }]; };
    catalog.resolve = async candidate => (candidate.source === 'animeyt' ? { url: 'https://p.example/animeyt' } : null);
    catalog.pageFallback = () => false;
    const item = { source: 'cuevana', kind: 'anime', title: 'One Piece', url: 'https://cuevana3c.pro/serie/one-piece/5' };
    const found = await catalog.resolvePlayable(item);
    assert.deepEqual(found.target.url, 'https://p.example/animeyt');
    assert.deepEqual(triedOnly, ['jkanime', null]); // the preferred site is not searched again in the general pass
  });

  await check('resolvePlayable: nada resuelve en ningún sitio → null', async () => {
    const catalog = newCatalog();
    catalog.preference = async () => null;
    catalog.resolve = async () => null;
    catalog.pageFallback = () => false;
    catalog.elsewhere = async () => [];
    const found = await catalog.resolvePlayable({ source: 'x', kind: 'movie', title: 'T', url: 'https://x.example/t' });
    assert.equal(found, null);
  });

  await check('Servidor: /holy-api/resolve abre desde un navegador cualquiera y marca «empezado»; /holy-api/forget la quita', async () => {
    const library = new Library(join(directory, 'lib.json'));
    const catalog = newCatalog([{ ...site, versions: async () => [{ id: 'a', label: 'Español latino', kind: 'dub', target: { url: 'https://p.example/a' } }, { id: 'b', label: 'Coreano · subtítulos en español', kind: 'sub', target: { url: 'https://p.example/b', referrer: 'https://x.example/' } }] }]);
    const server = startServer({ catalog, library, port: 0, log: () => {}, imageDir: join(directory, 'img'), root: directory, webRoot: join(directory, 'no-web-build') });
    await new Promise(resolve => (server.listening ? resolve() : server.once('listening', resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const resolveCall = (body, headers = {}) => fetch(base + '/holy-api/resolve', { method: 'POST', headers: { 'Content-Type': 'text/plain', ...headers }, body: JSON.stringify(body) });
    try {
      const item = { source: 'x', url: 'https://x.example/e1', kind: 'movie', title: 'Una película', poster: 'https://x.example/p.jpg', genres: ['Acción'] };
      const result = await resolveCall({ item, kind: 'sub' });
      const payload = await result.json();
      assert.deepEqual([result.status, payload.ok, payload.url, payload.versionKind, payload.site, payload.needsReferrer], [200, true, 'https://p.example/b', 'sub', 'X', true]);
      // The version without a required referrer can be embedded in the web page's own theater.
      assert.equal((await (await resolveCall({ item, kind: 'dub' })).json()).needsReferrer, false);
      assert.ok(library.get('https://x.example/e1'), 'queda en Continuar viendo, como hace la TV al reproducir');
      // No existe tal título en ningún conector del catálogo.
      const bad = await resolveCall({ item: { source: 'ninguno', url: 'https://x.example/e1' } });
      assert.deepEqual([bad.status, (await bad.json()).ok], [200, false]);
      // Una dirección no válida nunca llega a resolverse.
      const invalid = await resolveCall({ item: { source: 'x', url: 'javascript:alert(1)' } });
      assert.equal((await invalid.json()).ok, false);
      // Un origen cruzado no autorizado no puede reproducir nada (igual que /holy-api/language).
      const blocked = await resolveCall({ item }, { Origin: 'https://evil.example' });
      assert.equal(blocked.status, 403);
      // Quitar de Continuar viendo, igual que el botón rojo de la TV.
      const forget = await fetch(base + '/holy-api/forget', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ key: 'https://x.example/e1' }) });
      assert.equal(forget.status, 200);
      assert.equal(library.get('https://x.example/e1'), null);
      const forgetBlocked = await fetch(base + '/holy-api/forget', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example' }, body: JSON.stringify({ key: 'x' }) });
      assert.equal(forgetBlocked.status, 403);
    } finally { server.close(); catalog.stop(); }
  });

  await check('Servidor: la raíz sirve la página web (cualquier dispositivo) sin tocar /holy/ de la TV', async () => {
    const library = new Library(join(directory, 'lib2.json'));
    const catalog = newCatalog();
    const webRoot = join(directory, 'dist-holy-web');
    mkdirSync(join(webRoot, 'assets'), { recursive: true });
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>Holy</title>');
    writeFileSync(join(webRoot, 'assets', 'app.js'), 'console.log(1)');
    mkdirSync(join(directory, 'tv-root'), { recursive: true });
    writeFileSync(join(directory, 'tv-root', 'index.html'), '<!doctype html><title>Holy TV</title>');
    const server = startServer({ catalog, library, port: 0, log: () => {}, imageDir: join(directory, 'img2'), root: join(directory, 'tv-root'), webRoot });
    await new Promise(resolve => (server.listening ? resolve() : server.once('listening', resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      assert.match(await (await fetch(base + '/')).text(), /Holy<\/title>/);
      assert.match(await (await fetch(base + '/assets/app.js')).text(), /console\.log/);
      assert.match(await (await fetch(base + '/holy/')).text(), /Holy TV/);
      assert.equal((await fetch(base + '/holy-api/health')).status, 200);
      assert.equal((await fetch(base + '/no-existe')).status, 404);
    } finally { server.close(); catalog.stop(); }
  });

  await check('Servidor: sin build web todavía, la raíz da 404 en vez de fallar', async () => {
    const library = new Library(join(directory, 'lib3.json'));
    const catalog = newCatalog();
    const server = startServer({ catalog, library, port: 0, log: () => {}, imageDir: join(directory, 'img3'), root: join(directory, 'nada'), webRoot: join(directory, 'tampoco-existe') });
    await new Promise(resolve => (server.listening ? resolve() : server.once('listening', resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    try { assert.equal((await fetch(base + '/')).status, 404); } finally { server.close(); catalog.stop(); }
  });
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log(`${checks.length} comprobaciones de la página web (cualquier dispositivo) correctas.`);
