import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isIP } from 'node:net';

// The owner's list of sites (the window «Webs»). When a site moves to another address its
// parsers keep working: requests go to the new address and its answers are read as if they
// came from the original one, so saved titles and history stay valid.
// A new site needs its own reader in code, so it waits here as «por integrar».
const KNOWN_PENDING = [
  { name: 'AnimeOnline Ninja', url: 'https://ww3.animeonline.ninja/', reason: 'Cloudflare responde 403 a la computadora' },
  { name: 'FrameTV', url: 'https://framextv.cc/', reason: 'La página se arma solo con scripts' },
  { name: 'DoramasFlix .beer', url: 'https://doramasflix.beer/', reason: 'Los reproductores no vienen en la página' }
];
const hostOf = url => new URL(url).hostname;
export function cleanSite(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw Error('Escribe una dirección completa, como https://sitio.com/'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || isIP(host) || !host.includes('.') || /\.(local|localhost|internal|lan)$/i.test(host)) throw Error('La dirección debe ser https y de un sitio público.');
  return url.origin + '/';
}
export class SiteRegistry {
  constructor(file = '.local/holy-sites.json') {
    this.file = file; this.moved = {}; this.added = [];
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (data.moved && typeof data.moved === 'object') this.moved = data.moved;
      if (Array.isArray(data.added)) this.added = data.added;
    } catch { /* No changes yet. */ }
    this.routes = []; 
  }
  // Called with the connectors so addresses can be mapped both ways.
  attach(connectors) { this.connectors = connectors; this.rebuild(); return this; }
  rebuild() {
    this.routes = (this.connectors || []).filter(connector => this.moved[connector.id]).map(connector => ({ from: hostOf(connector.site), to: hostOf(this.moved[connector.id]) }));
  }
  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify({ moved: this.moved, added: this.added }, null, 2), { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file);
  }
  currentSite(connector) { return this.moved[connector.id] || connector.site; }
  move(id, value) {
    const connector = this.connectors.find(entry => entry.id === id);
    if (!connector) throw Error('Sitio desconocido.');
    const site = cleanSite(value);
    if (site === connector.site) delete this.moved[id]; else this.moved[id] = site;
    this.rebuild(); this.save();
    return site;
  }
  reset(id) { delete this.moved[id]; this.rebuild(); this.save(); }
  add(value, name) {
    const url = cleanSite(value);
    if ((this.connectors || []).some(connector => hostOf(this.currentSite(connector)) === hostOf(url))) throw Error('Ese sitio ya está integrado.');
    if (this.pending().some(entry => hostOf(entry.url) === hostOf(url))) throw Error('Ese sitio ya está en la lista.');
    this.added.push({ url, name: String(name || '').trim().slice(0, 60) || hostOf(url), at: new Date().toISOString() });
    this.save();
  }
  remove(value) { this.added = this.added.filter(entry => entry.url !== value); this.save(); }
  pending() { return [...KNOWN_PENDING.map(entry => ({ ...entry, known: true })), ...this.added.map(entry => ({ ...entry, reason: 'Agregada por ti; falta programar su lector' }))]; }
  swap(text, from, to) { return text.split('//' + from).join('//' + to).split('//www.' + from).join('//' + to); }
  toLive(url) {
    let value = String(url || '');
    for (const route of this.routes) value = this.swap(value, route.from, route.to);
    return value;
  }
  toCanonical(text) {
    if (typeof text !== 'string') return text;
    for (const route of this.routes) text = this.swap(text, route.to, route.from);
    return text;
  }
}
// What a site answers now; a redirect to another domain usually means it moved.
export async function checkSite(url, fetcher = fetch) {
  const site = cleanSite(url), started = Date.now();
  try {
    const response = await fetcher(site, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' }, signal: AbortSignal.timeout(10000) });
    const final = response.url ? new URL(response.url).origin + '/' : site;
    return { ok: response.ok, status: response.status, ms: Date.now() - started, final, moved: hostOf(final).replace(/^www\./, '') !== hostOf(site).replace(/^www\./, '') };
  } catch (error) { return { ok: false, status: 0, ms: Date.now() - started, final: site, moved: false, error: String(error.message).slice(0, 100) }; }
}
