import http from 'node:http';
import { DiagnosticLog } from '../diagnostics.mjs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync, renameSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve, extname, join } from 'node:path';
import { HOME_PATH, PORT } from './config.mjs';
import {safePath} from '../desktop-config.mjs';
import { packHome } from '../../src/holy.js';

// Holy's server on the Mac: the home page (dist/), the rows it shows and a small
// image cache. Only devices on the local network may ask, and the image cache
// only fetches from the sites' own image hosts.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json' };
// Every connector's image hosts (test-holy-robust checks the catalogue's images are all covered).
export const IMAGE_HOSTS = /(^|\.)(anilist\.co|image\.tmdb\.org|jkdesa\.com|jkanime\.net|wp\.com|repelishd\.blog|cuevana3c\.pro|doramasmp4\.cyou|animeyt\.cc|asialiveaction\.com|doramasflix\.(io|in)|doramasia\.com|mytsumi\.com)$/;
const loopback = ip => ip === '::1' || (isIP(ip || '') === 4 && ip.startsWith('127.'));
const local = ip => {
  if (ip === '::1') return true;
  if (isIP(ip || '') !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
};
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Reading the catalogue is public within the LAN; changing tastes or asking the
// doctor to act is reserved to the packaged app, Holy homes and local controls.
export function mutationAllowed(req, port = PORT) {
  const origin = req.headers.origin;
  const ip = req.socket.remoteAddress?.replace('::ffff:', '');
  if (origin === undefined) return req.headers['sec-fetch-site'] !== 'cross-site' && loopback(ip);
  if (origin === 'null') return true;
  try {
    const url = new URL(origin), host = url.hostname.replace(/^\[|\]$/g, '');
    const originPort = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    return ['http:', 'https:'].includes(url.protocol) && url.origin === origin && !url.username && !url.password && (local(host) || host === 'localhost') &&
      (originPort === port || originPort === PORT);
  } catch { return false; }
}

// Small JSON bodies only (votes).
function body(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    // Too big: keep draining (so the client still gets an answer) but stop storing.
    req.on('data', chunk => { size += chunk.length; if (size <= limit) chunks.push(chunk); });
    req.on('end', () => {
      if (size > limit) { reject(Error('body')); return; }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('json');
        resolve(value);
      } catch { reject(Error('json')); }
    });
    req.on('error', reject);
  });
}

