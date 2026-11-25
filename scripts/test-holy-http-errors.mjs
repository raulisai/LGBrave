import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from './holy/server.mjs';
import { Library } from './holy/library.mjs';
const directory = mkdtempSync(join(tmpdir(), 'holy-http-errors-'));
const library = new Library(join(directory, 'library.json'));
const item = { source: 'test', title: 'Prueba', kind: 'movie', url: 'https://source.example/title' };
let repairs = 0, imageCalls = 0;
const catalog = { items: [], sources: () => [], connector: () => ({}), home: () => ({ rows: [{ id: 'sample', items: [{ overview: 'x'.repeat(10000) }] }] }) };
const server = startServer({ library, catalog, doctor: { prescribe: async () => { repairs++; return {}; }, diagnose: async () => ({}) },
  port: 0, imageDir: join(directory, 'images'), root: directory, log: () => {},
  resolveHost: async host => host === 'private.example' ? ['127.0.0.1'] : ['93.184.216.34'],
  fetchImage: async () => { imageCalls++; return new Response(null, { status: 302, headers: { Location: 'https://private.example/image' } }); } });
await once(server, 'listening');
const port = server.address().port, base = 'http://127.0.0.1:' + port;
const raw = (path, method = 'GET', headers = {}, body) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers }, res => {
    const chunks = []; res.on('data', data => chunks.push(data)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
  }); req.setTimeout(2000, () => req.destroy(Error('request hung'))); req.on('error', reject); req.end(body);
});
try {
  const malformed = await raw('http://['); assert.equal(malformed.status, 400); assert.equal(JSON.parse(malformed.text).code, 'invalid_url');
  assert.equal((await raw('/holy-api/home', 'DELETE')).status, 405);
  assert.equal((await raw('/holy-api/health')).status, 200);
  for (let i = 0; i < 100; i++) library.toggleQueue({ ...item, url: item.url + i });
  const post = body => raw('/holy-api/queue', 'POST', { 'Content-Type': 'text/plain', Origin: base }, JSON.stringify(body));
  const full = await post({ item }); assert.equal(full.status, 409); const detail = JSON.parse(full.text); assert.equal(detail.code, 'queue_full'); assert.match(detail.error, /100 títulos/);
  assert.equal(library.watchQueue.length, 100);
  assert.equal((await post({ item: { ...item, url: item.url + 0 } })).status, 200, 'Removal still works with a full queue');
  assert.equal(library.watchQueue.length, 99);
  assert.equal((await raw('/holy-api/queue', 'POST', { Origin: base }, 'x'.repeat(17000))).status, 413);
  assert.equal((await raw('/holy-api/queue', 'POST', { Origin: base }, 'not-json')).status, 400);
  const attacker = await raw('/holy-api/doctor', 'POST', { Origin: 'http://192.168.1.222:' + port }, '{}'); assert.equal(attacker.status, 403); assert.equal(repairs, 0);
  const windowsName = await raw('/holy-api/doctor', 'POST', { Host: 'djoker:' + port, Origin: 'http://djoker:' + port }, '{}'); assert.equal(windowsName.status, 200); assert.equal(repairs, 1);
  const compressed = await raw('/holy-api/home', 'GET', { Origin: base, 'Accept-Encoding': 'gzip' }); assert.equal(compressed.status, 200); assert.match(compressed.headers.vary, /Origin/); assert.match(compressed.headers.vary, /Accept-Encoding/);
  assert.notEqual((await raw('/holy-api/img?u=' + encodeURIComponent('https://i0.wp.com/a.jpg'))).status, 200); assert.equal(imageCalls, 1, 'No image fetch follows a public name with private DNS');
  console.log('HTTP: URL inválida400, método405, cola llena409/mensaje, cuerpos413, origen propio, nombre Windows, CORS gzip y redirección de imagen protegida correctos.');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); }
