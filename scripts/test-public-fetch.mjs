import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { once } from 'node:events';
import { createPublicFetcher, publicAddresses, publicLookup } from './holy/public-fetch.mjs';
import { fetchText } from './holy/sources.mjs';

const publicDNS = async () => ['93.184.216.34'];
const transports = [];
const make = options => { const request = createPublicFetcher(options); transports.push(request); return request; };
let hits = 0, seen = [];
const server = http.createServer((req, res) => {
  hits++; seen.push({ path: req.url, cookie: req.headers.cookie, authorization: req.headers.authorization, referer: req.headers.referer, method: req.method });
  if (req.url === '/redirect-private') { res.writeHead(302, { Location: 'http://127.0.0.1:1/private' }).end(); return; }
  if (req.url === '/redirect-dns') { res.writeHead(302, { Location: 'https://private.example/secret' }).end(); return; }
  if (req.url === '/redirect-public') { res.writeHead(302, { Location: 'https://other.example/final' }).end(); return; }
  if (req.url === '/same') { res.writeHead(307, { Location: '/final' }).end(); return; }
  if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }).end(); return; }
  if (req.url === '/gzip') { res.writeHead(200, { 'Content-Encoding': 'gzip', 'Set-Cookie': ['a=one; Path=/', 'b=two; Path=/'] }).end(gzipSync('hello '.repeat(2000))); return; }
  if (req.url === '/chunked') { res.writeHead(200); res.write(Buffer.alloc(1024)); res.end(Buffer.alloc(1024)); return; }
  if (req.url === '/slow') { res.writeHead(200); res.flushHeaders(); return; }
  if (req.url === '/echo') { let body = ''; req.on('data', data => body += data); req.on('end', () => res.end(body)); return; }
  res.end('contenido');
}).listen(0, '127.0.0.1');
await once(server, 'listening');
const base = 'http://127.0.0.1:' + server.address().port;
const nativeFetch = globalThis.fetch;
// Only the first hop's transport is mapped to our fixture. Redirects remain public URLs
// and are handled by the production wrapper, not automatically by this stand-in.
const fixture = (url, options) => nativeFetch(base + new URL(url).pathname, { ...options, dispatcher: undefined });
try {
  const get = make({ resolveHost: publicDNS, fetcher: fixture });
  assert.equal(await (await get('https://public.example/final')).text(), 'contenido');
  const before = hits;
  for (const url of ['http://localhost/x', 'https://127.0.0.1/x', 'file:///tmp/x', 'https://u:p@public.example/x']) await assert.rejects(get(url), { code: 'PRIVATE_DESTINATION' });
  assert.equal(hits, before);
  await assert.rejects(get('https://public.example/redirect-private'), { code: 'PRIVATE_DESTINATION' });
  assert.equal(hits, before + 1, 'No request to the private redirect target');
  const dns = make({ resolveHost: async host => host === 'private.example' ? ['10.0.0.1'] : publicDNS(), fetcher: fixture });
  await assert.rejects(dns('https://public.example/redirect-dns'), { code: 'PRIVATE_DESTINATION' });
  assert.equal(hits, before + 2, 'Public-looking name resolving privately is rejected at redirect');
  for (const answers of [[], ['127.0.0.1'], ['93.184.216.34', '::1'], ['::ffff:7f00:1']]) await assert.rejects(publicAddresses('x.example', async () => answers));
  const failedDNS = make({ resolveHost: async () => { throw Error('ENOTFOUND'); }, fetcher: fixture });
  await assert.rejects(failedDNS('https://public.example/final'), /ENOTFOUND/);
  const hangingDNS = make({ resolveHost: () => new Promise(() => {}), fetcher: fixture });
  await assert.rejects(hangingDNS('https://public.example/final', { timeout: 30 }), { name: 'TimeoutError' });
  const lookedUp = await new Promise((resolve, reject) => publicLookup(async () => ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'])('example.com', { all: true }, (error, records) => error ? reject(error) : resolve(records)));
  assert.equal(lookedUp.length, 2);
  // The check also runs in the real socket's lookup, closing the check/connect DNS race.
  let lookups = 0;
  const rebinding = make({ resolveHost: async () => ++lookups === 1 ? ['93.184.216.34'] : ['127.0.0.1'] });
  const reboundBefore = hits;
  await assert.rejects(rebinding('http://rebind.example:' + server.address().port + '/final'), error => error.cause?.code === 'PRIVATE_DESTINATION');
  assert.ok(lookups >= 2); assert.equal(hits, reboundBefore);

  await get('https://public.example/redirect-public', { method: 'POST', body: 'form=data', headers: { Cookie: 'session=private', Authorization: 'Bearer private', 'X-CSRF-Token': 'private', Referer: 'https://public.example/show', 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.deepEqual(seen.at(-1), { path: '/final', cookie: undefined, authorization: undefined, referer: 'https://public.example/show', method: 'GET' });
  await get('https://public.example/same', { method: 'POST', body: 'form=data', headers: { Cookie: 'session=private' } });
  assert.equal(seen.at(-1).method, 'POST'); assert.equal(seen.at(-1).cookie, 'session=private');
  assert.equal(await (await get('https://public.example/echo', { method: 'POST', body: 'form=data' })).text(), 'form=data');
  await assert.rejects(get('https://public.example/loop', { maxRedirects: 2 }), { code: 'REDIRECT_LIMIT' });
  const manual = await get('https://public.example/redirect-private', { redirect: 'manual' }); assert.equal(manual.status, 302);
  const gzip = await get('https://public.example/gzip'); assert.equal((await gzip.text()).length, 12000); assert.equal(gzip.headers.getSetCookie().length, 2);
  for (const path of ['gzip', 'chunked']) await assert.rejects(get('https://public.example/' + path, { maxBytes: 1000 }), { code: 'RESPONSE_TOO_LARGE' });
  await assert.rejects(get('https://public.example/slow', { timeout: 40 }));
  assert.equal(await (await get('https://public.example/final')).text(), 'contenido', 'A failed or oversized download releases its slot');

  let active = 0, maximum = 0;
  const bounded = make({ resolveHost: publicDNS, connections: 2, maxWaiting: 2, fetcher: async () => {
    active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 30)); active--; return new Response('ok');
  } });
  const jobs = Array.from({ length: 4 }, () => bounded('https://public.example/final'));
  await assert.rejects(bounded('https://public.example/final'), { code: 'DOWNLOAD_BUSY' });
  await Promise.all(jobs); assert.equal(maximum, 2);
  const abort = new AbortController();
  const first = bounded('https://public.example/final'), second = bounded('https://public.example/final');
  const pending = bounded('https://public.example/final', { signal: abort.signal }); abort.abort(); await assert.rejects(pending, { name: 'AbortError' });
  await Promise.all([first, second]); assert.equal(await (await bounded('https://public.example/final')).text(), 'ok');
  // Actual source reader rejects private destinations even without the API preflight.
  await assert.rejects(fetchText(base + '/final'), { code: 'PRIVATE_DESTINATION' });
  console.log('Descargas: destinos/DNS en cada salto y socket, cookies/POST/Referer, gzip, bytes, timeout, concurrencia, cancelación y lector real correctos (fixtures locales).');
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await Promise.all(transports.map(get => get.close()));
}
