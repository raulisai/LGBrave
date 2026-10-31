import { readFileSync, mkdirSync, writeFileSync, renameSync, existsSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fetchText, country, languageLabel } from './sources.mjs';
import { CONNECTORS, connectorFor } from './connectors.mjs';
import { genreShelves } from '../../src/holy.js';
import { entryKey, titleKey, nextEpisode } from './library.mjs';
import { matchVersion, publicVersion, targetMatchesLanguage } from './versions.mjs';
import { KnownLists } from './known-lists.mjs';

// The newest titles from the owner's sites, refreshed on the Mac every half hour.
// Details (genres, synopsis, show page) are cached per page: they rarely change.
// One site failing never empties or blocks the others.
const REFRESH_EVERY = 30 * 60000;
const DETAILS_PER_REFRESH = 320;
const MAX_DETAILS = 4000;
const SITE_DEADLINE = 90000;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const strings = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : [];
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
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!record(data)) throw Error('shape');
    return data;
  }
  catch { try { copyFileSync(file, `${file}.dañado-${Date.now()}`); } catch { /* Nothing to keep. */ } return null; }
};
const deadline = (promise, ms, message) => {
  let timer;
  return Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error(message)), ms); })]).finally(() => clearTimeout(timer));
};
const valid = item => record(item) && typeof item.title === 'string' && item.title.trim() && typeof item.url === 'string' && /^https:\/\//.test(item.url);
const cleanItem = item => ({ ...item, genres: strings(item.genres), studios: strings(item.studios), overview: String(item.overview || ''), country: typeof item.country === 'string' ? country(item.country) : '' });
// Genre rows of the home, in their default order ([catalogue genre, row title]).
const GENRE_ROWS = [['Acción', 'Acción'], ['Comedia', 'Comedia'], ['Drama', 'Drama'], ['Suspenso', 'Suspenso y thriller'], ['Terror', 'Terror'], ['Ciencia ficción', 'Ciencia ficción'],
  ['Romance', 'Romance'], ['Animación', 'Animación'], ['Aventura', 'Aventura'], ['Crimen', 'Crimen'], ['Fantasía', 'Fantasía'], ['Misterio', 'Misterio'], ['Familia', 'Familia'],
  ['Documental', 'Documentales'], ['Bélica', 'Bélicas'], ['Shounen', 'Anime shounen'], ['Vida cotidiana', 'Vida cotidiana'], ['Sobrenatural', 'Sobrenatural']];
