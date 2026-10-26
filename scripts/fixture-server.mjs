import http from 'node:http';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';

import {tvAddress, lanAddress, safePath} from './desktop-config.mjs';
const tv = tvAddress().host;
const host = lanAddress();
const logs = [];
const allowed = new Set([tv, host, '127.0.0.1', '::1']);
mkdirSync('evidence/browser-lab', { recursive: true });
function page(port, query) {
  const other = port === 43187 ? 43188 : 43187;
  const run = query.get('run') || 'manual';
  const suffix = '?run=' + encodeURIComponent(run);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fixture LG Lab</title>
  <link rel="stylesheet" href="/content-fixture/style.css${suffix}">
  <link rel="stylesheet" href="/ad-fixture/style.css${suffix}">
  <script src="/content-fixture/good.js${suffix}"></script>
  <script src="/ad-fixture/banner.js${suffix}"></script>
  <script src="/ad-fixture/allowed.js${suffix}"></script>
  </head><body style="font:24px Arial;background:#f4f6fa;color:#243149;padding:110px 48px 48px">
  <h1>Una página, menos ruido.</h1><p id="good-content">Contenido editorial que debe seguir visible.</p>
  <div class="lab-ad">Anuncio estático del laboratorio</div><div id="generic-lab-ad">Anuncio genérico</div>
  <img alt="contenido" src="/content-fixture/pixel.png${suffix}">
  <img alt="anuncio" src="/ad-fixture/pixel.png${suffix}">
  <iframe title="anuncio" src="/ad-fixture/frame${suffix}"></iframe>
  <iframe title="contenido" src="/content-fixture/frame${suffix}"></iframe>
  <a href="http://${host}:${other}/fixture?run=navigation">Página en otro origen</a>
  <script>
  window.fixtureReady=false;
  Promise.allSettled([
    fetch('/ad-fixture/fetch${suffix}'),fetch('/content-fixture/fetch${suffix}'),
    new Promise(r=>{let x=new XMLHttpRequest();x.open('GET','/ad-fixture/xhr${suffix}');x.onloadend=r;x.send()}),
    fetch('http://${host}:${other}/ad-fixture/cross${suffix}'),
    fetch('http://${host}:${other}/content-fixture/cross${suffix}'),
    fetch('/content-fixture/cookie${suffix}')
  ]).then(()=>window.fixtureReady=true);
  setTimeout(()=>{let d=document.createElement('div');d.className='lab-ad';d.textContent='Anuncio dinámico';document.body.append(d)},300);
  window.scriptletValue=typeof window.__labScriptlet !== 'undefined' ? window.__labScriptlet : null;
  </script></body></html>`;
}
for (const port of [43187, 43188]) {
  http.createServer((req, res) => {
    const ip = req.socket.remoteAddress?.replace('::ffff:', '');
    if (!allowed.has(ip)) { res.writeHead(403).end(); return; }
    const url = new URL(req.url, `http://${host}:${port}`);
    if (url.pathname === '/lab-log') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(logs)); return;
    }
    if (url.pathname === '/lab-reset' && req.method === 'POST') { logs.length = 0; res.end('OK'); return; }
    logs.push({ time: new Date().toISOString(), port, path: url.pathname, run: url.searchParams.get('run') });
    if (logs.length > 2000) logs.shift();
    writeFileSync('evidence/browser-lab/fixture-requests.json', JSON.stringify(logs, null, 2));
    if (url.pathname !== '/no-cors') res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/navigation-slow') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const delay = Number(url.searchParams.get('delay')) || 2200;
      const page = '<!doctype html><html><head><title>Carga lenta de prueba</title></head><body>';
      if (url.searchParams.has('headers')) setTimeout(() => { if (!res.destroyed) res.end(page + '<h1 id="slow-ready">Página cargada correctamente</h1></body></html>'); }, delay);
      else res.end(page + `<script src="/navigation-hold.js?delay=${delay}"></script><h1 id="slow-ready">Página cargada correctamente</h1></body></html>`);
      return;
    }
    if (url.pathname === '/navigation-hold.js') {
      res.setHeader('Content-Type', 'application/javascript');
      setTimeout(() => { if (!res.destroyed) res.end('window.slowReady=true;'); }, Number(url.searchParams.get('delay')) || 2200);
      return;
    }
    if (url.pathname === '/navigation-empty') {
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Fixture vacío</title><body></body>'); return;
    }
    if (url.pathname === '/navigation-error') {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><h1>Servicio de prueba no disponible</h1>'); return;
    }
    if (url.pathname.startsWith('/luma-home/')) {
      const root = resolve('dist');
      const path = safePath(root, url.pathname.slice('/luma-home/'.length) || 'index.html');
      if (!path) { res.writeHead(403).end(); return; }
      try {
        res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm' })[extname(path)] || 'application/octet-stream');
        // Hashed bundles never change; index.html is revalidated so a new build shows at once.
        res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
        res.end(readFileSync(path));
      } catch { res.writeHead(404).end(); }
      return;
    }
    if (url.pathname === '/deny-xfo') res.setHeader('X-Frame-Options', 'DENY');
    if (url.pathname === '/deny-csp') res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    if (url.pathname.endsWith('cookie')) res.setHeader('Set-Cookie', 'lab_fixture=ok; SameSite=Lax; Path=/');
    if (url.pathname.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(url.pathname.includes('/ad-fixture/') ? 'window.adScriptExecuted=(window.adScriptExecuted||0)+1;' : 'window.goodScriptExecuted=true;');
    } else if (url.pathname.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
      res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64'));
    } else if (url.pathname.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css'); res.end('.lab-ad,#generic-lab-ad{background:#ffd5b0;padding:25px;margin:20px 0}');
    } else if (url.pathname === '/fixture') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page(port, url.searchParams));
    } else if (['/simple', '/deny-xfo', '/deny-csp'].includes(url.pathname) || url.pathname.endsWith('/frame')) {
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Fixture simple</title><h2 id="fixture-simple">Contenido del laboratorio</h2>');
    } else {
      res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}');
    }
  }).listen(port, '0.0.0.0', () => console.log(`Fixtures: http://${host}:${port} (TV y computadora autorizadas)`));
}
