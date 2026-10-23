import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONNECTORS, connectorFor, fetchText } from './sources.mjs';
import { entryKey, titleKey } from './library.mjs';

// The newest titles from the owner's sites, refreshed on the Mac every half hour.
// Details (genres, synopsis, backdrop) are cached per page: they rarely change.
const REFRESH_EVERY = 30 * 60000;
const DETAILS_PER_REFRESH = 160;
const MAX_DETAILS = 3000;

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
const load = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

export class Catalog {
  constructor({ file = '.local/holy-catalog.json', detailsFile = '.local/holy-details.json', connectors = CONNECTORS, fetch = fetchText, log = () => {} } = {}) {
    Object.assign(this, { file, detailsFile, connectors, fetch, log });
    const data = load(file) || {};
    this.items = Array.isArray(data.items) ? data.items : [];
    this.updatedAt = data.updatedAt || 0;
    this.errors = data.errors || {};
    this.details = new Map(Object.entries(load(detailsFile) || {}));
    this.version = 1;
    this.refreshing = null;
  }
  detailURL(item) { return item.source === 'jkanime' ? item.show : item.url; }
  async refresh() {
    this.refreshing ||= this.run().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async run() {
    const lists = await Promise.all(this.connectors.map(async connector => {
      try {
        const items = connector.parseHome(await this.fetch(connector.site), connector.site);
        if (!items.length) throw Error('no se encontraron títulos (¿cambió el sitio?)');
        delete this.errors[connector.id];
        return items;
      } catch (error) {
        this.errors[connector.id] = error.message;
        this.log(`Holy: ${connector.name}: ${error.message}`);
        // Keep the last good titles from a site that is down for a while.
        return this.items.filter(item => item.source === connector.id);
      }
    }));
    const seen = new Set();
    const items = lists.flat().filter(item => item.title && item.url && !seen.has(item.url) && seen.add(item.url));
    // Round-robin across sites so every row gets genres even when the budget runs out.
    const queues = lists.map(list => list.map(item => this.detailURL(item)).filter(url => url && !this.details.has(url)));
    const longest = Math.max(0, ...queues.map(queue => queue.length));
    const missing = [...new Set(Array.from({ length: longest }, (_, index) => queues.map(queue => queue[index])).flat().filter(Boolean))].slice(0, DETAILS_PER_REFRESH);
    await pool(missing, 4, async url => {
      const item = items.find(candidate => this.detailURL(candidate) === url);
      const connector = connectorFor(item.source);
      const detail = connector.parseDetail(await this.fetch(url), url);
      // Player addresses can carry tokens: never cache them, resolve at play time.
      this.details.set(url, { genres: detail.genres || [], overview: detail.overview || '', backdrop: detail.backdrop || '' });
    });
    while (this.details.size > MAX_DETAILS) this.details.delete(this.details.keys().next().value);
    this.items = items.map(item => this.enrich(item));
    this.updatedAt = Date.now();
    this.version++;
    save(this.file, { updatedAt: this.updatedAt, errors: this.errors, items: this.items });
    save(this.detailsFile, Object.fromEntries(this.details));
    return this.items;
  }
  enrich(item) {
    const detail = this.details.get(this.detailURL(item));
    if (!detail) return item;
    return { ...item, genres: detail.genres.length ? detail.genres : item.genres, overview: detail.overview || item.overview, backdrop: item.backdrop || detail.backdrop };
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
  // Some sites' own pages lead to players that close the TV app: never open those as a fallback.
  pageFallback(item) { return !connectorFor(item.source)?.noPageFallback; }
  // The player page the site itself would open for this title, resolved fresh.
  async resolve(item) {
    const connector = connectorFor(item.source);
    if (!connector) return null;
    if (connector.resolve) return connector.resolve(item, (url, options) => this.fetch(url, { referrer: connector.site, ...options }));
    const detail = connector.parseDetail(await this.fetch(item.url, { referrer: connector.site }), item.url);
    if (detail.genres?.length || detail.overview) {
      const url = this.detailURL(item);
      if (url && !this.details.has(url)) this.details.set(url, { genres: detail.genres || [], overview: detail.overview || '', backdrop: detail.backdrop || '' });
    }
    return connector.player(detail, item.url);
  }
  // Rows for the home: «Continuar viendo», «Para ti», then the latest by kind.
  home(library) {
    const by = kind => this.items.filter(item => item.kind === kind);
    const interleave = (...lists) => {
      const out = [];
      for (let index = 0; lists.some(list => index < list.length); index++) for (const list of lists) if (list[index]) out.push(list[index]);
      return out;
    };
    // One card per film even when two sites carry it.
    const titles = new Set();
    const movies = interleave(...this.connectors.map(connector => by('movie').filter(item => item.source === connector.id)))
      .filter(item => !titles.has(titleKey(item)) && titles.add(titleKey(item)));
    const continuing = library.continueWatching();
    const forYou = library.recommend(interleave(movies, by('anime'), by('dorama'), by('series')), 24);
    const rows = [
      { id: 'continue', title: 'Continuar viendo', items: continuing },
      { id: 'foryou', title: 'Recomendado para ti', items: forYou },
      { id: 'movies', title: 'Películas recién llegadas', items: movies.slice(0, 40) },
      { id: 'anime', title: 'Anime · nuevos episodios', items: by('anime').slice(0, 32) },
      { id: 'doramas', title: 'Doramas · nuevos capítulos', items: by('dorama').slice(0, 32) },
      { id: 'series', title: 'Series · últimos episodios', items: by('series').slice(0, 24) }
    ];
    for (const name of library.favouriteGenres(2)) {
      const items = this.items.filter(item => item.genres?.includes(name) && !continuing.some(entry => entry.key === entryKey(item)));
      if (items.length >= 4) rows.push({ id: 'genre-' + name, title: 'Porque te gusta: ' + name, items: items.slice(0, 24) });
    }
    const hero = continuing.find(item => item.backdrop) || forYou.find(item => item.backdrop) || movies.find(item => item.backdrop) || this.items.find(item => item.backdrop) || null;
    return {
      updatedAt: this.updatedAt, refreshing: !!this.refreshing, hero,
      rows: rows.filter(row => row.items.length), items: this.items,
      sources: this.connectors.map(connector => ({ id: connector.id, name: connector.name, count: this.items.filter(item => item.source === connector.id).length, error: this.errors[connector.id] || '' }))
    };
  }
}
