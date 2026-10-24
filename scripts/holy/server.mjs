import http from 'node:http';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { HOME_PATH, PORT } from './config.mjs';
import { packHome } from '../../src/holy.js';

// Holy's server on the Mac: the home page (dist/), the rows it shows and a small
// image cache. Only devices on the local network may ask, and the image cache
// only fetches from the sites' own image hosts.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json' };
// Every connector's image hosts (test-holy-robust checks the catalogue's images are all covered).
export const IMAGE_HOSTS = /(^|\.)(image\.tmdb\.org|jkdesa\.com|jkanime\.net|wp\.com|repelishd\.blog|cuevana3c\.pro|doramasmp4\.cyou|animeyt\.cc|asialiveaction\.com|doramasflix\.(io|in)|doramasia\.com|mytsumi\.com)$/;
const local = ip => /^(127\.|::1$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip || '');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Small JSON bodies only (votes).
function body(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    // Too big: keep draining (so the client still gets an answer) but stop storing.
    req.on('data', chunk => { size += chunk.length; if (size <= limit) chunks.push(chunk); });
    req.on('end', () => {
      if (size > limit) { reject(Error('body')); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Error('json')); }
    });
    req.on('error', reject);
  });
}

export function startServer({ catalog, library, doctor, port = PORT, root = 'dist', imageDir = '.local/holy-images', log = console.log, status = () => ({}) } = {}) {
  const started = Date.now();
  mkdirSync(imageDir, { recursive: true });
  // Forget images not used for two weeks.
  for (const name of readdirSync(imageDir)) {
    const path = join(imageDir, name);
    try { if (Date.now() - statSync(path).atimeMs > 14 * 86400000) unlinkSync(path); } catch { /* Gone already. */ }
  }
  const pending = new Map();
  async function image(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !IMAGE_HOSTS.test(parsed.hostname)) throw Error('host');
    const key = createHash('sha1').update(url).digest('hex');
    const path = join(imageDir, key);
    if (existsSync(path)) return { body: readFileSync(path), type: readFileSync(path + '.type', 'utf8') };
    if (!pending.has(key)) pending.set(key, (async () => {
      const response = await fetch(url, { headers: { 'User-Agent': UA, Referer: parsed.origin + '/' }, signal: AbortSignal.timeout(15000) });
      const type = response.headers.get('content-type') || 'image/jpeg';
      if (!response.ok || !type.startsWith('image/')) throw Error('image ' + response.status);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 4e6) throw Error('size');
      writeFileSync(path, body); writeFileSync(path + '.type', type);
      return { body, type };
    })().finally(() => pending.delete(key)));
    return pending.get(key);
  }
  // JSON answers are compressed when the TV accepts it (the full catalogue is several hundred KB).
  // The packed home is built once per catalogue/history version and kept compressed.
  let homeCache = { key: '', raw: null, gz: null };
  const sendHome = (req, res) => {
    const key = catalog.version + ':' + library.version + ':' + !!catalog.refreshing;
    if (homeCache.key !== key) {
      const raw = Buffer.from(JSON.stringify(packHome({ ...catalog.home(library), catalogVersion: catalog.version, libraryVersion: library.version })));
      homeCache = { key, raw, gz: gzipSync(raw) };
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) { res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding'); res.end(homeCache.gz); }
    else res.end(homeCache.raw);
  };
  const sendJSON = (req, res, value) => {
    const raw = Buffer.from(JSON.stringify(value));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (raw.length > 2048 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) { res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding'); res.end(gzipSync(raw)); }
    else res.end(raw);
  };
  const server = http.createServer(async (req, res) => {
    const ip = req.socket.remoteAddress?.replace('::ffff:', '');
    if (!local(ip)) { res.writeHead(403).end(); return; }
    const url = new URL(req.url, 'http://holy.local');
    // The packaged home (file://) reads these too.
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' }).end(); return; }
    try {
      if (url.pathname === '/holy-api/home') {
        res.setHeader('Cache-Control', 'no-store');
        // ?v=2: packed (current screens); without it, the plain rows older installed screens expect.
        if (url.searchParams.get('v') === '2') sendHome(req, res);
        else sendJSON(req, res, { ...catalog.home(library), catalogVersion: catalog.version, libraryVersion: library.version });
      } else if (url.pathname === '/holy-api/search') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const source = url.searchParams.get('source') || '';
        const query = url.searchParams.get('q') || '';
        const started = Date.now();
        if (source === 'local') { res.end(JSON.stringify({ source, ms: 0, items: library.scored(catalog.searchLocal(query)) })); return; }
        const items = await catalog.search(source, query).catch(error => ({ error: error.message }));
        res.end(JSON.stringify(Array.isArray(items) ? { source, ms: Date.now() - started, items: library.scored(items) } : { source, ms: Date.now() - started, items: [], error: items.error }));
      } else if (url.pathname === '/holy-api/episodes') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const seasons = await catalog.episodes(url.searchParams.get('source') || '', url.searchParams.get('show') || '').catch(error => ({ error: error.message }));
        res.end(JSON.stringify(Array.isArray(seasons) ? { seasons } : { seasons: [], error: seasons.error }));
      } else if (url.pathname === '/holy-api/taste') {
        res.setHeader('Cache-Control', 'no-store');
        sendJSON(req, res, catalog.calibration(library));
      } else if (url.pathname === '/holy-api/vote' && req.method === 'POST') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const { item, vote, pref, dismiss } = await body(req);
        let value = 0;
        if (vote === 'reset') library.clearVotes();
        else if (pref) value = library.prefer(pref.type, pref.name, [1, -1].includes(pref.value) ? pref.value : 0);
        else if (dismiss) library.dismissRating(dismiss);
        else value = library.vote(item, [2, 1, -1].includes(vote) ? vote : 0);
        res.end(JSON.stringify({ ok: true, vote: value, taste: library.summary(), libraryVersion: library.version }));
      } else if (url.pathname === '/holy-api/health') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ ok: true, uptime: Math.round((Date.now() - started) / 1000), catalog: { updatedAt: catalog.updatedAt, items: catalog.items.length, refreshing: !!catalog.refreshing },
          library: { entries: library.entries.length, votes: library.votes.length }, sources: catalog.sources(), ...status() }));
      } else if (url.pathname === '/holy-api/doctor' && doctor) {
        // GET looks, POST «prescribes» the safe fixes (reconnect, refresh, restart…).
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(req.method === 'POST' ? { ...(await doctor.prescribe()), report: await doctor.diagnose() } : await doctor.diagnose()));
      } else if (url.pathname === '/holy-api/refresh' && req.method === 'POST') {
        catalog.refresh().catch(() => {});
        res.end('{"ok":true}');
      } else if (url.pathname === '/holy-api/img') {
        const { body, type } = await image(url.searchParams.get('u') || '');
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800, immutable' }).end(body);
      } else if (url.pathname.startsWith(HOME_PATH)) {
        const base = resolve(root);
        const path = resolve(base, url.pathname.slice(HOME_PATH.length) || 'index.html');
        if (!path.startsWith(base + '/')) { res.writeHead(403).end(); return; }
        res.setHeader('Content-Type', TYPES[extname(path)] || 'application/octet-stream');
        // Hashed bundles never change; index.html is revalidated so a new build shows at once.
        res.setHeader('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
        res.end(readFileSync(path));
      } else res.writeHead(404).end();
    } catch (error) {
      const code = error.message === 'host' ? 403 : ['json', 'body'].includes(error.message) || /dirección válida|gusto no es válido/.test(error.message) ? 400 : 404;
      if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ ok: false, error: code === 400 ? error.message : 'no disponible' }));
      else res.end();
    }
  });
  server.on('error', error => log(`Holy: el servidor no pudo abrir el puerto ${port}: ${error.message}`));
  server.listen(port, '0.0.0.0', () => log(`Holy: servidor en el puerto ${port}`));
  return server;
}
