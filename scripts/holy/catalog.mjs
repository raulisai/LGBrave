import { readFileSync, mkdirSync, writeFileSync, renameSync, existsSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fetchText } from './sources.mjs';
import { CONNECTORS, connectorFor } from './connectors.mjs';
import { entryKey, titleKey } from './library.mjs';

// The newest titles from the owner's sites, refreshed on the Mac every half hour.
// Details (genres, synopsis, show page) are cached per page: they rarely change.
// One site failing never empties or blocks the others.
const REFRESH_EVERY = 30 * 60000;
const DETAILS_PER_REFRESH = 220;
const MAX_DETAILS = 4000;
const SITE_DEADLINE = 45000;
// Explicit adult anime is not part of Holy's rows or recommendations.
export const ADULT = /^(hentai|erótica|erotica)$/i;

async function pool(list, size, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, async () => {
    while (next < list.length) { const index = next++; await work(list[index]).catch(() => {}); }
  }));
}
const save = (file, data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file + '.tmp', JSON.stringify(data) + '\n', { mode: 0o600 });
  renameSync(file + '.tmp', file);
};
const load = file => {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { try { copyFileSync(file, `${file}.dañado-${Date.now()}`); } catch { /* Nothing to keep. */ } return null; }
};
const deadline = (promise, ms, message) => {
  let timer;
  return Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error(message)), ms); })]).finally(() => clearTimeout(timer));
};
const valid = item => item && typeof item.title === 'string' && item.title.trim() && /^https:\/\//.test(String(item.url || ''));