// What the TV needs of each title: long synopses are cut so the home stays light.
const slim = item => (item.overview && item.overview.length > 280 ? { ...item, overview: item.overview.slice(0, 277).trimEnd() + '…' } : item);
// The owner's first choice per kind: anime goes to JKAnime first, wherever it was picked.
// How long a player found for a title is reused (tokens in player addresses expire).
const RESOLVE_TTL = 150000;
export const PREFERRED = { anime: 'jkanime' };
// Which of the owner's sites carry each kind of title (for finding a title elsewhere).
const KIND_SITES = { movie: ['cuevana', 'repelishd', 'doramasflix'], series: ['cuevana'], anime: ['jkanime', 'animeyt'], dorama: ['doramasflix', 'doramasmp4', 'asialiveaction'] };
const plain = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, ' ').trim();
// Same work on two sites: same title (or the same main title before «:»), and close years when both say.
export function sameTitle(a, b) {
  const [x, y] = [plain(a?.title), plain(b?.title)];
  if (!x || !y) return false;
  const main = value => plain(String(value).split(/[:(]/)[0]);
  const close = !(Number(a?.year) > 1900 && Number(b?.year) > 1900) || Math.abs(Number(a.year) - Number(b.year)) <= 1;
  // Films match on their main title. Shows split into arcs share it too («Tokyo Revengers: A» ≠ «: B»),
  // so a show only matches when one side is the bare main title («One Piece» = «One Piece: Arco de Elbaph»);
  // the episode number then decides.
  if (x === y) return close;
  if (main(a.title).length < 4 || main(a.title) !== main(b.title)) return false;
  if (a?.kind === 'movie' && b?.kind === 'movie') return close;
  return close && (x === main(a.title) || y === main(b.title));
}
const sameKind = (a, b) => a.kind === b.kind || (['series', 'dorama'].includes(a.kind) && ['series', 'dorama'].includes(b.kind));
// Season and episode from the fields or the address patterns the sites use.
export function episodeOf(item) {
  const url = String(item?.url || '');
  let match;
  if ((match = /-(\d+)x(\d+)\/?$/.exec(url))) return { season: +match[1], episode: +match[2] };
  if ((match = /capitulo-(\d+)/.exec(url))) return { season: null, episode: +match[1] };
  if ((match = /^https:\/\/jkanime\.net\/[^/]+\/(\d+)\/$/.exec(url))) return { season: null, episode: +match[1] };
  return { season: null, episode: Number(item?.episode) || null };
}
// A later season against a site without seasons only matches absolute numbering
// (Cuevana's One Piece 15x642 is JKAnime's 642; «2x5» is not anyone's episode 5).
export const sameEpisode = (a, b) => !!a.episode && a.episode === b.episode &&
  (a.season && b.season ? a.season === b.season : (a.season || b.season || 1) <= 1 || a.episode > 30);

// The page each host serves for a video it removed. Only a clear answer counts: a slow or
// unknown host stays in the list and the TV tries it as before.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const GONE_PAGE = /vp_video_stub_txt|can't find the video you are looking for|deleted by the creator|file was deleted|video not found/i;
export async function playerGone(url, referrer) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Referer: referrer }, signal: AbortSignal.timeout(4000) });
  if ([404, 410].includes(response.status)) return true;
  return response.ok && GONE_PAGE.test(await response.text());
}
export class Catalog {
  // knownLists: award and chart lists (null in tests that do not want them).
  constructor({ file = '.local/holy-catalog.json', detailsFile = '.local/holy-details.json', connectors = CONNECTORS, fetch = fetchText, log = () => {}, diagnostics, knownLists, probe = fetch === fetchText ? playerGone : null } = {}) {
    this.probe = probe;
    Object.assign(this, { file, detailsFile, connectors, fetch, log, diagnostics });
    this.knownLists = knownLists === undefined ? (file === '.local/holy-catalog.json' ? new KnownLists({ log }) : null) : knownLists;
    const data = load(file) || {};
    this.items = (Array.isArray(data.items) ? data.items : []).filter(valid).map(cleanItem);
    this.updatedAt = Number(data.updatedAt) || 0;
    this.errors = record(data.errors) ? data.errors : {};
    this.health = record(data.health) ? data.health : {};
    this.details = new Map(Object.entries(load(detailsFile) || {}).filter(([, value]) => record(value)).map(([key, value]) => [key, { ...value, genres: strings(value.genres), studios: strings(value.studios), overview: String(value.overview || '') }]));
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
    const ms = Date.now() - started;
    // Genre pages and directories enlarge the catalogue; failing them never fails the site.
    const more = connector.more ? await connector.more(this.loader(connector)).catch(() => []) : [];
    return { items: [...(Array.isArray(items) ? items : []), ...(Array.isArray(more) ? more : [])].filter(valid), ms, extra: more.length || 0 };
  }
  async run() {
    const lists = await Promise.all(this.connectors.map(async connector => {
      try {
        const { items, ms, extra } = await deadline(this.readSite(connector), SITE_DEADLINE, 'tardó demasiado en responder');
        if (!items.length) throw Error('no se encontraron títulos (¿cambió el sitio?)');
        this.diagnostics?.event('catalog','source-loaded',{source:connector.id,count:items.length,durationMs:ms});
        delete this.errors[connector.id];
        this.health[connector.id] = { ok: true, at: Date.now(), ms, count: items.length, extra };
        return items;
      } catch (error) {
        this.diagnostics?.event('catalog','source-error',{source:connector.id,error},'error');
        this.errors[connector.id] = error.message;
        this.health[connector.id] = { ok: false, at: Date.now(), error: error.message, count: this.items.filter(item => item.source === connector.id).length };
        this.log(`Holy: ${connector.name}: ${error.message}`);
        // Keep the last good titles from a site that is down for a while.
        return this.items.filter(item => item.source === connector.id);
      }
    }));
    // The same address from the home and a genre page: keep one, with every genre it was listed under.
    const byURL = new Map();
    for (const item of lists.flat().filter(valid)) {
      const previous = byURL.get(item.url);
      if (previous) {
        previous.genres = [...new Set([...(previous.genres || []), ...(item.genres || [])])];
        // What one listing knows and the other doesn't (e.g. «en emisión» and its latest episode).
        for (const [key, value] of Object.entries(item)) if (previous[key] === undefined || previous[key] === '') previous[key] = value;
      }
      else byURL.set(item.url, { ...item, genres: [...(item.genres || [])] });
    }
    const items = [...byURL.values()];
    // Round-robin across sites so every row gets genres even when the budget runs out.
    // A page read before versions were noted (no `language`) is read again when its site shows them.
    const stale = (item, url) => !this.details.has(url) || (this.connector(item.source)?.languages && this.details.get(url).language === undefined);
    const queues = lists.map(list => list.filter(item => stale(item, this.detailURL(item))).map(item => this.detailURL(item)).filter(Boolean));
    const longest = Math.max(0, ...queues.map(queue => queue.length));
    const missing = [...new Set(Array.from({ length: longest }, (_, index) => queues.map(queue => queue[index])).flat().filter(Boolean))].slice(0, DETAILS_PER_REFRESH);
    await pool(missing, 4, async url => {
      const item = items.find(candidate => this.detailURL(candidate) === url);
      const connector = this.connector(item.source);
      const detail = connector.detail ? await connector.detail(item, this.loader(connector)) : connector.parseDetail(await this.fetch(url), url);
      // Player addresses can carry tokens: never cache them, resolve at play time.
      this.details.set(url, { genres: detail?.genres || [], overview: detail?.overview || '', backdrop: detail?.backdrop || '', poster: detail?.poster || '', show: detail?.show || '',
        studios: Array.isArray(detail?.studios) ? detail.studios : [], country: detail?.country || '', language: languageLabel(detail?.language), imdb: /^tt\d+$/.test(detail?.imdb || '') ? detail.imdb : '' });
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
    // Audio/subtitles: what the title's page says, else its site's usual version; unknown stays empty.
    const language = detail?.language || item.language || this.connector(item.source)?.language || '';
    if (!detail) return { ...item, genres, language };
    return { ...item, genres: detail.genres?.length ? detail.genres : genres, overview: item.overview || detail.overview || '', backdrop: item.backdrop || detail.backdrop || '',
      poster: item.poster || detail.poster || '', show: item.show || detail.show || '', studios: detail.studios?.length ? detail.studios : item.studios || [], country: country(item.country || detail.country || ''), language, ...(detail.imdb ? { imdb: detail.imdb } : {}) };
  }
  start(log = this.log) {
    const tick = () => {
      this.refresh().catch(error => log('Holy: catálogo: ' + error.message));
      // Award and chart lists change slowly: each one is read again when its time to live ends.
      this.knownLists?.refresh().then(read => { if (read) this.version++; return this.findListTitles(); }).catch(() => {});
    };
    if (Date.now() - this.updatedAt > REFRESH_EVERY / 3) tick();
    this.timer = setInterval(tick, REFRESH_EVERY);
    this.timer.unref?.();
    return this;
  }
  stop() { clearInterval(this.timer); }
  // Award/chart titles missing from the catalogue are searched on the owner's sites (a few per
  // round, three at a time); a copy with the same title (and year when known) becomes playable
  // in its list row. Not found is remembered for a week.
  async findListTitles(limit = 45) {
    const lists = this.knownLists;
    if (!lists || this.findingLists) return this.findingLists || 0;
    const titleKeyOf = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
    this.findingLists = (async () => {
      const jobs = lists.pending(this.items, limit);
      let found = 0;
      await pool(jobs, 3, async ({ list, entry, id }) => {
        const names = [...new Set([entry.title, entry.original].filter(Boolean))];
        const wanted = new Set(entry.aliases.map(titleKeyOf));
        const kinds = { movie: ['movie'], series: ['series', 'dorama'], dorama: ['dorama', 'series'], anime: ['anime'] }[list.kind] || [list.kind];
        let match = null;
        for (const source of KIND_SITES[list.kind] || []) {
          for (const name of names) {
            const results = await this.search(source, name).catch(() => []);
            match = results.find(item => kinds.includes(item.kind) && (wanted.has(titleKeyOf(item.title)) || wanted.has(titleKeyOf(String(item.title).split(/[:(]/)[0])))
              && (!entry.year || !Number(item.year) || Math.abs(Number(item.year) - entry.year) <= 1)) || null;
            if (match) break;
          }
          if (match) break;
        }
        lists.remember(id, match && this.enrich(match));
        if (match) found++;
      });
      if (jobs.length) { lists.save(); if (found) this.version++; }
      return found;
    })().finally(() => { this.findingLists = null; });
    return this.findingLists;
  }
  find(url) { return this.items.find(item => item.url === url) || null; }
  cached(key, ttl, work) {
    // Failed lookups (null) are not kept: the next try asks the site again.
    const keepNull = !key.startsWith('resolve\n');
    this.cache ||= new Map();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = Promise.resolve().then(work).then(result => { if (result == null && !keepNull && this.cache.get(key)?.value === value) this.cache.delete(key); return result; })
      .catch(error => { if (this.cache.get(key)?.value === value) this.cache.delete(key); throw error; });
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
    // «onepiece» finds «One Piece» too.
    const joined = fold(query).replace(/[^a-z0-9]+/g, '');
    return this.items.filter(item => words.every(word => fold(item.title).includes(word)) || (joined.length >= 4 && fold(item.title).replace(/[^a-z0-9]+/g, '').includes(joined))).slice(0, 30);
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
  // The page's session (cookie and token) is reused for a few minutes: one list is several POSTs.
  async post(url, referrer, fresh = false) {
    this.sessions ||= new Map();
    let session = this.sessions.get(referrer);
    if (fresh || !session || Date.now() - session.at > 5 * 60000) {
      const page = await fetch(referrer, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
      const html = await page.text();
      session = { at: Date.now(), token: /csrf-token" content="([^"]+)"/.exec(html)?.[1] || '', cookie: page.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
      this.sessions.set(referrer, session);
      if (this.sessions.size > 50) this.sessions.delete(this.sessions.keys().next().value);
    }
    const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': UA, Referer: referrer, Cookie: session.cookie, 'X-CSRF-TOKEN': session.token, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' }, body: '_token=' + encodeURIComponent(session.token) });
    // An expired session (419 and the like) is renewed once.
    if (!response.ok && !fresh && [401, 403, 419].includes(response.status)) return this.post(url, referrer, true);
    if (!response.ok) throw Error(new URL(url).hostname + ' respondió ' + response.status);
    return response.text();
  }
  // Only sites whose own page the autoplay step knows how to start may be opened as a fallback;
  // others could lead to players that close the TV app.
  pageFallback(item) { return this.connector(item.source)?.pageFallback === true; }
  // The player page the site itself would open for this title, resolved fresh.
  // A player found a moment ago (e.g. while the owner looked at the card) is reused for a
  // couple of minutes; one that failed to start is forgotten (`forgetPlayer`).
  // options: { version: id, kind: 'dub'|'sub'|'orig' } picks that version of a title that has several
  // (the target carries `versions`, the chosen `version` and whether it `matched` what was asked);
  // without a match the site's first one is used.
  async resolve(item, options = {}) {
    const connector = this.connector(item.source);
    if (!connector || !/^https:\/\//.test(String(item?.url || ''))) return null;
    const bundle = await this.cached('resolve\n' + item.url, RESOLVE_TTL, () => this.resolveNow(item, connector));
    if (!bundle) return null;
    if (!bundle.versions.length) return bundle.target;
    const asked = matchVersion(bundle.versions, { id: options.version, kind: options.kind });
    const chosen = asked || bundle.versions[0];
    return { ...chosen.target, versions: bundle.versions.map(publicVersion), version: String(chosen.id), versionKind: chosen.kind, matched: !!asked };
  }
  // Which versions the title has (empty when its site offers a single one), without choosing.
  async versionsOf(item) {
    if (!this.connector(item.source)?.versions) return [];
    const target = await this.resolve(item).catch(() => null);
    return target?.versions || [];
  }
  forgetPlayer(url) { this.cache?.delete('resolve\n' + url); }
  // The playable target for a title, tried the way the TV's own session does it, but in one
  // pass for a plain browser tab that has no curtain or rescue to fall back on: the owner's
  // preferred site for its kind first (anime → JKAnime), then its own site, then the other
  // sites that carry it. Returns the title actually used (a copy on another site, kept under
  // the asked title/art) together with its target, or null when nothing resolved anywhere.
  async resolvePlayable(item, options = {}) {
    const tried = new Set([item.source]);
    const copy = candidate => ({ ...candidate, title: item.title, poster: item.poster || candidate.poster, backdrop: item.backdrop || candidate.backdrop, genres: item.genres?.length ? item.genres : candidate.genres });
    const preference = await this.preference(item).catch(() => null);
    if (preference?.site && !tried.has(preference.site)) {
      const candidates = await this.elsewhere(item, new Set(tried), { only: preference.site, kind: preference.kind }).catch(() => []);
      tried.add(preference.site);
      for (const candidate of candidates.slice(0, 2)) {
        const target = await this.resolve(candidate, options).catch(() => null);
        if (targetMatchesLanguage(target, candidate, options) && target) return { item: copy(candidate), target };
      }
    }
    let target = await this.resolve(item, options).catch(() => null);
    if (!target && this.pageFallback(item) && targetMatchesLanguage({}, item, options)) target = { url: item.url, versions: [] };
    if (target && targetMatchesLanguage(target, item, options)) return { item, target };
    for (const candidate of (await this.elsewhere(item, tried).catch(() => [])).slice(0, 4)) {
      const found = await this.resolve(candidate, options).catch(() => null);
      if (found && targetMatchesLanguage(found, candidate, options)) return { item: copy(candidate), target: found };
    }
    return null;
  }
  async resolveNow(item, connector) {
    // A player the host already took down is skipped here, so the TV never waits on it.
    const living = async target => {
      if (!target || !this.probe) return target;
      const urls = [target.url, ...target.alternatives];
      const gone = await Promise.all(urls.map(url => this.probe(url, item.url).catch(() => false)));
      const alive = urls.filter((url, index) => !gone[index]);
      if (alive.length === urls.length || !alive.length) return target;
      this.diagnostics?.event('catalog', 'player-gone', { source: item.source, title: item.title, host: urls.filter((url, index) => gone[index]).map(url => new URL(url).hostname).join(' ') }, 'warn');
      return { ...target, url: alive[0], alternatives: alive.slice(1) };
    };
    const clean = target => (target && /^https:\/\//.test(String(target.url || '')) ? { ...target, alternatives: (target.alternatives || []).filter(url => /^https:\/\//.test(String(url || '')) && url !== target.url) } : null);
    if (connector.versions) {
      const list = await deadline(connector.versions(item, this.loader(connector)), 30000, 'El sitio tardó demasiado en dar el reproductor.');
      const versions = (await Promise.all((Array.isArray(list) ? list : []).map(async version => ({ ...version, target: await living(clean(version.target)) })))).filter(version => version.target);
      // One version is no choice: it behaves like a site without versions.
      return versions.length ? { target: { ...versions[0].target, version: String(versions[0].id), versionKind: versions[0].kind }, versions: versions.length === 1 ? [] : versions } : null;
    }
    const work = async () => {
      if (connector.resolve) return connector.resolve(item, this.loader(connector));
      const detail = connector.parseDetail(await this.fetch(item.url, { referrer: connector.site }), item.url);
      return connector.player(detail, item.url);
    };
    const target = await living(clean(await deadline(work(), 30000, 'El sitio tardó demasiado en dar el reproductor.')));
    return target ? { target, versions: [] } : null;
  }
  // The same title on the owner's other sites, for when its own site cannot play it:
  // copies already in the catalogue first, then each compatible site's search. For an
  // episode, the same episode number (and season when both sites number seasons).
  // The episode after (step 1) or before (step -1) this one, by number (JKAnime lists newest
  // first): from the show's list when the site has one (none past either end), else from the
  // address pattern (next only) or the site's own address per number (JKAnime).
  async next(item) { return this.neighbour(item, 1); }
  async previous(item) { return this.neighbour(item, -1); }
  async neighbour(item, step) {
    const current = episodeOf(item);
    if (!current.episode) return null;
    const order = entry => (entry.season || 0) * 1e5 + (entry.episode || 0);
    const position = order({ season: current.season, episode: current.episode });
    const connector = this.connector(item.source);
    const seasons = item.show && connector?.episodes ? await this.episodes(item.source, item.show).catch(() => []) : [];
    const list = seasons.flatMap(season => season.episodes).map(entry => ({ ...entry, ...episodeOf(entry), season: entry.season ?? episodeOf(entry).season }));
    if (list.length) {
      const side = list.filter(entry => entry.episode && (step > 0 ? order(entry) > position : order(entry) < position)).sort((a, b) => (order(a) - order(b)) * step)[0];
      return side ? { url: side.url, episode: side.episode, label: side.label || 'Episodio ' + side.episode, still: side.still || '' } : null;
    }
    if (step < 0) {
      const number = current.episode - 1;
      return number >= 1 && item.show && connector?.episodeURL && !current.season ? { url: connector.episodeURL(item.show, number), episode: number, label: 'Episodio ' + number, still: '' } : null;
    }
    const guess = nextEpisode(item);
    return guess ? { ...guess, episode: guess.episode || null, still: '' } : null;
  }
  // Films like this one for the end of a film: shared genres first, then the match;
  // never the same title, one already finished or one without a poster.
  similar(item, library, limit = 4) {
    const genres = new Set(item.genres || []);
    const finished = new Set(library.entries.filter(entry => entry.finished).map(entry => entry.key));
    const titles = new Set([titleKey(item)]);
    const candidates = library.scored(this.items.filter(other => other.kind === item.kind && !other.isShow && other.poster && other.url !== item.url && !finished.has(entryKey(other))));
    return candidates.map(other => ({ other, score: (other.genres || []).filter(name => genres.has(name)).length * 12 + (other.match || 50) }))
      .sort((a, b) => b.score - a.score).map(entry => entry.other)
      .filter(other => !titles.has(titleKey(other)) && titles.add(titleKey(other)))
      .slice(0, limit).map(slim);
  }
  // Where to look first: anime on JKAnime, also anime that a site files as a series
  // (Cuevana's One Piece carries the genre «Anime»; LEGO ONE PIECE only «Animación»).
  async preference(item) {
    let kind = item.kind;
    if (kind === 'series') {
      const genres = item.genres?.length ? item.genres : await this.genresOf(item).catch(() => []);
      if (genres.includes('Anime')) kind = 'anime';
    }
    return PREFERRED[kind] ? { site: PREFERRED[kind], kind } : null;
  }
  // Genres of a title not in the catalogue (e.g. a search result), read once from its page.
  async genresOf(item) {
    const url = item.show || this.detailURL(item);
    if (!/^https:\/\//.test(String(url || ''))) return [];
    const known = this.details.get(url);
    if (known) return known.genres || [];
    const connector = this.connector(item.source);
    if (!connector) return [];
    return this.cached('genres\n' + url, 6 * 3600000, async () => {
      const detail = await deadline(connector.detail ? connector.detail({ ...item, url }, this.loader(connector)) : this.fetch(url).then(html => connector.parseDetail(html, url)), 6000, 'la ficha tardó demasiado');
      return detail?.genres || [];
    });
  }
  // kind: look for it as this kind (an anime filed as a series is searched on the anime sites).
  async elsewhere(item, tried = new Set(), { only, kind } = {}) {
    if (kind) item = { ...item, kind };
    const found = [];
    const allowed = id => !only || id === only;
    const add = candidate => { if (candidate && !tried.has(candidate.source) && candidate.url !== item.url && !found.some(other => other.url === candidate.url)) found.push(candidate); };
    const wanted = episodeOf(item);
    for (const other of this.items) if (allowed(other.source) && !other.isShow && sameTitle(item, other) && sameKind(item, other) && (item.kind === 'movie' || sameEpisode(wanted, episodeOf(other)))) add(other);
    const query = String(item.title || '').split(/[:(]/)[0].trim().slice(0, 40);
    for (const id of KIND_SITES[item.kind] || []) {
      if (tried.has(id) || !allowed(id) || query.length < 2) continue;
      const results = await this.search(id, query).catch(() => []);
      for (const result of results.filter(result => sameTitle(item, result)).slice(0, 2)) {
        if (!result.isShow) { if (item.kind === 'movie' || sameEpisode(wanted, episodeOf(result))) add(result); continue; }
        if (item.kind === 'movie' || !wanted.episode) continue;
        // Sites with one address per episode number (JKAnime) need no episode list.
        const direct = this.connector(id)?.episodeURL;
        if (direct && sameEpisode(wanted, { season: null, episode: wanted.episode })) {
          add({ ...result, url: direct(result.show, wanted.episode), episode: wanted.episode, subtitle: 'Episodio ' + wanted.episode, isShow: false });
          continue;
        }
        const seasons = await this.episodes(id, result.show).catch(() => []);
        const match = seasons.flatMap(season => season.episodes).find(entry => sameEpisode(wanted, { season: entry.season, episode: entry.episode }));
        if (match) add({ ...result, url: match.url, episode: match.episode, subtitle: match.label, isShow: false });
      }
    }
    // Exact titles before «main title» matches; then the closest year (or the newest when unknown).
    const exact = other => Number(plain(other.title) === plain(item.title));
    const year = other => Number(other.year) || 0;
    const distance = other => (Number(item.year) > 1900 ? Math.abs(year(other) - Number(item.year)) : -year(other));
    return found.sort((a, b) => exact(b) - exact(a) || distance(a) - distance(b));
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
    // One card per title and version: the same film in Latino and Subtitulado (or on two sites with different languages) stays twice.
    const once = list => { const seen = new Set(); return list.filter(item => { const key = titleKey(item) + '|' + (item.language || ''); return !seen.has(key) && seen.add(key); }); };
    const movies = once(perSite('movie'));
    const profile = library.profile();
    const personal = profile.signals >= 2;
    const score = items => library.scored(items, profile).map(item => ({ ...item, localWatched: library.get(entryKey(item))?.watched || 0 }));
    // With a profile, the best match first; without one, the sites' own order (newest first).
    const best = items => (personal ? score(items).sort((a, b) => (b.match || 0) - (a.match || 0)) : score(items));
    const continuing = library.continueWatching();
    const playable = list => list.filter(item => !item.isShow);
    const shows = list => list.filter(item => item.isShow);
    // Airing anime (JKAnime's schedule): the shows being watched first, then the best match, long runs before short ones.
    const watching = new Set(continuing.map(entry => entry.show).filter(Boolean));
    const airing = best(by('anime').filter(item => item.airing).sort((a, b) => (b.latest || 0) - (a.latest || 0)))
      .sort((a, b) => watching.has(b.show) - watching.has(a.show));
    // Well-known lists (awards, AniList charts) over this catalogue; titles on them get a small
    // nudge in «Recomendado para ti» when they also fit the owner's tastes.
    const listRows = this.knownLists ? this.knownLists.rows(score(this.items)) : [];
    const acclaimed = new Set(listRows.flatMap(row => row.items.filter(item => !item.discover).map(item => item.show || item.url)));
    const nudge = list => list.map(item => (acclaimed.has(item.show || item.url) ? { ...item, acclaimed: true } : item));
    const forYou = library.recommend(nudge(once(interleave(movies, perSite('anime'), perSite('dorama'), by('series')))), 30);
    const rows = [
      { id: 'continue', title: 'Continuar viendo', items: score(continuing) },
      { id: 'foryou', title: 'Recomendado para ti', items: forYou.map(item => ({ ...item, vote: library.voteOf(item) })) },
      { id: 'movies', title: 'Películas recién llegadas', items: score(movies.slice(0, 40)) },
      { id: 'anime', title: 'Anime · nuevos episodios', items: score(once(playable(perSite('anime'))).slice(0, 40)) },
      { id: 'anime-airing', title: 'Anime en emisión', items: airing.slice(0, 40) },
      { id: 'doramas', title: 'Doramas · nuevos capítulos', items: score(once(playable(perSite('dorama'))).slice(0, 40)) }
    ];
    // Genre rows over everything (films, series, anime, doramas), the owner's favourite genres first.
    const genreRows = GENRE_ROWS.map(([name, title], order) => {
      const items = once(this.items.filter(item => item.genres?.includes(name) && !continuing.some(entry => entry.key === entryKey(item))));
      const affinity = profile.genres.get(name) || 0;
      return { genre: name, id: 'genre-' + name, title: personal && affinity > 0.3 ? 'Porque te gusta: ' + title : title, items: best(items).slice(0, 30), affinity, order };
    }).filter(row => row.items.length >= 6).sort((a, b) => (personal ? b.affinity - a.affinity : 0) || a.order - b.order);
    rows.push(...genreRows.map(({ affinity, order, ...row }) => row));
    const knownGenres = new Set(genreRows.map(row => row.genre));
    rows.push(...genreShelves(this.items).filter(row => !knownGenres.has(row.title)).map(row => ({ ...row, items: best(once(row.items)).slice(0, 30) })));
    // Lists with something to play go right after the newest rows; lists of titles still to
    // find, after the genres.
    const after = Math.max(...['movies', 'anime', 'anime-airing', 'doramas'].map(id => rows.findIndex(row => row.id === id))) + 1;
    rows.splice(after || rows.length, 0, ...listRows.filter(row => row.owned >= 3).map(({ owned, ...row }) => row));
    rows.push(...listRows.filter(row => row.owned < 3).map(({ owned, ...row }) => row));
    rows.push(
      { id: 'anime-shows', title: 'Anime para descubrir', items: best(once(shows(perSite('anime')).filter(item => !item.airing))).slice(0, 30) },
      { id: 'dorama-shows', title: 'Doramas para descubrir', items: best(once(shows(perSite('dorama')))).slice(0, 30) },
      { id: 'series', title: 'Series · últimos episodios', items: score(by('series').slice(0, 24)) }
    );
    const hero = continuing.find(item => item.backdrop) || forYou.find(item => item.backdrop) || movies.find(item => item.backdrop) || this.items.find(item => item.backdrop) || null;
    return {
      updatedAt: this.updatedAt, refreshing: !!this.refreshing, hero: hero && score([hero])[0],
      rows: rows.filter(row => row.items.length).map(row => ({ ...row, items: row.items.map(slim) })), items: score(this.items).map(slim), taste: library.summary(),
      askRating: library.pendingRating?.() || null, preferred: PREFERRED,
      sources: this.sources()
    };
  }
  sources() {
    return this.connectors.map(connector => ({ id: connector.id, name: connector.name, count: this.items.filter(item => item.source === connector.id).length,
      error: this.errors[connector.id] || '', search: !!(connector.search || connector.searchURL), versions: !!connector.versions, health: this.health[connector.id] || null }));
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
    // Tastes to pick directly: genres, producers/studios and countries found in the catalogue.
    const tally = values => { const counts = new Map(); for (const value of values) if (value) counts.set(value, (counts.get(value) || 0) + 1); return counts; };
    const chips = (type, counts, minimum, limit) => [...counts].filter(([, count]) => count >= minimum).sort((a, b) => b[1] - a[1]).slice(0, limit)
      .map(([name, count]) => ({ chip: true, type, name, title: name, count, value: library.prefOf(type, name), url: `holy:gusto:${type}:${name}` }));
    const chipRows = [
      { id: 'pref-genre', title: 'Géneros', items: chips('genre', tally(this.items.flatMap(item => item.genres || [])), 3, 20) },
      { id: 'pref-studio', title: 'Productoras y estudios', items: chips('studio', tally(this.items.flatMap(item => item.studios || [])), 2, 20) },
      { id: 'pref-country', title: 'Países', items: chips('country', tally(this.items.map(item => item.country)), 2, 12) }
    ].filter(row => row.items.length);
    return { rows: [...chipRows, ...rows].map(row => ({ ...row, items: row.items.map(slim) })), taste: library.summary() };
  }
}