export function startServer({ catalog, library, doctor, port = PORT, root = 'dist-holy', imageDir = '.local/holy-images', log = console.log, status = () => ({}), fetchImage = fetch, diagnostics = new DiagnosticLog() } = {}) {
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
    if (existsSync(path) || existsSync(path + '.type')) {
      try {
        const body = readFileSync(path), type = readFileSync(path + '.type', 'utf8');
        if (!/^image\/[a-z0-9.+-]+(?:\s*;[^\r\n]*)?$/i.test(type) || !body.length || body.length > 4e6) throw Error('cache');
        return { body, type };
      } catch {
        // Interrupted writes must be fetched again rather than failing forever.
        for (const part of [path, path + '.type']) try { unlinkSync(part); } catch { /* Missing already. */ }
      }
    }
    if (!pending.has(key)) pending.set(key, (async () => {
      const response = await fetchImage(url, { headers: { 'User-Agent': UA, Referer: parsed.origin + '/' }, signal: AbortSignal.timeout(15000) });
      const type = response.headers.get('content-type') || 'image/jpeg';
      if (!response.ok || !type.startsWith('image/')) throw Error('image ' + response.status);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 4e6) throw Error('size');
      writeFileSync(path + '.tmp', body); writeFileSync(path + '.type.tmp', type);
      renameSync(path + '.tmp', path); renameSync(path + '.type.tmp', path + '.type');
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
      const raw = Buffer.from(JSON.stringify(packHome({ ...catalog.home(library), profileSync: status().profile || null, catalogVersion: catalog.version, libraryVersion: library.version })));
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
  let clientErrors=0, clientWindow=Date.now();
  // A title from the query string: the catalogue's own copy when known, else just its addresses.
  const versionItem = params => {
    const address = value => (/^https:\/\/[^\s]{4,500}$/.test(String(value || '')) ? String(value) : '');
    const link = address(params.get('url'));
    if (!link || !catalog.connector(String(params.get('source') || ''))) return null;
    return catalog.find(link) || { source: String(params.get('source')), url: link, show: address(params.get('show')), kind: 'dorama', title: '' };
  };
  const server = http.createServer(async (req, res) => {
    const requestedAt=Date.now();
    res.once('finish',()=>{if(res.statusCode>=400||Date.now()-requestedAt>2000)diagnostics.event('http','response',{method:req.method,action:String(req.url||'').split('?')[0].slice(0,160),status:res.statusCode,durationMs:Date.now()-requestedAt},res.statusCode>=400?'warn':'info');});
    const ip = req.socket.remoteAddress?.replace('::ffff:', '');
    if (!local(ip)) { res.writeHead(403).end(); return; }
    const url = new URL(req.url, 'http://holy.local');
    const mutation = ['/holy-api/vote', '/holy-api/language', '/holy-api/client-error', '/holy-api/taste-profile', '/holy-api/doctor', '/holy-api/refresh'].includes(url.pathname) &&
      (req.method === 'POST' || (req.method === 'OPTIONS' && req.headers['access-control-request-method'] === 'POST'));
    if (mutation && !mutationAllowed(req, server.address()?.port || port)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' }).end('{"ok":false,"error":"origen no permitido"}');
      return;
    }
    // The packaged home (file://) reads these too.
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' }).end(); return; }
    try {
      if (url.pathname === '/holy-api/home') {
        res.setHeader('Cache-Control', 'no-store');
        // ?v=2: packed (current screens); without it, the plain rows older installed screens expect.
        if (url.searchParams.get('v') === '2') sendHome(req, res);
        else sendJSON(req, res, { ...catalog.home(library), profileSync: status().profile || null, catalogVersion: catalog.version, libraryVersion: library.version });
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
      } else if (url.pathname === '/holy-api/versions') {
        // The versions (audio / subtitles) a title offers and the one remembered for its series.
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        const item = versionItem(url.searchParams);
        const versions = item ? await catalog.versionsOf(item).catch(() => []) : [];
        res.end(JSON.stringify({ versions, remembered: item ? library.languageOf(item) : null }));
      } else if (url.pathname === '/holy-api/language' && req.method === 'POST') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const { item: sent, version } = await body(req);
        const item = versionItem(new URLSearchParams({ source: sent?.source || '', url: sent?.url || '', show: sent?.show || '' }));
        if (!item) throw Error('Esa serie no tiene una dirección válida.');
        const kind = ['dub', 'sub', 'orig'].includes(version?.kind) ? version.kind : null;
        const saved = library.setLanguage(item, version && kind && version.id ? { id: String(version.id), kind, label: String(version.label || '') } : null);
        res.end(JSON.stringify({ ok: true, remembered: saved, libraryVersion: library.version }));
      } else if (url.pathname === '/holy-api/taste') {
        res.setHeader('Cache-Control', 'no-store');
        sendJSON(req, res, catalog.calibration(library));
      } else if (url.pathname === '/holy-api/client-error' && req.method === 'POST') {
        if(Date.now()-clientWindow>60000){clientWindow=Date.now();clientErrors=0;}
        if(++clientErrors>30){res.writeHead(429).end();return;}
        const detail=await body(req,4096);
        diagnostics.event('ui','client-error',{phase:String(detail.phase||'').slice(0,40),error:String(detail.error||'').slice(0,1600)},'error');
        res.end('{"ok":true}');
      } else if (url.pathname === '/holy-api/taste-profile') {
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'POST') {
          library.mergeTastes(await body(req, 512 * 1024));
          sendJSON(req, res, { ok: true, taste: library.summary(), libraryVersion: library.version });
        } else if (req.method === 'GET') {
          res.setHeader('Content-Disposition', 'attachment; filename="holy-gustos.json"');
          sendJSON(req, res, library.exportTastes());
        } else res.writeHead(405).end();
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
        const path = safePath(base, url.pathname.slice(HOME_PATH.length) || 'index.html');
        if (!path) { res.writeHead(403).end(); return; }
        res.setHeader('Content-Type', TYPES[extname(path)] || 'application/octet-stream');
        // Hashed bundles never change; index.html is revalidated so a new build shows at once.
        res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
        res.end(readFileSync(path));
      } else res.writeHead(404).end();
    } catch (error) {
      diagnostics.event('http','request-error',{error,action:url.pathname},'error');
      const code = error.message === 'host' ? 403 : ['json', 'body'].includes(error.message) || /dirección válida|gusto no es válido|archivo de gustos no es compatible/.test(error.message) ? 400 : 404;
      if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ ok: false, error: code === 400 ? error.message : 'no disponible' }));
      else res.end();
    }
  });
  server.on('error', error => log(`Holy: el servidor no pudo abrir el puerto ${port}: ${error.message}`));
  server.listen(port, '0.0.0.0', () => log(`Holy: servidor en el puerto ${port}`));
  return server;
}
