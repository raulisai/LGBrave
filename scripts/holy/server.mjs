import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { HOME_PATH, PORT } from './config.mjs';

// Holy's server on the Mac: the home page (dist/), the rows it shows and a small
// image cache. Only devices on the local network may ask, and the image cache
// only fetches from the sites' own image hosts.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json' };
const IMAGE_HOSTS = /(^|\.)(image\.tmdb\.org|jkdesa\.com|jkanime\.net|wp\.com|repelishd\.blog|cuevana3c\.pro|doramasmp4\.cyou)$/;
const local = ip => /^(127\.|::1$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip || '');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export function startServer({ catalog, library, port = PORT, root = 'dist', imageDir = '.local/holy-images', log = console.log } = {}) {
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
  const server = http.createServer(async (req, res) => {
    const ip = req.socket.remoteAddress?.replace('::ffff:', '');
    if (!local(ip)) { res.writeHead(403).end(); return; }
    const url = new URL(req.url, 'http://holy.local');
    // The packaged home (file://) reads these too.
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      if (url.pathname === '/holy-api/home') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ ...catalog.home(library), catalogVersion: catalog.version, libraryVersion: library.version }));
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
      if (!res.headersSent) res.writeHead(error.message === 'host' ? 403 : 404).end();
      else res.end();
    }
  });
  server.listen(port, '0.0.0.0', () => log(`Holy: servidor en el puerto ${port}`));
  return server;
}
