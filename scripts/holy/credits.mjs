// Who is in each title and who directed it, so tastes can follow people («Con Adam Sandler»).
// Cinemeta (the public catalogue behind Stremio, no key) answers by IMDb id with the three
// top-billed actors, the directors, the IMDb rating and the awards line. A title without an IMDb
// id is first named in Wikidata: the same Spanish or English title (or alias), the same kind and,
// when both say, a year at most one apart; an ambiguous name is left alone rather than guessed.
// Anime is skipped: its people are voice actors, which say little about taste.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const UA = 'HolyLab/0.9 (personal TV catalogue; github.com/raulisai/LGBrave)';
const DAY = 86400000;
const CINEMETA = 'https://v3-cinemeta.strem.io/';
// People of a title rarely change: kept two months. A title nobody could name is asked again after a week.
const KEEP = 60 * DAY, RETRY = 7 * DAY;
export const PEOPLE_KINDS = new Set(['movie', 'series', 'dorama']);
// What Wikidata calls a film or a series (the common classes; anything else is not taken).
const FILMS = new Set(['Q11424', 'Q24869', 'Q29168811', 'Q202866', 'Q506240', 'Q93204', 'Q226730']);
const SHOWS = new Set(['Q5398426', 'Q526877', 'Q1259759', 'Q63952888', 'Q581714', 'Q15416', 'Q117467246']);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const plain = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
// Cinemeta sends some names with HTML entities («Colin O&apos;Donoghue»).
const ENTITIES = { amp: '&', apos: "'", quot: '"', '#39': "'", nbsp: ' ' };
const names = value => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
  .map(name => String(name || '').replace(/&(amp|apos|quot|#39|nbsp);/g, (_, entity) => ENTITIES[entity]).trim()).filter(name => name && name.length <= 80).slice(0, 4);
const yearOf = item => Number(String(item?.year || '').slice(0, 4)) || 0;
export const imdbOf = item => (/^tt\d{5,10}$/.test(item?.imdb || '') ? item.imdb : /imdb\.com\/title\/(tt\d{5,10})/.exec(String(item?.show || item?.url || ''))?.[1] || '');
// One key per title as the sites name it: «amadeus|movie|1984».
export const creditKey = item => plain(item?.title) + '|' + (item?.kind === 'movie' ? 'movie' : 'show') + '|' + (yearOf(item) || '');

async function json(get, url, options = {}) {
  const response = await get(url, { ...options, headers: { 'User-Agent': UA, Accept: 'application/json', ...(options.headers || {}) }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(new URL(url).hostname + ' respondió ' + response.status);
  return response.json();
}

export class Credits {
  constructor({ file = '.local/holy-credits.json', fetch: get = fetch, now = Date.now, log = () => {} } = {}) {
    Object.assign(this, { file, get, now, log });
    let data = {};
    try { if (existsSync(file)) data = JSON.parse(readFileSync(file, 'utf8')); } catch { data = {}; }
    // titles: IMDb id → its people (or `missing` when Cinemeta did not know it). ids: creditKey → IMDb id ('' = not found).
    this.titles = record(data.titles) ? data.titles : {};
    this.ids = record(data.ids) ? data.ids : {};
    this.version = 1;
  }
  idOf(item) { return imdbOf(item) || this.ids[creditKey(item)]?.imdb || ''; }
  of(item) {
    const found = PEOPLE_KINDS.has(item?.kind) && this.titles[this.idOf(item)];
    return found && !found.missing ? found : null;
  }
  // The title's people, top-billed first: up to three actors (order 0, 1, 2) and its directors.
  people(item) {
    const found = this.of(item);
    return found ? [...found.cast.map((name, order) => ({ name, role: 'cast', order })), ...found.directors.map(name => ({ name, role: 'director', order: 0 }))] : [];
  }
  // Every person and how many of these titles they are in (for the «Gustos» chips).
  // A person counts as a director when most of their titles here are ones they directed.
  tally(items) {
    const counts = new Map();
    for (const item of items) for (const person of new Map(this.people(item).map(person => [person.name, person])).values()) {
      const entry = counts.get(person.name) || { name: person.name, count: 0, directed: 0 };
      entry.count++;
      if (person.role === 'director') entry.directed++;
      counts.set(person.name, entry);
    }
    return new Map([...counts].map(([name, entry]) => [name, { name, count: entry.count, role: entry.directed * 2 > entry.count ? 'director' : 'cast' }]));
  }
  // Fills what is missing, history first (the caller orders `items`): IMDb ids from Wikidata for up
  // to `limit` titles, then the people of up to `limit` ids from Cinemeta. Returns how many were added.
  async fill(items, { limit = 60 } = {}) {
    const now = this.now();
    const fresh = (entry, ttl) => entry && now - (entry.at || 0) < ttl;
    const wanted = [...new Map((Array.isArray(items) ? items : []).filter(item => item?.title && PEOPLE_KINDS.has(item.kind)).map(item => [imdbOf(item) || creditKey(item), item])).values()];
    const unnamed = wanted.filter(item => !imdbOf(item) && !fresh(this.ids[creditKey(item)], this.ids[creditKey(item)]?.imdb ? KEEP : RETRY)).slice(0, limit);
    let added = 0;
    for (let index = 0; index < unnamed.length; index += 40) {
      try { await this.name(unnamed.slice(index, index + 40)); }
      catch (error) { this.log('Holy: reparto (Wikidata): ' + error.message); break; }
    }
    const ids = [...new Map(wanted.map(item => [this.idOf(item), item])).entries()].filter(([id]) => id && !fresh(this.titles[id], this.titles[id]?.missing ? RETRY : KEEP)).slice(0, limit);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (next < ids.length) {
        const [id, item] = ids[next++];
        try {
          const meta = (await json(this.get, `${CINEMETA}meta/${item.kind === 'movie' ? 'movie' : 'series'}/${id}.json`))?.meta;
          const cast = names(meta?.cast).slice(0, 3), directors = names(meta?.director).slice(0, 2);
          this.titles[id] = meta?.name ? { at: now, cast, directors, rating: Number(meta.imdbRating) || 0, awards: String(meta.awards || '').slice(0, 120), name: String(meta.name).slice(0, 120) } : { at: now, missing: true };
          if (meta?.name) added++;
        } catch { this.titles[id] = { at: now, missing: true }; }
      }
    }));
    if (unnamed.length || ids.length) { this.version++; this.save(); }
    return added;
  }
  // IMDb ids for titles the sites name only in Spanish (or English): one Wikidata question per 40 titles.
  async name(items) {
    const literal = value => '"' + String(value).replace(/["\\\n\r]/g, ' ').trim() + '"';
    const labels = [...new Set(items.flatMap(item => [item.title, String(item.title).split(/\s+\(/)[0]]).map(title => String(title || '').trim()).filter(title => title.length >= 2 && title.length <= 120))];
    const query = `SELECT ?label ?work ?imdb (MIN(YEAR(?date)) AS ?first) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?class), "entity/"); separator=" ") AS ?classes) WHERE {
      VALUES ?label { ${labels.flatMap(label => [literal(label) + '@es', literal(label) + '@en', literal(label) + '@mul']).join(' ')} }
      ?work rdfs:label|skos:altLabel ?label ; wdt:P345 ?imdb ; wdt:P31 ?class .
      OPTIONAL { ?work wdt:P577 ?date } OPTIONAL { ?work wdt:P580 ?date }
    } GROUP BY ?label ?work ?imdb`;
    const data = await json(this.get, 'https://query.wikidata.org/sparql', { method: 'POST', headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'query=' + encodeURIComponent(query) });
    const found = new Map();
    for (const row of data.results?.bindings || []) {
      const label = plain(row.label?.value), imdb = row.imdb?.value || '', classes = String(row.classes?.value || '').split(' ');
      if (!/^tt\d+$/.test(imdb)) continue;
      const kind = classes.some(name => FILMS.has(name)) ? 'movie' : classes.some(name => SHOWS.has(name)) ? 'show' : '';
      if (!kind) continue;
      if (!found.has(label)) found.set(label, new Map());
      found.get(label).set(imdb, { imdb, kind, year: Number(row.first?.value) || 0 });
    }
    let named = 0;
    const now = this.now();
    for (const item of items) {
      const kind = item.kind === 'movie' ? 'movie' : 'show', year = yearOf(item);
      const options = [...new Map([plain(item.title), plain(String(item.title).split(/\s+\(/)[0])].flatMap(label => [...(found.get(label)?.values() || [])]).map(option => [option.imdb, option])).values()]
        .filter(option => option.kind === kind && (!year || !option.year || Math.abs(option.year - year) <= 1));
      // Two works with that name and no year to tell them apart: better none than the wrong one.
      const pick = options.length === 1 || (year && options.filter(option => option.year).length === 1) ? options.find(option => options.length === 1 || option.year) : null;
      this.ids[creditKey(item)] = { at: now, imdb: pick?.imdb || '' };
      if (pick) named++;
    }
    return named;
  }
  save() {
    // Old answers go first when the file grows (at most 6000 titles and 6000 names).
    const trim = map => Object.fromEntries(Object.entries(map).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 6000));
    this.titles = trim(this.titles); this.ids = trim(this.ids);
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file + '.tmp', JSON.stringify({ titles: this.titles, ids: this.ids }));
      renameSync(this.file + '.tmp', this.file);
    } catch { /* Rebuilt on the next round. */ }
  }
}