export class Catalog {
  constructor({ file = '.local/holy-catalog.json', detailsFile = '.local/holy-details.json', connectors = CONNECTORS, fetch = fetchText, log = () => {} } = {}) {
    Object.assign(this, { file, detailsFile, connectors, fetch, log });
    const data = load(file) || {};
    this.items = (Array.isArray(data.items) ? data.items : []).filter(valid);
    this.updatedAt = Number(data.updatedAt) || 0;
    this.errors = data.errors && typeof data.errors === 'object' ? data.errors : {};
    this.health = data.health && typeof data.health === 'object' ? data.health : {};
    this.details = new Map(Object.entries(load(detailsFile) || {}).filter(([, value]) => value && typeof value === 'object'));
    this.version = 1;
    this.refreshing = null;
  }
  connector(id) { return this.connectors.find(connector => connector.id === id) || connectorFor(id); }
  loader(connector) { return (url, options) => this.fetch(url, { referrer: connector.site, ...options }); }
  detailURL(item) { return this.connector(item.source)?.detailURL?.(item) || (item.source === 'jkanime' ? item.show : item.url) || item.url; }
  async refresh() {
    this.refreshing ||= this.run().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async readSite(connector) {
    const started = Date.now();
    const items = connector.home ? await connector.home(this.loader(connector)) : connector.parseHome(await this.fetch(connector.site), connector.site);
    return { items: (Array.isArray(items) ? items : []).filter(valid), ms: Date.now() - started };
  }
  async run() {
    const lists = await Promise.all(this.connectors.map(async connector => {
      try {
        const { items, ms } = await deadline(this.readSite(connector), SITE_DEADLINE, 'tardó demasiado en responder');
        if (!items.length) throw Error('no se encontraron títulos (¿cambió el sitio?)');
        delete this.errors[connector.id];
        this.health[connector.id] = { ok: true, at: Date.now(), ms, count: items.length };
        return items;
      } catch (error) {
        this.errors[connector.id] = error.message;
        this.health[connector.id] = { ok: false, at: Date.now(), error: error.message, count: this.items.filter(item => item.source === connector.id).length };
        this.log(`Holy: ${connector.name}: ${error.message}`);
        // Keep the last good titles from a site that is down for a while.
        return this.items.filter(item => item.source === connector.id);
      }
    }));
    const seen = new Set();
    const items = lists.flat().filter(item => valid(item) && !seen.has(item.url) && seen.add(item.url));
    // Round-robin across sites so every row gets genres even when the budget runs out.
    const queues = lists.map(list => list.map(item => this.detailURL(item)).filter(url => url && !this.details.has(url)));
    const longest = Math.max(0, ...queues.map(queue => queue.length));
    const missing = [...new Set(Array.from({ length: longest }, (_, index) => queues.map(queue => queue[index])).flat().filter(Boolean))].slice(0, DETAILS_PER_REFRESH);
    await pool(missing, 4, async url => {
      const item = items.find(candidate => this.detailURL(candidate) === url);
      const connector = this.connector(item.source);
      const detail = connector.detail ? await connector.detail(item, this.loader(connector)) : connector.parseDetail(await this.fetch(url), url);
      // Player addresses can carry tokens: never cache them, resolve at play time.
      this.details.set(url, { genres: detail?.genres || [], overview: detail?.overview || '', backdrop: detail?.backdrop || '', poster: detail?.poster || '', show: detail?.show || '' });
    });
    while (this.details.size > MAX_DETAILS) this.details.delete(this.details.keys().next().value);
    this.items = items.map(item => this.enrich(item)).filter(item => !item.genres.some(name => ADULT.test(name)));
    this.updatedAt = Date.now();
    this.version++;
    save(this.file, { updatedAt: this.updatedAt, errors: this.errors, health: this.health, items: this.items });
    save(this.detailsFile, Object.fromEntries(this.details));
    return this.items;
  }
  enrich(item) {
    const detail = this.details.get(this.detailURL(item));
    const genres = Array.isArray(item.genres) ? item.genres : [];
    if (!detail) return { ...item, genres };
    return { ...item, genres: detail.genres?.length ? detail.genres : genres, overview: item.overview || detail.overview || '', backdrop: item.backdrop || detail.backdrop || '',
      poster: item.poster || detail.poster || '', show: item.show || detail.show || '' };
  }
  start(log = this.log) {
    const tick = () => this.refresh().catch(error => log('Holy: catálogo: ' + error.message));
    if (Date.now() - this.updatedAt > REFRESH_EVERY / 3) tick();
    this.timer = setInterval(tick, REFRESH_EVERY);
    this.timer.unref?.();
    return this;
  }
  stop() { clearInterval(this.timer); }
  find(url) { return this.items.find(item => item.url === url) || null; }
  cached(key, ttl, work) {
    this.cache ||= new Map();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = Promise.resolve().then(work).catch(error => { this.cache.delete(key); throw error; });
    this.cache.set(key, { at: Date.now(), value });
    if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value);
    return value;
  }
  // One site's search results; the home asks every site at once and shows the fastest first.
  async search(sourceId, query) {
    const connector = this.connector(sourceId);
    const words = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!connector || (!connector.search && !connector.searchURL) || words.length < 2) return [];
    return this.cached('search\n' + sourceId + '\n' + words.toLowerCase(), 10 * 60000, async () => {
      const found = connector.search
        ? await deadline(connector.search(words, (url, options) => this.fetch(url, { referrer: connector.site, timeout: 9000, ...options })), 15000, 'tardó demasiado en buscar')
        : connector.parseSearch(await this.fetch(connector.searchURL(words), { referrer: connector.site, timeout: 9000 }), connector.site);
      return (Array.isArray(found) ? found : []).filter(valid).slice(0, 40).map(item => this.enrich(item));
    });
  }
  // Titles already in the catalogue that match, instantly.
  searchLocal(query) {
    const fold = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return this.items.filter(item => words.every(word => fold(item.title).includes(word))).slice(0, 30);
  }
  async episodes(sourceId, show) {
    const connector = this.connector(sourceId);
    if (!connector?.episodes || !/^https:\/\//.test(String(show || ''))) return [];
    return this.cached('episodes\n' + show, 20 * 60000, async () => {
      const seasons = await deadline(connector.episodes(show, this.loader(connector), (url, referrer) => this.post(url, referrer)), 25000, 'la lista de episodios tardó demasiado');
      return (Array.isArray(seasons) ? seasons : []).map(season => ({ title: String(season?.title || 'Episodios'), episodes: (season?.episodes || []).filter(entry => /^https:\/\//.test(String(entry?.url || ''))) }))
        .filter(season => season.episodes.length);
    });
  }
  // Same-site form POST (JKAnime's episode list needs its session cookie and token).
  async post(url, referrer) {
    const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    const page = await fetch(referrer, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    const html = await page.text();
    const token = /csrf-token" content="([^"]+)"/.exec(html)?.[1] || '';
    const cookie = page.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': UA, Referer: referrer, Cookie: cookie, 'X-CSRF-TOKEN': token, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' }, body: '_token=' + encodeURIComponent(token) });
    if (!response.ok) throw Error(new URL(url).hostname + ' respondió ' + response.status);
    return response.text();
  }
  // Only sites whose own page the autoplay step knows how to start may be opened as a fallback;
  // others could lead to players that close the TV app.
  pageFallback(item) { return this.connector(item.source)?.pageFallback === true; }
  // The player page the site itself would open for this title, resolved fresh.
  async resolve(item) {
    const connector = this.connector(item.source);
    if (!connector) return null;
    const work = async () => {
      if (connector.resolve) return connector.resolve(item, this.loader(connector));
      const detail = connector.parseDetail(await this.fetch(item.url, { referrer: connector.site }), item.url);
      return connector.player(detail, item.url);
    };
    const target = await deadline(work(), 30000, 'El sitio tardó demasiado en dar el reproductor.');
    if (!target || !/^https:\/\//.test(String(target.url || ''))) return null;
    return { ...target, alternatives: (target.alternatives || []).filter(url => /^https:\/\//.test(String(url || '')) && url !== target.url) };
  }
  // Rows for the home: «Continuar viendo», «Para ti», then the latest by kind, each title with its match.
  home(library) {
    const by = kind => this.items.filter(item => item.kind === kind);
    const interleave = (...lists) => {
      const out = [];
      for (let index = 0; lists.some(list => index < list.length); index++) for (const list of lists) if (list[index]) out.push(list[index]);
      return out;
    };
    const perSite = kind => interleave(...this.connectors.map(connector => by(kind).filter(item => item.source === connector.id)));
    // One card per title even when two sites carry it.
    const once = list => { const titles = new Set(); return list.filter(item => !titles.has(titleKey(item)) && titles.add(titleKey(item))); };
    const movies = once(perSite('movie'));
    const profile = library.profile();
    const score = items => library.scored(items, profile);
    const continuing = library.continueWatching();
    const forYou = library.recommend(once(interleave(movies, perSite('anime'), perSite('dorama'), by('series'))), 24);
    const rows = [
      { id: 'continue', title: 'Continuar viendo', items: score(continuing) },
      { id: 'foryou', title: 'Recomendado para ti', items: forYou.map(item => ({ ...item, vote: library.voteOf(item) })) },
      { id: 'movies', title: 'Películas recién llegadas', items: score(movies.slice(0, 40)) },
      { id: 'anime', title: 'Anime · nuevos episodios', items: score(once(perSite('anime')).slice(0, 40)) },
      { id: 'doramas', title: 'Doramas · nuevos capítulos', items: score(once(perSite('dorama')).slice(0, 40)) },
      { id: 'series', title: 'Series · últimos episodios', items: score(by('series').slice(0, 24)) }
    ];
    for (const name of library.favouriteGenres(2)) {
      const items = this.items.filter(item => item.genres?.includes(name) && !continuing.some(entry => entry.key === entryKey(item)));
      if (items.length >= 4) rows.push({ id: 'genre-' + name, title: 'Porque te gusta: ' + name, items: score(once(items)).sort((a, b) => (b.match || 0) - (a.match || 0)).slice(0, 24) });
    }
    const hero = continuing.find(item => item.backdrop) || forYou.find(item => item.backdrop) || movies.find(item => item.backdrop) || this.items.find(item => item.backdrop) || null;
    return {
      updatedAt: this.updatedAt, refreshing: !!this.refreshing, hero: hero && score([hero])[0],
      rows: rows.filter(row => row.items.length), items: score(this.items), taste: library.summary(),
      sources: this.sources()
    };
  }
  sources() {
    return this.connectors.map(connector => ({ id: connector.id, name: connector.name, count: this.items.filter(item => item.source === connector.id).length,
      error: this.errors[connector.id] || '', search: !!(connector.search || connector.searchURL), health: this.health[connector.id] || null }));
  }
  // «Gustos»: titles to rate, grouped by the catalogue's main genres, plus what was already rated.
  calibration(library) {
    const profile = library.profile();
    const rated = new Set(library.votes.map(vote => vote.key));
    const counts = new Map();
    for (const item of this.items) for (const name of item.genres || []) counts.set(name, (counts.get(name) || 0) + 1);
    const pool = this.items.filter(item => item.genres?.length && (item.poster || item.backdrop));
    const used = new Set();
    const rows = [];
    for (const [name] of [...counts].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      const items = [];
      for (const item of pool) {
        const key = titleKey(item);
        if (!item.genres.includes(name) || used.has(key) || rated.has(entryKey(item))) continue;
        used.add(key); items.push(item);
        if (items.length >= 12) break;
      }
      if (items.length >= 3) rows.push({ id: 'cal-' + name, title: name, items: library.scored(items, profile) });
    }
    const votes = library.votes.map(vote => ({ ...vote, url: vote.url || vote.key, match: library.match(vote, profile).percent }));
    if (votes.length) rows.unshift({ id: 'cal-rated', title: 'Ya calificados', items: votes });
    return { rows, taste: library.summary() };
  }
}
