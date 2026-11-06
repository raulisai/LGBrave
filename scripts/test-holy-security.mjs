import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Catalog } from './holy/catalog.mjs';
import { Library } from './holy/library.mjs';
import { startServer, mutationAllowed, hostAllowed, readOrigin } from './holy/server.mjs';
import { privateAddress, publicHostURL, publicHttpsURL, publicTarget } from './holy/public-url.mjs';
import { PORT } from './holy/config.mjs';
import { intoPrivateNetwork, privateHost } from './private-network.mjs';

// What a web page, a stranger on the Wi-Fi or a hostile site open on the TV can and cannot make
// Holy's server do. No Internet: names are resolved by a stand-in.
const directory = mkdtempSync(join(tmpdir(), 'holy-security-'));
let passed = 0;
const check = async (name, work) => { await work(); passed++; };
const TV = '192.168.1.134';
const req = (ip, headers = {}) => ({ headers, socket: { remoteAddress: ip } });
const resolveHost = async host => ({ 'intranet.example.com': ['10.0.0.5'], 'rebind.example.com': ['93.184.216.34', '127.0.0.1'], 'v6.example.com': ['fd00::1'] })[host] || ['93.184.216.34'];

try {
  await check('Direcciones privadas: IPv4, IPv6 y IPv4 escondida en IPv6', () => {
    for (const bad of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.65', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1', '::ffff:7f00:1', 'no-es-ip'])
      assert.equal(privateAddress(bad), true, bad);
    for (const good of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946']) assert.equal(privateAddress(good), false, good);
  });

  await check('Solo https con nombre público; sin usuario, IP ni nombres de red local', async () => {
    for (const bad of ['http://x.example.com/', 'https://127.0.0.1/', 'https://[::1]/', 'https://192.168.1.1/a', 'https://localhost/', 'https://impresora.local/', 'https://router.lan/', 'https://nas/', 'https://u:p@x.example.com/', 'javascript:1', '', 'https://metadata.internal/'])
      assert.equal(publicHostURL(bad), null, bad);
    assert.ok(publicHostURL('https://www.ejemplo.com/ruta?x=1'));
    assert.equal(await publicHttpsURL('https://sitio.example.com/a', { resolve: resolveHost }), true);
    // Un nombre público que apunta a la red de casa (o a una de sus respuestas) se rechaza.
    assert.equal(await publicHttpsURL('https://intranet.example.com/a', { resolve: resolveHost }), false);
    assert.equal(await publicHttpsURL('https://rebind.example.com/a', { resolve: resolveHost }), false);
    assert.equal(await publicHttpsURL('https://v6.example.com/a', { resolve: resolveHost }), false);
    // Si el nombre no existe no se puede descargar nada: la petición posterior falla sola.
    assert.equal(await publicHttpsURL('https://no-existe.example.com/', { resolve: async () => { throw Error('ENOTFOUND'); } }), true);
    assert.equal(publicTarget('http://cdn.ejemplo.com/a.jpg'), true);
    assert.equal(publicTarget('http://127.0.0.1/a.jpg'), false);
    assert.equal(publicTarget('http://[fd00::1]/a.jpg'), false);
    assert.equal(publicTarget('http://servidor/a.jpg'), false);
  });

  await check('Escudo: una página de Internet no pide recursos a la red local; las de la red local sí', () => {
    const page = 'https://peliculas.example.com/ver/1';
    for (const target of ['http://192.168.1.65:43190/holy-api/health', 'http://127.0.0.1:43190/', 'http://localhost/x', 'http://[::1]:43190/', 'http://djoker:43190/', 'http://holy-mac.local:43190/', 'http://10.0.0.1/', 'http://2130706433/', 'http://169.254.169.254/latest'])
      for (const type of ['Fetch', 'XHR', 'Script', 'Image', 'Other']) assert.equal(intoPrivateNetwork(target, page, type), true, target + ' ' + type);
    // Abrir una dirección local (la escribe el dueño) y las páginas hacia Internet no se tocan.
    assert.equal(intoPrivateNetwork('http://192.168.1.1/', page, 'Document'), false);
    assert.equal(intoPrivateNetwork('https://cdn.ejemplo.com/app.js', page, 'Script'), false);
    // Holy, Luma y las pruebas viven en la red local: hablan con su propio servidor.
    for (const home of ['http://192.168.1.65:43190/holy/', 'http://localhost:43190/', 'http://djoker:43190/']) assert.equal(intoPrivateNetwork('http://192.168.1.65:43190/holy-api/home', home, 'Fetch'), false, home);
    assert.equal(intoPrivateNetwork('http://192.168.1.65:43190/x', 'about:blank', 'Fetch'), false);
    assert.equal(privateHost('8.8.8.8'), false);
    assert.equal(privateHost('sitio.example.com'), false);
  });

  await check('Origin «null» solo se cree si viene de la TV, y nunca para sitios ni Doctor', () => {
    const nullFrom = ip => req(ip, { origin: 'null' });
    assert.equal(mutationAllowed(nullFrom(TV), PORT, { tv: TV }), true);
    assert.equal(mutationAllowed(nullFrom('192.168.1.200'), PORT, { tv: TV }), false, 'otro equipo de la red');
    assert.equal(mutationAllowed(nullFrom('127.0.0.1'), PORT, { tv: TV }), false, 'navegador de esta misma computadora');
    assert.equal(mutationAllowed(nullFrom(TV), PORT, { tv: '' }), false, 'sin TV configurada');
    assert.equal(mutationAllowed(nullFrom(TV), PORT, { tv: TV, strict: true }), false, 'cambiar sitios o reiniciar');
    assert.equal(mutationAllowed(req(TV, { origin: `http://192.168.1.65:${PORT}` }), PORT, { tv: TV, strict: true }), true, 'la página de Holy sí');
    assert.equal(mutationAllowed(req(TV, { origin: 'https://evil.example' }), PORT, { tv: TV }), false);
  });

  await check('Lectura entre orígenes: la TV y la red local sí; ningún sitio de Internet', () => {
    assert.equal(readOrigin(req(TV, { origin: 'null' }), TV), '*');
    assert.equal(readOrigin(req('192.168.1.200', { origin: 'null' }), TV), '');
    assert.equal(readOrigin(req('127.0.0.1', { origin: 'null' }), TV), '');
    assert.equal(readOrigin(req(TV, { origin: 'https://evil.example' }), TV), '');
    assert.equal(readOrigin(req(TV, { origin: 'http://192.168.evil.example:43190' }), TV), '');
    assert.equal(readOrigin(req(TV, { origin: 'http://192.168.1.50:5173' }), TV), 'http://192.168.1.50:5173');
    assert.equal(readOrigin(req(TV, { origin: 'http://holy-mac.local:43190' }), TV), 'http://holy-mac.local:43190');
    assert.equal(readOrigin(req(TV), TV), '');
  });

  await check('Cabecera Host: direcciones, nombre simple y sufijos de red local; no dominios públicos', () => {
    for (const host of ['192.168.1.65:43190', '127.0.0.1:43190', 'localhost:43190', '[::1]:43190', 'djoker:43190', 'holy-mac.local:43190', 'router.lan', 'mi-pc.home.arpa', undefined])
      assert.equal(hostAllowed(req('192.168.1.5', host === undefined ? {} : { host })), true, String(host));
    for (const host of ['evil.example.com:43190', 'a.b.c', '7f000001.rebind.net', 'evil.example.com.', 'evil.local.example.com', 'x@y'])
      assert.equal(hostAllowed(req('192.168.1.5', { host })), false, host);
  });

  await check('Servidor: Host ajeno, orígenes no permitidos y descargas hacia la red de casa', async () => {
    const library = new Library(join(directory, 'lib.json'));
    const asked = [];
    const site = { id: 'x', name: 'X', site: 'https://x.example/', parseHome: () => [],
      episodes: async show => { asked.push(show); return [{ title: 'T1', episodes: [{ url: 'https://x.example/e1', episode: 1 }] }]; },
      versions: async item => { asked.push(item.url); return [{ id: 'a', label: 'Español latino', kind: 'dub', target: { url: 'https://p.example/a' } }, { id: 'b', label: 'Subtitulado', kind: 'sub', target: { url: 'https://p.example/b' } }]; } };
    const catalog = new Catalog({ file: join(directory, 'c.json'), detailsFile: join(directory, 'd.json'), fetch: async () => '', connectors: [site] });
    const fetched = [];
    const fetchImage = async (url) => {
      fetched.push(url);
      if (url.includes('/salta-a-casa')) return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1:43190/holy-api/health' } });
      if (url.includes('/salta-a-cdn')) return new Response(null, { status: 302, headers: { Location: 'https://cdn.wp.com/final.jpg' } });
      return new Response('imagen', { headers: { 'Content-Type': url.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg' } });
    };
    const server = startServer({ catalog, library, port: 0, log: () => {}, imageDir: join(directory, 'img'), root: directory, webRoot: join(directory, 'nada'), resolveHost, fetchImage });
    await new Promise(resolve => (server.listening ? resolve() : server.once('listening', resolve)));
    const port = server.address().port, base = `http://127.0.0.1:${port}`;
    const raw = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port, path, method, headers }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
      });
      request.on('error', reject); request.end(body);
    });
    try {
      // DNS rebinding: a public name that was pointed at this computer.
      assert.equal((await raw('/holy-api/health', { headers: { Host: `evil.example.com:${port}` } })).status, 403);
      assert.equal((await raw('/holy-api/taste-profile', { headers: { Host: `rebind.example.net:${port}` } })).status, 403);
      assert.equal((await raw('/holy-api/health', { headers: { Host: `djoker:${port}` } })).status, 200);
      const health = await raw('/holy-api/health');
      assert.equal(health.status, 200);
      assert.equal(health.headers['x-content-type-options'], 'nosniff');
      assert.equal(health.headers['x-frame-options'], 'SAMEORIGIN');

      // Another website cannot read the answers (no CORS grant); this network's pages and the TV can.
      assert.equal((await raw('/holy-api/taste-profile', { headers: { Origin: 'https://evil.example' } })).headers['access-control-allow-origin'], undefined);
      assert.equal((await raw('/holy-api/taste-profile', { headers: { Origin: 'null' } })).headers['access-control-allow-origin'], undefined, 'un iframe «sandbox» no es la TV');
      const lan = await raw('/holy-api/health', { headers: { Origin: 'http://192.168.1.50:5173' } });
      assert.equal(lan.headers['access-control-allow-origin'], 'http://192.168.1.50:5173');
      assert.match(lan.headers.vary, /Origin/);
      const preflight = await raw('/holy-api/health', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
      assert.equal(preflight.headers['access-control-allow-origin'], undefined);
      assert.equal(preflight.headers['access-control-allow-methods'], undefined);

      // The classic bypass: a sandboxed iframe sends «Origin: null». It changes nothing, not even on the loopback.
      const post = (path, headers = {}, body = '{}') => raw('/holy-api/' + path, { method: 'POST', headers: { 'Content-Type': 'text/plain', ...headers }, body });
      for (const path of ['sites', 'doctor', 'vote', 'refresh', 'forget', 'language', 'resolve', 'taste-profile'])
        assert.equal((await post(path, { Origin: 'null' })).status, 403, path);
      assert.equal(catalog.sites?.added?.length || 0, 0);

      // Downloads on behalf of a stranger never reach this network or a non-https address.
      for (const show of ['https://127.0.0.1/', 'https://intranet.example.com/serie', 'https://rebind.example.com/serie', 'http://x.example/serie', 'https://192.168.1.1/', 'https://router.lan/'])
        assert.deepEqual((await (await fetch(`${base}/holy-api/episodes?source=x&show=${encodeURIComponent(show)}`)).json()).seasons, [], show);
      assert.deepEqual(asked, []);
      for (const url of ['https://127.0.0.1/e1', 'https://intranet.example.com/e1'])
        assert.deepEqual(await (await fetch(`${base}/holy-api/versions?source=x&url=${encodeURIComponent(url)}`)).json(), { versions: [], remembered: null }, url);
      const refused = await (await post('resolve', {}, JSON.stringify({ item: { source: 'x', url: 'https://intranet.example.com/e1', title: 'T' } }))).body;
      assert.equal(JSON.parse(refused).ok, false);
      assert.deepEqual(asked, [], 'ningún conector llegó a pedir nada');
      // A real title still works.
      assert.equal((await (await fetch(`${base}/holy-api/episodes?source=x&show=${encodeURIComponent('https://x.example/serie')}`)).json()).seasons.length, 1);
      assert.deepEqual(asked, ['https://x.example/serie']);
      assert.equal((await (await fetch(`${base}/holy-api/versions?source=x&url=${encodeURIComponent('https://x.example/e1')}`)).json()).versions.length, 2);

      // Images: no bounce into this network, a normal CDN hop is followed, and a picture opened on its own is inert.
      const bounced = await raw('/holy-api/img?u=' + encodeURIComponent('https://i0.wp.com/salta-a-casa.jpg'));
      assert.notEqual(bounced.status, 200);
      assert.deepEqual(fetched, ['https://i0.wp.com/salta-a-casa.jpg'], 'la petición a 127.0.0.1 nunca se hizo');
      const hop = await raw('/holy-api/img?u=' + encodeURIComponent('https://i0.wp.com/salta-a-cdn.jpg'));
      assert.equal(hop.status, 200);
      assert.equal(fetched.at(-1), 'https://cdn.wp.com/final.jpg');
      assert.match(hop.headers['content-security-policy'], /sandbox/);
      assert.equal(hop.headers['x-content-type-options'], 'nosniff');
    } finally { await new Promise(resolve => server.close(resolve)); catalog.stop(); }
  });

  console.log(`Seguridad de Holy: ${passed} comprobaciones correctas.`);
} finally { rmSync(directory, { recursive: true, force: true }); }
